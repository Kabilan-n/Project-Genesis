/**
 * Tests for KnowledgeEngine.
 *
 * Two pure-ish entry points: attemptSkillTeaching (which guards on conversation
 * outcome before any DB call) and propagateKnowledge (same). The transfer
 * decisions themselves are best validated by stubbing DB writes and asserting
 * which transfers were attempted.
 */
import { describe, it, expect, vi } from 'vitest';
import { KnowledgeEngine } from '../cultural/KnowledgeEngine.js';
import {
  makeAgent, makeAgentB, makeConversation, makeConversationTurn,
  AGENT_ID_A, AGENT_ID_B,
} from './fixtures.js';

describe('KnowledgeEngine.attemptSkillTeaching — outcome gate', () => {
  it('returns no teachings for a neutral conversation', async () => {
    const eng = new KnowledgeEngine();
    const conv = makeConversation([makeConversationTurn(AGENT_ID_A, 'Alice', 'Hi')], 'neutral');
    const result = await eng.attemptSkillTeaching(makeAgent(), makeAgentB(), conv);
    expect(result).toEqual([]);
  });

  it('returns no teachings for a hostile conversation', async () => {
    const eng = new KnowledgeEngine();
    const conv = makeConversation([makeConversationTurn(AGENT_ID_A, 'Alice', 'Hi')], 'hostile');
    const result = await eng.attemptSkillTeaching(makeAgent(), makeAgentB(), conv);
    expect(result).toEqual([]);
  });
});

describe('KnowledgeEngine.attemptSkillTeaching — gap threshold', () => {
  it('does NOT teach when level gap is less than 5', async () => {
    const eng = new KnowledgeEngine();
    const transferSpy = vi.spyOn(eng as any, 'transferSkill').mockResolvedValue(null);

    const conv = makeConversation([makeConversationTurn(AGENT_ID_A, 'Alice', 'Hi')], 'bonding');
    const a = makeAgent({ skills: [{ skill_name: 'foraging', level: 10, xp: 0 }] });
    const b = makeAgentB({ skills: [{ skill_name: 'foraging', level: 7, xp: 0 }] });

    await eng.attemptSkillTeaching(a, b, conv);
    expect(transferSpy).not.toHaveBeenCalled();
  });

  it('teaches when gap is >= 5', async () => {
    const eng = new KnowledgeEngine();
    const transferSpy = vi.spyOn(eng as any, 'transferSkill').mockResolvedValue(null);

    const conv = makeConversation([makeConversationTurn(AGENT_ID_A, 'Alice', 'Hi')], 'bonding');
    const a = makeAgent({ skills: [{ skill_name: 'foraging', level: 20, xp: 0 }] });
    const b = makeAgentB({ skills: [{ skill_name: 'foraging', level: 10, xp: 0 }] });

    await eng.attemptSkillTeaching(a, b, conv);
    // Gap = 10, XP transfer = 10 * 0.15 = 1.5
    expect(transferSpy).toHaveBeenCalledWith(
      a, b, 'foraging', 1.5, 20, 10, conv.conversation_id, conv.tick, conv.day,
    );
  });

  it('teaches in the reverse direction when B is stronger', async () => {
    const eng = new KnowledgeEngine();
    const transferSpy = vi.spyOn(eng as any, 'transferSkill').mockResolvedValue(null);

    const conv = makeConversation([makeConversationTurn(AGENT_ID_A, 'Alice', 'Hi')], 'friendly');
    const a = makeAgent({ skills: [{ skill_name: 'crafting', level: 5, xp: 0 }] });
    const b = makeAgentB({ skills: [{ skill_name: 'crafting', level: 30, xp: 0 }] });

    await eng.attemptSkillTeaching(a, b, conv);
    expect(transferSpy).toHaveBeenCalledWith(
      b, a, 'crafting', expect.closeTo(3.75, 5), 30, 5, conv.conversation_id, conv.tick, conv.day,
    );
  });

  it('skips skills the other agent does not have', async () => {
    const eng = new KnowledgeEngine();
    const transferSpy = vi.spyOn(eng as any, 'transferSkill').mockResolvedValue(null);

    const conv = makeConversation([makeConversationTurn(AGENT_ID_A, 'Alice', 'Hi')], 'bonding');
    const a = makeAgent({ skills: [{ skill_name: 'fishing', level: 50, xp: 0 }] });
    const b = makeAgentB({ skills: [] });

    await eng.attemptSkillTeaching(a, b, conv);
    expect(transferSpy).not.toHaveBeenCalled();
  });
});

describe('KnowledgeEngine.propagateKnowledge — outcome gate', () => {
  it('does not call shareFacts when outcome is neutral', async () => {
    const eng = new KnowledgeEngine();
    const shareSpy = vi.spyOn(eng as any, 'shareFacts').mockResolvedValue(undefined);

    const conv = makeConversation([makeConversationTurn(AGENT_ID_A, 'Alice', 'Hi')], 'neutral');
    await eng.propagateKnowledge(makeAgent(), makeAgentB(), conv);
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('shares both directions on a bonding conversation', async () => {
    const eng = new KnowledgeEngine();
    const shareSpy = vi.spyOn(eng as any, 'shareFacts').mockResolvedValue(undefined);

    const conv = makeConversation([makeConversationTurn(AGENT_ID_A, 'Alice', 'Hi')], 'bonding');
    await eng.propagateKnowledge(makeAgent(), makeAgentB(), conv);
    expect(shareSpy).toHaveBeenCalledTimes(2);
  });
});
