'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { WarPanel } from './WarPanel.js';
import { BeliefPanel } from './BeliefPanel.js';
import { ChroniclePanel } from './ChroniclePanel.js';
import { LawPanel } from './LawPanel.js';

type CivTab = 'wars' | 'beliefs' | 'laws' | 'chronicle';

const TAB_ICONS: Record<CivTab, string> = {
  wars:      '⚔',
  beliefs:   '✦',
  laws:      '⚖',
  chronicle: '📜',
};

export function CivilisationPanel() {
  const [tab, setTab] = useState<CivTab>('wars');

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-gray-700/50 shrink-0">
        {(Object.keys(TAB_ICONS) as CivTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            title={t.charAt(0).toUpperCase() + t.slice(1)}
            className={clsx(
              'flex-1 py-2 text-sm transition-colors',
              tab === t
                ? 'text-white border-b-2 border-blue-400 -mb-px'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {TAB_ICONS[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'wars'      && <WarPanel />}
        {tab === 'beliefs'   && <BeliefPanel />}
        {tab === 'laws'      && <LawPanel />}
        {tab === 'chronicle' && <ChroniclePanel />}
      </div>
    </div>
  );
}
