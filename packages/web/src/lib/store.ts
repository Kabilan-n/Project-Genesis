import { create } from 'zustand';

export interface AgentSummary {
  agent_id: string;
  name: string;
  archetype: string;
  hp: number;
  position_x: number;
  position_y: number;
  mental_state: string;
  current_activity: string;
  need_food: number;
  need_water: number;
  need_rest: number;
  group_id?: string | null;
  group_name?: string | null;
  group_colour?: string | null;
}

export interface GroupSummary {
  group_id: string;
  name: string;
  colour: string;
  member_count: number;
  territory_x?: number;
  territory_y?: number;
  territory_radius: number;
}

export interface WorldEvent {
  event_id: string;
  tick: number;
  day: number;
  event_type: string;
  significance: string;
  title: string;
  summary?: string;
  participant_agent_ids: string[];
  consequences?: Record<string, unknown>;
}

export interface WorldStats {
  tick: number;
  day: number;
  time_of_day: string;
  agent_count: number;
}

interface GenesisStore {
  worldId: string;
  agents: Map<string, AgentSummary>;
  groups: Map<string, GroupSummary>;
  events: WorldEvent[];
  stats: WorldStats | null;
  selectedAgentId: string | null;
  setWorldId: (id: string) => void;
  updateAgent: (update: Partial<AgentSummary> & { agent_id: string }) => void;
  addEvent: (event: WorldEvent) => void;
  setStats: (stats: WorldStats) => void;
  setSelectedAgent: (id: string | null) => void;
  setAgents: (agents: AgentSummary[]) => void;
  setGroups: (groups: GroupSummary[]) => void;
  upsertGroup: (group: GroupSummary) => void;
  // WebSocket connection state — single authoritative source.
  connectionState: 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';
  setConnectionState: (s: GenesisStore['connectionState']) => void;
}

export const useGenesisStore = create<GenesisStore>((set, get) => ({
  worldId: ((typeof window !== 'undefined' && (window as any).__genesis?.worldId) || process.env.NEXT_PUBLIC_WORLD_ID) ?? '',
  agents: new Map(),
  groups: new Map(),
  events: [],
  stats: null,
  selectedAgentId: null,

  setWorldId: (id) => set({ worldId: id }),

  setAgents: (agentList) => {
    const map = new Map(agentList.map(a => [a.agent_id, a]));
    set({ agents: map });
  },

  updateAgent: (update) => set(state => {
    const agents = new Map(state.agents);
    const existing = agents.get(update.agent_id);
    if (existing) {
      agents.set(update.agent_id, { ...existing, ...update });
    }
    return { agents };
  }),

  addEvent: (event) => set(state => ({
    events: [event, ...state.events].slice(0, 200),
  })),

  setStats: (stats) => set({ stats }),

  setSelectedAgent: (id) => set({ selectedAgentId: id }),

  setGroups: (groupList) => {
    const map = new Map(groupList.map(g => [g.group_id, g]));
    set({ groups: map });
  },

  upsertGroup: (group) => set(state => {
    const groups = new Map(state.groups);
    groups.set(group.group_id, group);
    return { groups };
  }),

  connectionState: 'closed',
  setConnectionState: (connectionState) => set({ connectionState }),
}));
