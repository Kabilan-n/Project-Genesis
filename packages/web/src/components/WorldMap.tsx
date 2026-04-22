'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import { useGenesisStore } from '../lib/store.js';

const TILE = 16;
const AGENT_R = 5;
const NAME_FONT = '8px monospace';
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4.0;
const ZOOM_STEP = 0.15;

const TERRAIN: Record<string, { base: string; alt: string; detail?: string }> = {
  water:     { base: '#1a4b7a', alt: '#1e5a8f', detail: '#2568a0' },
  swamp:     { base: '#2a4a2a', alt: '#35553a', detail: '#3a6040' },
  grassland: { base: '#3a7a2e', alt: '#45882e', detail: '#4d9635' },
  forest:    { base: '#1d5a1d', alt: '#256425', detail: '#1a4a1a' },
  mountain:  { base: '#5a5a5a', alt: '#6a6a6a', detail: '#787878' },
  desert:    { base: '#b8943c', alt: '#c4a44c', detail: '#d4b45c' },
};

const MENTAL_COLORS: Record<string, string> = {
  alert:     '#22c55e', content:   '#3b82f6', tired:     '#eab308',
  stressed:  '#f97316', desperate: '#ef4444', depressed: '#8b5cf6',
  flow:      '#06b6d4', manic:     '#ec4899', anxious:   '#fb923c',
  lonely:    '#a78bfa', angry:     '#dc2626', hopeful:   '#34d399',
};

const RESOURCE_ICON: Record<string, { color: string }> = {
  food:  { color: '#86efac' },
  water: { color: '#7dd3fc' },
  wood:  { color: '#d4a054' },
};

interface Tile { x: number; y: number; terrain: string; is_passable: boolean; }
interface ResourceNode { x: number; y: number; resource_type: string; current_amount: number; is_depleted: boolean; }
interface ExploredTile { x: number; y: number; }
interface Props {
  tiles: Tile[];
  resourceNodes: ResourceNode[];
  worldSize: number;
  exploredTiles?: ExploredTile[];
}

function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
  return (h ^ (h >> 16)) >>> 0;
}

export function WorldMap({ tiles, resourceNodes, worldSize, exploredTiles }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const offscreenRef  = useRef<HTMLCanvasElement | null>(null);
  const terrainDirty  = useRef(true);

  /* ── zoom / pan state (refs so they don't trigger re-renders) ── */
  const zoomRef   = useRef(1);
  const panRef    = useRef({ x: 0, y: 0 });
  const dragging  = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const [zoom, setZoom] = useState(1); // mirror for UI only

  const { agents, groups, selectedAgentId, setSelectedAgent } = useGenesisStore();

  /* Build tile lookup */
  const tileMap = useRef<Map<string, Tile>>(new Map());
  useEffect(() => {
    const map = new Map<string, Tile>();
    for (const t of tiles) map.set(`${t.x},${t.y}`, t);
    tileMap.current = map;
    terrainDirty.current = true;
  }, [tiles]);

  /* Fog-of-war: set of explored "x,y" keys. Tiles NOT in this set render black. */
  const exploredSet = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!exploredTiles) return;
    const s = new Set<string>();
    for (const t of exploredTiles) s.add(`${t.x},${t.y}`);
    exploredSet.current = s;
    terrainDirty.current = true;
  }, [exploredTiles]);

  /* ── pre-render static terrain to offscreen canvas ── */
  const renderTerrain = useCallback((waveTick: number) => {
    const size = worldSize * TILE;
    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
    const off = offscreenRef.current;
    off.width  = size;
    off.height = size;
    const ctx = off.getContext('2d')!;

    const fogEnabled = exploredSet.current.size > 0;
    for (const tile of tiles) {
      const tx = tile.x * TILE;
      const ty = tile.y * TILE;

      // Fog of war: unexplored tiles render as void. A one-tile wider check
      // would give a "fringe" effect, but keeping it simple for now.
      if (fogEnabled && !exploredSet.current.has(`${tile.x},${tile.y}`)) {
        ctx.fillStyle = '#05070d';
        ctx.fillRect(tx, ty, TILE, TILE);
        continue;
      }

      const t  = TERRAIN[tile.terrain] ?? TERRAIN.grassland;
      const h  = tileHash(tile.x, tile.y);

      ctx.fillStyle = t.base;
      ctx.fillRect(tx, ty, TILE, TILE);

      const pCount = 2 + (h % 3);
      ctx.fillStyle = t.alt;
      for (let i = 0; i < pCount; i++) {
        ctx.fillRect(tx + ((h >> (i * 5)) % (TILE - 2)) + 1, ty + ((h >> (i * 5 + 2)) % (TILE - 2)) + 1, 2, 2);
      }

      if (tile.terrain === 'water') {
        const waveOff = ((tile.x + tile.y + waveTick) % 8);
        if (waveOff < 3) {
          ctx.fillStyle = 'rgba(100,180,255,0.15)';
          ctx.fillRect(tx + waveOff * 2, ty + 4 + (h % 6), 6, 1);
        }
      } else if (tile.terrain === 'forest') {
        const cnt = 1 + (h % 2);
        for (let i = 0; i < cnt; i++) {
          const ox = 2 + ((h >> (i * 4)) % (TILE - 6));
          const oy = 2 + ((h >> (i * 4 + 2)) % (TILE - 6));
          ctx.fillStyle = '#4a3520'; ctx.fillRect(tx + ox + 1, ty + oy + 2, 2, 3);
          ctx.fillStyle = t.detail!; ctx.fillRect(tx + ox, ty + oy, 4, 3);
          ctx.fillStyle = '#2a7a2a'; ctx.fillRect(tx + ox, ty + oy, 2, 1);
        }
      } else if (tile.terrain === 'mountain' && h % 3 === 0) {
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.moveTo(tx + TILE / 2, ty + 2);
        ctx.lineTo(tx + TILE / 2 + 4, ty + TILE - 3);
        ctx.lineTo(tx + TILE / 2 - 4, ty + TILE - 3);
        ctx.fill();
        ctx.fillStyle = '#ccc'; ctx.fillRect(tx + TILE / 2 - 1, ty + 2, 3, 2);
      } else if (tile.terrain === 'desert' && h % 4 === 0) {
        ctx.fillStyle = 'rgba(255,255,220,0.12)';
        ctx.fillRect(tx + 2, ty + (h % 8) + 3, TILE - 4, 1);
      } else if (tile.terrain === 'swamp' && h % 3 === 0) {
        ctx.fillStyle = 'rgba(60,120,80,0.3)';
        ctx.beginPath();
        ctx.arc(tx + 4 + (h % 6), ty + 4 + ((h >> 3) % 6), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const node of resourceNodes) {
      if (node.is_depleted) continue;
      if (fogEnabled && !exploredSet.current.has(`${node.x},${node.y}`)) continue;
      const r = RESOURCE_ICON[node.resource_type];
      if (!r) continue;
      ctx.globalAlpha = Math.max(0.3, Math.min(1, node.current_amount / 150));
      ctx.fillStyle = r.color;
      const cx = node.x * TILE + TILE / 2;
      const cy = node.y * TILE + TILE / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 3); ctx.lineTo(cx + 3, cy); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx - 3, cy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    terrainDirty.current = false;
  }, [tiles, resourceNodes, worldSize]);

  /* ── main render loop (draws onto a viewport-sized canvas with transform) ── */
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d')!;
    let animFrame: number;
    let tick = 0;

    const resize = () => {
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = () => {
      tick++;
      if (terrainDirty.current || tick % 60 === 0) renderTerrain(Math.floor(tick / 60));

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, w, h);

      const z  = zoomRef.current;
      const px = panRef.current.x;
      const py = panRef.current.y;

      ctx.save();
      ctx.translate(px, py);
      ctx.scale(z, z);

      /* terrain blit */
      if (offscreenRef.current) ctx.drawImage(offscreenRef.current, 0, 0);

      /* group territories */
      for (const [, grp] of groups) {
        if (grp.territory_x == null || grp.territory_y == null) continue;
        const cx = grp.territory_x * TILE + TILE / 2;
        const cy = grp.territory_y * TILE + TILE / 2;
        const r  = grp.territory_radius * TILE;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grp.colour; ctx.globalAlpha = 0.05; ctx.fill(); ctx.globalAlpha = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = grp.colour; ctx.lineWidth = 1 / z; ctx.globalAlpha = 0.3; ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.font = `${7 / z}px monospace`; ctx.fillStyle = grp.colour; ctx.globalAlpha = 0.7;
        ctx.textAlign = 'center'; ctx.fillText(grp.name, cx, cy - r - 4); ctx.textAlign = 'start'; ctx.globalAlpha = 1;
      }

      /* agents — hidden if on unexplored tile (can happen briefly right after spawn) */
      const fogOn = exploredSet.current.size > 0;
      for (const [id, agent] of agents) {
        if (fogOn && !exploredSet.current.has(`${agent.position_x},${agent.position_y}`)) continue;
        const cx  = agent.position_x * TILE + TILE / 2;
        const cy  = agent.position_y * TILE + TILE / 2;
        const sel = id === selectedAgentId;
        const col = MENTAL_COLORS[agent.mental_state] ?? '#9ca3af';

        // glow
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, AGENT_R + 6);
        grad.addColorStop(0, col + '30'); grad.addColorStop(1, col + '00');
        ctx.fillStyle = grad;
        ctx.fillRect(cx - AGENT_R - 6, cy - AGENT_R - 6, (AGENT_R + 6) * 2, (AGENT_R + 6) * 2);

        // group ring
        if (agent.group_colour) {
          ctx.beginPath(); ctx.arc(cx, cy, AGENT_R + 3, 0, Math.PI * 2);
          ctx.strokeStyle = agent.group_colour; ctx.lineWidth = 1.5 / z; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
        }

        // selection pulse
        if (sel) {
          const pulse = 1 + Math.sin(tick * 0.08) * 0.3;
          ctx.beginPath(); ctx.arc(cx, cy, (AGENT_R + 6) * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / z;
          ctx.globalAlpha = 0.6 + Math.sin(tick * 0.08) * 0.2; ctx.stroke(); ctx.globalAlpha = 1;
        }

        // sprite
        ctx.fillStyle = col;
        ctx.fillRect(cx - 2, cy - AGENT_R, 4, 4);
        ctx.fillRect(cx - 3, cy - AGENT_R + 4, 6, 5);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.5 / z;
        ctx.strokeRect(cx - 3, cy - AGENT_R, 6, 9);
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - 1, cy - AGENT_R + 1, 1, 1);
        ctx.fillRect(cx + 1, cy - AGENT_R + 1, 1, 1);

        // HP bar
        const barW = 12; const barH = 2;
        const barX = cx - barW / 2; const barY = cy + AGENT_R + 2;
        ctx.fillStyle = '#1a1a2e'; ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = agent.hp > 60 ? '#22c55e' : agent.hp > 30 ? '#eab308' : '#ef4444';
        ctx.fillRect(barX, barY, barW * Math.max(0, agent.hp / 100), barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5 / z;
        ctx.strokeRect(barX, barY, barW, barH);

        // name — hide when zoomed very far out to avoid clutter
        if (z >= 0.6) {
          const fontSize = Math.max(6, Math.min(8, 8 / z)) ;
          ctx.font = `${fontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.65)';
          ctx.fillText(agent.name, cx, barY + barH + 8);
          ctx.textAlign = 'start';
        }

        if (sel && agent.current_activity) {
          ctx.font = `6px monospace`;
          ctx.fillStyle = 'rgba(255,255,200,0.5)';
          ctx.textAlign = 'center';
          ctx.fillText(agent.current_activity, cx, barY + barH + 15);
          ctx.textAlign = 'start';
        }
      }

      ctx.restore();
      animFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => { cancelAnimationFrame(animFrame); ro.disconnect(); };
  }, [tiles, resourceNodes, agents, groups, selectedAgentId, worldSize, renderTerrain]);

  /* ── clamp pan so map never flies off screen ── */
  const clampPan = useCallback((x: number, y: number, z: number, cw: number, ch: number) => {
    const mapSize = worldSize * TILE * z;
    const maxX = Math.max(0, (mapSize - cw) / 2 + cw * 0.1);
    const maxY = Math.max(0, (mapSize - ch) / 2 + ch * 0.1);
    return {
      x: Math.max(-maxX, Math.min(maxX + Math.max(0, cw - mapSize), x)),
      y: Math.max(-maxY, Math.min(maxY + Math.max(0, ch - mapSize), y)),
    };
  }, [worldSize]);

  /* ── zoom helpers ── */
  const applyZoom = useCallback((newZ: number, originX: number, originY: number) => {
    const canvas = canvasRef.current!;
    const oldZ = zoomRef.current;
    newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZ));

    // adjust pan so zoom is anchored at cursor position
    const worldX = (originX - panRef.current.x) / oldZ;
    const worldY = (originY - panRef.current.y) / oldZ;
    const raw = {
      x: originX - worldX * newZ,
      y: originY - worldY * newZ,
    };
    panRef.current = clampPan(raw.x, raw.y, newZ, canvas.width, canvas.height);
    zoomRef.current = newZ;
    setZoom(newZ);
  }, [clampPan]);

  /* ── wheel to zoom ── */
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    applyZoom(zoomRef.current + delta, ox, oy);
  }, [applyZoom]);

  /* ── click-drag to pan ── */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    dragging.current  = true;
    dragStart.current = { x: e.clientX, y: e.clientY, px: panRef.current.x, py: panRef.current.y };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const canvas = canvasRef.current!;
    panRef.current = clampPan(
      dragStart.current.px + dx,
      dragStart.current.py + dy,
      zoomRef.current, canvas.width, canvas.height
    );
  }, [clampPan]);

  const handleMouseUp = useCallback(() => { dragging.current = false; }, []);
  const handleMouseLeave = useCallback(() => { dragging.current = false; }, []);

  /* ── click to select agent ── */
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (Math.abs(e.clientX - dragStart.current.x) > 4 || Math.abs(e.clientY - dragStart.current.y) > 4) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const z  = zoomRef.current;
    const wx = (e.clientX - rect.left - panRef.current.x) / z;
    const wy = (e.clientY - rect.top  - panRef.current.y) / z;
    const tileX = Math.floor(wx / TILE);
    const tileY = Math.floor(wy / TILE);

    for (const [id, agent] of agents) {
      if (Math.abs(agent.position_x - tileX) <= 1 && Math.abs(agent.position_y - tileY) <= 1) {
        setSelectedAgent(id === selectedAgentId ? null : id);
        return;
      }
    }
    setSelectedAgent(null);
  }, [agents, selectedAgentId, setSelectedAgent]);

  /* ── button zoom controls ── */
  const zoomIn  = useCallback(() => {
    const c = canvasRef.current!;
    applyZoom(zoomRef.current + ZOOM_STEP, c.width / 2, c.height / 2);
  }, [applyZoom]);
  const zoomOut = useCallback(() => {
    const c = canvasRef.current!;
    applyZoom(zoomRef.current - ZOOM_STEP, c.width / 2, c.height / 2);
  }, [applyZoom]);
  const zoomReset = useCallback(() => {
    const c = canvasRef.current!;
    const fitZ = Math.min(c.width, c.height) / (worldSize * TILE);
    zoomRef.current = fitZ;
    panRef.current  = { x: (c.width  - worldSize * TILE * fitZ) / 2,
                         y: (c.height - worldSize * TILE * fitZ) / 2 };
    setZoom(fitZ);
  }, [worldSize]);

  /* ── centre map on first render ── */
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    // small delay so canvas has been sized
    const t = setTimeout(() => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const fitZ = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(cw, ch) / (worldSize * TILE)));
      zoomRef.current = fitZ;
      panRef.current  = { x: (cw - worldSize * TILE * fitZ) / 2,
                           y: (ch - worldSize * TILE * fitZ) / 2 };
      setZoom(fitZ);
    }, 50);
    return () => clearTimeout(t);
  }, [worldSize]);

  const pct = Math.round(zoom * 100);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0a0e1a] rounded-lg border border-gray-800/50 overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className="block w-full h-full"
        style={{ cursor: dragging.current ? 'grabbing' : 'crosshair', imageRendering: 'pixelated' }}
      />

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-[#0c1020]/80 border border-gray-700/40 rounded-lg px-2 py-1.5 backdrop-blur-sm">
        <button
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM}
          className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white disabled:text-gray-700 transition-colors text-sm font-bold"
          title="Zoom out"
        >−</button>
        <button
          onClick={zoomReset}
          className="px-2 text-xs text-gray-400 hover:text-white transition-colors min-w-[3rem] text-center font-mono"
          title="Reset zoom to fit"
        >{pct}%</button>
        <button
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM}
          className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white disabled:text-gray-700 transition-colors text-sm font-bold"
          title="Zoom in"
        >+</button>
      </div>

      {/* Scroll hint — fades after first interaction */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 text-xs text-gray-600 pointer-events-none select-none">
        Scroll to zoom · drag to pan
      </div>
    </div>
  );
}
