'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { WorldMap } from '../../components/WorldMap.js';
import { EventFeed } from '../../components/EventFeed.js';
import { AgentProfile } from '../../components/AgentProfile.js';
import { StatsBar } from '../../components/StatsBar.js';
import { CivilisationPanel } from '../../components/CivilisationPanel.js';
import { CreateAgentModal } from '../../components/CreateAgentModal.js';
import { SettingsModal } from '../../components/SettingsModal.js';
import { useGenesisStore } from '../../lib/store.js';
import { useGenesisWebSocket } from '../../lib/useWebSocket.js';
import { useAuthStore, apiFetch } from '../../lib/auth.js';
import { ErrorBoundary } from 'react-error-boundary';
import { PanelErrorFallback } from '../../components/ErrorFallbacks';

interface MapData {
  size: number;
  tiles: Array<{ x: number; y: number; terrain: string; is_passable: boolean }>;
  resource_nodes: Array<{ x: number; y: number; resource_type: string; current_amount: number; is_depleted: boolean }>;
  explored_tiles?: Array<{ x: number; y: number }>;
}

export default function ViewerPage() {
  const router = useRouter();
  const { token, user, clearAuth } = useAuthStore();
  const { worldId, setAgents, setGroups } = useGenesisStore();
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [civOpen, setCivOpen] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!token) {
      router.replace('/login');
    } else {
      setAuthChecked(true);
    }
  }, [token, router]);

  useGenesisWebSocket();

  useEffect(() => {
    if (!worldId || !authChecked) return;

    const loadWorld = async () => {
      try {
        const [mapRes, agentsRes, groupsRes] = await Promise.all([
          apiFetch(`/worlds/${worldId}/map`),
          apiFetch(`/worlds/${worldId}/agents`),
          apiFetch(`/worlds/${worldId}/groups`),
        ]);
        if (mapRes.ok)    setMapData(await mapRes.json());
        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (groupsRes.ok) setGroups(await groupsRes.json());
      } catch (err) {
        console.error('Failed to load world:', err);
      } finally {
        setLoading(false);
      }
    };

    loadWorld();
    const interval = setInterval(async () => {
      try {
        const [agentsRes, groupsRes] = await Promise.all([
          apiFetch(`/worlds/${worldId}/agents`),
          apiFetch(`/worlds/${worldId}/groups`),
        ]);
        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (groupsRes.ok) setGroups(await groupsRes.json());
      } catch { /* ignore */ }
    }, 30_000);

    // Fog-of-war incremental reveal: poll every 5s for newly-explored tiles.
    const fogInterval = setInterval(async () => {
      try {
        const res = await apiFetch(`/worlds/${worldId}/explored`);
        if (res.ok) {
          const newly = await res.json() as Array<{ x: number; y: number }>;
          if (newly.length > 0) {
            setMapData(prev => {
              if (!prev) return prev;
              const seen = new Set<string>();
              const merged: Array<{ x: number; y: number }> = [];
              for (const t of prev.explored_tiles ?? []) {
                const k = `${t.x},${t.y}`;
                if (!seen.has(k)) { seen.add(k); merged.push(t); }
              }
              for (const t of newly) {
                const k = `${t.x},${t.y}`;
                if (!seen.has(k)) { seen.add(k); merged.push(t); }
              }
              return { ...prev, explored_tiles: merged };
            });
          }
        }
      } catch { /* ignore */ }
    }, 5_000);

    return () => { clearInterval(interval); clearInterval(fogInterval); };
  }, [worldId, authChecked, setAgents, setGroups]);

  const handleAgentCreated = useCallback(async () => {
    if (!worldId) return;
    try {
      const res = await apiFetch(`/worlds/${worldId}/agents`);
      if (res.ok) setAgents(await res.json());
    } catch { /* ignore */ }
  }, [worldId, setAgents]);

  const handleLogout = useCallback(() => {
    clearAuth();
    router.replace('/');
  }, [clearAuth, router]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0e1a] text-gray-400">
        <div className="w-8 h-8 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
      </div>
    );
  }

  if (!worldId) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0e1a] text-gray-400">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
            <span className="text-2xl text-blue-400 font-bold">G</span>
          </div>
          <div className="text-xl font-bold text-blue-400 mb-2">PROJECT GENESIS</div>
          <div className="text-sm text-gray-500">Set NEXT_PUBLIC_WORLD_ID in your .env to observe a world</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0e1a] text-gray-200 overflow-hidden">
      <StatsBar
        onCreateAgent={() => setShowCreateAgent(true)}
        onSettings={() => setShowSettings(true)}
        username={user?.username}
        onLogout={handleLogout}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className={`flex flex-col border-r border-gray-700/30 transition-all duration-200 ${civOpen ? 'w-64' : 'w-8'} shrink-0 bg-[#0c1020]/50`}>
          <button
            onClick={() => setCivOpen((o: boolean) => !o)}
            title={civOpen ? 'Close civilisation panel' : 'Open civilisation panel'}
            className="flex items-center justify-center h-8 w-full text-gray-600 hover:text-gray-300 transition-colors border-b border-gray-700/30 shrink-0"
          >
            <span className="text-xs">{civOpen ? '\u25C0' : '\u25B6'}</span>
          </button>
          {civOpen && (
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary FallbackComponent={PanelErrorFallback}>
                <CivilisationPanel />
              </ErrorBoundary>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-1">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
                <span className="text-sm">Loading world...</span>
              </div>
            </div>
          ) : mapData ? (
            <ErrorBoundary FallbackComponent={PanelErrorFallback}>
              <WorldMap
                tiles={mapData.tiles}
                resourceNodes={mapData.resource_nodes}
                worldSize={mapData.size}
                exploredTiles={mapData.explored_tiles}
              />
            </ErrorBoundary>
          ) : (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">
              Failed to load world map
            </div>
          )}
        </div>

        <div className="w-80 flex flex-col border-l border-gray-700/30 bg-[#0c1020]/50">
          <div className="h-1/2 border-b border-gray-700/30 overflow-hidden">
            <ErrorBoundary FallbackComponent={PanelErrorFallback}>
              <AgentProfile />
            </ErrorBoundary>
          </div>
          <div className="h-1/2 overflow-hidden">
            <ErrorBoundary FallbackComponent={PanelErrorFallback}>
              <EventFeed />
            </ErrorBoundary>
          </div>
        </div>
      </div>

      {showCreateAgent && (
        <CreateAgentModal
          worldId={worldId}
          onClose={() => setShowCreateAgent(false)}
          onAgentCreated={handleAgentCreated}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
