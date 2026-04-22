'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useGenesisStore } from '../lib/store.js';

interface BeliefSystem {
  belief_id: string;
  name: string;
  core_tenet: string;
  adherent_count: number;
  colour: string;
  founder_name?: string;
  founded_day: number;
  is_extinct: boolean;
  prescribes_aggression: boolean;
  prescribes_sharing: boolean;
  prescribes_isolation: boolean;
  prescribes_ritual: boolean;
}

interface Myth {
  myth_id: string;
  title: string;
  narrative: string;
  author_name: string;
  spread_count: number;
  believability: number;
  belief_name?: string;
  belief_colour?: string;
  created_day: number;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function BeliefTag({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={clsx(
      'text-xs px-1.5 py-0.5 rounded',
      active ? 'bg-purple-900/60 text-purple-300' : 'bg-gray-800/40 text-gray-600'
    )}>
      {label}
    </span>
  );
}

function ProgressBar({ value, max, colour }: { value: number; max: number; colour: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex-1 bg-gray-700/50 rounded h-1.5">
      <div className="h-1.5 rounded transition-all" style={{ width: `${pct}%`, backgroundColor: colour }} />
    </div>
  );
}

export function BeliefPanel() {
  const { worldId } = useGenesisStore();
  const [beliefs, setBeliefs] = useState<BeliefSystem[]>([]);
  const [myths, setMyths] = useState<Myth[]>([]);
  const [tab, setTab] = useState<'beliefs' | 'myths'>('beliefs');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!worldId) return;
    const load = async () => {
      try {
        const [belRes, mythRes] = await Promise.all([
          fetch(`${API}/worlds/${worldId}/beliefs`),
          fetch(`${API}/worlds/${worldId}/myths`),
        ]);
        if (belRes.ok)  setBeliefs(await belRes.json());
        if (mythRes.ok) setMyths(await mythRes.json());
      } catch { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 20_000);
    return () => clearInterval(interval);
  }, [worldId]);

  const maxAdherents = Math.max(...beliefs.map(b => b.adherent_count), 1);

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Header */}
      <div className="px-4 pt-3 pb-1 shrink-0 border-b border-gray-700/50">
        <div className="text-gray-300 font-semibold text-xs uppercase tracking-wider mb-2">Belief Systems</div>
        <div className="flex gap-1">
          {(['beliefs', 'myths'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'flex-1 rounded py-0.5 text-xs capitalize transition-colors',
                tab === t ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {t}
              {t === 'beliefs' && beliefs.length > 0 && (
                <span className="ml-1 text-gray-600">({beliefs.length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">

        {/* Beliefs tab */}
        {tab === 'beliefs' && (
          <div className="flex flex-col gap-2">
            {beliefs.length === 0 && (
              <div className="text-gray-500 text-xs text-center py-6">No belief systems yet</div>
            )}
            {beliefs.map(b => (
              <div key={b.belief_id} className={clsx(
                'rounded p-2.5 border transition-colors',
                b.is_extinct ? 'border-gray-700/20 bg-gray-900/30 opacity-60' : 'border-gray-700/40 bg-gray-800/40'
              )}>
                {/* Title row */}
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedId(expandedId === b.belief_id ? null : b.belief_id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.colour }} />
                    <span className="text-gray-200 text-xs font-medium">{b.name}</span>
                    {b.is_extinct && <span className="text-gray-500 text-xs">(extinct)</span>}
                    <span className="ml-auto text-gray-500 text-xs">{b.adherent_count} believers</span>
                  </div>
                  {/* Adherent bar */}
                  <div className="flex items-center gap-2 mt-1">
                    <ProgressBar value={b.adherent_count} max={maxAdherents} colour={b.colour} />
                  </div>
                </button>

                {/* Expanded details */}
                {expandedId === b.belief_id && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <div className="text-gray-400 text-xs italic">"{b.core_tenet}"</div>
                    <div className="text-gray-600 text-xs">
                      Founded Day {b.founded_day}
                      {b.founder_name && <> by {b.founder_name}</>}
                    </div>
                    <div className="flex gap-1 flex-wrap mt-0.5">
                      <BeliefTag label="Aggression" active={b.prescribes_aggression} />
                      <BeliefTag label="Sharing"    active={b.prescribes_sharing} />
                      <BeliefTag label="Isolation"  active={b.prescribes_isolation} />
                      <BeliefTag label="Ritual"     active={b.prescribes_ritual} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Myths tab */}
        {tab === 'myths' && (
          <div className="flex flex-col gap-2">
            {myths.length === 0 && (
              <div className="text-gray-500 text-xs text-center py-6">No myths recorded yet</div>
            )}
            {myths.map(m => (
              <div key={m.myth_id} className="bg-gray-800/40 rounded p-2.5 border border-gray-700/30">
                {/* Header */}
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedId(expandedId === m.myth_id ? null : m.myth_id)}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-gray-200 text-xs font-medium">{m.title}</span>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      {m.belief_colour && (
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.belief_colour }} />
                      )}
                      <span>{m.spread_count}✗</span>
                    </div>
                  </div>
                  <div className="text-gray-500 text-xs">
                    by {m.author_name} · Day {m.created_day}
                    {m.belief_name && <> · {m.belief_name}</>}
                  </div>
                </button>

                {expandedId === m.myth_id && (
                  <div className="mt-2">
                    <div className="text-gray-400 text-xs leading-relaxed">{m.narrative}</div>
                    <div className="text-gray-600 text-xs mt-1">
                      Believability: {Math.round(m.believability * 100)}%
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
