'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

interface Turn {
  speaker_id: string;
  speaker_name: string;
  message: string;
  thought: string;
  turn_number: number;
  // added when merging conversations
  day: number;
  tick: number;
  outcome: string;
  conversation_id: string;
}

interface ConvSummary {
  conversation_id: string;
  tick: number;
  day: number;
  outcome: string;
  initiator_agent_id: string;
  target_agent_id: string;
  initiator_name: string;
  target_name: string;
  turns: Array<{
    turn_number: number;
    speaker_id: string;
    speaker_name: string;
    message: string;
    thought: string;
  }>;
}

const OUTCOME_COLOR: Record<string, string> = {
  bonding:        'text-green-400 border-green-700/50 bg-green-900/20',
  friendly:       'text-blue-400 border-blue-700/50 bg-blue-900/20',
  neutral:        'text-gray-400 border-gray-600/50 bg-gray-800/20',
  reconciliation: 'text-teal-400 border-teal-700/50 bg-teal-900/20',
  conflict:       'text-orange-400 border-orange-700/50 bg-orange-900/20',
  hostile:        'text-red-400 border-red-700/50 bg-red-900/20',
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ChatThreadModal({
  agentId,
  agentName,
  partnerId,
  partnerName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  partnerId: string;
  partnerName: string;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [showThoughts, setShowThoughts] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Server returns only conversations between these two agents,
        // already sorted oldest-first, with full turns JSONB included.
        const res = await fetch(`${API}/agents/${agentId}/conversations/with/${partnerId}?limit=200`);
        if (!res.ok) return;
        const convs: ConvSummary[] = await res.json();

        // Flatten all turns, tag with conversation metadata
        const flat: Turn[] = [];
        for (const conv of convs) {
          for (const t of (conv.turns ?? [])) {
            flat.push({
              ...t,
              day: conv.day,
              tick: conv.tick,
              outcome: conv.outcome,
              conversation_id: conv.conversation_id,
            });
          }
        }

        setTurns(flat);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };
    load();
  }, [agentId, partnerId]);

  // Scroll to bottom when turns load
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // Group turns so we can insert day separators
  type Message = Turn & { _type: 'message' } | { _type: 'separator'; day: number; outcome: string; conversation_id: string };
  const messages: Message[] = [];
  let lastConvId = '';
  for (const t of turns) {
    if (t.conversation_id !== lastConvId) {
      messages.push({ _type: 'separator', day: t.day, outcome: t.outcome, conversation_id: t.conversation_id });
      lastConvId = t.conversation_id;
    }
    messages.push({ ...t, _type: 'message' });
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-[#0c1020] border border-gray-700/50 rounded-xl w-full max-w-lg h-[80vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/40 bg-[#0a0e1a]/80 shrink-0">
          <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-xs font-bold text-blue-400">
            {partnerName[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">{partnerName}</div>
            <div className="text-xs text-gray-500">{turns.length} messages · {new Set(turns.map(t => t.conversation_id)).size} conversations</div>
          </div>
          <button
            onClick={() => setShowThoughts(v => !v)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showThoughts ? 'hide thoughts' : 'show thoughts'}
          </button>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none ml-1">×</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1">
          {loading && (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading...</div>
          )}

          {!loading && turns.length === 0 && (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              No conversations with {partnerName} yet
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg._type === 'separator') {
              const cls = OUTCOME_COLOR[msg.outcome] ?? OUTCOME_COLOR.neutral;
              return (
                <div key={`sep-${msg.conversation_id}`} className="flex items-center gap-2 my-3">
                  <div className="flex-1 h-px bg-gray-700/40" />
                  <span className={clsx('text-[10px] px-2 py-0.5 rounded border capitalize', cls)}>
                    Day {msg.day} · {msg.outcome}
                  </span>
                  <div className="flex-1 h-px bg-gray-700/40" />
                </div>
              );
            }

            const isMine = msg.speaker_id === agentId;

            return (
              <div
                key={`${msg.conversation_id}-${msg.turn_number}`}
                className={clsx('flex flex-col max-w-[80%]', isMine ? 'self-end items-end' : 'self-start items-start')}
              >
                <div className={clsx(
                  'px-3 py-2 rounded-2xl text-xs leading-relaxed',
                  isMine
                    ? 'bg-blue-600/80 text-white rounded-br-sm'
                    : 'bg-gray-700/60 text-gray-200 rounded-bl-sm'
                )}>
                  {msg.message}
                </div>

                {showThoughts && msg.thought && (
                  <div className={clsx(
                    'text-[10px] text-gray-500 italic mt-0.5 px-1 max-w-full',
                    isMine ? 'text-right' : 'text-left'
                  )}>
                    💭 {msg.thought}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
