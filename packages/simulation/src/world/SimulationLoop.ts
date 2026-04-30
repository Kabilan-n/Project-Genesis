/**
 * Tick-lock helpers for the simulation main loop.
 *
 * The current process model already serialises ticks within itself — each
 * iteration awaits the previous one. The lock here is for cross-process
 * safety: a second simulation process pointed at the same world must not
 * tick alongside the first. Without this, two processes both writing to
 * `agents.agent_state` produce lost writes, phantom moves, and duplicate
 * memory rows.
 *
 * Lock semantics:
 *   key  — `tick-lock:<worldId>` (per-world, not global)
 *   TTL  — 30 seconds (auto-releases on process death)
 *   mode — Redis SET NX EX
 *
 * If the lock is held, the new tick is skipped and a metrics counter
 * (`ticks_skipped`) is incremented; the loop just tries again next interval.
 * If Redis is unreachable, the tick is skipped (do NOT run unlocked) and an
 * error is logged.
 */
import type { Redis } from 'ioredis';
import { metrics } from '../observability/metrics.js';

export const LOCK_TTL_SECONDS = 30;

export function tickLockKey(worldId: string): string {
  return `tick-lock:${worldId}`;
}

export async function acquireTickLock(redis: Redis, worldId: string): Promise<boolean> {
  const result = await redis.set(tickLockKey(worldId), '1', 'EX', LOCK_TTL_SECONDS, 'NX');
  return result === 'OK';
}

export async function releaseTickLock(redis: Redis, worldId: string): Promise<void> {
  await redis.del(tickLockKey(worldId));
}

export interface RunTickResult {
  executed: boolean;
  durationMs: number;
}

/**
 * Wrap a single tick execution in lock acquire/release.
 * Returns `executed: false` if the lock was already held.
 * If the body throws, the lock is still released (finally).
 */
export async function runTickWithLock(
  redis: Redis,
  worldId: string,
  body: () => Promise<void>,
): Promise<RunTickResult> {
  const start = Date.now();
  let acquired: boolean;

  try {
    acquired = await acquireTickLock(redis, worldId);
  } catch (err) {
    // Redis is unreachable — do NOT run unlocked.
    metrics.ticksSkipped.inc({ reason: 'redis_error', worldId });
    console.error('[SimulationLoop] tick_lock_redis_error', err);
    return { executed: false, durationMs: Date.now() - start };
  }

  if (!acquired) {
    metrics.ticksSkipped.inc({ reason: 'lock_held', worldId });
    console.warn('[SimulationLoop] tick_skipped_lock_held', { worldId });
    return { executed: false, durationMs: Date.now() - start };
  }

  try {
    await body();
    return { executed: true, durationMs: Date.now() - start };
  } finally {
    try {
      await releaseTickLock(redis, worldId);
    } catch (err) {
      console.error('[SimulationLoop] tick_lock_release_error', err);
    }
  }
}
