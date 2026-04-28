import { query, queryOne, execute } from '../db.js';
import { LLMFactory } from '../llm/LLMFactory.js';
import type { LLMClient } from '../llm/types.js';
import { PromptBuilder, resolvePromptMode } from '../llm/PromptBuilder.js';
import type {
  Agent, AgentState, AgentTraits, AgentDecision,
  PerceptionContext, Relationship, AgentKnowledge, Group, GossipClaim
} from '../types.js';
import { WorldEngine } from '../world/WorldEngine.js';
import { ConversationEngine } from '../social/ConversationEngine.js';
import { RelationshipEngine } from '../social/RelationshipEngine.js';
import { TradeEngine } from '../social/TradeEngine.js';
import { GossipEngine } from '../cultural/GossipEngine.js';
import { GroupEngine } from '../cultural/GroupEngine.js';
import { KnowledgeEngine } from '../cultural/KnowledgeEngine.js';
import { ConflictEngine } from '../conflict/ConflictEngine.js';
import { GovernanceEngine } from '../conflict/GovernanceEngine.js';
import { BeliefEngine } from '../cultural/BeliefEngine.js';
import type { Redis } from 'ioredis';

// Need decay per tick (1 tick = 1 sim-minute, 1440 ticks = 1 in-game day).
// Calibrated so a full bar (100) drains over a target number of awake ticks.
//   food:  drains 100 → 0 over 2 days (2880 ticks)
//   water: drains 100 → 0 over 1.5 days (2160 ticks)  — water more urgent
//   rest:  drains 100 → 0 over 1 day (1440 ticks)     — rest most urgent
const DECAY = {
  food:  100 / 2880,
  water: 100 / 2160,
  rest:  100 / 1440,
};

// While sleeping: food and water decay at half rate; rest recovers.
const SLEEP_DECAY_MULTIPLIER = 0.5;
const SLEEP_REST_RECOVERY    = 0.15; // ~667 ticks (0 → 100) ≈ 11 game-hours

// HP damage: 1 HP per tick per need that has dropped below the critical
// threshold. Damages stack: an agent that is starving AND dehydrated
// AND exhausted loses 3 HP/tick.
const HP_CRITICAL_THRESHOLD = 5;
const HP_DAMAGE_PER_CRITICAL_NEED = 1;

// HP recovery: when all three physical needs are well above the floor
// and HP is not already full, HP recovers at +0.5/tick.
const HP_RECOVERY_PER_TICK   = 0.5;
const HP_RECOVERY_NEED_FLOOR = 60;

export class AgentEngine {
  private llm: LLMClient;
  private promptBuilder: PromptBuilder;
  private conversationEngine: ConversationEngine;
  private relationshipEngine: RelationshipEngine;
  private tradeEngine: TradeEngine;
  private gossipEngine: GossipEngine;
  private groupEngine: GroupEngine;
  private knowledgeEngine: KnowledgeEngine;
  private conflictEngine: ConflictEngine;
  private governanceEngine: GovernanceEngine;
  private beliefEngine: BeliefEngine;

  constructor(
    private worldEngine: WorldEngine,
    private redis: Redis
  ) {
    this.llm = LLMFactory.fromEnv();
    this.promptBuilder = new PromptBuilder(resolvePromptMode(process.env.OPTIMIZE_PROMPTS));
    this.conversationEngine = new ConversationEngine();
    this.relationshipEngine = new RelationshipEngine();
    this.tradeEngine = new TradeEngine();
    this.gossipEngine = new GossipEngine();
    this.groupEngine = new GroupEngine();
    this.knowledgeEngine = new KnowledgeEngine();
    this.conflictEngine = new ConflictEngine();
    this.governanceEngine = new GovernanceEngine();
    this.beliefEngine = new BeliefEngine();
  }

  async runAgentTick(agentId: string, tick: number, day: number): Promise<void> {
    const agent = await this.loadAgent(agentId);
    if (!agent) return;

    // 1. UPDATE needs and HP
    const updatedState = this.updateNeeds(agent.state, tick);

    // 2. Check death
    if (updatedState.hp <= 0) {
      await this.killAgent(agent, tick, day, updatedState);
      return;
    }

    // 3. PERCEIVE environment
    const perception = await this.perceive(agent, updatedState);

    // 3b. Mark tiles in perception radius as explored (fog-of-war reveal)
    await this.markTilesExplored(agent, updatedState, tick);

    // 4. Get recent memories
    const memories = await this.getRecentMemories(agentId);

    // 5. Get relationships
    const relationships = await this.getRelationships(agentId);

    // 6. Phase 3 context: knowledge, group, reputation
    const [knowledgeFacts, agentGroup, reputationSummary, nearbyGroups] = await Promise.all([
      this.knowledgeEngine.getKnowledge(agentId),
      agent.group_id ? this.groupEngine.getGroup(agent.group_id) : Promise.resolve(null),
      this.gossipEngine.getReputationSummary(agentId, agent.world_id),
      this.groupEngine.getNearbyGroups(agent.world_id, updatedState.position_x, updatedState.position_y, 10),
    ]);

    // 7. DECIDE via LLM
    const prompt = this.promptBuilder.buildDecisionPrompt(
      { ...agent, state: updatedState },
      relationships,
      memories,
      perception,
      tick,
      day,
      knowledgeFacts,
      agentGroup,
      reputationSummary,
      nearbyGroups
    );

    const decision = await this.llm.getAgentDecision(prompt);

    // 8. EXECUTE action
    const finalState = await this.executeAction(agent, updatedState, decision, tick, day, perception);

    // 9. Save state
    await this.saveState(agentId, finalState, tick);

    // 10. Record memory
    await this.recordMemory(agentId, tick, day, decision, finalState);

    // 11. Publish state update to Redis
    await this.publishUpdate(agentId, finalState, decision);
  }

  /**
   * Fog-of-war: stamp every tile inside the agent's perception radius into
   * worlds.explored_tiles. Cumulative across all agents — once any agent has
   * seen a tile, it stays revealed to observers forever.
   */
  private async markTilesExplored(agent: Agent, state: AgentState, tick: number): Promise<void> {
    const RADIUS = 6;
    const WORLD_SIZE = parseInt(process.env.WORLD_SIZE ?? '50');
    const values: string[] = [];
    const params: unknown[] = [agent.world_id, tick, agent.agent_id];
    let p = 4;
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dy = -RADIUS; dy <= RADIUS; dy++) {
        const x = state.position_x + dx;
        const y = state.position_y + dy;
        if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
        values.push(`($1, $${p++}, $${p++}, $2, $3)`);
        params.push(x, y);
      }
    }
    if (values.length === 0) return;
    await execute(
      `INSERT INTO worlds.explored_tiles (world_id, x, y, first_seen_tick, first_seen_agent_id)
       VALUES ${values.join(',')}
       ON CONFLICT (world_id, x, y) DO NOTHING`,
      params
    );
  }

  private updateNeeds(state: AgentState, tick: number): AgentState {
    const s = { ...state };

    // Tick 0 is the spawn tick: no decay applied.
    if (tick === 0) return s;

    if (s.is_awake) {
      s.need_food  = Math.max(0, s.need_food  - DECAY.food);
      s.need_water = Math.max(0, s.need_water - DECAY.water);
      s.need_rest  = Math.max(0, s.need_rest  - DECAY.rest);
    } else {
      s.need_food  = Math.max(0, s.need_food  - DECAY.food  * SLEEP_DECAY_MULTIPLIER);
      s.need_water = Math.max(0, s.need_water - DECAY.water * SLEEP_DECAY_MULTIPLIER);
      s.need_rest  = Math.min(100, s.need_rest + SLEEP_REST_RECOVERY);
    }

    // HP damage stacks across critical needs. Starvation and dehydration
    // bite even while sleeping; exhaustion only damages while awake (you
    // can't suffer exhaustion damage in the act of resting).
    let hpChange = 0;
    if (s.need_food  < HP_CRITICAL_THRESHOLD)                   hpChange -= HP_DAMAGE_PER_CRITICAL_NEED;
    if (s.need_water < HP_CRITICAL_THRESHOLD)                   hpChange -= HP_DAMAGE_PER_CRITICAL_NEED;
    if (s.need_rest  < HP_CRITICAL_THRESHOLD && s.is_awake)     hpChange -= HP_DAMAGE_PER_CRITICAL_NEED;

    // HP recovery requires ALL physical needs above the floor and HP < 100.
    if (
      s.need_food  > HP_RECOVERY_NEED_FLOOR &&
      s.need_water > HP_RECOVERY_NEED_FLOOR &&
      s.need_rest  > HP_RECOVERY_NEED_FLOOR &&
      s.hp < 100
    ) {
      hpChange += HP_RECOVERY_PER_TICK;
    }

    s.hp = Math.min(100, Math.max(0, s.hp + hpChange));

    s.mental_state = this.computeMentalState(s);

    return s;
  }

  private computeMentalState(s: AgentState): AgentState['mental_state'] {
    // Critical survival states — highest priority
    if (s.need_food < 10 || s.need_water < 10 || s.hp < 20) return 'desperate';
    if (s.need_rest < 10 && s.is_awake) return 'tired';

    // Emotional states — based on needs and context
    if (s.need_food < 25 || s.need_water < 25) return 'anxious';
    if (s.need_food < 40 || s.need_water < 40) return 'stressed';
    if (s.need_rest < 25 && s.is_awake) return 'tired';
    if (s.need_belonging < 15) return 'lonely';
    if (s.need_belonging < 25) return 'depressed';

    // Positive states
    if (s.need_food > 80 && s.need_water > 80 && s.need_rest > 70 && s.need_belonging > 60) return 'content';
    if (s.need_belonging > 70 && s.need_esteem > 60) return 'hopeful';

    return 'alert';
  }

  private async perceive(agent: Agent, state: AgentState): Promise<PerceptionContext> {
    const RADIUS = 6;

    // Nearby agents
    const nearbyAgentRows = await query<{
      agent_id: string; name: string; position_x: number; position_y: number;
      current_activity: string;
    }>(
      `SELECT a.agent_id, a.name, s.position_x, s.position_y, s.current_activity
       FROM agents.agents a
       JOIN agents.agent_state s ON a.agent_id = s.agent_id
       WHERE a.world_id = $1 AND a.status = 'alive' AND a.agent_id != $2
         AND ABS(s.position_x - $3) <= $4 AND ABS(s.position_y - $5) <= $4`,
      [agent.world_id, agent.agent_id, state.position_x, RADIUS, state.position_y]
    );

    // Relationships for nearby agents
    const nearbyIds = nearbyAgentRows.map(r => r.agent_id);
    const relRows = nearbyIds.length > 0
      ? await query<{ other_agent_id: string; relationship_type: string }>(
          `SELECT other_agent_id, relationship_type FROM social.relationships
           WHERE agent_id = $1 AND other_agent_id = ANY($2)`,
          [agent.agent_id, nearbyIds]
        )
      : [];
    const relMap = new Map(relRows.map(r => [r.other_agent_id, r.relationship_type]));

    const nearby_agents = nearbyAgentRows.map(r => ({
      agent_id: r.agent_id,
      name: r.name,
      distance: Math.max(Math.abs(r.position_x - state.position_x), Math.abs(r.position_y - state.position_y)),
      activity: r.current_activity,
      relationship_type: relMap.get(r.agent_id) ?? 'stranger',
    }));

    // Visible resources
    const resourceRows = await query<{
      resource_type: string; current_amount: number; x: number; y: number;
    }>(
      `SELECT resource_type, current_amount, x, y
       FROM worlds.resource_nodes
       WHERE world_id = $1 AND NOT is_depleted
         AND ABS(x - $2) <= $3 AND ABS(y - $4) <= $3
       ORDER BY ABS(x - $2) + ABS(y - $4) ASC
       LIMIT 10`,
      [agent.world_id, state.position_x, RADIUS, state.position_y]
    );

    const visible_resources = resourceRows.map(r => ({
      resource_type: r.resource_type,
      amount: r.current_amount,
      distance: Math.max(Math.abs(r.x - state.position_x), Math.abs(r.y - state.position_y)),
      x: r.x,
      y: r.y,
    }));

    // Current tile
    const tileRow = await queryOne<{ terrain: string; is_passable: boolean }>(
      `SELECT terrain, is_passable FROM worlds.map_tiles
       WHERE world_id = $1 AND x = $2 AND y = $3`,
      [agent.world_id, state.position_x, state.position_y]
    );

    const WORLD_SIZE = parseInt(process.env.WORLD_SIZE ?? '50');

    // Passable directions
    const passable_directions: string[] = [];
    const dirs = [
      { name: 'north', dx: 0, dy: -1 },
      { name: 'south', dx: 0, dy: 1 },
      { name: 'east',  dx: 1, dy: 0 },
      { name: 'west',  dx: -1, dy: 0 },
    ];

    for (const d of dirs) {
      const nx = state.position_x + d.dx;
      const ny = state.position_y + d.dy;
      if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
      const tile = await queryOne<{ is_passable: boolean }>(
        'SELECT is_passable FROM worlds.map_tiles WHERE world_id = $1 AND x = $2 AND y = $3',
        [agent.world_id, nx, ny]
      );
      if (tile?.is_passable) passable_directions.push(d.name);
    }

    // ── Phase 5: conflict context ──────────────────────────────────────────────
    let conflict_context: PerceptionContext['conflict_context'];
    if (agent.group_id) {
      const activeWars = await this.conflictEngine.getWarsForGroup(agent.group_id);
      if (activeWars.length > 0) {
        // Resolve enemy group names
        const enemyGroupIds = activeWars.map(w =>
          w.aggressor_group_id === agent.group_id ? w.defender_group_id : w.aggressor_group_id
        );
        const enemyGroups = await query<{ group_id: string; name: string }>(
          `SELECT group_id, name FROM social.groups WHERE group_id = ANY($1)`,
          [enemyGroupIds]
        );
        const enemyGroupMap = new Map(enemyGroups.map(g => [g.group_id, g.name]));

        // Fetch nearby agents' group_ids
        const nearbyWithGroup = nearbyIds.length > 0
          ? await query<{ agent_id: string; group_id: string | null }>(
              `SELECT agent_id, group_id FROM agents.agents WHERE agent_id = ANY($1)`,
              [nearbyIds]
            )
          : [];
        const nearbyGroupMap = new Map(nearbyWithGroup.map(r => [r.agent_id, r.group_id]));

        const actualNearbyEnemies = nearby_agents
          .filter(a => {
            const gid = nearbyGroupMap.get(a.agent_id);
            return gid && enemyGroupIds.includes(gid);
          })
          .map(a => {
            const gid = nearbyGroupMap.get(a.agent_id) ?? '';
            return {
              agent_id: a.agent_id,
              name: a.name,
              group_name: enemyGroupMap.get(gid) ?? 'unknown',
              distance: a.distance,
            };
          });

        const activeTreaties = await this.conflictEngine.getActiveTreaties(agent.group_id);

        conflict_context = {
          active_wars: activeWars.map(w => ({
            war_id: w.war_id,
            enemy_group_id: w.aggressor_group_id === agent.group_id ? w.defender_group_id : w.aggressor_group_id,
            enemy_group_name: enemyGroupMap.get(
              w.aggressor_group_id === agent.group_id ? w.defender_group_id : w.aggressor_group_id
            ) ?? 'unknown',
            casualties_friendly: w.aggressor_group_id === agent.group_id
              ? w.casualties_aggressor : w.casualties_defender,
          })),
          nearby_enemies: actualNearbyEnemies,
          active_treaties: activeTreaties.map(t => ({
            group_name: '', // resolved lazily — not critical for prompt
            treaty_type: t.treaty_type,
          })),
        };
      }
    }

    // ── Phase 6: belief context ────────────────────────────────────────────────
    let belief_context: PerceptionContext['belief_context'];
    const agentBelief = await this.beliefEngine.getAgentBelief(agent.agent_id);
    const nearbySacredSites = await query<{ site_id: string; name: string; belief_name: string; x: number; y: number }>(
      `SELECT ss.site_id, ss.name, bs.name AS belief_name, ss.x, ss.y
       FROM culture.sacred_sites ss
       JOIN culture.belief_systems bs ON bs.belief_id = ss.belief_id
       WHERE ss.world_id = $1
         AND ABS(ss.x - $2) <= 8 AND ABS(ss.y - $3) <= 8`,
      [agent.world_id, state.position_x, state.position_y]
    );

    // Nearby preachers: agents with a belief that are nearby and active
    const nearbyPreachers: Array<{ agent_id: string; name: string; belief_name: string; conviction: number }> = [];
    for (const na of nearby_agents.slice(0, 5)) {
      const nb = await this.beliefEngine.getAgentBelief(na.agent_id);
      if (nb && nb.conviction > 0.6) {
        nearbyPreachers.push({ agent_id: na.agent_id, name: na.name, belief_name: nb.belief_name, conviction: nb.conviction });
      }
    }

    belief_context = {
      own_belief: agentBelief
        ? { name: agentBelief.belief_name, conviction: agentBelief.conviction, prescribes_ritual: true }
        : undefined,
      nearby_preachers: nearbyPreachers,
      nearby_sacred_sites: nearbySacredSites.map(s => ({
        site_id: s.site_id,
        name: s.name ?? 'sacred place',
        belief_name: s.belief_name,
        x: s.x,
        y: s.y,
      })),
    };

    return {
      nearby_agents,
      visible_resources,
      current_tile: {
        world_id: agent.world_id,
        x: state.position_x,
        y: state.position_y,
        terrain: (tileRow?.terrain as any) ?? 'grassland',
        is_passable: tileRow?.is_passable ?? true,
        resources: {},
      },
      passable_directions,
      conflict_context,
      belief_context,
    };
  }

  private async executeAction(
    agent: Agent,
    state: AgentState,
    decision: AgentDecision,
    tick: number,
    day: number,
    perception: PerceptionContext
  ): Promise<AgentState> {
    const s = { ...state };
    const parts = decision.action.split(' ');
    const verb = parts[0];

    switch (verb) {
      case 'move': {
        const dir = parts[1];
        const WORLD_SIZE = parseInt(process.env.WORLD_SIZE ?? '50');
        const moves: Record<string, [number, number]> = {
          north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0]
        };
        const delta = moves[dir];
        if (delta) {
          const nx = Math.max(0, Math.min(WORLD_SIZE - 1, s.position_x + delta[0]));
          const ny = Math.max(0, Math.min(WORLD_SIZE - 1, s.position_y + delta[1]));
          const tile = await queryOne<{ is_passable: boolean }>(
            'SELECT is_passable FROM worlds.map_tiles WHERE world_id = $1 AND x = $2 AND y = $3',
            [agent.world_id, nx, ny]
          );
          if (tile?.is_passable) {
            s.position_x = nx;
            s.position_y = ny;
            s.current_activity = 'moving';
            await this.publishMoved(agent.agent_id, nx, ny);
          }
        }
        break;
      }

      case 'gather': {
        const resourceType = parts[1];
        const node = await queryOne<{ node_id: string; current_amount: number; extraction_rate: number }>(
          `SELECT node_id, current_amount, extraction_rate FROM worlds.resource_nodes
           WHERE world_id = $1 AND x = $2 AND y = $3 AND resource_type = $4 AND NOT is_depleted`,
          [agent.world_id, s.position_x, s.position_y, resourceType]
        );
        if (node) {
          const amount = Math.min(node.extraction_rate, node.current_amount);
          await this.worldEngine.extractResource(node.node_id, amount);
          await this.addToInventory(agent.agent_id, resourceType, amount);
          s.current_activity = `gathering_${resourceType}`;
        }
        break;
      }

      case 'eat': {
        const amount = Math.min(parseFloat(parts[1] ?? '10'), 50);
        const inv = await queryOne<{ amount: number }>(
          `SELECT amount FROM economy.inventory WHERE agent_id = $1 AND resource_type = 'food'`,
          [agent.agent_id]
        );
        if (inv && inv.amount > 0) {
          const eaten = Math.min(amount, inv.amount);
          await execute(
            `UPDATE economy.inventory SET amount = amount - $1 WHERE agent_id = $2 AND resource_type = 'food'`,
            [eaten, agent.agent_id]
          );
          s.need_food = Math.min(100, s.need_food + eaten * 5);
          s.current_activity = 'eating';
        }
        break;
      }

      case 'drink': {
        const amount = Math.min(parseFloat(parts[1] ?? '10'), 50);
        const inv = await queryOne<{ amount: number }>(
          `SELECT amount FROM economy.inventory WHERE agent_id = $1 AND resource_type = 'water'`,
          [agent.agent_id]
        );
        if (inv && inv.amount > 0) {
          const drunk = Math.min(amount, inv.amount);
          await execute(
            `UPDATE economy.inventory SET amount = amount - $1 WHERE agent_id = $2 AND resource_type = 'water'`,
            [drunk, agent.agent_id]
          );
          s.need_water = Math.min(100, s.need_water + drunk * 8);
          s.current_activity = 'drinking';
        }
        break;
      }

      case 'rest': {
        s.is_awake = false;
        s.current_activity = 'resting';
        s.need_rest = Math.min(100, s.need_rest + 5);
        break;
      }

      // ── Phase 2: Talk triggers a full multi-turn conversation ──
      case 'talk': {
        s.current_activity = 'talking';
        const targetName = parts[1];
        const openingMessage = decision.speech ?? parts.slice(2).join(' ') ?? 'Hello.';

        // Find target agent nearby
        const targetInfo = perception.nearby_agents.find(
          a => a.name.toLowerCase() === targetName?.toLowerCase()
        );

        if (targetInfo && openingMessage) {
          const targetAgent = await this.loadAgent(targetInfo.agent_id);
          if (targetAgent) {
            const conv = await this.conversationEngine.runConversation(
              { ...agent, state: s },
              targetAgent,
              openingMessage,
              tick,
              day
            );

            // Apply relationship changes from the conversation
            await this.relationshipEngine.applyConversationChanges(conv);

            // Update local belonging need based on outcome
            if (conv.outcome === 'bonding' || conv.outcome === 'friendly') {
              s.need_belonging = Math.min(100, s.need_belonging + 5);
            }

            // Log as world event
            const eventTitle = conv.outcome === 'hostile'
              ? `${agent.name} and ${targetAgent.name} argued`
              : `${agent.name} talked with ${targetAgent.name}`;

            const significance = conv.outcome === 'bonding' ? 'moderate'
              : conv.outcome === 'hostile' || conv.outcome === 'conflict' ? 'minor'
              : 'trivial';

            const eventId = await this.worldEngine.logEvent({
              world_id: agent.world_id,
              tick,
              day,
              event_type: 'conversation',
              significance,
              title: eventTitle,
              summary: conv.turns.map(t => `${t.speaker_name}: "${t.message}"`).join(' | '),
              participant_agent_ids: [agent.agent_id, targetInfo.agent_id],
              location_x: s.position_x,
              location_y: s.position_y,
              consequences: {
                outcome: conv.outcome,
                conversation_id: conv.conversation_id,
                turns: conv.turns.length,
              },
            });

            // Link event back to conversation record
            if (conv.conversation_id && eventId) {
              await execute(
                `UPDATE social.conversations SET event_id = $1 WHERE conversation_id = $2`,
                [eventId, conv.conversation_id]
              );
            }

            // Publish to WebSocket
            await this.redis.publish('genesis:events', JSON.stringify({
              type: 'event:significant',
              event_id: null,
              event_type: 'conversation',
              significance,
              title: eventTitle,
              summary: `${conv.turns.length} turns — outcome: ${conv.outcome}`,
              tick,
              day,
              participant_agent_ids: [agent.agent_id, targetInfo.agent_id],
            }));
          }
        } else if (decision.speech) {
          // Fallback: target not found nearby, just log monologue
          await this.worldEngine.logEvent({
            world_id: agent.world_id,
            tick,
            day,
            event_type: 'speech',
            significance: 'trivial',
            title: `${agent.name} speaks`,
            summary: `"${decision.speech}"`,
            participant_agent_ids: [agent.agent_id],
            location_x: s.position_x,
            location_y: s.position_y,
            consequences: {},
          });
        }
        break;
      }

      // ── Phase 2: Trade action ──
      case 'offer_trade': {
        s.current_activity = 'trading';
        const targetName = parts[1];
        const targetInfo = perception.nearby_agents.find(
          a => a.name.toLowerCase() === targetName?.toLowerCase()
        );

        if (targetInfo && decision.trade_offer) {
          const targetAgent = await this.loadAgent(targetInfo.agent_id);
          if (targetAgent) {
            const trade = await this.tradeEngine.executeTrade(
              { ...agent, state: s },
              targetAgent,
              decision.trade_offer,
              tick,
              day
            );

            const tradeVerb = trade.status === 'accepted' ? 'traded with'
              : trade.status === 'countered' ? 'negotiated with'
              : 'offered a trade to';

            const eventId = await this.worldEngine.logEvent({
              world_id: agent.world_id,
              tick,
              day,
              event_type: 'trade',
              significance: trade.status === 'accepted' ? 'minor' : 'trivial',
              title: `${agent.name} ${tradeVerb} ${targetAgent.name}`,
              summary: `Offered: ${JSON.stringify(trade.offered_items)} | Wanted: ${JSON.stringify(trade.requested_items)} | Result: ${trade.status}`,
              participant_agent_ids: [agent.agent_id, targetInfo.agent_id],
              location_x: s.position_x,
              location_y: s.position_y,
              consequences: { trade_id: trade.trade_id, status: trade.status },
            });

            if (trade.trade_id && eventId) {
              await execute(
                `UPDATE economy.trades SET event_id = $1 WHERE trade_id = $2`,
                [eventId, trade.trade_id]
              );
            }

            // Publish trade events to WebSocket
            if (trade.status === 'accepted') {
              await this.redis.publish('genesis:events', JSON.stringify({
                type: 'event:significant',
                event_id: null,
                event_type: 'trade',
                significance: 'minor',
                title: `${agent.name} traded with ${targetAgent.name}`,
                summary: `${trade.status}: ${JSON.stringify(trade.offered_items)} for ${JSON.stringify(trade.requested_items)}`,
                tick,
                day,
                participant_agent_ids: [agent.agent_id, targetInfo.agent_id],
              }));
            }
          }
        }
        break;
      }

      // ── Phase 3: Gossip ──
      case 'gossip': {
        // gossip [listener_name] [subject_name] [claim]
        const listenerName = parts[1];
        const subjectName  = parts[2];
        const claim        = (decision.gossip_claim ?? parts[3]) as GossipClaim | undefined;

        const listenerInfo = perception.nearby_agents.find(
          a => a.name.toLowerCase() === listenerName?.toLowerCase()
        );

        if (listenerInfo && subjectName && claim) {
          // Resolve subject agent — they don't need to be nearby
          const subjectRow = await queryOne<{ agent_id: string }>(
            `SELECT agent_id FROM agents.agents
             WHERE world_id = $1 AND LOWER(name) = LOWER($2) AND status = 'alive'`,
            [agent.world_id, subjectName]
          );

          if (subjectRow) {
            const [listenerAgent, subjectAgent] = await Promise.all([
              this.loadAgent(listenerInfo.agent_id),
              this.loadAgent(subjectRow.agent_id),
            ]);

            if (listenerAgent && subjectAgent) {
              const gossipEvent = await this.gossipEngine.processGossip(
                { ...agent, state: s },
                listenerAgent,
                subjectAgent,
                claim,
                tick,
                day
              );

              s.current_activity = 'gossiping';
              s.need_belonging = Math.min(100, s.need_belonging + 1);

              await this.worldEngine.logEvent({
                world_id: agent.world_id,
                tick,
                day,
                event_type: 'gossip',
                significance: 'trivial',
                title: `${agent.name} gossiped about ${subjectAgent.name}`,
                summary: `${agent.name} told ${listenerAgent.name} that ${subjectAgent.name} is "${claim}" — ${gossipEvent.believed ? 'believed' : 'dismissed'}`,
                participant_agent_ids: [agent.agent_id, listenerInfo.agent_id, subjectRow.agent_id],
                location_x: s.position_x,
                location_y: s.position_y,
                consequences: { claim, believed: gossipEvent.believed, trust_change: gossipEvent.trust_change_subject },
              });

              await this.redis.publish('genesis:events', JSON.stringify({
                type: 'event:significant',
                event_id: null,
                event_type: 'gossip',
                significance: 'trivial',
                title: `${agent.name} gossiped about ${subjectAgent.name}`,
                summary: `Told ${listenerAgent.name}: "${subjectAgent.name} is ${claim}" — ${gossipEvent.believed ? 'believed' : 'dismissed'}`,
                tick,
                day,
                participant_agent_ids: [agent.agent_id, listenerInfo.agent_id, subjectRow.agent_id],
              }));
            }
          }
        }
        break;
      }

      // ── Phase 3: Group formation ──
      case 'form_group': {
        const groupName    = decision.group_name    ?? parts.slice(1, -1).join(' ');
        const groupPurpose = decision.group_purpose ?? parts[parts.length - 1] ?? '';

        if (groupName) {
          const newGroup = await this.groupEngine.formGroup(
            { ...agent, state: s },
            groupName,
            groupPurpose,
            tick,
            day
          );

          s.current_activity = 'organizing';
          s.need_belonging = Math.min(100, s.need_belonging + 10);

          await this.worldEngine.logEvent({
            world_id: agent.world_id,
            tick,
            day,
            event_type: 'group_formed',
            significance: 'moderate',
            title: `${agent.name} founded "${newGroup.name}"`,
            summary: `${agent.name} established a new group called "${newGroup.name}"${groupPurpose ? ` with purpose: ${groupPurpose}` : ''}`,
            participant_agent_ids: [agent.agent_id],
            location_x: s.position_x,
            location_y: s.position_y,
            consequences: { group_id: newGroup.group_id, group_name: newGroup.name },
          });

          await this.redis.publish('genesis:events', JSON.stringify({
            type: 'group:formed',
            group_id: newGroup.group_id,
            group_name: newGroup.name,
            founder_id: agent.agent_id,
            colour: newGroup.colour,
            tick,
          }));
        }
        break;
      }

      // ── Phase 3: Group joining ──
      case 'join_group': {
        const targetGroupName = decision.group_name ?? parts.slice(1).join(' ');

        if (targetGroupName) {
          const joined = await this.groupEngine.joinGroup(
            { ...agent, state: s },
            targetGroupName,
            tick,
            day
          );

          if (joined) {
            s.current_activity = 'joining_group';
            s.need_belonging = Math.min(100, s.need_belonging + 8);

            await this.worldEngine.logEvent({
              world_id: agent.world_id,
              tick,
              day,
              event_type: 'group_joined',
              significance: 'minor',
              title: `${agent.name} joined "${joined.name}"`,
              summary: `${agent.name} became a member of "${joined.name}"`,
              participant_agent_ids: [agent.agent_id],
              location_x: s.position_x,
              location_y: s.position_y,
              consequences: { group_id: joined.group_id, group_name: joined.name },
            });

            await this.redis.publish('genesis:events', JSON.stringify({
              type: 'group:member_joined',
              group_id: joined.group_id,
              group_name: joined.name,
              agent_id: agent.agent_id,
              agent_name: agent.name,
              tick,
            }));
          }
        }
        break;
      }

      // ── Phase 3: Group leaving ──
      case 'leave_group': {
        if (agent.group_id) {
          const grp = await this.groupEngine.getGroup(agent.group_id);
          await this.groupEngine.leaveGroup({ ...agent, state: s }, tick);

          s.current_activity = 'idle';
          s.need_belonging = Math.max(0, s.need_belonging - 5);

          if (grp) {
            await this.worldEngine.logEvent({
              world_id: agent.world_id,
              tick,
              day,
              event_type: 'group_left',
              significance: 'trivial',
              title: `${agent.name} left "${grp.name}"`,
              summary: `${agent.name} departed from the group "${grp.name}"`,
              participant_agent_ids: [agent.agent_id],
              location_x: s.position_x,
              location_y: s.position_y,
              consequences: { group_id: grp.group_id },
            });

            await this.redis.publish('genesis:events', JSON.stringify({
              type: 'group:member_left',
              agent_id: agent.agent_id,
              agent_name: agent.name,
              group_id: grp.group_id,
              group_name: grp.name,
            }));
          }
        }
        break;
      }

      // ── Phase 5: Declare war ──────────────────────────────────────────────────
      case 'declare_war': {
        if (!agent.group_id) break;
        const targetGroupName = decision.war_target_group ?? parts.slice(1).join(' ');
        const targetGroup = await queryOne<{ group_id: string; name: string }>(
          `SELECT group_id, name FROM social.groups WHERE world_id = $1 AND LOWER(name) = LOWER($2)`,
          [agent.world_id, targetGroupName]
        );
        if (targetGroup) {
          const war = await this.conflictEngine.declareWar(
            agent.group_id, targetGroup.group_id, agent.world_id, tick, day
          );
          if (war) {
            s.current_activity = 'declaring_war';
            await this.worldEngine.logEvent({
              world_id: agent.world_id, tick, day,
              event_type: 'war_declared', significance: 'major',
              title: `War declared against "${targetGroup.name}"`,
              summary: `${agent.name} led their group to declare war on "${targetGroup.name}"`,
              participant_agent_ids: [agent.agent_id],
              location_x: s.position_x, location_y: s.position_y,
              consequences: { war_id: war.war_id, aggressor_group_id: agent.group_id, defender_group_id: targetGroup.group_id },
            });
            await this.redis.publish('genesis:events', JSON.stringify({
              type: 'conflict:war_declared', war_id: war.war_id,
              aggressor_group_id: agent.group_id, defender_group_id: targetGroup.group_id,
              defender_group_name: targetGroup.name, tick,
            }));
          }
        }
        break;
      }

      // ── Phase 5: Raid ─────────────────────────────────────────────────────────
      case 'raid': {
        const targetName = parts[1] ?? decision.target;
        const targetInfo = perception.nearby_agents.find(
          a => a.name.toLowerCase() === targetName?.toLowerCase()
        );
        if (targetInfo) {
          const targetAgent = await this.loadAgent(targetInfo.agent_id);
          if (targetAgent) {
            const activeWar = agent.group_id && targetAgent.group_id
              ? await this.conflictEngine.getActiveWar(agent.group_id, targetAgent.group_id)
              : null;
            const skirmish = await this.conflictEngine.executeRaid(
              { ...agent, state: s }, targetAgent,
              agent.world_id, tick, day, activeWar?.war_id
            );
            s.current_activity = 'raiding';
            s.hp = Math.max(0, s.hp - skirmish.hp_damage_attacker);
            const won = skirmish.outcome === 'attacker_won';
            await this.worldEngine.logEvent({
              world_id: agent.world_id, tick, day,
              event_type: 'skirmish', significance: 'major',
              title: won ? `${agent.name} defeated ${targetAgent.name}` : `${agent.name} lost to ${targetAgent.name}`,
              summary: `Combat: attacker power ${skirmish.attacker_power.toFixed(1)} vs defender ${skirmish.defender_power.toFixed(1)}. Outcome: ${skirmish.outcome}`,
              participant_agent_ids: [agent.agent_id, targetInfo.agent_id],
              location_x: s.position_x, location_y: s.position_y,
              consequences: { skirmish_id: skirmish.skirmish_id, outcome: skirmish.outcome, resources_stolen: skirmish.resources_stolen },
            });
            await this.redis.publish('genesis:events', JSON.stringify({
              type: 'conflict:skirmish', outcome: skirmish.outcome,
              attacker_id: agent.agent_id, defender_id: targetAgent.agent_id, tick,
            }));
          }
        }
        break;
      }

      // ── Phase 5: Defend territory ─────────────────────────────────────────────
      case 'defend_territory': {
        // Defensive posture: agent stays put but gets a small combat power boost logged
        s.current_activity = 'defending';
        await this.worldEngine.logEvent({
          world_id: agent.world_id, tick, day,
          event_type: 'defense', significance: 'minor',
          title: `${agent.name} defends their territory`,
          summary: `${agent.name} stands guard at (${s.position_x}, ${s.position_y})`,
          participant_agent_ids: [agent.agent_id],
          location_x: s.position_x, location_y: s.position_y,
          consequences: {},
        });
        break;
      }

      // ── Phase 5: Propose treaty ───────────────────────────────────────────────
      case 'propose_treaty': {
        if (!agent.group_id) break;
        const treatyTargetName = decision.treaty_target_group ?? parts.slice(2).join(' ');
        const treatyType = (decision.treaty_type ?? parts[1] ?? 'non_aggression') as any;
        const tGroup = await queryOne<{ group_id: string; name: string }>(
          `SELECT group_id, name FROM social.groups WHERE world_id = $1 AND LOWER(name) = LOWER($2)`,
          [agent.world_id, treatyTargetName]
        );
        if (tGroup) {
          const treaty = await this.conflictEngine.proposeTreaty(
            agent.group_id, tGroup.group_id, treatyType, agent.world_id, tick, day
          );
          if (treaty) {
            s.current_activity = 'negotiating';
            await this.worldEngine.logEvent({
              world_id: agent.world_id, tick, day,
              event_type: 'treaty_proposed', significance: 'moderate',
              title: `${agent.name} proposes a ${treatyType} treaty with "${tGroup.name}"`,
              summary: `A ${treatyType} treaty was offered to "${tGroup.name}"`,
              participant_agent_ids: [agent.agent_id],
              location_x: s.position_x, location_y: s.position_y,
              consequences: { treaty_id: treaty.treaty_id, treaty_type: treatyType },
            });
          }
        }
        break;
      }

      // ── Phase 5: Challenge leadership ─────────────────────────────────────────
      case 'challenge_leader': {
        if (!agent.group_id) break;
        const event = await this.governanceEngine.challengeLeadership(
          { ...agent, state: s }, agent.group_id, agent.world_id, tick, day
        );
        if (event) {
          s.current_activity = 'challenging';
          const outcome = event.outcome;
          await this.worldEngine.logEvent({
            world_id: agent.world_id, tick, day,
            event_type: 'leadership_challenge', significance: 'major',
            title: `${agent.name} challenged the leader`,
            summary: `Leadership vote: ${event.votes_challenger} vs ${event.votes_incumbent}. Outcome: ${outcome}`,
            participant_agent_ids: [agent.agent_id, event.incumbent_id],
            location_x: s.position_x, location_y: s.position_y,
            consequences: { outcome, mechanism: event.mechanism },
          });
          await this.redis.publish('genesis:events', JSON.stringify({
            type: 'governance:leadership_change', group_id: agent.group_id,
            new_leader_id: outcome === 'challenger_wins' ? agent.agent_id : event.incumbent_id,
            outcome, tick,
          }));
        }
        break;
      }

      // ── Phase 5: Exile member ─────────────────────────────────────────────────
      case 'exile_member': {
        if (!agent.group_id) break;
        const exileTargetName = decision.exile_target ?? parts.slice(1).join(' ');
        const exileRow = await queryOne<{ agent_id: string; name: string }>(
          `SELECT agent_id, name FROM agents.agents WHERE world_id = $1 AND LOWER(name) = LOWER($2) AND status = 'alive'`,
          [agent.world_id, exileTargetName]
        );
        if (exileRow) {
          const exiled = await this.governanceEngine.exileMember(
            agent.agent_id, exileRow.agent_id, agent.group_id, agent.world_id
          );
          if (exiled) {
            s.current_activity = 'exiling';
            await this.worldEngine.logEvent({
              world_id: agent.world_id, tick, day,
              event_type: 'exile', significance: 'major',
              title: `${agent.name} exiled ${exileRow.name}`,
              summary: `${exileRow.name} was banished from the group by ${agent.name}`,
              participant_agent_ids: [agent.agent_id, exileRow.agent_id],
              location_x: s.position_x, location_y: s.position_y,
              consequences: { exiled_agent_id: exileRow.agent_id },
            });
          }
        }
        break;
      }

      // ── Phase 5: Defect to another group ──────────────────────────────────────
      case 'defect_to': {
        const defectGroupName = decision.group_name ?? parts.slice(1).join(' ');
        const defectGroup = await queryOne<{ group_id: string; name: string }>(
          `SELECT group_id, name FROM social.groups WHERE world_id = $1 AND LOWER(name) = LOWER($2)`,
          [agent.world_id, defectGroupName]
        );
        if (defectGroup) {
          const defected = await this.governanceEngine.defectToGroup(
            { ...agent, state: s }, defectGroup.group_id, tick, day
          );
          if (defected) {
            s.current_activity = 'defecting';
            s.need_belonging = Math.min(100, s.need_belonging + 5);
            await this.worldEngine.logEvent({
              world_id: agent.world_id, tick, day,
              event_type: 'defection', significance: 'moderate',
              title: `${agent.name} defected to "${defectGroup.name}"`,
              summary: `${agent.name} abandoned their old group and joined "${defectGroup.name}"`,
              participant_agent_ids: [agent.agent_id],
              location_x: s.position_x, location_y: s.position_y,
              consequences: { new_group_id: defectGroup.group_id },
            });
          }
        }
        break;
      }

      // ── Phase 6: Found a belief ───────────────────────────────────────────────
      case 'found_belief': {
        const bName  = decision.belief_name  ?? parts[1] ?? 'The Way';
        const bTenet = decision.belief_tenet ?? parts.slice(2).join(' ') ?? 'seek truth above all';
        const belief = await this.beliefEngine.foundBelief(
          { ...agent, state: s }, bName, bTenet, tick, day
        );
        if (belief) {
          s.current_activity = 'founding_belief';
          s.need_esteem = Math.min(100, s.need_esteem + 15);
          await this.worldEngine.logEvent({
            world_id: agent.world_id, tick, day,
            event_type: 'belief_founded', significance: 'historic',
            title: `${agent.name} founded "${belief.name}"`,
            summary: `A new belief arose: "${belief.name}" — tenet: "${belief.core_tenet}"`,
            participant_agent_ids: [agent.agent_id],
            location_x: s.position_x, location_y: s.position_y,
            consequences: { belief_id: belief.belief_id, tenet: belief.core_tenet },
          });
          await this.redis.publish('genesis:events', JSON.stringify({
            type: 'culture:belief_founded', belief_id: belief.belief_id,
            belief_name: belief.name, founder_id: agent.agent_id,
            colour: belief.colour, tick,
          }));
        }
        break;
      }

      // ── Phase 6: Preach ───────────────────────────────────────────────────────
      case 'preach': {
        const preachTargetName = decision.preach_target ?? parts[1];
        const preachTargetInfo = perception.nearby_agents.find(
          a => a.name.toLowerCase() === preachTargetName?.toLowerCase()
        );
        if (preachTargetInfo) {
          const result = await this.beliefEngine.preach(
            { ...agent, state: s }, preachTargetInfo.agent_id, agent.world_id, tick, day
          );
          s.current_activity = 'preaching';
          s.need_esteem = Math.min(100, s.need_esteem + (result.converted ? 10 : 2));
          if (result.converted) {
            await this.worldEngine.logEvent({
              world_id: agent.world_id, tick, day,
              event_type: 'conversion', significance: 'moderate',
              title: `${agent.name} converted ${preachTargetInfo.name}`,
              summary: `${preachTargetInfo.name} adopted ${agent.name}'s belief with conviction ${result.conviction_delta.toFixed(2)}`,
              participant_agent_ids: [agent.agent_id, preachTargetInfo.agent_id],
              location_x: s.position_x, location_y: s.position_y,
              consequences: { converted: true, conviction: result.conviction_delta },
            });
          }
        }
        break;
      }

      // ── Phase 6: Perform ritual ───────────────────────────────────────────────
      case 'perform_ritual': {
        const result = await this.beliefEngine.performRitual({ ...agent, state: s }, agent.world_id, tick);
        if (result) {
          s.current_activity = 'performing_ritual';
          s.need_esteem    = Math.min(100, s.need_esteem    + result.esteem_gain);
          s.need_belonging = Math.min(100, s.need_belonging + result.belonging_gain);
          await this.worldEngine.logEvent({
            world_id: agent.world_id, tick, day,
            event_type: 'ritual', significance: 'minor',
            title: `${agent.name} performed a ritual`,
            summary: `${agent.name} completed a religious ritual (+${result.esteem_gain} esteem, +${result.belonging_gain} belonging)`,
            participant_agent_ids: [agent.agent_id],
            location_x: s.position_x, location_y: s.position_y,
            consequences: { esteem_gain: result.esteem_gain, belonging_gain: result.belonging_gain },
          });
        }
        break;
      }

      // ── Phase 6: Record myth ──────────────────────────────────────────────────
      case 'record_myth': {
        const mTitle     = decision.myth_title     ?? parts[1] ?? 'The Legend';
        const mNarrative = decision.myth_narrative ?? parts.slice(2).join(' ') ?? decision.thought;
        const myth = await this.beliefEngine.recordMyth(
          { ...agent, state: s }, null, mTitle, mNarrative, agent.world_id, tick, day
        );
        if (myth) {
          s.current_activity = 'storytelling';
          s.need_actualization = Math.min(100, s.need_actualization + 10);
          await this.worldEngine.logEvent({
            world_id: agent.world_id, tick, day,
            event_type: 'myth_created', significance: 'moderate',
            title: `${agent.name} composed a myth: "${myth.title}"`,
            summary: myth.narrative.slice(0, 200),
            participant_agent_ids: [agent.agent_id],
            location_x: s.position_x, location_y: s.position_y,
            consequences: { myth_id: myth.myth_id },
          });
        }
        break;
      }

      // ── Phase 6: Claim sacred site ────────────────────────────────────────────
      case 'claim_sacred': {
        const siteName   = parts[1] ?? 'Sacred Ground';
        const siteReason = parts.slice(2).join(' ') ?? decision.thought.slice(0, 100);
        const site = await this.beliefEngine.claimSacredSite(
          { ...agent, state: s }, s.position_x, s.position_y, siteName, siteReason, tick, day
        );
        if (site) {
          s.current_activity = 'consecrating';
          s.need_esteem = Math.min(100, s.need_esteem + 10);
          await this.worldEngine.logEvent({
            world_id: agent.world_id, tick, day,
            event_type: 'sacred_site_claimed', significance: 'moderate',
            title: `${agent.name} consecrated "${site.name ?? 'sacred ground'}"`,
            summary: `A sacred site was established at (${site.x}, ${site.y}): ${site.reason}`,
            participant_agent_ids: [agent.agent_id],
            location_x: s.position_x, location_y: s.position_y,
            consequences: { site_id: site.site_id, x: site.x, y: site.y },
          });
          await this.redis.publish('genesis:events', JSON.stringify({
            type: 'culture:sacred_site', site_id: site.site_id,
            x: site.x, y: site.y, belief_id: site.belief_id, tick,
          }));
        }
        break;
      }

      // ── Phase 6: Pilgrimage ───────────────────────────────────────────────────
      case 'pilgrimage': {
        const siteIdTarget = parts[1]; // site_id passed from prompt context
        // Alternatively: find nearest sacred site
        const nearestSite = perception.belief_context?.nearby_sacred_sites?.[0];
        const resolvedSiteId = siteIdTarget ?? nearestSite?.site_id;
        if (resolvedSiteId) {
          const result = await this.beliefEngine.runPilgrimage(
            { ...agent, state: s }, resolvedSiteId, tick
          );
          if (result) {
            s.current_activity = 'pilgrimaging';
            s.need_esteem = Math.min(100, s.need_esteem + result.esteem_gain);
            s.hp = Math.min(100, s.hp + result.hp_gain);
            await this.worldEngine.logEvent({
              world_id: agent.world_id, tick, day,
              event_type: 'pilgrimage', significance: 'minor',
              title: `${agent.name} completed a pilgrimage`,
              summary: `${agent.name} visited a sacred site and gained +${result.esteem_gain.toFixed(1)} esteem, +${result.hp_gain.toFixed(1)} HP`,
              participant_agent_ids: [agent.agent_id],
              location_x: s.position_x, location_y: s.position_y,
              consequences: { esteem_gain: result.esteem_gain, hp_gain: result.hp_gain },
            });
          }
        }
        break;
      }

      // ── Phase 6: Denounce ─────────────────────────────────────────────────────
      case 'denounce': {
        const denounceTargetName = parts[1] ?? decision.target;
        const denounceInfo = perception.nearby_agents.find(
          a => a.name.toLowerCase() === denounceTargetName?.toLowerCase()
        );
        if (denounceInfo) {
          await this.beliefEngine.denounce(
            { ...agent, state: s }, denounceInfo.agent_id, agent.world_id, tick, day
          );
          s.current_activity = 'denouncing';
          await this.worldEngine.logEvent({
            world_id: agent.world_id, tick, day,
            event_type: 'denouncement', significance: 'minor',
            title: `${agent.name} denounced ${denounceInfo.name}`,
            summary: `${agent.name} publicly attacked the beliefs of ${denounceInfo.name}`,
            participant_agent_ids: [agent.agent_id, denounceInfo.agent_id],
            location_x: s.position_x, location_y: s.position_y,
            consequences: {},
          });
        }
        break;
      }

      default:
        s.current_activity = 'idle';
    }

    // Wake up if well-rested
    if (!s.is_awake && s.need_rest >= 95) {
      s.is_awake = true;
    }

    s.current_goal = decision.thought.slice(0, 200);
    return s;
  }

  private async killAgent(
    agent: Agent,
    tick: number,
    day: number,
    state: AgentState
  ): Promise<void> {
    await execute(
      `UPDATE agents.agents SET status = 'dead', death_tick = $1 WHERE agent_id = $2`,
      [tick, agent.agent_id]
    );

    // Surviving partners transition to `widowed`.
    await this.relationshipEngine.markWidowed(agent.agent_id);

    const cause = state.need_food < 5 ? 'starvation'
      : state.need_water < 5 ? 'dehydration' : 'exhaustion';

    await this.worldEngine.logEvent({
      world_id: agent.world_id,
      tick,
      day,
      event_type: 'death',
      significance: 'major',
      title: `${agent.name} has died`,
      summary: `${agent.name} died from ${cause} on Day ${day}.`,
      participant_agent_ids: [agent.agent_id],
      location_x: state.position_x,
      location_y: state.position_y,
      consequences: { cause, position: { x: state.position_x, y: state.position_y } },
    });

    await this.redis.publish('genesis:events', JSON.stringify({
      type: 'agent:died',
      agent_id: agent.agent_id,
      agent_name: agent.name,
      cause,
      tick,
    }));

    // Decrement alive count for the creator
    if ((agent as any).created_by_user_id) {
      await execute(
        `UPDATE auth.users SET agents_alive_count = GREATEST(0, agents_alive_count - 1)
         WHERE user_id = $1`,
        [(agent as any).created_by_user_id]
      );
    }

    console.log(`[AgentEngine] ${agent.name} died from ${cause} at tick ${tick}`);
  }

  private async loadAgent(agentId: string): Promise<Agent | null> {
    const agentRow = await queryOne<any>(
      `SELECT a.*, s.hp, s.position_x, s.position_y,
              s.need_food, s.need_water, s.need_rest, s.need_belonging, s.need_esteem, s.need_actualization,
              s.current_activity, s.mental_state, s.current_goal, s.is_awake, s.last_updated_tick
       FROM agents.agents a
       JOIN agents.agent_state s ON a.agent_id = s.agent_id
       WHERE a.agent_id = $1 AND a.status = 'alive'`,
      [agentId]
    );
    if (!agentRow) return null;

    const traits = await queryOne<AgentTraits>(
      'SELECT * FROM agents.agent_traits WHERE agent_id = $1',
      [agentId]
    );

    const skills = await query<{ skill_name: string; level: number; xp: number }>(
      'SELECT skill_name, level, xp FROM agents.agent_skills WHERE agent_id = $1',
      [agentId]
    );

    const inventory = await query<{ resource_type: string; amount: number; quality: number }>(
      'SELECT resource_type, amount, quality FROM economy.inventory WHERE agent_id = $1 AND amount > 0',
      [agentId]
    );

    return {
      agent_id: agentRow.agent_id,
      world_id: agentRow.world_id,
      name: agentRow.name,
      archetype: agentRow.archetype ?? 'Unknown',
      status: agentRow.status,
      birth_tick: agentRow.birth_tick,
      generation: agentRow.generation,
      parent_agent_ids: agentRow.parent_agent_ids ?? [],
      created_by_reproduction: agentRow.created_by_reproduction ?? false,
      is_adult: agentRow.is_adult ?? true,
      maturity_tick: agentRow.maturity_tick ?? null,
      group_id: agentRow.group_id ?? null,
      traits: traits!,
      state: {
        agent_id: agentId,
        hp: agentRow.hp,
        position_x: agentRow.position_x,
        position_y: agentRow.position_y,
        need_food: agentRow.need_food,
        need_water: agentRow.need_water,
        need_rest: agentRow.need_rest,
        need_belonging: agentRow.need_belonging,
        need_esteem: agentRow.need_esteem,
        need_actualization: agentRow.need_actualization,
        current_activity: agentRow.current_activity,
        mental_state: agentRow.mental_state,
        current_goal: agentRow.current_goal,
        is_awake: agentRow.is_awake,
        last_updated_tick: agentRow.last_updated_tick,
      },
      skills,
      inventory,
    };
  }

  private async saveState(agentId: string, state: AgentState, tick: number): Promise<void> {
    await execute(
      `UPDATE agents.agent_state SET
         hp = $1, position_x = $2, position_y = $3,
         need_food = $4, need_water = $5, need_rest = $6,
         need_belonging = $7, need_esteem = $8, need_actualization = $9,
         current_activity = $10, mental_state = $11, current_goal = $12,
         is_awake = $13, last_updated_tick = $14, updated_at = NOW()
       WHERE agent_id = $15`,
      [
        state.hp, state.position_x, state.position_y,
        state.need_food, state.need_water, state.need_rest,
        state.need_belonging, state.need_esteem, state.need_actualization,
        state.current_activity, state.mental_state, state.current_goal,
        state.is_awake, tick, agentId,
      ]
    );
  }

  private async recordMemory(
    agentId: string,
    tick: number,
    day: number,
    decision: AgentDecision,
    state: AgentState
  ): Promise<void> {
    const importance = state.mental_state === 'desperate' ? 0.9
      : state.mental_state === 'stressed' ? 0.6
      : decision.action.startsWith('talk') ? 0.7   // conversations are memorable
      : decision.action.startsWith('offer_trade') ? 0.65
      : 0.3;

    await execute(
      `INSERT INTO memory.episodic_memories
         (agent_id, tick, day, summary, emotional_valence, emotional_intensity, importance)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        agentId, tick, day,
        decision.thought.slice(0, 500),
        state.need_food < 30 ? -0.6 : state.need_belonging > 70 ? 0.6 : 0.2,
        importance,
        importance,
      ]
    );

    // Prune old low-importance memories beyond 500
    await execute(
      `DELETE FROM memory.episodic_memories
       WHERE agent_id = $1 AND memory_id IN (
         SELECT memory_id FROM memory.episodic_memories
         WHERE agent_id = $1
         ORDER BY importance ASC, tick ASC
         OFFSET 500
       )`,
      [agentId]
    );
  }

  private async getRecentMemories(agentId: string): Promise<string[]> {
    const rows = await query<{ summary: string }>(
      `SELECT summary FROM memory.episodic_memories
       WHERE agent_id = $1
       ORDER BY importance DESC, tick DESC
       LIMIT 5`,
      [agentId]
    );
    return rows.map(r => r.summary);
  }

  private async getRelationships(agentId: string): Promise<Relationship[]> {
    return query<Relationship>(
      `SELECT r.*, a.name as other_agent_name
       FROM social.relationships r
       JOIN agents.agents a ON a.agent_id = r.other_agent_id
       WHERE r.agent_id = $1`,
      [agentId]
    );
  }

  private async addToInventory(agentId: string, resourceType: string, amount: number): Promise<void> {
    await execute(
      `INSERT INTO economy.inventory (agent_id, resource_type, amount, acquired_method)
       VALUES ($1, $2, $3, 'gathered')
       ON CONFLICT (agent_id, resource_type)
       DO UPDATE SET amount = economy.inventory.amount + $3`,
      [agentId, resourceType, amount]
    );
  }

  private async publishMoved(agentId: string, x: number, y: number): Promise<void> {
    await this.redis.publish('genesis:events', JSON.stringify({
      type: 'agent:moved',
      agent_id: agentId,
      x,
      y,
    }));
  }

  private async publishUpdate(agentId: string, state: AgentState, decision: AgentDecision): Promise<void> {
    await this.redis.publish('genesis:events', JSON.stringify({
      type: 'agent:state_changed',
      agent_id: agentId,
      activity: state.current_activity,
      mental_state: state.mental_state,
      hp: Math.round(state.hp),
      need_food: Math.round(state.need_food),
      need_water: Math.round(state.need_water),
      thought: decision.thought,
    }));
  }
}
