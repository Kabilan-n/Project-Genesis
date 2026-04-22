import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../llm/PromptBuilder.js';
import {
  makeAgent, makeAgentB, makeRelationship, makeConversationTurn,
  makePerception, makeTraits, makeState, AGENT_ID_A, AGENT_ID_B,
} from './fixtures.js';

const pb = new PromptBuilder();

// ─── buildDecisionPrompt ────────────────────────────────────────────────────

describe('PromptBuilder.buildDecisionPrompt', () => {
  it('includes agent name and archetype', () => {
    const agent = makeAgent();
    const prompt = pb.buildDecisionPrompt(agent, [], [], makePerception(), 100, 1);
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('Hopeful Explorer');
  });

  it('embeds current HP in the state section', () => {
    const agent = makeAgent({ state: makeState({ hp: 42 }) });
    const prompt = pb.buildDecisionPrompt(agent, [], [], makePerception(), 100, 1);
    expect(prompt).toContain('42');
  });

  it('labels hp < 30 as CRITICAL', () => {
    const agent = makeAgent({ state: makeState({ hp: 15 }) });
    const prompt = pb.buildDecisionPrompt(agent, [], [], makePerception(), 100, 1);
    expect(prompt).toContain('CRITICAL');
  });

  it('includes relationship info for nearby agents', () => {
    const rel = makeRelationship();
    const agent = makeAgent();
    const perception = makePerception({
      nearby_agents: [{
        agent_id: AGENT_ID_B,
        name: 'Bob',
        distance: 2,
        activity: 'idle',
        relationship_type: 'acquaintance',
      }],
    });
    const prompt = pb.buildDecisionPrompt(agent, [rel], [], perception, 100, 1);
    expect(prompt).toContain('Bob');
    expect(prompt).toContain('acquaintance');
  });

  it('shows recent memories', () => {
    const agent = makeAgent();
    const memories = ['I found berries near the river', 'Bob helped me carry wood'];
    const prompt = pb.buildDecisionPrompt(agent, [], memories, makePerception(), 100, 1);
    expect(prompt).toContain('I found berries near the river');
    expect(prompt).toContain('Bob helped me carry wood');
  });

  it('shows visible resources', () => {
    const agent = makeAgent();
    const perception = makePerception({
      visible_resources: [{ resource_type: 'food', amount: 120, distance: 3, x: 22, y: 25 }],
    });
    const prompt = pb.buildDecisionPrompt(agent, [], [], perception, 100, 1);
    expect(prompt).toContain('food');
    expect(prompt).toContain('120');
  });

  it('outputs correct time-of-day labels for different ticks', () => {
    const agent = makeAgent();
    // tick 0 = pre-dawn (0-359)
    const dawn = pb.buildDecisionPrompt(agent, [], [], makePerception(), 0, 1);
    expect(dawn).toContain('pre-dawn');

    // tick 720 = midday (720-899)
    const midday = pb.buildDecisionPrompt(agent, [], [], makePerception(), 720, 1);
    expect(midday).toContain('midday');

    // tick 1300 = night (≥1260)
    const night = pb.buildDecisionPrompt(agent, [], [], makePerception(), 1300, 1);
    expect(night).toContain('night');
  });

  it('describes optimistic trait when optimism > 65', () => {
    const agent = makeAgent({ traits: makeTraits({ optimism: 80 }) });
    const prompt = pb.buildDecisionPrompt(agent, [], [], makePerception(), 100, 1);
    expect(prompt).toContain('bright side');
  });

  it('describes pessimistic trait when optimism < 35', () => {
    const agent = makeAgent({ traits: makeTraits({ optimism: 20 }) });
    const prompt = pb.buildDecisionPrompt(agent, [], [], makePerception(), 100, 1);
    expect(prompt).toContain('go badly');
  });

  it('includes all available action verbs', () => {
    const agent = makeAgent();
    const prompt = pb.buildDecisionPrompt(agent, [], [], makePerception(), 100, 1);
    expect(prompt).toContain('move');
    expect(prompt).toContain('gather');
    expect(prompt).toContain('rest');
    expect(prompt).toContain('eat');
    expect(prompt).toContain('drink');
    expect(prompt).toContain('talk');
  });

  it('requires JSON-only output', () => {
    const agent = makeAgent();
    const prompt = pb.buildDecisionPrompt(agent, [], [], makePerception(), 100, 1);
    expect(prompt).toContain('Respond ONLY with a JSON object');
  });

  it('labels inventory items', () => {
    const agent = makeAgent({
      inventory: [{ resource_type: 'food', amount: 30, quality: 1 }],
    });
    const prompt = pb.buildDecisionPrompt(agent, [], [], makePerception(), 100, 1);
    expect(prompt).toContain('food');
    expect(prompt).toContain('30');
  });
});

// ─── buildConversationTurnPrompt ────────────────────────────────────────────

describe('PromptBuilder.buildConversationTurnPrompt', () => {
  it('includes both agent names', () => {
    const speaker = makeAgent();
    const listener = makeAgentB();
    const turns = [makeConversationTurn(AGENT_ID_A, 'Alice', 'Hello!')];
    const prompt = pb.buildConversationTurnPrompt(
      speaker, listener, turns, 'Hello!', null, [], 100, 1, false
    );
    expect(prompt).toContain('Alice');
    // Listener name is uppercased in the prompt template
    expect(prompt).toContain('BOB');
  });

  it('includes conversation history', () => {
    const speaker = makeAgent();
    const listener = makeAgentB();
    const turns = [
      makeConversationTurn(AGENT_ID_A, 'Alice', 'Hello!', 1),
      makeConversationTurn(AGENT_ID_B, 'Bob', 'Hi there!', 2),
    ];
    const prompt = pb.buildConversationTurnPrompt(
      speaker, listener, turns, 'Hi there!', null, [], 100, 1, false
    );
    expect(prompt).toContain('Hello!');
    expect(prompt).toContain('Hi there!');
  });

  it('adds force-end instruction on last turn', () => {
    const speaker = makeAgent();
    const listener = makeAgentB();
    const prompt = pb.buildConversationTurnPrompt(
      speaker, listener, [], 'Bye now.', null, [], 100, 1, true
    );
    expect(prompt).toContain('natural close');
  });

  it('shows relationship context when available', () => {
    const speaker = makeAgent();
    const listener = makeAgentB();
    const rel = makeRelationship({ relationship_type: 'friend', trust_score: 75 });
    const prompt = pb.buildConversationTurnPrompt(
      speaker, listener, [], 'Let us share resources.', rel, [], 100, 1, false
    );
    expect(prompt).toContain('friend');
    expect(prompt).toContain('75');
  });

  it('labels relationship as "stranger" when no relationship exists', () => {
    const speaker = makeAgent();
    const listener = makeAgentB();
    const prompt = pb.buildConversationTurnPrompt(
      speaker, listener, [], 'Who are you?', null, [], 100, 1, false
    );
    expect(prompt).toContain('stranger');
  });

  it('requires JSON output with thought/speech/is_ending fields', () => {
    const prompt = pb.buildConversationTurnPrompt(
      makeAgent(), makeAgentB(), [], 'Hey.', null, [], 100, 1, false
    );
    expect(prompt).toContain('"thought"');
    expect(prompt).toContain('"speech"');
    expect(prompt).toContain('"is_ending"');
  });
});

// ─── buildTradeDecisionPrompt ───────────────────────────────────────────────

describe('PromptBuilder.buildTradeDecisionPrompt', () => {
  it('includes both agent names', () => {
    const receiver = makeAgent();
    const offerer = makeAgentB();
    const offer = { offered_items: { food: 10 }, requested_items: { water: 5 } };
    const prompt = pb.buildTradeDecisionPrompt(
      receiver, offerer, offer, [{ resource_type: 'water', amount: 20 }], null, 100, 1
    );
    expect(prompt).toContain('Alice');
    // Offerer name is uppercased in the prompt template: "TRADE OFFER FROM BOB"
    expect(prompt).toContain('BOB');
  });

  it('lists offered and requested items', () => {
    const offer = { offered_items: { food: 15 }, requested_items: { wood: 8 } };
    const prompt = pb.buildTradeDecisionPrompt(
      makeAgent(), makeAgentB(), offer,
      [{ resource_type: 'wood', amount: 30 }],
      null, 100, 1
    );
    expect(prompt).toContain('food');
    expect(prompt).toContain('15');
    expect(prompt).toContain('wood');
    expect(prompt).toContain('8');
  });

  it('includes receiver inventory', () => {
    const inventory = [
      { resource_type: 'water', amount: 40 },
      { resource_type: 'stone', amount: 10 },
    ];
    const offer = { offered_items: { food: 5 }, requested_items: { water: 3 } };
    const prompt = pb.buildTradeDecisionPrompt(
      makeAgent(), makeAgentB(), offer, inventory, null, 100, 1
    );
    expect(prompt).toContain('water');
    expect(prompt).toContain('40');
    expect(prompt).toContain('stone');
  });

  it('shows trust score from relationship', () => {
    const rel = { trust_score: 62, relationship_type: 'friend' };
    const offer = { offered_items: { food: 5 }, requested_items: { water: 3 } };
    const prompt = pb.buildTradeDecisionPrompt(
      makeAgent(), makeAgentB(), offer, [], rel, 100, 1
    );
    expect(prompt).toContain('62');
    expect(prompt).toContain('friend');
  });

  it('requires JSON with decision field', () => {
    const offer = { offered_items: { food: 5 }, requested_items: { water: 3 } };
    const prompt = pb.buildTradeDecisionPrompt(
      makeAgent(), makeAgentB(), offer, [], null, 100, 1
    );
    expect(prompt).toContain('"decision"');
    expect(prompt).toContain('"accept"');
    expect(prompt).toContain('"reject"');
    expect(prompt).toContain('"counter"');
  });
});
