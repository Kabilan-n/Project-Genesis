'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useGenesisStore } from '../lib/store.js';

interface Law {
  law_id: string;
  name: string;
  description: string;
  law_type: string;
  penalty_type: string;
  penalty_value: number;
  status: 'proposed' | 'active' | 'repealed';
  votes_for: number;
  votes_against: number;
  proposed_by_name?: string;
  proposed_tick: number;
  enacted_tick?: number;
  group_name?: string;
  group_colour?: string;
}

interface Violation {
  violation_id: string;
  law_name: string;
  law_type: string;
  violator_name: string;
  reporter_name?: string;
  penalty_applied: string;
  tick: number;
  day: number;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const LAW_TYPE_COLOR: Record<string, string> = {
  resource:   'text-yellow-400',
  behavior:   'text-blue-400',
  territory:  'text-green-400',
  trade:      'text-teal-400',
  belief:     'text-purple-400',
};

export function LawPanel() {
  const { worldId } = useGenesisStore();
  const [laws, setLaws] = useState<Law[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [tab, setTab] = useState<'laws' | 'violations'>('laws');

  useEffect(() => {
    if (!worldId) return;
    const load = async () => {
      try {
        const [lawRes, violRes] = await Promise.all([
          fetch(`${API}/worlds/${worldId}/laws`),
          fetch(`${API}/worlds/${worldId}/violations?limit=15`),
        ]);
        if (lawRes.ok)  setLaws(await lawRes.json());
        if (violRes.ok) setViolations(await violRes.json());
      } catch { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 20_000);
    return () => clearInterval(interval);
  }, [worldId]);

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="px-4 pt-3 pb-1 shrink-0 border-b border-gray-700/50">
        <div className="text-gray-300 font-semibold text-xs uppercase tracking-wider mb-2">Laws & Governance</div>
        <div className="flex gap-1">
          {(['laws', 'violations'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'flex-1 rounded py-0.5 text-xs capitalize transition-colors',
                tab === t ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {t}
              {t === 'violations' && violations.length > 0 && (
                <span className="ml-1 text-red-500">({violations.length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {tab === 'laws' && (
          <div className="flex flex-col gap-2">
            {laws.length === 0 && (
              <div className="text-gray-500 text-xs text-center py-6">No laws enacted yet</div>
            )}
            {laws.map(l => (
              <div key={l.law_id} className="bg-gray-800/40 rounded p-2.5 border border-gray-700/30">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-gray-200 text-xs font-medium">{l.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {l.group_colour && (
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: l.group_colour }} />
                    )}
                    <span className={clsx('text-xs capitalize', LAW_TYPE_COLOR[l.law_type] ?? 'text-gray-400')}>
                      {l.law_type}
                    </span>
                  </div>
                </div>
                <div className="text-gray-500 text-xs leading-relaxed">{l.description}</div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-600">
                  <span>⚖ {l.penalty_type.replace('_', ' ')}: {Math.round(l.penalty_value)}</span>
                  <span className="text-green-500">▲{l.votes_for}</span>
                  <span className="text-red-500">▼{l.votes_against}</span>
                  {l.proposed_by_name && <span>by {l.proposed_by_name}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'violations' && (
          <div className="flex flex-col gap-1.5">
            {violations.length === 0 && (
              <div className="text-gray-500 text-xs text-center py-6">No violations reported</div>
            )}
            {violations.map(v => (
              <div key={v.violation_id} className="bg-gray-800/30 rounded px-2 py-1.5 border border-gray-700/20">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-300 font-medium">{v.violator_name}</span>
                  <span className={clsx('text-xs capitalize', LAW_TYPE_COLOR[v.law_type] ?? 'text-gray-400')}>
                    {v.law_type}
                  </span>
                </div>
                <div className="text-gray-500 text-xs mt-0.5">
                  Broke: {v.law_name} · Day {v.day}
                </div>
                <div className="text-xs text-orange-400/80 mt-0.5">
                  Penalty: {v.penalty_applied.replace('_', ' ')}
                  {v.reporter_name && <span className="text-gray-600"> · reported by {v.reporter_name}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
