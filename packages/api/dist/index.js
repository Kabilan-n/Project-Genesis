"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: '../../.env' });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const ioredis_1 = __importDefault(require("ioredis"));
const auth_js_1 = require("./routes/auth.js");
const onboarding_js_1 = require("./routes/onboarding.js");
const worlds_js_1 = require("./routes/worlds.js");
const agents_js_1 = require("./routes/agents.js");
const social_js_1 = require("./routes/social.js");
const civilisation_js_1 = require("./routes/civilisation.js");
const PORT = parseInt(process.env.API_PORT ?? '3001');
async function start() {
    const app = (0, fastify_1.default)({ logger: { level: 'info' } });
    // Plugins
    await app.register(cors_1.default, { origin: true });
    await app.register(jwt_1.default, { secret: process.env.JWT_SECRET ?? 'genesis-secret' });
    await app.register(websocket_1.default);
    // Auth decorator
    app.decorate('authenticate', async (request, reply) => {
        try {
            await request.jwtVerify();
        }
        catch (err) {
            reply.send(err);
        }
    });
    // Routes
    await app.register(auth_js_1.authRoutes);
    await app.register(onboarding_js_1.onboardingRoutes);
    await app.register(worlds_js_1.worldRoutes);
    await app.register(agents_js_1.agentRoutes);
    await app.register(social_js_1.socialRoutes);
    await app.register(civilisation_js_1.civilisationRoutes);
    // WebSocket — subscribe to Redis pub/sub and fan out to connected clients
    const redis = new ioredis_1.default(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const subscriber = redis.duplicate();
    await subscriber.subscribe('genesis:events');
    const wsClients = new Set();
    app.get('/ws', { websocket: true }, (socket) => {
        wsClients.add(socket);
        socket.on('close', () => wsClients.delete(socket));
        socket.on('error', () => wsClients.delete(socket));
    });
    subscriber.on('message', (_channel, message) => {
        for (const client of wsClients) {
            try {
                client.send(message);
            }
            catch { /* client disconnected */ }
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
