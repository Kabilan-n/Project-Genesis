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

interface ConversationDetail {
  conversation_id: string;
  tick: number;
  day: number;
  topic: string;
  outcome: string;
  initiator_name: string;
  target_name: string;
  turns: ConversationTurn[];
}

const OUTCOME_STYLES: Record<string, string> = {
  bonding:        'text-green-400 bg-green-900/30 border-green-700',
  friendly:       'text-blue-400 bg-blue-900/30 border-blue-700',
  neutral:        'text-gray-400 bg-gray-800/30 border-gray-600',
  reconciliation: 'text-teal-400 bg-teal-900/30 border-teal-700',
  conflict:       'text-orange-400 bg-orange-900/30 border-orange-700',
  hostile:        'text-red-400 bg-red-900/30 border-red-700',
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ConversationModal({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [showThoughts, setShowThoughts] = useState(false);

  useEffect(() => {
    fetch(`${API}/conversations/${conversationId}`)
      .then(r => r.json())
      .then(setConv)
      .catch(() => {});
  }, [conversationId]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div>
            <span className="text-white font-semibold text-sm">Conversation</span>
            {conv && (
              <span className="text-gray-400 text-xs ml-2">
                Day {conv.day} · {conv.initiator_name} &amp; {conv.target_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {conv && (
              <span className={clsx(
                'text-xs px-2 py-0.5 rounded border capitalize',
                OUTCOME_STYLES[conv.outcome] ?? OUTCOME_STYLES.neutral
              )}>
                {conv.outcome}
              </span>
            )}
            <button
              className="text-xs text-gray-500 hover:text-gray-300"
              onClick={() => setShowThoughts(v => !v)}
            >
              {showThoughts ? 'hide thoughts' : 'show thoughts'}
            </button>
            <button
              className="text-gray-400 hover:text-white text-lg leading-none"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {!conv && (
            <div className="text-gray-500 text-sm text-center mt-8">Loading...</div>
          )}
          {conv?.turns.map((turn, i) => {
            const isInitiator = turn.speaker_id === undefined || i % 2 === 0;
            return (
              <div key={i} className={clsx('flex flex-col gap-1', isInitiator ? 'items-start' : 'items-end')}>
                <span className="text-xs text-gray-500">{turn.speaker_name}</span>
                <div className={clsx(
                  'max-w-[85%] px-3 py-2 rounded-lg text-sm',
                  isInitiator
                    ? 'bg-gray-700 text-gray-100 rounded-tl-none'
                    : 'bg-blue-900/50 text-blue-100 rounded-tr-none'
                )}>
                  "{turn.message}"
                </div>
                {showThoughts && turn.thought && (
                  <div className="text-xs text-gray-500 italic max-w-[85%] px-2">
                    *(thinks: {turn.thought})*
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {conv?.topic && (
          <div className="px-4 py-2 border-t border-gray-700/50 text-xs text-gray-500 truncate">
            Topic: {conv.topic}
          </div>
        )}
      </div>
    </div>
  );
}
