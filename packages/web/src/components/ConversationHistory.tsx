'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

interface ConversationTurn {
  turn_number: number;
  speaker_id: string;
  speaker_name: string;
  message: string;
  thought: string;
}

interface ConversationSummary {
  conversation_id: string;
  tick: number;
  day: number;
  initiator_name: string;
  target_name: string;
  outcome: string;
  turns_count: number;
}

interface ConversationDetail extends ConversationSummary {
  turns: ConversationTurn[];
}

const OUTCOME_COLORS: Record<string, string> = {
  bonding:        'text-green-400',
  friendly:       'text-blue-400',
  neutral:        'text-gray-400',
  reconciliation: 'text-teal-400',
  conflict:       'text-orange-400',
  hostile:        'text-red-400',
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ConversationHistory({
  agentId,
  otherAgentId,
  otherAgentName,
}: {
  agentId: string;
  otherAgentId: string;
  otherAgentName: string;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConv, setSelectedConv] = useState<ConversationDetail | null>(null);
  const [showThoughts, setShowThoughts] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/agents/${agentId}/conversations`)
      .then(r => r.json())
      .then((all: ConversationSummary[]) => {
        const filtered = all.filter(c =>
          (c.initiator_name === otherAgentName && c.target_name) ||
          (c.target_name === otherAgentName)
        );
        setConversations(filtered.sort((a, b) => b.tick - a.tick));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId, otherAgentId, otherAgentName]);

  const handleSelectConversation = (convId: string) => {
    fetch(`${API}/conversations/${convId}`)
      .then(r => r.json())
      .then(setSelectedConv)
      .catch(() => {});
  };

  return (
    <div className="flex gap-3 h-full bg-[#0a0e1a]">
      {/* List */}
      <div className="w-48 border-r border-gray-700/30 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700/30">
          <div className="text-xs font-semibold text-gray-300">Conversations with</div>
          <div className="text-xs text-blue-400 truncate">{otherAgentName}</div>
          <div className="text-xs text-gray-500 mt-1">{conversations.length} total</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-gray-500 text-center py-4">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="text-xs text-gray-600 text-center py-4">No conversations yet</div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.conversation_id}
                onClick={() => handleSelectConversation(conv.conversation_id)}
                className={clsx(
                  'w-full text-left px-3 py-2 border-b border-gray-800 text-xs transition-colors',
                  selectedConv?.conversation_id === conv.conversation_id
                    ? 'bg-blue-900/30 border-blue-700'
                    : 'hover:bg-gray-800/50'
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-gray-300 truncate">Day {conv.day}</span>
                  <span className={clsx('text-[10px] font-semibold', OUTCOME_COLORS[conv.outcome] ?? 'text-gray-400')}>
                    {conv.outcome.slice(0, 3).toUpperCase()}
                  </span>
                </div>
                <div className="text-gray-500 text-[10px] mt-0.5">
                  {conv.turns_count} turn{conv.turns_count !== 1 ? 's' : ''}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedConv ? (
          <>
            <div className="px-4 py-3 border-b border-gray-700/30 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">
                  {selectedConv.initiator_name} &amp; {selectedConv.target_name}
                </div>
                <div className="text-xs text-gray-500">Day {selectedConv.day} · Tick {selectedConv.tick}</div>
              </div>
              <button
                onClick={() => setShowThoughts(v => !v)}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                {showThoughts ? 'hide thoughts' : 'show thoughts'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {selectedConv.turns.map((turn, i) => (
                <div key={i} className="text-xs">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-semibold text-blue-400">{turn.speaker_name}</span>
                    <span className="text-gray-600 text-[10px]">turn {turn.turn_number}</span>
                  </div>
                  <div className="text-gray-300 leading-relaxed mb-2">{turn.message}</div>
                  {showThoughts && turn.thought && (
                    <div className="text-gray-600 italic text-[10px] pl-2 border-l border-gray-700">
                      💭 {turn.thought}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select a conversation to view details
          </div>
        )}
      </div>
    </div>
  );
}
