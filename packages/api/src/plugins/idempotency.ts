/**
 * Idempotency-Key handling for mutating endpoints.
 *
 * Activates only when the client sends an `Idempotency-Key` header on a
 * POST / PUT / DELETE / PATCH. Absence of the header means best-effort
 * (legacy behaviour preserved).
 *
 * Lookup → replay or proceed:
 *   - Same (user_id|IP, key, request_hash) seen before → reply with the
 *     cached status + body. No handler runs.
 *   - Same key, DIFFERENT request_hash → 409 idempotency conflict. The
 *     classic "same key reused for a different operation" anti-pattern.
 *   - No prior row → handler runs. The response is captured in onSend
 *     and persisted before returning.
 *
 * The store is Postgres (table created in 014_idempotency.sql). A daily
 * cleanup of rows older than 24h is the operator's responsibility for
 * now — Phase 8 wires it into the simulation tick when it lands.
 */
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import { createHash } from 'crypto';
import { queryOne, execute } from '../db.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const IDEMPOTENCY_HEADER = 'idempotency-key';
const RECORD_TTL_MS = 24 * 60 * 60 * 1000; // 24h

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the preHandler when a usable Idempotency-Key was present. */
    _idempotency?: {
      userId: string | null;
      callerIp: string;
      key: string;
      requestHash: string;
    };
  }
}

function hashBody(body: unknown): string {
  const serialized = JSON.stringify(body ?? null);
  return createHash('sha256').update(serialized).digest('hex');
}

interface IdempotencyRow {
  request_hash: string;
  response_status: number;
  response_body: unknown;
  created_at: string;
}

export async function idempotencyPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(req.method)) return;

    const key = req.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || key.length === 0 || key.length > 200) return;

    // Determine scope: user_id for authenticated callers, IP otherwise.
    const userId = (req.user as { user_id?: string } | undefined)?.user_id ?? null;
    const callerIp = req.ip ?? '';
    const requestHash = hashBody(req.body);

    const existing = await queryOne<IdempotencyRow>(
      `SELECT request_hash, response_status, response_body, created_at
       FROM auth.idempotency_records
       WHERE
         ($1::uuid IS NOT NULL AND user_id = $1::uuid AND idempotency_key = $3)
         OR ($1::uuid IS NULL AND caller_ip = $2 AND idempotency_key = $3)
       LIMIT 1`,
      [userId, callerIp, key],
    );

    if (existing) {
      const age = Date.now() - new Date(existing.created_at).getTime();
      if (age <= RECORD_TTL_MS) {
        if (existing.request_hash !== requestHash) {
          reply.code(409).send({
            error: 'idempotency_conflict',
            message: 'This Idempotency-Key was used for a different request.',
          });
          return;
        }
        reply.code(existing.response_status).send(existing.response_body);
        return;
      }
      // Stale row will be overwritten by the upsert in onSend.
    }

    // Stash so onSend persists the response.
    req._idempotency = { userId, callerIp, key, requestHash };
  });

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (!req._idempotency) return payload;

    let body: unknown = payload;
    if (typeof payload === 'string') {
      // Fastify default JSON serializer hands us a stringified payload
      // before this hook runs.
      try { body = JSON.parse(payload); } catch { body = payload; }
    }

    const status = reply.statusCode;
    // Persist or refresh the record. ON CONFLICT replaces any stale row
    // with the latest response so callers see consistent behaviour.
    try {
      await execute(
        `INSERT INTO auth.idempotency_records
           (user_id, caller_ip, idempotency_key, request_hash,
            response_status, response_body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
         ON CONFLICT (user_id, caller_ip, idempotency_key)
         DO UPDATE SET
           request_hash = EXCLUDED.request_hash,
           response_status = EXCLUDED.response_status,
           response_body = EXCLUDED.response_body,
           created_at = NOW()`,
        [
          req._idempotency.userId,
          req._idempotency.callerIp,
          req._idempotency.key,
          req._idempotency.requestHash,
          status,
          JSON.stringify(body),
        ],
      );
    } catch (err) {
      // A DB blip should never prevent the response from being sent;
      // idempotency is best-effort.
      req.log.warn({ err: String(err) }, 'idempotency_persist_failed');
    }

    return payload;
  });
}
