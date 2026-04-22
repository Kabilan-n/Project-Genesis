// Core types for Project Genesis simulation

export interface Agent {
  agent_id: string;
  world_id: string;
  name: string;
  archetype: string;
  status: 'alive' | 'dead' | 'archived';
  birth_tick: number;
  generation: number;
  parent_agent_ids: string[];
  created_by_reproduction: boolean;
  is_adult: boolean;
  maturity_tick?: number | null;
  traits: AgentTraits;
  state: AgentState;
  skills: AgentSkill[];
  inventory: InventoryItem[];
  group_id?: string | null;   // Phase 3: current group membership
}

export interface AgentTraits {
  agent_id: string;
  // Temperament
  optimism: number;
  resilience: number;
  impulsivity: number;
  // Social
  extraversion: number;
  empathy: number;
  trust_default: number;
  // Cognitive
  curiosity: number;
  analytical: number;
  creativity: number;
  // Moral
  fairness: number;
  loyalty: number;
  authority_respect: number;
  // Survival
  ambition: number;
  aggression: number;
  self_preservation: number;
  // Insecurities
  fear_of_rejection: number;
  scarcity_anxiety: number;
  status_obsession: number;
  // Computed
  leadership_tendency: number;
}

export interface AgentState {
  agent_id: string;
  hp: number;
  position_x: number;
  position_y: number;
  need_food: number;
  need_water: number;
  need_rest: number;
  need_belonging: number;
  need_esteem: number;
  need_actualization: number;
  current_activity: string;
  mental_state: MentalState;
  current_goal: string | null;
  is_awake: boolean;
  last_updated_tick: number;
}

export type MentalState = 'alert' | 'tired' | 'stressed' | 'desperate' | 'flow' | 'depressed' | 'manic' | 'content' | 'anxious' | 'lonely' | 'angry' | 'hopeful';

export interface AgentSkill {
  skill_name: string;
  level: number;
  xp: number;
}

export interface InventoryItem {
  resource_type: string;
  amount: number;
  quality: number;
}

export interface MapTile {
  world_id: string;
  x: number;
  y: number;
  terrain: TerrainType;
  is_passable: boolean;
  resources: Record<string, number>;
}

export type TerrainType = 'water' | 'forest' | 'mountain' | 'grassland' | 'desert' | 'swamp';

export interface ResourceNode {
  node_id: string;
  world_id: string;
  x: number;
  y: number;
  resource_type: string;
  current_amount: number;
  max_capacity: number;
  extraction_rate: number;
  regen_rate: number;
  is_depleted: boolean;
}

export interface Relationship {
  agent_id: string;
  other_agent_id: string;
  other_agent_name: string;
  trust_score: number;
  affection_score: number;
  respect_score: number;
  fear_score: number;
  relationship_type: string;
}

export interface WorldEvent {
  event_id?: string;
  world_id: string;
  tick: number;
  day: number;
  event_type: string;
  significance: 'trivial' | 'minor' | 'moderate' | 'major' | 'historic';
  title: string;
  summary?: string;
  participant_agent_ids: string[];
  location_x?: number;
  location_y?: number;
  consequences: Record<string, unknown>;
}

export interface AgentDecision {
  thought: string;
  action: string;
  speech?: string;
  target?: string;        // agent_id or resource_type or tile coord "x,y"
  trade_offer?: TradeOffer;  // populated when action starts with 'offer_trade'
  gossip_subject?: string;   // Phase 3: name of the agent being gossiped about
  gossip_claim?: GossipClaim; // Phase 3: what claim is being made
  group_name?: string;        // Phase 3: name for form_group action
  group_purpose?: string;     // Phase 3: purpose for form_group action
  // Phase 5 fields
  war_target_group?: string;  // group_id for declare_war / raid / defend
  treaty_type?: 'non_aggression' | 'resource_sharing' | 'alliance' | 'vassalage';
  treaty_target_group?: string; // group_id for propose_treaty
  exile_target?: string;       // agent_id for exile_member
  // Phase 6 fields
  belief_name?: string;        // name for found_belief
  belief_tenet?: string;       // core_tenet for found_belief
  myth_title?: string;         // title for record_myth
  myth_narrative?: string;     // narrative for record_myth
  preach_target?: string;      // agent_id or group_id for preach
}

// Phase 2: Conversation types
export interface ConversationTurn {
  turn_number: number;
  speaker_id: string;
  speaker_name: string;
  message: string;
  thought: string;
  is_ending: boolean;
}

export interface Conversation {
  conversation_id?: string;
  world_id: string;
  tick: number;
  day: number;
  initiator_agent_id: string;
  target_agent_id: string;
  location_x: number;
  location_y: number;
  topic?: string;
  turns: ConversationTurn[];
  outcome: 'friendly' | 'hostile' | 'neutral' | 'reconciliation' | 'conflict' | 'bonding';
  relationship_changes: Record<string, RelationshipDelta>;
}

export interface RelationshipDelta {
  trust?: number;
  affection?: number;
  respect?: number;
  fear?: number;
}

// Phase 2: Trade types
export interface TradeOffer {
  offered_items: Record<string, number>;   // resource_type → amount
  requested_items: Record<string, number>; // resource_type → amount
}

export interface TradeRecord {
  trade_id?: string;
  world_id: string;
  tick: number;
  day: number;
  offerer_agent_id: string;
  receiver_agent_id: string;
  offered_items: Record<string, number>;
  requested_items: Record<string, number>;
  counter_offer?: Record<string, number>;
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'expired';
  outcome_reason?: string;
}

// ─── Phase 3: Knowledge ──────────────────────────────────────────────────────

export interface AgentKnowledge {
  knowledge_id?: string;
  agent_id: string;
  world_id: string;
  fact_key: string;    // e.g. 'water_source_at_12_8'
  fact_value: string;  // e.g. 'x=12,y=8 has water node with ~200 units'
  confidence: number;  // 0–1
  source_agent_id?: string;
  learned_tick: number;
  times_shared: number;
}

export interface SkillTeaching {
  teaching_id?: string;
  world_id: string;
  teacher_id: string;
  student_id: string;
  skill_name: string;
  xp_transferred: number;
  teacher_level: number;
  student_level_before: number;
  student_level_after: number;
  tick: number;
  day: number;
  conversation_id?: string;
}

// ─── Phase 3: Reputation & Gossip ────────────────────────────────────────────

export type GossipClaim = 'trustworthy' | 'dangerous' | 'skilled' | 'generous' | 'deceptive' | 'weak' | 'heroic' | 'cruel';

export interface Reputation {
  agent_id: string;
  world_id: string;
  trustworthiness: number;  // 0–100, 50=neutral
  generosity: number;
  skill_renown: number;
  danger_level: number;
  total_reports: number;
  positive_reports: number;
  negative_reports: number;
  last_updated_tick: number;
}

export interface GossipEvent {
  gossip_id?: string;
  world_id: string;
  gossiper_id: string;
  listener_id: string;
  subject_id: string;
  claim: GossipClaim;
  believed: boolean;
  trust_change_subject: number;
  tick: number;
  day: number;
}

// ─── Phase 3: Groups / Tribes ─────────────────────────────────────────────────

export interface Group {
  group_id?: string;
  world_id: string;
  name: string;
  purpose?: string;
  founder_id: string;
  leader_id?: string;
  status: 'active' | 'disbanded' | 'merging';
  territory_x?: number;
  territory_y?: number;
  territory_radius: number;
  shared_values: Record<string, number>;  // trait-like values the group upholds
  colour: string;
  formed_tick: number;
  formed_day: number;
  member_count: number;
}

export interface GroupMember {
  group_id: string;
  agent_id: string;
  role: 'founder' | 'leader' | 'elder' | 'member' | 'recruit';
  joined_tick: number;
  joined_day: number;
  contribution_score: number;
}

export interface WorldConfig {
  map_size: number;
  time_scale: number;
  scarcity_level: 'low' | 'moderate' | 'high';
  max_agents: number;
}

export interface PerceptionContext {
  nearby_agents: Array<{
    agent_id: string;
    name: string;
    distance: number;
    activity: string;
    relationship_type: string;
  }>;
  visible_resources: Array<{
    resource_type: string;
    amount: number;
    distance: number;
    x: number;
    y: number;
  }>;
  current_tile: MapTile;
  passable_directions: string[];
  // Phase 5: conflict context (optional — only populated when relevant)
  conflict_context?: {
    active_wars: Array<{ war_id: string; enemy_group_id: string; enemy_group_name: string; casualties_friendly: number }>;
    nearby_enemies: Array<{ agent_id: string; name: string; group_name: string; distance: number }>;
    active_treaties: Array<{ group_name: string; treaty_type: string }>;
  };
  // Phase 6: belief context (optional)
  belief_context?: {
    own_belief?: { name: string; conviction: number; prescribes_ritual: boolean };
    nearby_preachers: Array<{ agent_id: string; name: string; belief_name: string; conviction: number }>;
    nearby_sacred_sites: Array<{ site_id: string; name: string; belief_name: string; x: number; y: number }>;
  };
}

// ─── Phase 5: Conflict / Governance ─────────────────────────────────────────

export interface War {
  war_id: string;
  world_id: string;
  aggressor_group_id: string;
  defender_group_id: string;
  status: 'active' | 'ceasefire' | 'ended';
  declared_tick: number;
  declared_day: number;
  ended_tick?: number;
  ended_day?: number;
  outcome?: string;
  casualties_aggressor: number;
  casualties_defender: number;
  resources_looted: Record<string, number>;
}

export interface Skirmish {
  skirmish_id?: string;
  world_id: string;
  war_id?: string;
  attacker_id: string;
  defender_id: string;
  attacker_group_id?: string;
  defender_group_id?: string;
  location_x: number;
  location_y: number;
  tick: number;
  day: number;
  outcome: 'attacker_won' | 'defender_won' | 'fled' | 'interrupted';
  hp_damage_attacker: number;
  hp_damage_defender: number;
  attacker_power: number;
  defender_power: number;
  resources_stolen: Record<string, number>;
  event_id?: string;
}

export interface Treaty {
  treaty_id: string;
  world_id: string;
  group_a_id: string;
  group_b_id: string;
  treaty_type: 'non_aggression' | 'resource_sharing' | 'alliance' | 'vassalage';
  terms: Record<string, unknown>;
  status: 'pending' | 'active' | 'broken' | 'expired';
  proposed_tick: number;
  proposed_day: number;
  ratified_tick?: number;
  ratified_day?: number;
  expires_tick?: number;
  broken_by_group_id?: string;
  proposer_group_id: string;
  event_id?: string;
}

export interface LeadershipEvent {
  leadership_event_id?: string;
  world_id: string;
  group_id: string;
  challenger_id: string;
  incumbent_id: string;
  mechanism: 'vote' | 'intimidation' | 'demonstration';
  outcome: 'challenger_wins' | 'incumbent_wins' | 'split';
  votes_challenger: number;
  votes_incumbent: number;
  tick: number;
  day: number;
}

// ─── Phase 6: Beliefs & Culture ──────────────────────────────────────────────

export interface BeliefSystem {
  belief_id: string;
  world_id: string;
  name: string;
  founder_id?: string;
  core_tenet: string;
  secondary_tenets: string[];
  prescribes_aggression: boolean;
  prescribes_sharing: boolean;
  prescribes_isolation: boolean;
  prescribes_ritual: boolean;
  adherent_count: number;
  colour: string;
  founded_tick: number;
  founded_day: number;
  is_extinct: boolean;
}

export interface AgentBelief {
  agent_id: string;
  belief_id: string;
  conviction: number;  // 0–1
  personal_interpretation?: string;
  adopted_tick: number;
  adopted_day: number;
  converted_from_agent_id?: string;
}

export interface Myth {
  myth_id: string;
  world_id: string;
  author_id: string;
  source_event_id?: string;
  belief_id?: string;
  title: string;
  narrative: string;
  moral_lesson?: string;
  spread_count: number;
  believability: number;  // 0–1
  created_tick: number;
  created_day: number;
}

export interface AgentMyth {
  agent_id: string;
  myth_id: string;
  local_version?: string;  // agent's personal retelling
  fidelity: number;        // 0–1, decays with each retelling
  learned_from_id?: string;
  learned_tick: number;
}

export interface Ritual {
  ritual_id?: string;
  world_id: string;
  belief_id: string;
  group_id?: string;
  name: string;
  description?: string;
  trigger_type: 'daily' | 'weekly' | 'on_war' | 'on_death' | 'manual';
  resource_cost: Record<string, number>;
  esteem_gain: number;
  belonging_gain: number;
  conviction_gain: number;
  last_performed_tick: number;
  times_performed: number;
}

export interface SacredSite {
  site_id: string;
  world_id: string;
  belief_id: string;
  x: number;
  y: number;
  name?: string;
  reason?: string;
  pilgrimage_bonus_esteem: number;
  pilgrimage_bonus_hp: number;
  visit_count: number;
  created_tick: number;
  created_day: number;
}

// ─── Generations ─────────────────────────────────────────────────────────────

export interface ReproductionRecord {
  record_id?: string;
  world_id: string;
  parent_a_id: string;
  parent_b_id: string;
  child_id: string;
  tick: number;
  day: number;
  inheritance_log: Record<string, { parent_a: number; parent_b: number; mutation: number; final: number }>;
}

export interface TraitDriftEvent {
  drift_id?: string;
  world_id: string;
  agent_id: string;
  tick: number;
  day: number;
  trigger_type: 'trauma' | 'success' | 'prolonged_scarcity' | 'bonding' | 'isolation';
  source_event_id?: string;
  changes: Partial<Record<keyof AgentTraits, number>>;
}

export interface FamilyNode {
  agent_id: string;
  name: string;
  archetype: string;
  generation: number;
  status: 'alive' | 'dead' | 'archived';
  parent_agent_ids: string[];
  children: FamilyNode[];
}
