import { query, queryOne, execute } from '../db.js';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Agent, BeliefSystem, AgentBelief, Myth, AgentMyth, Ritual, SacredSite,
} from '../types.js';

const MODEL = process.env.LLM_MODEL ?? 'claude-haiku-4-5-20251001';

// ── Constants ────────────────────────────────────────────────────────────────
const BELIEF_COLOURS = [
  '#a78bfa', '#f472b6', '#fb923c', '#facc15',
  '#34d399', '#60a5fa', '#e879f9', '#4ade80',
];
const MYTH_FIDELITY_DECAY      = 0.95;  // each retelling loses 5% fidelity
const PREACH_CONVICTION_GAIN   = 0.08;
const PREACH_SUCCESS_THRESHOLD = 0.4;   // listener must have conviction < this to convert
const PILGRIMAGE_COOLDOWN_TICKS = 1440; // once per day
const RITUAL_DAILY_COOLDOWN     = 1440;
const EXTINCTION_ADHERENT_FLOOR = 0;    // belief goes extinct when adherents reach 0

/**
 * BeliefEngine — Phase 6
 *
 * Manages the full lifecycle of belief systems and collective memory:
 *   - `foundBelief`          — agent creates a new religion/ideology
 *   - `preach`               — agent attempts to convert another agent
 *   - `performRitual`        — agent performs a belief ritual (morale boost)
 *   - `recordMyth`           — LLM generates a mythologised story about a real event
 *   - `spreadMyth`           — agent retells a myth to another (with fidelity decay)
 *   - `claimSacredSite`      — agent declares a map tile sacred to their belief
 *   - `runPilgrimage`        — agent visits a sacred site for bonuses
 *   - `denounce`             — agent publicly attacks another's belief (reputation hit)
 *   - `checkBeliefExtinction` — mark beliefs with zero adherents as extinct
 *   - `runBeliefTick`        — per-tick pass (passive conviction gain, ritual triggers)
 */
export class BeliefEngine {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ── Founding ─────────────────────────────────────────────────────────────────

  async foundBelief(
    founder: Agent,
    name: string,
    coreTenet: string,
    tick: number,
    day: number
  ): Promise<BeliefSystem | null> {
    // Founder must not already have a strong belief (conviction < 0.7)
    const existing = await queryOne<{ conviction: number }>(
      `SELECT conviction FROM culture.agent_beliefs WHERE agent_id = $1 ORDER BY conviction DESC LIMIT 1`,
      [founder.agent_id]
    );
    if (existing && existing.conviction >= 0.7) return null;

    const colour = await this.pickColour(founder.world_id);
    const prescriptions = this.derivePrescriptions(coreTenet, founder);

    const belief = await queryOne<BeliefSystem>(
      `INSERT INTO culture.belief_systems
         (world_id, name, founder_id, core_tenet, secondary_tenets,
          prescribes_aggression, prescribes_sharing, prescribes_isolation, prescribes_ritual,
          adherent_count, colour, founded_tick, founded_day)
       VALUES ($1,$2,$3,$4,'[]',$5,$6,$7,$8,1,$9,$10,$11)
       RETURNING *`,
      [
        founder.world_id, name, founder.agent_id, coreTenet,
        prescriptions.aggression, prescriptions.sharing,
        prescriptions.isolation, prescriptions.ritual,
        colour, tick, day,
      ]
    );
    if (!belief) return null;

    // Founder immediately adopts it with full conviction
    await execute(
      `INSERT INTO culture.agent_beliefs
         (agent_id, belief_id, conviction, adopted_tick, adopted_day)
       VALUES ($1, $2, 1.0, $3, $4)
       ON CONFLICT (agent_id, belief_id) DO UPDATE SET conviction = 1.0`,
      [founder.agent_id, belief.belief_id, tick, day]
    );

    // Set as primary belief
    await execute(
      `UPDATE agents.agents SET primary_belief_id = $2 WHERE agent_id = $1`,
      [founder.agent_id, belief.belief_id]
    );

    // Create a default daily ritual
    await execute(
      `INSERT INTO culture.rituals
         (world_id, belief_id, name, description, trigger_type,
          resource_cost, esteem_gain, belonging_gain, conviction_gain)
       VALUES ($1, $2, $3, $4, 'daily', '{}', 5, 5, 0.05)`,
      [
        founder.world_id,
        belief.belief_id,
        `Rite of ${name}`,
        `Daily observance of the tenet: "${coreTenet}"`,
      ]
    );

    return belief;
  }

  /** Parse core_tenet keywords + founder traits to derive behavioural prescriptions */
  private derivePrescriptions(coreTenet: string, founder: Agent): {
    aggression: boolean; sharing: boolean; isolation: boolean; ritual: boolean;
  } {
    const t = coreTenet.toLowerCase();
    const aggressionWords  = ['strength', 'power', 'war', 'domina', 'conquer', 'fight', 'force'];
    const sharingWords     = ['together', 'share', 'communal', 'gift', 'give', 'community'];
    const isolationWords   = ['alone', 'solitude', 'pure', 'outsider', 'separate', 'chosen'];

    return {
      aggression: aggressionWords.some(w => t.includes(w)) || founder.traits.aggression > 70,
      sharing:    sharingWords.some(w => t.includes(w)) || founder.traits.empathy > 70,
      isolation:  isolationWords.some(w => t.includes(w)) || founder.traits.trust_default < 30,
      ritual:     true, // always prescribes some form of ritual
    };
  }

  private async pickColour(worldId: string): Promise<string> {
    const used = await query<{ colour: string }>(
      `SELECT colour FROM culture.belief_systems WHERE world_id = $1`,
      [worldId]
    );
    const usedSet = new Set(used.map(r => r.colour));
    return BELIEF_COLOURS.find(c => !usedSet.has(c)) ?? BELIEF_COLOURS[Math.floor(Math.random() * BELIEF_COLOURS.length)];
  }

  // ── Preaching / Conversion ───────────────────────────────────────────────────

  async preach(
    preacher: Agent,
    listenerAgentId: string,
    worldId: string,
    tick: number,
    day: number
  ): Promise<{ converted: boolean; conviction_delta: number }> {
    if (!preacher.traits) return { converted: false, conviction_delta: 0 };

    // Get preacher's primary belief
    const preacherBelief = await queryOne<{ belief_id: string; conviction: number }>(
      `SELECT belief_id, conviction FROM culture.agent_beliefs
       WHERE agent_id = $1 ORDER BY conviction DESC LIMIT 1`,
      [preacher.agent_id]
    );
    if (!preacherBelief) return { converted: false, conviction_delta: 0 };

    // Listener's current conviction in this belief (0 if not known)
    const listenerBelief = await queryOne<{ conviction: number; belief_id: string }>(
      `SELECT belief_id, conviction FROM culture.agent_beliefs WHERE agent_id = $1
       ORDER BY conviction DESC LIMIT 1`,
      [listenerAgentId]
    );

    // Listener's scepticism = 100 - trust_default
    const listenerTraits = await queryOne<{ trust_default: number; scepticism?: number; authority_respect: number }>(
      `SELECT trust_default, authority_respect FROM agents.agent_traits WHERE agent_id = $1`,
      [listenerAgentId]
    );
    const scepticism = 100 - (listenerTraits?.trust_default ?? 50);

    // Preaching effectiveness: preacher conviction × their extraversion, reduced by listener scepticism
    const effectiveness = (preacherBelief.conviction * ((preacher.traits.extraversion ?? 50) / 100))
      - (scepticism / 200);

    const alreadyBelieving = listenerBelief?.belief_id === preacherBelief.belief_id;
    const convictionDelta = effectiveness * PREACH_CONVICTION_GAIN;

    if (alreadyBelieving) {
      // Reinforce existing belief
      await execute(
        `UPDATE culture.agent_beliefs
         SET conviction = LEAST(1.0, conviction + $3)
         WHERE agent_id = $1 AND belief_id = $2`,
        [listenerAgentId, preacherBelief.belief_id, convictionDelta]
      );
      return { converted: false, conviction_delta: convictionDelta };
    }

    // Potential conversion: only if listener has no strong competing belief
    const listenerHasStrongBelief = listenerBelief && listenerBelief.conviction >= 0.6;
    if (listenerHasStrongBelief) {
      return { converted: false, conviction_delta: 0 };
    }

    if (effectiveness >= PREACH_SUCCESS_THRESHOLD) {
      // Convert
      await execute(
        `INSERT INTO culture.agent_beliefs
           (agent_id, belief_id, conviction, adopted_tick, adopted_day, converted_from_agent_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agent_id, belief_id) DO UPDATE
           SET conviction = EXCLUDED.conviction`,
        [listenerAgentId, preacherBelief.belief_id, effectiveness, tick, day, preacher.agent_id]
      );
      // Set as primary if no stronger belief
      await execute(
        `UPDATE agents.agents SET primary_belief_id = $2
         WHERE agent_id = $1 AND (primary_belief_id IS NULL)`,
        [listenerAgentId, preacherBelief.belief_id]
      );
      // Update adherent count
      await execute(
        `UPDATE culture.belief_systems SET adherent_count = adherent_count + 1 WHERE belief_id = $1`,
        [preacherBelief.belief_id]
      );
      return { converted: true, conviction_delta: effectiveness };
    }

    return { converted: false, conviction_delta: 0 };
  }

  // ── Rituals ───────────────────────────────────────────────────────────────────

  async performRitual(
    agent: Agent,
    worldId: string,
    tick: number
  ): Promise<{ esteem_gain: number; belonging_gain: number } | null> {
    const beliefId = (agent as any).primary_belief_id;
    if (!beliefId) return null;

    const ritual = await queryOne<Ritual>(
      `SELECT * FROM culture.rituals
       WHERE belief_id = $1
         AND (trigger_type = 'daily' OR trigger_type = 'manual')
         AND last_performed_tick <= $2
       ORDER BY last_performed_tick ASC LIMIT 1`,
      [beliefId, tick - RITUAL_DAILY_COOLDOWN]
    );
    if (!ritual) return null;

    // Check resource cost
    for (const [resource, cost] of Object.entries(ritual.resource_cost)) {
      const inv = await queryOne<{ amount: number }>(
        `SELECT amount FROM economy.inventory WHERE agent_id = $1 AND resource_type = $2`,
        [agent.agent_id, resource]
      );
      if ((inv?.amount ?? 0) < cost) return null; // can't afford
    }

    // Deduct resources
    for (const [resource, cost] of Object.entries(ritual.resource_cost)) {
      await execute(
        `UPDATE economy.inventory SET amount = amount - $3
         WHERE agent_id = $1 AND resource_type = $2`,
        [agent.agent_id, resource, cost]
      );
    }

    // Apply gains
    await execute(
      `UPDATE agents.agent_state
       SET need_esteem    = LEAST(100, need_esteem + $2),
           need_belonging = LEAST(100, need_belonging + $3)
       WHERE agent_id = $1`,
      [agent.agent_id, ritual.esteem_gain, ritual.belonging_gain]
    );

    // Strengthen conviction
    await execute(
      `UPDATE culture.agent_beliefs
       SET conviction = LEAST(1.0, conviction + $3)
       WHERE agent_id = $1 AND belief_id = $2`,
      [agent.agent_id, beliefId, ritual.conviction_gain]
    );

    // Update ritual last_performed
    await execute(
      `UPDATE culture.rituals
       SET last_performed_tick = $2, times_performed = times_performed + 1
       WHERE ritual_id = $1`,
      [ritual.ritual_id, tick]
    );

    return { esteem_gain: ritual.esteem_gain, belonging_gain: ritual.belonging_gain };
  }

  // ── Myths ─────────────────────────────────────────────────────────────────────

  /**
   * recordMyth — agent composes a myth based on a real world event.
   * Uses Claude to generate a mythologised narrative.
   */
  async recordMyth(
    author: Agent,
    sourceEventId: string | null,
    title: string,
    rawSummary: string,
    worldId: string,
    tick: number,
    day: number
  ): Promise<Myth | null> {
    const beliefId = (author as any).primary_belief_id ?? null;

    // Generate narrative via LLM
    const narrative = await this.generateMythNarrative(author, title, rawSummary, beliefId, worldId);

    const myth = await queryOne<Myth>(
      `INSERT INTO culture.myths
         (world_id, author_id, source_event_id, belief_id, title, narrative,
          believability, created_tick, created_day)
       VALUES ($1,$2,$3,$4,$5,$6,0.5,$7,$8)
       RETURNING *`,
      [worldId, author.agent_id, sourceEventId, beliefId, title, narrative, tick, day]
    );
    if (!myth) return null;

    // Author knows this myth with perfect fidelity
    await execute(
      `INSERT INTO culture.agent_myths (agent_id, myth_id, fidelity, learned_tick)
       VALUES ($1, $2, 1.0, $3)
       ON CONFLICT (agent_id, myth_id) DO NOTHING`,
      [author.agent_id, myth.myth_id, tick]
    );

    return myth;
  }

  private async generateMythNarrative(
    author: Agent,
    title: string,
    rawSummary: string,
    beliefId: string | null,
    worldId: string
  ): Promise<string> {
    let beliefLine = '';
    if (beliefId) {
      const belief = await queryOne<{ name: string; core_tenet: string }>(
        `SELECT name, core_tenet FROM culture.belief_systems WHERE belief_id = $1`,
        [beliefId]
      );
      if (belief) beliefLine = `The author follows the belief "${belief.name}" whose tenet is: "${belief.core_tenet}".`;
    }

    const prompt = `You are ${author.name}, a storyteller in a primordial world.
${beliefLine}
Write a short mythologized retelling (2-4 sentences) of this real event, framing it as a legendary tale:

EVENT: ${rawSummary}

Use vivid, ancient-storytelling language. Weave in the belief's tenet if relevant.
Output only the narrative text, nothing else.`;

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      });
      return response.content[0].type === 'text' ? response.content[0].text.trim() : rawSummary;
    } catch {
      return rawSummary; // fallback to plain text on API error
    }
  }

  // ── Myth spreading ────────────────────────────────────────────────────────────

  async spreadMyth(
    teller: Agent,
    listenerAgentId: string,
    mythId: string,
    tick: number
  ): Promise<boolean> {
    const tellerMyth = await queryOne<AgentMyth>(
      `SELECT * FROM culture.agent_myths WHERE agent_id = $1 AND myth_id = $2`,
      [teller.agent_id, mythId]
    );
    if (!tellerMyth) return false;

    // Fidelity decays with each retelling
    const newFidelity = tellerMyth.fidelity * MYTH_FIDELITY_DECAY;

    // Build local_version: if fidelity is low, apply minor textual mutation
    const originalMyth = await queryOne<Myth>(
      `SELECT narrative FROM culture.myths WHERE myth_id = $1`,
      [mythId]
    );
    let localVersion: string | null = null;
    if (newFidelity < 0.7 && originalMyth) {
      localVersion = await this.mutateMythText(originalMyth.narrative, newFidelity);
    }

    await execute(
      `INSERT INTO culture.agent_myths (agent_id, myth_id, local_version, fidelity, learned_from_id, learned_tick)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agent_id, myth_id) DO UPDATE
         SET local_version = EXCLUDED.local_version,
             fidelity = LEAST(culture.agent_myths.fidelity, EXCLUDED.fidelity)`,
      [listenerAgentId, mythId, localVersion, newFidelity, teller.agent_id, tick]
    );

    // Increment spread count
    await execute(
      `UPDATE culture.myths SET spread_count = spread_count + 1 WHERE myth_id = $1`,
      [mythId]
    );

    return true;
  }

  /** Apply light mutations to myth text when fidelity is low */
  private async mutateMythText(original: string, fidelity: number): Promise<string> {
    if (fidelity > 0.5) {
      // Minor: replace a name or number
      return original.replace(/\b(they|it|he|she)\b/g, match =>
        Math.random() < 0.3 ? (['the hero', 'the wanderer', 'the ancient one'][Math.floor(Math.random() * 3)]) : match
      );
    }
    // Severe distortion: shuffle sentences
    const sentences = original.match(/[^.!?]+[.!?]+/g) ?? [original];
    for (let i = sentences.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sentences[i], sentences[j]] = [sentences[j], sentences[i]];
    }
    return sentences.join(' ');
  }

  // ── Sacred Sites ──────────────────────────────────────────────────────────────

  async claimSacredSite(
    agent: Agent,
    x: number,
    y: number,
    name: string,
    reason: string,
    tick: number,
    day: number
  ): Promise<SacredSite | null> {
    const beliefId = (agent as any).primary_belief_id;
    if (!beliefId) return null;

    const site = await queryOne<SacredSite>(
      `INSERT INTO culture.sacred_sites
         (world_id, belief_id, x, y, name, reason,
          pilgrimage_bonus_esteem, pilgrimage_bonus_hp, created_tick, created_day)
       VALUES ($1, $2, $3, $4, $5, $6, 15, 5, $7, $8)
       ON CONFLICT (world_id, x, y, belief_id) DO NOTHING
       RETURNING *`,
      [agent.world_id, beliefId, x, y, name, reason, tick, day]
    );
    return site ?? null;
  }

  async runPilgrimage(
    agent: Agent,
    siteId: string,
    tick: number
  ): Promise<{ esteem_gain: number; hp_gain: number } | null> {
    const site = await queryOne<SacredSite>(
      `SELECT * FROM culture.sacred_sites WHERE site_id = $1`,
      [siteId]
    );
    if (!site) return null;

    // Agent must believe in the associated belief
    const believes = await queryOne<{ conviction: number }>(
      `SELECT conviction FROM culture.agent_beliefs
       WHERE agent_id = $1 AND belief_id = $2`,
      [agent.agent_id, site.belief_id]
    );
    if (!believes) return null;

    // Apply bonuses (scaled by conviction)
    const scale = believes.conviction;
    const esteemGain = site.pilgrimage_bonus_esteem * scale;
    const hpGain     = site.pilgrimage_bonus_hp * scale;

    await execute(
      `UPDATE agents.agent_state
       SET need_esteem = LEAST(100, need_esteem + $2),
           hp          = LEAST(100, hp + $3)
       WHERE agent_id = $1`,
      [agent.agent_id, esteemGain, hpGain]
    );

    await execute(
      `UPDATE culture.sacred_sites SET visit_count = visit_count + 1 WHERE site_id = $1`,
      [siteId]
    );

    return { esteem_gain: esteemGain, hp_gain: hpGain };
  }

  // ── Denouncing ────────────────────────────────────────────────────────────────

  async denounce(
    denouncer: Agent,
    targetAgentId: string,
    worldId: string,
    tick: number,
    day: number
  ): Promise<void> {
    // Hit target's reputation on trustworthiness
    await execute(
      `UPDATE social.reputations
       SET trustworthiness = GREATEST(0, trustworthiness - 10),
           negative_reports = negative_reports + 1,
           total_reports = total_reports + 1,
           last_updated_tick = $2
       WHERE agent_id = $1`,
      [targetAgentId, tick]
    );

    // Hit denouncer's own esteem if listeners didn't agree (random)
    if (Math.random() < 0.3) {
      await execute(
        `UPDATE agents.agent_state
         SET need_esteem = GREATEST(0, need_esteem - 5)
         WHERE agent_id = $1`,
        [denouncer.agent_id]
      );
    }
  }

  // ── Tick pass ─────────────────────────────────────────────────────────────────

  /**
   * runBeliefTick — called every tick.
   * - Passive conviction decay for agents without a group reinforcing their belief
   * - Trigger 'on_war' rituals if a war is active for the group
   */
  async runBeliefTick(worldId: string, tick: number): Promise<void> {
    // Passive conviction decay: 0.001 per tick for isolated believers
    await execute(
      `UPDATE culture.agent_beliefs ab
       SET conviction = GREATEST(0, conviction - 0.001)
       FROM agents.agents a
       WHERE ab.agent_id = a.agent_id
         AND a.world_id = $1
         AND a.group_id IS NULL`,
      [worldId]
    );

    // Trigger 'on_war' rituals for groups currently at war
    const atWarGroups = await query<{ group_id: string; leader_id: string }>(
      `SELECT group_id, leader_id FROM social.groups
       WHERE world_id = $1 AND array_length(at_war_with, 1) > 0`,
      [worldId]
    );

    for (const group of atWarGroups) {
      // Find any 'on_war' ritual not performed recently
      const warRitual = await queryOne<Ritual>(
        `SELECT r.* FROM culture.rituals r
         JOIN social.group_members gm ON gm.group_id = $2
         WHERE r.trigger_type = 'on_war'
           AND r.group_id = $2
           AND r.last_performed_tick < $1 - 1440
         LIMIT 1`,
        [tick, group.group_id]
      );

      if (warRitual) {
        // All group members perform it passively
        await execute(
          `UPDATE agents.agent_state ags
           SET need_esteem = LEAST(100, need_esteem + $2),
               need_belonging = LEAST(100, need_belonging + $3)
           FROM social.group_members gm
           WHERE gm.group_id = $4 AND gm.agent_id = ags.agent_id`,
          [warRitual.esteem_gain, warRitual.belonging_gain, tick, group.group_id]
        );
        await execute(
          `UPDATE culture.rituals
           SET last_performed_tick = $1, times_performed = times_performed + 1
           WHERE ritual_id = $2`,
          [tick, warRitual.ritual_id]
        );
      }
    }
  }

  /**
   * checkBeliefExtinction — called once per day.
   * Marks beliefs with zero adherents as extinct.
   */
  async checkBeliefExtinction(worldId: string): Promise<void> {
    await execute(
      `UPDATE culture.belief_systems
       SET is_extinct = TRUE
       WHERE world_id = $1
         AND adherent_count <= $2
         AND is_extinct = FALSE`,
      [worldId, EXTINCTION_ADHERENT_FLOOR]
    );
  }

  // ── Query helpers ─────────────────────────────────────────────────────────────

  async getBeliefsForWorld(worldId: string): Promise<BeliefSystem[]> {
    return query<BeliefSystem>(
      `SELECT * FROM culture.belief_systems WHERE world_id = $1 AND is_extinct = FALSE`,
      [worldId]
    );
  }

  async getAgentBelief(agentId: string): Promise<(AgentBelief & { belief_name: string; core_tenet: string; colour: string }) | null> {
    return queryOne(
      `SELECT ab.*, bs.name AS belief_name, bs.core_tenet, bs.colour
       FROM culture.agent_beliefs ab
       JOIN culture.belief_systems bs ON bs.belief_id = ab.belief_id
       WHERE ab.agent_id = $1
       ORDER BY ab.conviction DESC LIMIT 1`,
      [agentId]
    );
  }

  async getTopMyths(worldId: string, limit = 10): Promise<Myth[]> {
    return query<Myth>(
      `SELECT * FROM culture.myths WHERE world_id = $1 ORDER BY spread_count DESC LIMIT $2`,
      [worldId, limit]
    );
  }

  async getSacredSitesForWorld(worldId: string): Promise<SacredSite[]> {
    return query<SacredSite>(
      `SELECT * FROM culture.sacred_sites WHERE world_id = $1`,
      [worldId]
    );
  }

  async getAgentMyths(agentId: string): Promise<Array<AgentMyth & { title: string; narrative: string }>> {
    return query(
      `SELECT am.*, m.title, COALESCE(am.local_version, m.narrative) AS narrative
       FROM culture.agent_myths am
       JOIN culture.myths m ON m.myth_id = am.myth_id
       WHERE am.agent_id = $1
       ORDER BY am.learned_tick DESC`,
      [agentId]
    );
  }
}
