import { query, queryOne, execute } from '../db.js';
import type { Agent, AgentKnowledge, SkillTeaching, Conversation } from '../types.js';

const XP_TRANSFER_RATIO = 0.15;    // teacher gives 15% of level gap as XP
const KNOWLEDGE_CONFIDENCE_DECAY = 0.02; // secondhand knowledge loses 2% confidence
const MAX_FACTS_PER_AGENT = 50;    // prune oldest low-confidence facts beyond this

/**
 * KnowledgeEngine — Phase 3
 *
 * Handles two forms of cultural transmission between agents:
 *
 * 1. SKILL TEACHING: When a bonding/friendly conversation occurs between agents
 *    where one has a significantly higher skill level, the more skilled agent
 *    automatically transfers some XP to the less skilled one.
 *
 * 2. KNOWLEDGE FACTS: Agents accumulate facts about the world (resource locations,
 *    safe routes, dangerous areas). During conversations these facts propagate to
 *    other agents with reduced confidence (secondhand knowledge).
 */
export class KnowledgeEngine {

  // ── Skill Teaching ──────────────────────────────────────────────────────────

  /**
   * Called after a bonding or friendly conversation.
   * If the two agents share overlapping skills where one is clearly better,
   * the better agent transfers some XP to the other.
   */
  async attemptSkillTeaching(
    agentA: Agent,
    agentB: Agent,
    conversation: Conversation
  ): Promise<SkillTeaching[]> {
    if (conversation.outcome !== 'bonding' && conversation.outcome !== 'friendly') {
      return [];
    }

    const teachings: SkillTeaching[] = [];

    for (const skillA of agentA.skills) {
      const skillB = agentB.skills.find(s => s.skill_name === skillA.skill_name);
      if (!skillB) continue;

      const levelGap = skillA.level - skillB.level;
      if (levelGap < 5) continue; // Only teach if gap is meaningful

      const xpTransfer = levelGap * XP_TRANSFER_RATIO;
      const teaching = await this.transferSkill(
        agentA, agentB, skillA.skill_name, xpTransfer,
        skillA.level, skillB.level, conversation.conversation_id, conversation.tick, conversation.day
      );
      if (teaching) teachings.push(teaching);
    }

    // Also check the reverse — agentB may be better at some skills
    for (const skillB of agentB.skills) {
      const skillA = agentA.skills.find(s => s.skill_name === skillB.skill_name);
      if (!skillA) continue;

      const levelGap = skillB.level - skillA.level;
      if (levelGap < 5) continue;

      const xpTransfer = levelGap * XP_TRANSFER_RATIO;
      const teaching = await this.transferSkill(
        agentB, agentA, skillB.skill_name, xpTransfer,
        skillB.level, skillA.level, conversation.conversation_id, conversation.tick, conversation.day
      );
      if (teaching) teachings.push(teaching);
    }

    return teachings;
  }

  private async transferSkill(
    teacher: Agent,
    student: Agent,
    skillName: string,
    xpAmount: number,
    teacherLevel: number,
    studentLevelBefore: number,
    conversationId: string | undefined,
    tick: number,
    day: number
  ): Promise<SkillTeaching | null> {
    // Add XP to student
    await execute(
      `UPDATE agents.agent_skills
       SET xp = xp + $1
       WHERE agent_id = $2 AND skill_name = $3`,
      [xpAmount, student.agent_id, skillName]
    );

    // Level up if XP threshold reached (100 XP per level)
    const newSkillRow = await queryOne<{ level: number; xp: number }>(
      `SELECT level, xp FROM agents.agent_skills WHERE agent_id = $1 AND skill_name = $2`,
      [student.agent_id, skillName]
    );

    let newLevel = studentLevelBefore;
    if (newSkillRow && newSkillRow.xp >= newSkillRow.level * 100) {
      newLevel = Math.min(100, newSkillRow.level + 1);
      await execute(
        `UPDATE agents.agent_skills SET level = $1, xp = 0 WHERE agent_id = $2 AND skill_name = $3`,
        [newLevel, student.agent_id, skillName]
      );
    }

    // Record the teaching event
    const row = await queryOne<{ teaching_id: string }>(
      `INSERT INTO agents.skill_teachings
         (world_id, teacher_id, student_id, skill_name, xp_transferred,
          teacher_level, student_level_before, student_level_after, tick, day, conversation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING teaching_id`,
      [
        teacher.world_id, teacher.agent_id, student.agent_id,
        skillName, xpAmount, teacherLevel, studentLevelBefore, newLevel,
        tick, day, conversationId ?? null,
      ]
    );

    return {
      teaching_id: row!.teaching_id,
      world_id: teacher.world_id,
      teacher_id: teacher.agent_id,
      student_id: student.agent_id,
      skill_name: skillName,
      xp_transferred: xpAmount,
      teacher_level: teacherLevel,
      student_level_before: studentLevelBefore,
      student_level_after: newLevel,
      tick,
      day,
      conversation_id: conversationId,
    };
  }

  // ── Knowledge Propagation ───────────────────────────────────────────────────

  /**
   * During a friendly/bonding conversation, propagate facts between agents.
   * The agent with more knowledge shares their highest-confidence facts.
   * Recipient gets the fact at reduced confidence (secondhand effect).
   */
  async propagateKnowledge(
    agentA: Agent,
    agentB: Agent,
    conversation: Conversation
  ): Promise<void> {
    if (conversation.outcome !== 'bonding' && conversation.outcome !== 'friendly') {
      return;
    }

    // Share from A to B
    await this.shareFacts(agentA, agentB);
    // Share from B to A
    await this.shareFacts(agentB, agentA);
  }

  private async shareFacts(sharer: Agent, receiver: Agent): Promise<void> {
    // Get sharer's top-confidence facts not already known by receiver
    const sharerFacts = await query<AgentKnowledge>(
      `SELECT k.* FROM memory.agent_knowledge k
       WHERE k.agent_id = $1
         AND k.fact_key NOT IN (
           SELECT fact_key FROM memory.agent_knowledge WHERE agent_id = $2
         )
       ORDER BY k.confidence DESC, k.times_shared ASC
       LIMIT 3`,
      [sharer.agent_id, receiver.agent_id]
    );

    for (const fact of sharerFacts) {
      const receiverConfidence = Math.max(0.1, fact.confidence - KNOWLEDGE_CONFIDENCE_DECAY);
      await this.upsertKnowledge({
        agent_id: receiver.agent_id,
        world_id: receiver.world_id,
        fact_key: fact.fact_key,
        fact_value: fact.fact_value,
        confidence: receiverConfidence,
        source_agent_id: sharer.agent_id,
        learned_tick: fact.learned_tick,
        times_shared: 0,
      });

      // Increment sharer's times_shared counter
      await execute(
        `UPDATE memory.agent_knowledge SET times_shared = times_shared + 1
         WHERE agent_id = $1 AND fact_key = $2`,
        [sharer.agent_id, fact.fact_key]
      );
    }
  }

  /**
   * Record a new fact an agent has directly discovered (e.g., found a resource node).
   */
  async recordDiscovery(
    agentId: string,
    worldId: string,
    factKey: string,
    factValue: string,
    tick: number
  ): Promise<void> {
    await this.upsertKnowledge({
      agent_id: agentId,
      world_id: worldId,
      fact_key: factKey,
      fact_value: factValue,
      confidence: 1.0,
      source_agent_id: undefined,
      learned_tick: tick,
      times_shared: 0,
    });

    // Prune oldest low-confidence facts if over limit
    await execute(
      `DELETE FROM memory.agent_knowledge
       WHERE agent_id = $1
         AND knowledge_id IN (
           SELECT knowledge_id FROM memory.agent_knowledge
           WHERE agent_id = $1
           ORDER BY confidence ASC, learned_tick ASC
           OFFSET $2
         )`,
      [agentId, MAX_FACTS_PER_AGENT]
    );
  }

  /**
   * Get an agent's full knowledge base (for prompt building).
   */
  async getKnowledge(agentId: string): Promise<AgentKnowledge[]> {
    return query<AgentKnowledge>(
      `SELECT * FROM memory.agent_knowledge
       WHERE agent_id = $1
       ORDER BY confidence DESC, times_shared DESC
       LIMIT 10`,
      [agentId]
    );
  }

  private async upsertKnowledge(k: Omit<AgentKnowledge, 'knowledge_id'>): Promise<void> {
    await execute(
      `INSERT INTO memory.agent_knowledge
         (agent_id, world_id, fact_key, fact_value, confidence, source_agent_id, learned_tick, times_shared)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (agent_id, fact_key) DO UPDATE SET
         fact_value  = EXCLUDED.fact_value,
         confidence  = GREATEST(memory.agent_knowledge.confidence, EXCLUDED.confidence),
         learned_tick= CASE WHEN EXCLUDED.confidence > memory.agent_knowledge.confidence
                         THEN EXCLUDED.learned_tick
                         ELSE memory.agent_knowledge.learned_tick END,
         times_shared= memory.agent_knowledge.times_shared`,
      [
        k.agent_id, k.world_id, k.fact_key, k.fact_value,
        k.confidence, k.source_agent_id ?? null, k.learned_tick, k.times_shared,
      ]
    );
  }
}
