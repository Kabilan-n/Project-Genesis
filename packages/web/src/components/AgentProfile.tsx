'use client';
import { useEffect, useState } from 'react';
import { useGenesisStore } from '../lib/store.js';
import { ConversationModal } from './ConversationModal.js';
import { FamilyTree } from './FamilyTree.js';
import clsx from 'clsx';

interface AgentDetail {
  agent_id: string;
  name: string;
  archetype: string;
  hp: number;
  mental_state: string;
  current_goal: string;
  current_activity: string;
  need_food: number;
  need_water: number;
  need_rest: number;
  need_belonging: number;
  need_esteem: number;
  birth_tick: number;
  traits: Record<string, number>;
  skills: Array<{ skill_name: string; level: number }>;
  inventory: Array<{ resource_type: string; amount: number }>;
  recent_memories: Array<{ summary: string; emotional_valence: number; tick: number }>;
  group_id?: string | null;
}

interface GroupDetail {
  group_id: string;
  name: string;
  purpose?: string;
  colour: string;
  member_count: number;
  formed_day: number;
  members: Array<{
    agent_id: string;
    name: string;
    role: string;
    contribution_score: number;
    hp: number;
    mental_state: string;
  }>;
}

interface ReputationDetail {
  trustworthiness: number;
  generosity: number;
  skill_renown: number;
  danger_level: number;
  total_reports: number;
  positive_reports: number;
  negative_reports: number;
}

interface RelationshipRow {
  other_agent_id: string;
  other_name: string;
  other_archetype: string;
  trust_score: number;
  affection_score: number;
  respect_score: number;
  fear_score: number;
  relationship_type: string;
  last_interaction_tick: number;
}

interface ConversationRow {
  conversation_id: string;
  tick: number;
  day: number;
  topic: string;
  outcome: string;
  initiator_agent_id: string;
  target_agent_id: string;
  initiator_name: string;
  target_name: string;
  turn_count: number;
}

function NeedBar({ label, value, critical }: { label: string; value: number; critical: number }) {
  const color = value < critical ? 'bg-red-500' : value < critical * 2 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-gray-400 truncate">{label}</span>
      <div className="flex-1 bg-gray-700 rounded h-2">
        <div className={clsx('h-2 rounded transition-all', color)} style={{ width: `${Math.round(value)}%` }} />
      </div>
      <span className="w-8 text-right text-gray-400">{Math.round(value)}</span>
    </div>
  );
}

function TraitDot({ label, value }: { label: string; value: number }) {
  const dots = Math.round(value / 20);
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="w-24 text-gray-400 truncate">{label}</span>
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => (
          <div key={i} className={clsx('w-2 h-2 rounded-full', i <= dots ? 'bg-blue-400' : 'bg-gray-600')} />
        ))}
      </div>
    </div>
  );
}

const REL_COLORS: Record<string, string> = {
  stranger:         'text-gray-400',
  acquaintance:     'text-blue-300',
  friend:           'text-green-300',
  close_friend:     'text-emerald-300',
  romantic_partner: 'text-pink-300',
  rival:            'text-yellow-300',
  enemy:            'text-red-400',
  family:           'text-purple-300',
};

const OUTCOME_DOT: Record<string, string> = {
  bonding:        'bg-green-400',
  friendly:       'bg-blue-400',
  neutral:        'bg-gray-500',
  reconciliation: 'bg-teal-400',
  conflict:       'bg-orange-400',
  hostile:        'bg-red-500',
};

function PartnerThread({
  partnerName, conversations, onOpenConv,
}: {
  partnerName: string;
  conversations: ConversationRow[];
  onOpenConv: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = conversations[0];
  const total = conversations.length;
  // Count outcomes
  const positive = conversations.filter(c => c.outcome === 'bonding' || c.outcome === 'friendly').length;
  const negative = conversations.filter(c => c.outcome === 'hostile' || c.outcome === 'conflict').length;

  return (
    <div className="bg-gray-800/30 rounded-lg border border-gray-700/30 overflow-hidden">
      {/* Partner header — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-3 py-2 hover:bg-gray-700/30 transition-colors flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">{expanded ? '\u25BC' : '\u25B6'}</span>
          <span className="text-xs font-medium text-gray-200">{partnerName}</span>
          <span className="text-xs text-gray-500">{total} conversation{total !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {positive > 0 && <span className="text-xs text-green-400">+{positive}</span>}
          {negative > 0 && <span className="text-xs text-red-400">-{negative}</span>}
          <div className={clsx('w-2 h-2 rounded-full', OUTCOME_DOT[latest.outcome] ?? 'bg-gray-500')} />
        </div>
      </button>

      {/* Expanded — show individual conversations */}
      {expanded && (
        <div className="border-t border-gray-700/20 divide-y divide-gray-700/20">
          {conversations.map(conv => (
            <button
              key={conv.conversation_id}
              onClick={() => onOpenConv(conv.conversation_id)}
              className="w-full text-left px-4 py-1.5 hover:bg-gray-700/40 transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className={clsx('w-1.5 h-1.5 rounded-full shrink-0', OUTCOME_DOT[conv.outcome] ?? 'bg-gray-500')} />
                <span className="text-xs text-gray-400 truncate">
                  {conv.topic ? `"${conv.topic.slice(0, 40)}"` : conv.outcome}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-xs text-gray-600">{conv.turn_count}t</span>
                <span className="text-xs text-gray-600">D{conv.day}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface AgentBelief {
  belief_id: string;
  name: string;
  core_tenet: string;
  colour: string;
  conviction: number;
  adopted_day: number;
}

type Tab = 'status' | 'relations' | 'group' | 'history' | 'family';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function AgentProfile() {
  const { selectedAgentId, stats } = useGenesisStore();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [groupDetail, setGroupDetail] = useState<GroupDetail | null>(null);
  const [reputation, setReputation] = useState<ReputationDetail | null>(null);
  const [beliefs, setBeliefs] = useState<AgentBelief[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('status');
  const [openConvId, setOpenConvId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAgentId) { setAgent(null); setGroupDetail(null); setReputation(null); return; }

    const loadAll = async () => {
      try {
        const [agentRes, relRes, convRes, repRes, beliefRes] = await Promise.all([
          fetch(`${API}/agents/${selectedAgentId}`),
          fetch(`${API}/agents/${selectedAgentId}/relationships`),
          fetch(`${API}/agents/${selectedAgentId}/conversations?limit=50`),
          fetch(`${API}/agents/${selectedAgentId}/reputation`),
          fetch(`${API}/agents/${selectedAgentId}/beliefs`),
        ]);
        const agentData: AgentDetail | null = agentRes.ok ? await agentRes.json() : null;
        if (agentData) setAgent(agentData);
        if (relRes.ok)    setRelationships(await relRes.json());
        if (convRes.ok)   setConversations(await convRes.json());
        if (repRes.ok)    setReputation(await repRes.json());
        if (beliefRes.ok) setBeliefs(await beliefRes.json());

        // Load group details if agent is in one
        if (agentData?.group_id) {
          const grpRes = await fetch(`${API}/groups/${agentData.group_id}`);
          if (grpRes.ok) setGroupDetail(await grpRes.json());
        } else {
          setGroupDetail(null);
        }
      } catch { /* ignore */ }
    };

    loadAll();
    const interval = setInterval(loadAll, 8000);
    return () => clearInterval(interval);
  }, [selectedAgentId]);

  if (!selectedAgentId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Click an agent on the map to inspect
      </div>
    );
  }

  if (!agent) {
    return <div className="text-gray-500 text-sm p-4">Loading...</div>;
  }

  const age = stats ? stats.tick - agent.birth_tick : 0;
  const days = Math.floor(age / 1440);

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="text-lg font-bold text-white">{agent.name}</div>
        <div className="text-blue-400 text-xs">{agent.archetype}</div>
        <div className="text-gray-500 text-xs">Day {days} of existence</div>

        {/* HP bar always visible */}
        <div className="mt-2">
          <NeedBar label="Health" value={agent.hp} critical={30} />
        </div>

        {/* Mental state */}
        <div className="mt-2 bg-gray-800 rounded px-2 py-1 text-xs">
          <span className="text-gray-400">State: </span>
          <span className="text-yellow-300">{agent.mental_state}</span>
          {agent.current_activity && (
            <> · <span className="text-gray-300">{agent.current_activity}</span></>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700/60 px-2 shrink-0 overflow-x-auto">
        {(['status', 'relations', 'group', 'history', 'family'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'px-2.5 py-1.5 text-xs capitalize transition-colors whitespace-nowrap',
              activeTab === tab
                ? 'text-white border-b-2 border-blue-400 -mb-px'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {tab}
            {tab === 'relations' && relationships.length > 0 && (
              <span className="ml-1 text-gray-600">({relationships.length})</span>
            )}
            {tab === 'group' && groupDetail && (
              <span className="ml-1 w-2 h-2 rounded-full inline-block" style={{ backgroundColor: groupDetail.colour }} />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">

        {/* ── Status tab ── */}
        {activeTab === 'status' && (
          <div className="flex flex-col gap-4">
            {agent.current_goal && (
              <div className="bg-gray-800/50 rounded p-2 text-xs text-gray-300 italic">
                "{agent.current_goal.slice(0, 120)}"
              </div>
            )}

            <div>
              <div className="text-gray-400 text-xs font-semibold mb-1 uppercase tracking-wider">Needs</div>
              <div className="flex flex-col gap-1.5">
                <NeedBar label="Food"      value={agent.need_food}      critical={20} />
                <NeedBar label="Water"     value={agent.need_water}     critical={20} />
                <NeedBar label="Rest"      value={agent.need_rest}      critical={20} />
                <NeedBar label="Belonging" value={agent.need_belonging} critical={25} />
                <NeedBar label="Esteem"    value={agent.need_esteem}    critical={20} />
              </div>
            </div>

            {agent.traits && (
              <div>
                <div className="text-gray-400 text-xs font-semibold mb-1 uppercase tracking-wider">Traits</div>
                <div className="flex flex-col gap-1">
                  <TraitDot label="Optimism"  value={agent.traits.optimism   ?? 50} />
                  <TraitDot label="Empathy"   value={agent.traits.empathy    ?? 50} />
                  <TraitDot label="Curiosity" value={agent.traits.curiosity  ?? 50} />
                  <TraitDot label="Aggression"value={agent.traits.aggression ?? 50} />
                  <TraitDot label="Trust"     value={agent.traits.trust_default ?? 50} />
                </div>
              </div>
            )}

            {agent.inventory && agent.inventory.length > 0 && (
              <div>
                <div className="text-gray-400 text-xs font-semibold mb-1 uppercase tracking-wider">Inventory</div>
                <div className="flex flex-col gap-0.5">
                  {agent.inventory.map(item => (
                    <div key={item.resource_type} className="flex justify-between text-xs">
                      <span className="text-gray-300">{item.resource_type}</span>
                      <span className="text-gray-400">{Math.round(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {agent.skills && agent.skills.length > 0 && (
              <div>
                <div className="text-gray-400 text-xs font-semibold mb-1 uppercase tracking-wider">Skills</div>
                <div className="flex flex-col gap-0.5">
                  {agent.skills.map(s => (
                    <div key={s.skill_name} className="flex justify-between text-xs">
                      <span className="text-gray-300">{s.skill_name}</span>
                      <span className="text-blue-400">Lv.{s.level}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {reputation && reputation.total_reports > 0 && (
              <div>
                <div className="text-gray-400 text-xs font-semibold mb-1 uppercase tracking-wider">Reputation</div>
                <div className="flex flex-col gap-1.5">
                  {[
                    { label: 'Trustworthy', value: reputation.trustworthiness, neutral: 50 },
                    { label: 'Generosity',  value: reputation.generosity,       neutral: 50 },
                    { label: 'Skill renown',value: reputation.skill_renown,     neutral: 10 },
                    { label: 'Danger',      value: reputation.danger_level,     neutral: 0  },
                  ].map(({ label, value, neutral }) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <span className="w-20 text-gray-400 truncate">{label}</span>
                      <div className="flex-1 bg-gray-700 rounded h-1.5">
                        <div
                          className={clsx('h-1.5 rounded', label === 'Danger' ? 'bg-red-500' : value >= neutral ? 'bg-blue-400' : 'bg-gray-500')}
                          style={{ width: `${Math.round(value)}%` }}
                        />
                      </div>
                      <span className="w-6 text-right text-gray-500 text-xs">{Math.round(value)}</span>
                    </div>
                  ))}
                  <div className="text-gray-600 text-xs mt-0.5">
                    {reputation.total_reports} reports · {reputation.positive_reports} positive · {reputation.negative_reports} negative
                  </div>
                </div>
              </div>
            )}

            {beliefs.length > 0 && (
              <div>
                <div className="text-gray-400 text-xs font-semibold mb-1 uppercase tracking-wider">Beliefs</div>
                <div className="flex flex-col gap-1">
                  {beliefs.map(b => (
                    <div key={b.belief_id} className="flex items-center gap-2 text-xs bg-gray-800/30 rounded px-2 py-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.colour }} />
                      <span className="text-gray-200">{b.name}</span>
                      <div className="ml-auto flex-1 max-w-16 bg-gray-700 rounded h-1">
                        <div className="h-1 rounded bg-purple-400" style={{ width: `${Math.round(b.conviction * 100)}%` }} />
                      </div>
                      <span className="text-gray-500 w-7 text-right">{Math.round(b.conviction * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {agent.recent_memories && agent.recent_memories.length > 0 && (
              <div>
                <div className="text-gray-400 text-xs font-semibold mb-1 uppercase tracking-wider">Recent Memories</div>
                <div className="flex flex-col gap-1">
                  {agent.recent_memories.slice(0, 5).map((m, i) => (
                    <div key={i} className={clsx(
                      'text-xs p-1.5 rounded border-l-2',
                      m.emotional_valence < -0.3 ? 'border-red-500 bg-red-950/20' :
                      m.emotional_valence > 0.3  ? 'border-green-500 bg-green-950/20' :
                      'border-gray-600 bg-gray-800/30'
                    )}>
                      {m.summary.slice(0, 100)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Relations tab ── */}
        {activeTab === 'relations' && (
          <div className="flex flex-col gap-2">
            {relationships.length === 0 && (
              <div className="text-gray-500 text-xs text-center mt-6">
                No relationships formed yet
              </div>
            )}
            {relationships.map(rel => (
              <div key={rel.other_agent_id} className="bg-gray-800/40 rounded p-2 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-gray-200 text-xs font-medium">{rel.other_name}</span>
                  <span className={clsx('text-xs capitalize', REL_COLORS[rel.relationship_type] ?? 'text-gray-400')}>
                    {rel.relationship_type.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-gray-500 text-xs">{rel.other_archetype}</div>
                {/* Score bars */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
                  {[
                    { label: 'Trust',     value: rel.trust_score     },
                    { label: 'Affection', value: rel.affection_score },
                    { label: 'Respect',   value: rel.respect_score   },
                    { label: 'Fear',      value: rel.fear_score      },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center gap-1 text-xs">
                      <span className="w-14 text-gray-500 truncate">{label}</span>
                      <div className="flex-1 bg-gray-700 rounded h-1">
                        <div
                          className={clsx('h-1 rounded', label === 'Fear' ? 'bg-red-500' : 'bg-blue-500')}
                          style={{ width: `${value}%` }}
                        />
                      </div>
                      <span className="w-5 text-right text-gray-500 text-xs">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Group tab ── */}
        {activeTab === 'group' && (
          <div className="flex flex-col gap-3">
            {!groupDetail ? (
              <div className="text-gray-500 text-xs text-center mt-6">
                {agent.group_id ? 'Loading group...' : 'Not a member of any group'}
              </div>
            ) : (
              <>
                {/* Group header */}
                <div className="rounded p-3 border" style={{ borderColor: groupDetail.colour + '60', backgroundColor: groupDetail.colour + '10' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: groupDetail.colour }} />
                    <span className="text-white font-semibold text-sm">{groupDetail.name}</span>
                    <span className="text-gray-400 text-xs ml-auto">{groupDetail.member_count} members</span>
                  </div>
                  {groupDetail.purpose && (
                    <div className="text-gray-400 text-xs italic">"{groupDetail.purpose}"</div>
                  )}
                  <div className="text-gray-600 text-xs mt-1">Founded Day {groupDetail.formed_day}</div>
                </div>

                {/* Member list */}
                <div>
                  <div className="text-gray-400 text-xs font-semibold mb-1 uppercase tracking-wider">Members</div>
                  <div className="flex flex-col gap-1">
                    {groupDetail.members.map(m => (
                      <div key={m.agent_id} className="flex items-center justify-between bg-gray-800/40 rounded px-2 py-1.5">
                        <div className="flex flex-col">
                          <span className="text-gray-200 text-xs">{m.name}</span>
                          <span className="text-gray-500 text-xs capitalize">{m.role}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span className="text-gray-500">{m.mental_state}</span>
                          <span className={clsx(
                            'font-mono',
                            m.hp > 60 ? 'text-green-400' : m.hp > 30 ? 'text-yellow-400' : 'text-red-400'
                          )}>{Math.round(m.hp)}hp</span>
                          <span className={clsx(
                            m.contribution_score > 0 ? 'text-blue-400' : 'text-red-400'
                          )}>{m.contribution_score > 0 ? '+' : ''}{Math.round(m.contribution_score)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── History tab — grouped by partner ── */}
        {activeTab === 'history' && (
          <div className="flex flex-col gap-1.5">
            {conversations.length === 0 && (
              <div className="text-gray-500 text-xs text-center mt-6">
                No conversations yet
              </div>
            )}
            {(() => {
              // Group conversations by partner
              const grouped = new Map<string, { name: string; convs: ConversationRow[] }>();
              for (const conv of conversations) {
                const isInitiator = conv.initiator_agent_id === selectedAgentId;
                const partnerId = isInitiator ? conv.target_agent_id : conv.initiator_agent_id;
                const partnerName = isInitiator ? conv.target_name : conv.initiator_name;
                if (!grouped.has(partnerId)) {
                  grouped.set(partnerId, { name: partnerName, convs: [] });
                }
                grouped.get(partnerId)!.convs.push(conv);
              }
              return Array.from(grouped.entries()).map(([partnerId, { name, convs }]) => (
                <PartnerThread
                  key={partnerId}
                  partnerName={name}
                  conversations={convs}
                  onOpenConv={setOpenConvId}
                />
              ));
            })()}
          </div>
        )}

        {/* ── Family tab ── */}
        {activeTab === 'family' && (
          <FamilyTree
            agentId={selectedAgentId!}
            onSelectAgent={(id) => {
              useGenesisStore.getState().setSelectedAgent(id);
            }}
          />
        )}
      </div>

      {/* Conversation detail modal */}
      {openConvId && (
        <ConversationModal
          conversationId={openConvId}
          onClose={() => setOpenConvId(null)}
        />
      )}
    </div>
  );
}
