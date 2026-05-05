import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import { authRoutes } from './routes/auth.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { worldRoutes } from './routes/worlds.js';
import { agentRoutes } from './routes/agents.js';
import { socialRoutes } from './routes/social.js';
import { civilisationRoutes } from './routes/civilisation.js';
import { settingsRoutes } from './routes/settings.js';

const PORT = parseInt(process.env.API_PORT ?? '3001');

async function start() {
  // connectionTimeout: drop slow/dead clients that never finish their TLS
  // handshake or first request. keepAliveTimeout: idle keep-alive sockets
  // close after this so an abandoned client can't pin a connection.
  const app = Fastify({
    logger: { level: 'info' },
    connectionTimeout: 60_000,
    keepAliveTimeout: 5_000,
  });

  // Plugins
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'genesis-secret' });
  await app.register(websocket);

  // Global rate limit: 100 requests/minute/IP. Per-route overrides on
  // expensive endpoints live next to the routes themselves (auth/register,
  // onboarding/sessions). The /health and /ws paths are excluded so
  // monitoring pings and long-lived sockets aren't penalised.
  await app.register(rateLimit, {
    global: true,
    max: parseInt(process.env.API_RATE_LIMIT_GLOBAL_MAX ?? '100'),
    timeWindow: '1 minute',
    skipOnError: true, // never let a Redis blip take the whole API down
    allowList: (req) => req.url === '/health' || req.url.startsWith('/ws'),
  });

  // Auth decorator
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  // Routes
  await app.register(authRoutes);
  await app.register(onboardingRoutes);
  await app.register(worldRoutes);
  await app.register(agentRoutes);
  await app.register(socialRoutes);
  await app.register(civilisationRoutes);
  await app.register(settingsRoutes);

  // WebSocket — subscribe to Redis pub/sub and fan out to connected clients
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const subscriber = redis.duplicate();
  await subscriber.subscribe('genesis:events');

  const wsClients = new Set<any>();

  // Per-connection heartbeat: server sends a pong every 30s and closes the
  // socket if the client hasn't sent a ping/message in 45s. Pairs with the
  // client-side heartbeat in packages/web/src/lib/useWebSocket.ts.
  const HEARTBEAT_INTERVAL_MS = 30_000;
  const STALE_LIMIT_MS = 45_000;

  app.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket);
    let lastSeen = Date.now();

    const heartbeat = setInterval(() => {
      try {
        if (Date.now() - lastSeen > STALE_LIMIT_MS) {
          socket.close(4000, 'stale_heartbeat');
          return;
        }
        socket.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      } catch { /* socket closed */ }
    }, HEARTBEAT_INTERVAL_MS);

    socket.on('message', (raw: Buffer | string) => {
      lastSeen = Date.now();
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', t: Date.now() }));
        }
      } catch { /* ignore non-JSON */ }
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      wsClients.delete(socket);
    });
    socket.on('error', () => {
      clearInterval(heartbeat);
      wsClients.delete(socket);
    });
  });

  subscriber.on('message', (_channel, message) => {
    for (const client of wsClients) {
      try {
        client.send(message);
      } catch { /* client disconnected */ }
    }
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[API] Server running on port ${PORT}`);
}

start().catch(err => {
  console.error('[API] Fatal error:', err);
  process.exit(1);
});
