'use client';
import { useState } from 'react';
import { useGenesisStore } from '../lib/store.js';
import { ConversationModal } from './ConversationModal.js';
import clsx from 'clsx';

const SIGNIFICANCE_STYLES: Record<string, string> = {
  trivial:  'border-gray-600 text-gray-400',
  minor:    'border-blue-600 text-blue-300',
  moderate: 'border-yellow-600 text-yellow-300',
  major:    'border-orange-500 text-orange-300',
  historic: 'border-red-500 text-red-300',
};

const EVENT_ICONS: Record<string, string> = {
  birth:          '★',
  death:          '†',
  conversation:   '◉',
  speech:         '◎',
  trade:          '⇌',
  conflict:       '⚔',
  skirmish:       '⚔',
  war_declared:   '⚔',
  war_ended:      '⚑',
  discovery:      '◈',
  group_formed:   '◎',
  group_joined:   '◎',
  group_left:     '◎',
  gossip:         '◈',
  belief_founded: '✦',
  myth_created:   '✧',
  chronicle:      '📜',
  law_enacted:    '⚖',
  default:        '·',
};

export function EventFeed() {
  const { events } = useGenesisStore();
  const [openConvId, setOpenConvId] = useState<string | null>(null);

  const handleEventClick = (event: (typeof events)[number]) => {
    // If the event has a conversation_id in consequences, open modal
    const convId = (event as any).consequences?.conversation_id;
    if (event.event_type === 'conversation' && convId) {
      setOpenConvId(convId);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700/50">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Event Feed</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-1">
        {events.length === 0 && (
          <div className="text-center text-gray-600 text-xs mt-8">
            Waiting for events...
          </div>
        )}
        {events.map((event, i) => {
          const convId = (event as any).consequences?.conversation_id;
          const isClickable = event.event_type === 'conversation' && convId;
          return (
            <div
              key={event.event_id ?? i}
              onClick={() => handleEventClick(event)}
              className={clsx(
                'border-l-2 pl-2 py-1 rounded-r text-xs',
                SIGNIFICANCE_STYLES[event.significance] ?? SIGNIFICANCE_STYLES.minor,
                isClickable && 'cursor-pointer hover:bg-white/5 transition-colors'
              )}
            >
              <div className="flex items-start gap-1">
                <span className="shrink-0 mt-px">
                  {EVENT_ICONS[event.event_type] ?? EVENT_ICONS.default}
                </span>
                <div className="min-w-0">
                  <div className="font-medium leading-tight flex items-center gap-1">
                    {event.title}
                    {isClickable && (
                      <span className="text-gray-600 text-xs">↗</span>
                    )}
                  </div>
                  {event.summary && (
                    <div className="text-gray-500 mt-0.5 leading-tight truncate">{event.summary}</div>
                  )}
                  <div className="text-gray-600 mt-0.5">Day {event.day}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {openConvId && (
        <ConversationModal
          conversationId={openConvId}
          onClose={() => setOpenConvId(null)}
        />
      )}
    </div>
  );
}
