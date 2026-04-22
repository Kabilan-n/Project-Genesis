'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface SimConfig {
  llm_provider: string;
  llm_model: string;
  optimize_prompts: boolean;
  tick_interval_ms: number;
  world_size: number;
  initial_agents: number;
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<SimConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/config`)
      .then(r => r.json())
      .then(data => setConfig(data))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-96 rounded-xl border border-gray-700/50 bg-[#0f1628] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/40">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Simulation Settings</h2>
            <p className="text-xs text-gray-500 mt-0.5">Read-only — edit .env and restart to change</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-500 text-sm">
              <div className="w-5 h-5 mr-2 rounded-full border-2 border-gray-600 border-t-blue-500 animate-spin" />
              Loading config…
            </div>
          )}

          {!loading && !config && (
            <p className="text-center text-sm text-red-400 py-4">
              Could not reach API server
            </p>
          )}

          {config && (
            <>
              {/* LLM section */}
              <Section title="Language Model">
                <Row label="Provider" value={config.llm_provider} />
                <Row label="Model" value={config.llm_model} mono />
                <Row
                  label="Optimised prompts"
                  value={config.optimize_prompts ? 'Enabled' : 'Disabled'}
                  badge={config.optimize_prompts ? 'green' : 'gray'}
                  hint={config.optimize_prompts
                    ? '~150–250 tokens/decision'
                    : '~600–800 tokens/decision'}
                />
              </Section>

              {/* Simulation section */}
              <Section title="Simulation">
                <Row label="Tick interval" value={`${config.tick_interval_ms / 1000}s`} />
                <Row label="World size" value={`${config.world_size} × ${config.world_size}`} />
                <Row label="Starting agents" value={config.initial_agents.toString()} />
              </Section>

              {/* Env var hint */}
              <div className="rounded-lg bg-blue-900/10 border border-blue-500/20 px-3 py-2.5">
                <p className="text-xs text-blue-300 font-medium mb-1">To enable optimised prompts:</p>
                <code className="text-xs text-blue-400/80 font-mono">OPTIMIZE_PROMPTS=true</code>
                <p className="text-xs text-gray-500 mt-1">Saves ~70% tokens per tick with minimal quality loss.</p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-700/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</p>
      <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 divide-y divide-gray-700/20">
        {children}
      </div>
    </div>
  );
}

function Row({
  label, value, mono, badge, hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: 'green' | 'gray';
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <div>
        <span className="text-xs text-gray-400">{label}</span>
        {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
      </div>
      {badge ? (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          badge === 'green'
            ? 'bg-green-900/40 text-green-400 border border-green-700/30'
            : 'bg-gray-700/40 text-gray-400 border border-gray-600/30'
        }`}>
          {value}
        </span>
      ) : (
        <span className={`text-xs text-gray-200 ${mono ? 'font-mono' : ''}`}>{value}</span>
      )}
    </div>
  );
}
