'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useGenesisStore } from '../lib/store.js';

interface War {
  war_id: string;
  aggressor_name: string;
  aggressor_colour: string;
  defender_name: string;
  defender_colour: string;
  status: 'active' | 'ceasefire' | 'ended';
  declared_day: number;
  ended_day?: number;
  outcome?: string;
  casualties_aggressor: number;
  casualties_defender: number;
  resources_looted: Record<string, number>;
}

interface Treaty {
  treaty_id: string;
  group_a_name: string;
  group_a_colour: string;
  group_b_name: string;
  group_b_colour: string;
  treaty_type: string;
  ratified_tick: number;
}

interface Skirmish {
  skirmish_id: string;
  attacker_name: string;
  defender_name: string;
  attacker_group_name?: string;
  defender_group_name?: string;
  outcome: string;
  hp_damage_attacker: number;
  hp_damage_defender: number;
  tick: number;
  day: number;
  location_x: number;
  location_y: number;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const WAR_STATUS_COLOR: Record<string, string> = {
  active: 'text-red-400',
  ceasefire: 'text-yellow-400',
  ended: 'text-gray-500',
};

const TREATY_TYPE_LABEL: Record<string, string> = {
  non_aggression: 'Non-Aggression',
  resource_sharing: 'Resource Sharing',
  alliance: 'Alliance',
  vassalage: 'Vassalage',
};

function GroupTag({ name, colour }: { name: string; colour: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colour }} />
      <span className="text-gray-200">{name}</span>
    </span>
  );
}

export function WarPanel() {
  const { worldId } = useGenesisStore();
  const [wars, setWars] = useState<War[]>([]);
  const [treaties, setTreaties] = useState<Treaty[]>([]);
  const [recentSkirmishes, setRecentSkirmishes] = useState<Skirmish[]>([]);
  const [tab, setTab] = useState<'wars' | 'treaties' | 'skirmishes'>('wars');

  useEffect(() => {
    if (!worldId) return;
    const load = async () => {
      try {
        const [warsRes, treatiesRes, skirmishRes] = await Promise.all([
          fetch(`${API}/worlds/${worldId}/wars`),
          fetch(`${API}/worlds/${worldId}/treaties`),
          fetch(`${API}/worlds/${worldId}/skirmishes?limit=15`),
        ]);
        if (warsRes.ok)     setWars(await warsRes.json());
        if (treatiesRes.ok) setTreaties(await treatiesRes.json());
        if (skirmishRes.ok) setRecentSkirmishes(await skirmishRes.json());
      } catch { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [worldId]);

  const activeWars = wars.filter(w => w.status === 'active');

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Header */}
      <div className="px-4 pt-3 pb-1 shrink-0 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <span className="text-gray-300 font-semibold text-xs uppercase tracking-wider">Conflict</span>
          {activeWars.length > 0 && (
            <span className="text-red-400 text-xs animate-pulse">{activeWars.length} active war{activeWars.length > 1 ? 's' : ''}</span>
          )}
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-2">
          {(['wars', 'treaties', 'skirmishes'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'flex-1 rounded py-0.5 text-xs capitalize transition-colors',
                tab === t ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {t}
              {t === 'wars' && wars.length > 0 && (
                <span className="ml-1 text-gray-600">({wars.length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">

        {/* Wars */}
        {tab === 'wars' && (
          <div className="flex flex-col gap-2">
            {wars.length === 0 && (
              <div className="text-gray-500 text-xs text-center py-6">No wars recorded</div>
            )}
            {wars.map(w => (
              <div key={w.war_id} className="bg-gray-800/40 rounded p-2.5 border border-gray-700/30">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <GroupTag name={w.aggressor_name} colour={w.aggressor_colour} />
                    <span className="text-red-500 text-xs">⚔</span>
                    <GroupTag name={w.defender_name} colour={w.defender_colour} />
                  </div>
                  <span className={clsx('text-xs capitalize', WAR_STATUS_COLOR[w.status])}>{w.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
                  <span>Day {w.declared_day}</span>
                  {w.ended_day && <span>→ Day {w.ended_day}</span>}
                  {w.outcome && (
                    <span className="col-span-2 text-gray-400 capitalize">{w.outcome.replace(/_/g, ' ')}</span>
                  )}
                  <span>⚔ {w.casualties_aggressor + w.casualties_defender} casualties</span>
                  {Object.keys(w.resources_looted).length > 0 && (
                    <span>
                      Looted: {Object.entries(w.resources_looted).map(([k, v]) => `${v} ${k}`).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Treaties */}
        {tab === 'treaties' && (
          <div className="flex flex-col gap-2">
            {treaties.length === 0 && (
              <div className="text-gray-500 text-xs text-center py-6">No active treaties</div>
            )}
            {treaties.map(t => (
              <div key={t.treaty_id} className="bg-gray-800/40 rounded p-2.5 border border-gray-700/30">
                <div className="flex items-center gap-1.5 mb-1">
                  <GroupTag name={t.group_a_name} colour={t.group_a_colour} />
                  <span className="text-teal-500 text-xs">↔</span>
                  <GroupTag name={t.group_b_name} colour={t.group_b_colour} />
                </div>
                <div className="text-xs text-blue-300">{TREATY_TYPE_LABEL[t.treaty_type] ?? t.treaty_type}</div>
              </div>
            ))}
          </div>
        )}

        {/* Skirmishes */}
        {tab === 'skirmishes' && (
          <div className="flex flex-col gap-1.5">
            {recentSkirmishes.length === 0 && (
              <div className="text-gray-500 text-xs text-center py-6">No skirmishes recorded</div>
            )}
            {recentSkirmishes.map(s => (
              <div key={s.skirmish_id} className="bg-gray-800/30 rounded px-2 py-1.5 border border-gray-700/20">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">
                    {s.attacker_name}
                    {s.attacker_group_name && <span className="text-gray-500"> ({s.attacker_group_name})</span>}
                  </span>
                  <span className={clsx(
                    'text-xs',
                    s.outcome === 'attacker_won' ? 'text-orange-400' :
                    s.outcome === 'defender_won' ? 'text-blue-400' : 'text-gray-500'
                  )}>
                    {s.outcome.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="text-gray-500 text-xs mt-0.5">
                  vs {s.defender_name}
                  {s.defender_group_name && <span> ({s.defender_group_name})</span>}
                  &nbsp;· Day {s.day} · ({s.location_x},{s.location_y})
                </div>
                <div className="text-xs text-gray-600 mt-0.5">
                  -{Math.round(s.hp_damage_attacker)}hp / -{Math.round(s.hp_damage_defender)}hp
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
