'use client';
import { useEffect, useRef } from 'react';
import { useGenesisStore } from './store.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS  = 10_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function useGenesisWebSocket() {
  const store = useGenesisStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeout  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt  = useRef<number>(0);
  const isMounted = useRef<boolean>(true);

  useEffect(() => {
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws';
    isMounted.current = true;

    const clearTimers = () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
        heartbeatInterval.current = null;
      }
      if (heartbeatTimeout.current) {
        clearTimeout(heartbeatTimeout.current);
        heartbeatTimeout.current = null;
      }
    };

    const startHeartbeat = (ws: WebSocket) => {
      heartbeatInterval.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        // If we don't see ANY message (including the server's ping or any
        // event) within HEARTBEAT_TIMEOUT_MS, treat the connection as dead.
        heartbeatTimeout.current = setTimeout(() => {
          try { ws.close(4000, 'heartbeat_timeout'); } catch { /* ignore */ }
        }, HEARTBEAT_TIMEOUT_MS);
      }, HEARTBEAT_INTERVAL_MS);
    };

    const connect = () => {
      if (!isMounted.current) return;
      store.setConnectionState(reconnectAttempt.current === 0 ? 'connecting' : 'reconnecting');

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt.current = 0;
        store.setConnectionState('open');
        startHeartbeat(ws);
      };

      ws.onmessage = (evt) => {
        // Any message clears the heartbeat-pending timer — the connection
        // is alive even if it's not a pong specifically.
        if (heartbeatTimeout.current) {
          clearTimeout(heartbeatTimeout.current);
          heartbeatTimeout.current = null;
        }
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'pong' || msg.type === 'ping') return;
          switch (msg.type) {
            case 'world:tick':
              store.setStats({
                tick: msg.tick,
                day: msg.day,
                time_of_day: msg.time_of_day,
                agent_count: msg.agent_count,
              });
              break;

            case 'agent:moved':
              store.updateAgent({
                agent_id: msg.agent_id,
                position_x: msg.x,
                position_y: msg.y,
              });
              break;

            case 'agent:state_changed':
              store.updateAgent({
                agent_id: msg.agent_id,
                current_activity: msg.activity,
                mental_state: msg.mental_state,
                hp: msg.hp,
                need_food: msg.need_food,
                need_water: msg.need_water,
              });
              break;

            case 'agent:died':
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'death',
                significance: 'major',
                title: `${msg.agent_name} has died`,
                summary: `Cause: ${msg.cause}`,
                participant_agent_ids: [msg.agent_id],
              });
              break;

            case 'event:significant':
              store.addEvent(msg);
              break;

            // Phase 3: group events
            case 'group:formed':
              store.upsertGroup({
                group_id: msg.group_id,
                name: msg.group_name,
                colour: msg.colour,
                member_count: 1,
                territory_radius: 5,
              });
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'group_formed',
                significance: 'moderate',
                title: `New group formed: ${msg.group_name}`,
                participant_agent_ids: [msg.founder_id],
              });
              break;

            case 'group:member_joined': {
              // Update the agent's group colour in real-time
              const joinedGroup = store.groups.get(msg.group_id);
              store.updateAgent({
                agent_id: msg.agent_id,
                group_id: msg.group_id,
                group_colour: joinedGroup?.colour ?? null,
                group_name: joinedGroup?.name ?? null,
              });
              // Update group member count
              if (joinedGroup) {
                store.upsertGroup({ ...joinedGroup, member_count: joinedGroup.member_count + 1 });
              }
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'group_joined',
                significance: 'trivial',
                title: `${msg.agent_name ?? 'An agent'} joined ${joinedGroup?.name ?? 'a group'}`,
                participant_agent_ids: [msg.agent_id],
              });
              break;
            }

            case 'group:member_left': {
              store.updateAgent({
                agent_id: msg.agent_id,
                group_id: null,
                group_colour: null,
                group_name: null,
              });
              const leftGroup = store.groups.get(msg.group_id);
              if (leftGroup) {
                store.upsertGroup({ ...leftGroup, member_count: Math.max(0, leftGroup.member_count - 1) });
              }
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'group_left',
                significance: 'trivial',
                title: `${msg.agent_name ?? 'An agent'} left ${leftGroup?.name ?? 'a group'}`,
                participant_agent_ids: [msg.agent_id],
              });
              break;
            }

            // Phase 5: conflict events
            case 'conflict:war_declared':
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'war_declared',
                significance: 'major',
                title: `⚔ War declared: ${msg.aggressor_name} vs ${msg.defender_name}`,
                participant_agent_ids: [],
                consequences: { war_id: msg.war_id },
              });
              break;

            case 'conflict:war_ended':
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'war_ended',
                significance: 'major',
                title: `War ended: ${msg.outcome?.replace(/_/g, ' ')}`,
                participant_agent_ids: [],
                consequences: { war_id: msg.war_id },
              });
              break;

            case 'conflict:skirmish':
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'skirmish',
                significance: 'minor',
                title: `Skirmish: ${msg.attacker_name} vs ${msg.defender_name}`,
                participant_agent_ids: [msg.attacker_id, msg.defender_id],
                consequences: { outcome: msg.outcome },
              });
              break;

            // Phase 6: belief/culture events
            case 'culture:belief_founded':
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'belief_founded',
                significance: 'moderate',
                title: `✦ New belief: "${msg.belief_name}"`,
                participant_agent_ids: [msg.founder_id],
                consequences: { belief_id: msg.belief_id },
              });
              break;

            case 'culture:myth_created':
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'myth_created',
                significance: 'minor',
                title: `Story: "${msg.myth_title}"`,
                participant_agent_ids: [msg.author_id],
              });
              break;

            case 'culture:chronicle':
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'chronicle',
                significance: 'historic',
                title: `📜 Era recorded: ${msg.era_name}`,
                participant_agent_ids: [],
                consequences: { chronicle_id: msg.chronicle_id },
              });
              break;

            // Civilisation: law events
            case 'law:enacted':
              store.addEvent({
                event_id: crypto.randomUUID(),
                tick: store.stats?.tick ?? 0,
                day: store.stats?.day ?? 0,
                event_type: 'law_enacted',
                significance: 'moderate',
                title: `⚖ New law: "${msg.law_name}"`,
                participant_agent_ids: [],
              });
              break;
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = (evt) => {
        // Stop heartbeats — they're tied to this socket only.
        if (heartbeatInterval.current) {
          clearInterval(heartbeatInterval.current);
          heartbeatInterval.current = null;
        }
        if (heartbeatTimeout.current) {
          clearTimeout(heartbeatTimeout.current);
          heartbeatTimeout.current = null;
        }

        // Component unmount issues an explicit close (code 1000); don't
        // reconnect in that case.
        if (!isMounted.current || evt.code === 1000) {
          store.setConnectionState('closed');
          return;
        }

        if (reconnectAttempt.current >= MAX_RECONNECT_ATTEMPTS) {
          store.setConnectionState('failed');
          return;
        }

        // Exponential backoff capped at MAX_RECONNECT_DELAY_MS.
        const delay = Math.min(
          MAX_RECONNECT_DELAY_MS,
          1000 * Math.pow(2, reconnectAttempt.current),
        );
        reconnectAttempt.current += 1;
        store.setConnectionState('reconnecting');
        reconnectTimeout.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // Errors precede close; let onclose drive reconnect.
        try { ws.close(); } catch { /* ignore */ }
      };
    };

    connect();

    return () => {
      isMounted.current = false;
      clearTimers();
      try {
        wsRef.current?.close(1000, 'component_unmount');
      } catch { /* ignore */ }
    };
  // We deliberately don't depend on `store` — Zustand getters are stable
  // and re-running this effect would tear down the connection on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
