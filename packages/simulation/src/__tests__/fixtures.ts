/**
 * Shared test fixtures for Project Genesis simulation tests.
 * All fixtures produce pure in-memory objects — no DB, no Redis, no Claude API calls.
 */
import type {
  Agent, AgentTraits, AgentState, AgentSkill, InventoryItem,
  Relationship, Conversation, ConversationTurn, TradeOffer, TradeRecord,
  PerceptionContext, MapTile,
} from '../types.js';

// ─── Agent fixtures ────────────────────────────────────────────────────────

export const AGENT_ID_A = 'aaaaaaaa-0000-0000-0000-000000000001';
export const AGENT_ID_B = 'bbbbbbbb-0000-0000-0000-000000000002';
export const WORLD_ID   = 'wwwwwwww-0000-0000-0000-000000000000';

export function makeTraits(overrides: Partial<AgentTraits> = {}): AgentTraits {
  return {
    agent_id: AGENT_ID_A,
    optimism: 50,
    resilience: 50,
    impulsivity: 50,
    extraversion: 50,
    empathy: 50,
    trust_default: 50,
    curiosity: 50,
    analytical: 50,
    creativity: 50,
    fairness: 50,
    loyalty: 50,
    authority_respect: 50,
    ambition: 50,
    aggression: 50,
    self_preservation: 50,
    fear_of_rejection: 50,
    scarcity_anxiety: 50,
    status_obsession: 50,
    leadership_tendency: 50,
    ...overrides,
  };
}

export function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    agent_id: AGENT_ID_A,
    hp: 80,
    position_x: 25,
    position_y: 25,
    need_food: 70,
    need_water: 70,
    need_rest: 70,
    need_belonging: 60,
    need_esteem: 60,
    need_actualization: 50,
    current_activity: 'idle',
    mental_state: 'content',
    current_goal: null,
    is_awake: true,
    last_updated_tick: 0,
    ...overrides,
  };
}

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    agent_id: AGENT_ID_A,
    world_id: WORLD_ID,
    name: 'Alice',
    archetype: 'Hopeful Explorer',
    status: 'alive',
    birth_tick: 0,
    generation: 1,
    parent_agent_ids: [],
    created_by_reproduction: false,
    is_adult: true,
    maturity_tick: null,
    traits: makeTraits(),
    state: makeState(),
    skills: [],
    inventory: [],
    ...overrides,
  };
}

export function makeAgentB(overrides: Partial<Agent> = {}): Agent {
  return makeAgent({
    agent_id: AGENT_ID_B,
    name: 'Bob',
    archetype: 'Cautious Caregiver',
    traits: makeTraits({ agent_id: AGENT_ID_B }),
    state: makeState({ agent_id: AGENT_ID_B }),
    ...overrides,
  });
}

// ─── Relationship fixture ──────────────────────────────────────────────────

export function makeRelationship(overrides: Partial<Relationship> = {}): Relationship {
  return {
    agent_id: AGENT_ID_A,
    other_agent_id: AGENT_ID_B,
    other_agent_name: 'Bob',
    trust_score: 50,
    affection_score: 40,
    respect_score: 40,
    fear_score: 5,
    relationship_type: 'acquaintance',
    ...overrides,
  };
}

// ─── Conversation fixtures ─────────────────────────────────────────────────

export function makeConversationTurn(
  speakerId: string,
  speakerName: string,
  message: string,
  turnNumber = 1
): ConversationTurn {
  return {
    turn_number: turnNumber,
    speaker_id: speakerId,
    speaker_name: speakerName,
    message,
    thought: 'internal thought',
    is_ending: false,
  };
}

export function makeConversation(
  turns: ConversationTurn[],
  outcome: Conversation['outcome'] = 'neutral'
): Conversation {
  return {
    conversation_id: 'conv-0001',
    world_id: WORLD_ID,
    tick: 100,
    day: 1,
    initiator_agent_id: AGENT_ID_A,
    target_agent_id: AGENT_ID_B,
    location_x: 25,
    location_y: 25,
    topic: 'general',
    turns,
    outcome,
    relationship_changes: {},
  };
}

// ─── Trade fixtures ────────────────────────────────────────────────────────

export function makeTradeOffer(
  offered: Record<string, number> = { food: 10 },
  requested: Record<string, number> = { water: 5 }
): TradeOffer {
  return { offered_items: offered, requested_items: requested };
}

export function makeTradeRecord(
  status: TradeRecord['status'] = 'accepted',
  overrides: Partial<TradeRecord> = {}
): TradeRecord {
  return {
    trade_id: 'trade-0001',
    world_id: WORLD_ID,
    tick: 100,
    day: 1,
    offerer_agent_id: AGENT_ID_A,
    receiver_agent_id: AGENT_ID_B,
    offered_items: { food: 10 },
    requested_items: { water: 5 },
    status,
    outcome_reason: 'Fair exchange',
    ...overrides,
  };
}

// ─── PerceptionContext fixture ─────────────────────────────────────────────

export function makePerception(overrides: Partial<PerceptionContext> = {}): PerceptionContext {
  const tile: MapTile = {
    world_id: WORLD_ID,
    x: 25,
    y: 25,
    terrain: 'grassland',
    is_passable: true,
    resources: {},
  };
  return {
    nearby_agents: [],
    visible_resources: [],
    current_tile: tile,
    passable_directions: ['north', 'south', 'east', 'west'],
    ...overrides,
  };
}
