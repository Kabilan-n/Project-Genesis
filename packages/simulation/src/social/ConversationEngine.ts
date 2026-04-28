import { query, queryOne, execute } from '../db.js';
import { LLMFactory } from '../llm/LLMFactory.js';
import type { LLMClient } from '../llm/types.js';
import { PromptBuilder } from '../llm/PromptBuilder.js';
import { PromptBuilderOptimised } from '../llm/PromptBuilderOptimised.js';
import { KnowledgeEngine } from '../cultural/KnowledgeEngine.js';
import type {
  Agent, Conversation, ConversationTurn, Relationship, RelationshipDelta
} from '../types.js';

const MAX_TURNS = 4; // 2 exchanges (A→B→A→B)

// Candidacy gate: a bonding conversation flips both sides into "romantically
// eligible" only when affection is already substantial and both agents are
// open to new experiences. No `openness` trait exists in this schema, so we
// proxy with `curiosity` — the closest Big-Five-aligned trait we track.
const ROMANTIC_CANDIDACY_AFFECTION_FLOOR = 70;
const ROMANTIC_CANDIDACY_OPENNESS_FLOOR  = 50;

export class ConversationEngine {
  private llm: LLMClient;
  private promptBuilder: PromptBuilder | PromptBuilderOptimised;
  private knowledgeEngine: KnowledgeEngine;

  constructor() {
    this.llm = LLMFactory.fromEnv();
    this.promptBuilder = process.env.OPTIMIZE_PROMPTS === 'true'
      ? new PromptBuilderOptimised()
      : new PromptBuilder();
    this.knowledgeEngine = new KnowledgeEngine();
  }

  /**
   * Run a full multi-turn conversation between two agents.
   * Returns the completed Conversation record.
   */
  async runConversation(
    initiator: Agent,
    target: Agent,
    openingMessage: string,
    tick: number,
    day: number
  ): Promise<Conversation> {
    const turns: ConversationTurn[] = [];

    // Turn 1: initiator's opening (already decided by AgentEngine)
    turns.push({
      turn_number: 1,
      speaker_id: initiator.agent_id,
      speaker_name: initiator.name,
      message: openingMessage,
      thought: 'Starting the conversation',
      is_ending: false,
    });

    let lastSpeaker = initiator;
    let lastListener = target;
    let lastMessage = openingMessage;
    let conversationEnded = false;

    // Pull partner-specific context once — same for every turn in this
    // conversation, so we don't query DB each iteration.
    const [
      initiatorPartnerHistory,
      targetPartnerHistory,
      initiatorPartnerMemories,
      targetPartnerMemories,
    ] = await Promise.all([
      this.getPartnerHistory(initiator.agent_id, target.agent_id),
      this.getPartnerHistory(target.agent_id, initiator.agent_id),
      this.getMemoriesAboutPartner(initiator.agent_id, target.agent_id),
      this.getMemoriesAboutPartner(target.agent_id, initiator.agent_id),
    ]);

    // Run up to MAX_TURNS total (turn 1 is already done)
    for (let t = 2; t <= MAX_TURNS && !conversationEnded; t++) {
      // Swap speakers
      [lastSpeaker, lastListener] = [lastListener, lastSpeaker];

      const listenerRel = await this.getRelationshipBetween(lastSpeaker.agent_id, lastListener.agent_id);
      const recentMemories = await this.getRecentMemories(lastSpeaker.agent_id);
      const partnerHistory  = lastSpeaker.agent_id === initiator.agent_id ? initiatorPartnerHistory  : targetPartnerHistory;
      const partnerMemories = lastSpeaker.agent_id === initiator.agent_id ? initiatorPartnerMemories : targetPartnerMemories;

      const prompt = this.promptBuilder.buildConversationTurnPrompt(
        lastSpeaker,
        lastListener,
        turns,
        lastMessage,
        listenerRel,
        recentMemories,
        tick,
        day,
        t === MAX_TURNS, // force_end on last turn
        partnerHistory,
        partnerMemories
      );

      const response = await this.llm.getConversationResponse(prompt);

      turns.push({
        turn_number: t,
        speaker_id: lastSpeaker.agent_id,
        speaker_name: lastSpeaker.name,
        message: response.speech ?? '...',
        thought: response.thought,
        is_ending: response.is_ending ?? (t === MAX_TURNS),
      });

      lastMessage = response.speech ?? '';
      conversationEnded = response.is_ending ?? false;
    }

    // Compute outcome and relationship deltas
    const outcome = this.computeOutcome(turns);
    const relationshipChanges = this.computeRelationshipChanges(
      initiator,
      target,
      turns,
      outcome
    );

    const conversation: Conversation = {
      world_id: initiator.world_id,
      tick,
      day,
      initiator_agent_id: initiator.agent_id,
      target_agent_id: target.agent_id,
      location_x: initiator.state.position_x,
      location_y: initiator.state.position_y,
      topic: this.extractTopic(turns),
      turns,
      outcome,
      relationship_changes: relationshipChanges,
    };

    const persisted = await this.persist(conversation);

    // Write a partner-tagged memory for each participant so future
    // conversations between this pair pull narrative context about
    // each other, not just a numeric trust score.
    await this.writePartnerMemories(initiator, target, persisted);

    // Phase 3: propagate knowledge and attempt skill teaching on positive outcomes
    if (persisted.outcome === 'bonding' || persisted.outcome === 'friendly') {
      await Promise.all([
        this.knowledgeEngine.propagateKnowledge(initiator, target, persisted),
        this.knowledgeEngine.attemptSkillTeaching(initiator, target, persisted),
      ]);
    }

    // Phase 1.2: a bonding conversation between two open, already-affectionate
    // agents flips the romantic-candidacy flag for the pair. The flag is what
    // unlocks the `romantic_partner` state in determineType.
    if (persisted.outcome === 'bonding' &&
        this.shouldFlagRomanticCandidacy(initiator, target)) {
      await this.flagRomanticCandidacy(initiator.agent_id, target.agent_id);
    }

    return persisted;
  }

  /**
   * Pure check: bonding outcome + existing affection ≥ 70 + both agents'
   * openness-proxy (curiosity) ≥ 50. Affection is read from the live
   * relationship rows by the caller via flagRomanticCandidacy.
   */
  shouldFlagRomanticCandidacy(initiator: Agent, target: Agent): boolean {
    return (
      initiator.traits.curiosity >= ROMANTIC_CANDIDACY_OPENNESS_FLOOR &&
      target.traits.curiosity    >= ROMANTIC_CANDIDACY_OPENNESS_FLOOR
    );
  }

  /**
   * Flip is_romantic_candidate symmetrically across the pair, but only if
   * the live affection score is already ≥ 70 on both sides. The check is
   * inside the SQL so we don't race a second conversation.
   */
  private async flagRomanticCandidacy(agentA: string, agentB: string): Promise<void> {
    await execute(
      `UPDATE social.relationships
       SET is_romantic_candidate = TRUE
       WHERE ((agent_id = $1 AND other_agent_id = $2)
           OR (agent_id = $2 AND other_agent_id = $1))
         AND affection_score >= $3`,
      [agentA, agentB, ROMANTIC_CANDIDACY_AFFECTION_FLOOR]
    );
  }

  /**
   * Persist one memory row per participant, tagged with the other
   * agent in `partner_agent_ids`. The summary is built from the
   * conversation outcome + the topic so it reads naturally when
   * injected into a future prompt ("you bonded with Sage about berry-foraging").
   */
  private async writePartnerMemories(
    initiator: Agent,
    target: Agent,
    conv: Conversation
  ): Promise<void> {
    const valenceByOutcome: Record<Conversation['outcome'], number> = {
      bonding:        0.8,
      friendly:       0.4,
      neutral:        0.0,
      reconciliation: 0.5,
      conflict:       -0.5,
      hostile:        -0.8,
    };
    const importanceByOutcome: Record<Conversation['outcome'], number> = {
      bonding:        0.75,
      friendly:       0.55,
      neutral:        0.35,
      reconciliation: 0.7,
      conflict:       0.7,
      hostile:        0.85,
    };

    const valence = valenceByOutcome[conv.outcome];
    const importance = importanceByOutcome[conv.outcome];
    const topicSnippet = (conv.topic ?? '').slice(0, 60);

    const summaryFor = (selfName: string, otherName: string) =>
      `Day ${conv.day}: had a ${conv.outcome} conversation with ${otherName}` +
      (topicSnippet ? ` about "${topicSnippet}"` : '') + '.';

    const initiatorSummary = summaryFor(initiator.name, target.name);
    const targetSummary    = summaryFor(target.name, initiator.name);

    const sql = `
      INSERT INTO memory.episodic_memories
        (agent_id, tick, day, summary, full_content, emotional_valence,
         emotional_intensity, importance, current_strength, tags, partner_agent_ids)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1.0, $9, $10)
    `;

    await Promise.all([
      execute(sql, [
        initiator.agent_id, conv.tick, conv.day,
        initiatorSummary, JSON.stringify(conv.turns),
        valence, Math.min(1, Math.abs(valence) + 0.2), importance,
        ['conversation', conv.outcome],
        [target.agent_id],
      ]),
      execute(sql, [
        target.agent_id, conv.tick, conv.day,
        targetSummary, JSON.stringify(conv.turns),
        valence, Math.min(1, Math.abs(valence) + 0.2), importance,
        ['conversation', conv.outcome],
        [initiator.agent_id],
      ]),
    ]);
  }

  private computeOutcome(turns: ConversationTurn[]): Conversation['outcome'] {
    const transcript = turns.map(t => t.message + ' ' + t.thought).join(' ').toLowerCase();

    const positiveScore = (
      (transcript.match(/\b(friend|trust|help|thank|care|love|together|glad|happy|share|gift)\b/g) ?? []).length
    );
    const negativeScore = (
      (transcript.match(/\b(enemy|hate|fear|angry|attack|leave|alone|danger|threat|warn)\b/g) ?? []).length
    );

    if (positiveScore >= 3 && negativeScore === 0) return 'bonding';
    if (positiveScore >= 2) return 'friendly';
    if (negativeScore >= 3) return 'hostile';
    if (negativeScore >= 2) return 'conflict';
    return 'neutral';
  }

  private computeRelationshipChanges(
    initiator: Agent,
    target: Agent,
    turns: ConversationTurn[],
    outcome: Conversation['outcome']
  ): Record<string, RelationshipDelta> {
    // Trust is earned slowly and lost quickly — asymmetric by design
    const baseDeltas: Record<Conversation['outcome'], RelationshipDelta> = {
      bonding:        { trust: 4,  affection: 5,  respect: 3,  fear: -2 },
      friendly:       { trust: 2,  affection: 3,  respect: 1,  fear: -1 },
      neutral:        { trust: 0,  affection: 0,  respect: 0,  fear: 0  },
      reconciliation: { trust: 3,  affection: 2,  respect: 2,  fear: -3 },
      conflict:       { trust: -8, affection: -6, respect: -3, fear: 5  },
      hostile:        { trust: -12, affection: -10, respect: -5, fear: 8 },
    };

    const delta = baseDeltas[outcome];

    // Personality modifiers: empathetic initiators give/receive more affection
    const empathyMod = (initiator.traits.empathy - 50) / 50; // -1 to +1
    const adjustedAffection = Math.round((delta.affection ?? 0) * (1 + empathyMod * 0.3));

    const initiatorDelta: RelationshipDelta = { ...delta, affection: adjustedAffection };
    const targetDelta: RelationshipDelta = { ...delta, affection: adjustedAffection };

    return {
      [initiator.agent_id]: initiatorDelta,
      [target.agent_id]: targetDelta,
    };
  }

  private extractTopic(turns: ConversationTurn[]): string {
    if (turns.length === 0) return 'general';
    const firstMessage = turns[0].message.slice(0, 50);
    return firstMessage;
  }

  private async getRelationshipBetween(agentId: string, otherId: string): Promise<Relationship | null> {
    return queryOne<Relationship>(
      `SELECT r.*, a.name as other_agent_name
       FROM social.relationships r
       JOIN agents.agents a ON a.agent_id = r.other_agent_id
       WHERE r.agent_id = $1 AND r.other_agent_id = $2`,
      [agentId, otherId]
    );
  }

  private async getRecentMemories(agentId: string): Promise<string[]> {
    const rows = await query<{ summary: string }>(
      `SELECT summary FROM memory.episodic_memories
       WHERE agent_id = $1
       ORDER BY importance DESC, tick DESC
       LIMIT 3`,
      [agentId]
    );
    return rows.map(r => r.summary);
  }

  /**
   * Memories where the partner is tagged in partner_agent_ids.
   * Powers the "what do I remember about THIS person" slot in prompts.
   */
  private async getMemoriesAboutPartner(agentId: string, partnerId: string): Promise<string[]> {
    const rows = await query<{ summary: string }>(
      `SELECT summary FROM memory.episodic_memories
       WHERE agent_id = $1
         AND $2 = ANY(partner_agent_ids)
       ORDER BY tick DESC
       LIMIT 3`,
      [agentId, partnerId]
    );
    return rows.map(r => r.summary);
  }

  /**
   * Last few conversations between this exact pair, ordered newest-first.
   * Returns compact "Day X · outcome · topic" strings for prompt injection.
   */
  private async getPartnerHistory(agentId: string, partnerId: string): Promise<string[]> {
    const rows = await query<{ day: number; outcome: string; topic: string }>(
      `SELECT day, outcome, topic
       FROM social.conversations
       WHERE (initiator_agent_id = $1 AND target_agent_id = $2)
          OR (initiator_agent_id = $2 AND target_agent_id = $1)
       ORDER BY tick DESC
       LIMIT 3`,
      [agentId, partnerId]
    );
    return rows.map(r =>
      `Day ${r.day}: ${r.outcome}` + (r.topic ? ` — "${r.topic.slice(0, 50)}"` : '')
    );
  }

  private async persist(conv: Conversation): Promise<Conversation> {
    const row = await queryOne<{ conversation_id: string }>(
      `INSERT INTO social.conversations
         (world_id, tick, day, initiator_agent_id, target_agent_id,
          location_x, location_y, topic, turns, outcome, relationship_changes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)
       RETURNING conversation_id`,
      [
        conv.world_id, conv.tick, conv.day,
        conv.initiator_agent_id, conv.target_agent_id,
        conv.location_x, conv.location_y,
        conv.topic,
        JSON.stringify(conv.turns),
        conv.outcome,
        JSON.stringify(conv.relationship_changes),
      ]
    );
    return { ...conv, conversation_id: row!.conversation_id };
  }
}
