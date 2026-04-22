'use client';
import { useGenesisStore } from '../lib/store.js';

export function StatsBar({ onCreateAgent, onSettings, username, onLogout }: {
  onCreateAgent?: () => void;
  onSettings?: () => void;
  username?: string;
  onLogout?: () => void;
}) {
  const { stats, agents } = useGenesisStore();
  const aliveCount = agents.size;

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-700/40 text-xs bg-[#0c1020]/80 backdrop-blur-sm shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold">G</div>
        <span className="text-blue-400 font-bold text-sm tracking-wide">PROJECT GENESIS</span>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-gray-700/50" />

      {stats ? (
        <div className="flex items-center gap-4">
          <Stat label="Day" value={stats.day.toString()} />
          <Stat label="Tick" value={stats.tick.toString()} />
          <StatPill label={stats.time_of_day} />
          <Stat label="Pop" value={aliveCount.toString()} accent />
        </div>
      ) : (
        <span className="text-gray-500 animate-pulse">Connecting...</span>
      )}

      {/* Right side: legend + create button */}
      <div className="ml-auto flex items-center gap-4">
        <div className="hidden md:flex gap-3 text-gray-500">
          <LegendDot color="#22c55e" label="alert" />
          <LegendDot color="#3b82f6" label="content" />
          <LegendDot color="#eab308" label="tired" />
          <LegendDot color="#fb923c" label="anxious" />
          <LegendDot color="#f97316" label="stressed" />
          <LegendDot color="#ef4444" label="desperate" />
          <LegendDot color="#a78bfa" label="lonely" />
        </div>

        {onCreateAgent && (
          <>
            <div className="w-px h-4 bg-gray-700/50" />
            <button
              onClick={onCreateAgent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 hover:text-blue-300 transition-all text-xs font-medium border border-blue-500/20"
            >
              <span>+</span>
              <span>Create Agent</span>
            </button>
          </>
        )}
        {username && (
          <>
            <div className="w-px h-4 bg-gray-700/50" />
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-xs">{username}</span>
              {onLogout && (
                <button
                  onClick={onLogout}
                  title="Log out"
                  className="px-2 py-1 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors text-xs"
                >
                  Log out
                </button>
              )}
            </div>
          </>
        )}
        {onSettings && (
          <>
            <div className="w-px h-4 bg-gray-700/50" />
            <button
              onClick={onSettings}
              title="Simulation settings"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-gray-800/60 text-gray-400 hover:bg-gray-700/60 hover:text-gray-200 transition-all text-xs border border-gray-700/30"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex gap-1 items-baseline">
      <span className="text-gray-500">{label}</span>
      <span className={accent ? 'text-blue-400 font-semibold' : 'text-gray-200 font-medium'}>{value}</span>
    </div>
  );
}

function StatPill({ label }: { label: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded bg-gray-800/60 text-gray-300 text-xs capitalize">
      {label}
    </span>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs">{label}</span>
    </div>
  );
}
