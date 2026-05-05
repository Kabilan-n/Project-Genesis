'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { useGenesisStore } from '../lib/store.js';
import { useAsyncData } from '../lib/useAsyncData';
import { LoadingSpinner, InlineError, EmptyState } from './AsyncStates';

interface Chronicle {
  chronicle_id: string;
  era_name: string;
  era_start_day: number;
  era_end_day: number;
  summary: string;
  key_events: string[];
  key_agents: Array<{ name: string; archetype: string }>;
  key_groups: Array<{ name: string; colour: string }>;
  population_at_end: number;
  wars_fought: number;
  trades_completed: number;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ChroniclePanel() {
  const { worldId } = useGenesisStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: chronicles, loading, error, isEmpty, refetch } = useAsyncData<Chronicle[]>(
    async (signal) => {
      if (!worldId) return [];
      const res = await fetch(`${API}/worlds/${worldId}/chronicles`, { signal });
      if (!res.ok) throw new Error(`Failed to load chronicles (${res.status})`);
      return res.json();
    },
    [worldId],
    { isEmpty: (rows) => rows.length === 0 },
  );

  if (loading) return <LoadingSpinner label="Loading chronicles…" className="h-full" />;
  if (error)   return <InlineError error={error} onRetry={refetch} label="Couldn't load chronicles." />;
  if (isEmpty) return (
    <EmptyState label="No chronicles written yet — first era will be recorded after Day 7" />
  );
  if (!chronicles) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 shrink-0 border-b border-gray-700/50">
        <div className="text-gray-300 font-semibold text-xs uppercase tracking-wider">World Chronicles</div>
        <div className="text-gray-600 text-xs mt-0.5">{chronicles.length} era{chronicles.length !== 1 ? 's' : ''} recorded</div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {chronicles.map((c, i) => (
          <div
            key={c.chronicle_id}
            className="bg-gray-800/40 rounded border border-gray-700/30"
          >
            {/* Era header */}
            <button
              className="w-full text-left px-3 py-2.5"
              onClick={() => setExpandedId(expandedId === c.chronicle_id ? null : c.chronicle_id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 text-xs font-mono">Era {i + 1}</span>
                  <span className="text-gray-200 text-xs font-semibold">{c.era_name}</span>
                </div>
                <span className="text-gray-500 text-xs">
                  Day {c.era_start_day}–{c.era_end_day}
                </span>
              </div>

              {/* Stats row */}
              <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
                <span>{c.population_at_end} agents</span>
                {c.wars_fought > 0 && <span className="text-red-500/70">{c.wars_fought} wars</span>}
                {c.trades_completed > 0 && <span>{c.trades_completed} trades</span>}
              </div>

              {/* Key groups */}
              {c.key_groups?.length > 0 && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {c.key_groups.slice(0, 4).map((g, gi) => (
                    <span key={gi} className="inline-flex items-center gap-1 text-xs bg-gray-700/40 rounded px-1.5 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: g.colour }} />
                      <span className="text-gray-300">{g.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </button>

            {/* Expanded detail */}
            {expandedId === c.chronicle_id && (
              <div className="px-3 pb-3 border-t border-gray-700/30 pt-2 flex flex-col gap-2">
                <div className="text-gray-300 text-xs leading-relaxed">{c.summary}</div>

                {c.key_events?.length > 0 && (
                  <div>
                    <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">Key Events</div>
                    <ul className="flex flex-col gap-0.5">
                      {c.key_events.slice(0, 5).map((ev, ei) => (
                        <li key={ei} className="text-gray-400 text-xs before:content-['·'] before:mr-1 before:text-gray-600">
                          {ev}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {c.key_agents?.length > 0 && (
                  <div>
                    <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">Notable Agents</div>
                    <div className="flex gap-1 flex-wrap">
                      {c.key_agents.slice(0, 6).map((a, ai) => (
                        <span key={ai} className="text-xs bg-gray-700/50 rounded px-1.5 py-0.5 text-gray-300">
                          {a.name}
                          <span className="text-gray-500 ml-1 text-xs">{a.archetype}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
