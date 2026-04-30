/**
 * Tests for the tick-lock helpers in SimulationLoop.
 *
 * Redis is fully mocked; we assert the SET NX EX call shape and the
 * lock-skipped vs lock-acquired paths in runTickWithLock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  acquireTickLock, releaseTickLock, runTickWithLock,
  tickLockKey, LOCK_TTL_SECONDS,
} from '../world/SimulationLoop.js';
import { metrics } from '../observability/metrics.js';

function makeRedis(setReturn: 'OK' | null) {
  return {
    set: vi.fn().mockResolvedValue(setReturn),
    del: vi.fn().mockResolvedValue(1),
  } as any;
}

beforeEach(() => {
  metrics.ticksSkipped.reset();
});

describe('SimulationLoop.tickLockKey', () => {
  it('namespaces by world_id', () => {
    expect(tickLockKey('w-1')).toBe('tick-lock:w-1');
  });
});

describe('SimulationLoop.acquireTickLock / releaseTickLock', () => {
  it('SET NX EX with the configured TTL', async () => {
    const redis = makeRedis('OK');
    const acquired = await acquireTickLock(redis, 'w-1');
    expect(acquired).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'tick-lock:w-1', '1', 'EX', LOCK_TTL_SECONDS, 'NX',
    );
  });

  it('returns false when SET NX returns null (lock already held)', async () => {
    const redis = makeRedis(null);
    const acquired = await acquireTickLock(redis, 'w-1');
    expect(acquired).toBe(false);
  });

  it('release uses DEL on the same key', async () => {
    const redis = makeRedis('OK');
    await releaseTickLock(redis, 'w-1');
    expect(redis.del).toHaveBeenCalledWith('tick-lock:w-1');
  });
});

describe('SimulationLoop.runTickWithLock', () => {
  it('runs body and reports executed=true when lock is acquired', async () => {
    const redis = makeRedis('OK');
    const body = vi.fn().mockResolvedValue(undefined);
    const result = await runTickWithLock(redis, 'w-1', body);
    expect(body).toHaveBeenCalledOnce();
    expect(result.executed).toBe(true);
    expect(redis.del).toHaveBeenCalledOnce(); // lock released
    expect(metrics.ticksSkipped.total()).toBe(0);
  });

  it('skips body and increments ticks_skipped when lock is held', async () => {
    const redis = makeRedis(null);
    const body = vi.fn().mockResolvedValue(undefined);
    const result = await runTickWithLock(redis, 'w-1', body);
    expect(body).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(metrics.ticksSkipped.get({ reason: 'lock_held', worldId: 'w-1' })).toBe(1);
  });

  it('skips body and increments ticks_skipped when Redis is unreachable', async () => {
    const redis = {
      set: vi.fn().mockRejectedValue(new Error('econnrefused')),
      del: vi.fn().mockResolvedValue(1),
    } as any;
    const body = vi.fn().mockResolvedValue(undefined);
    const result = await runTickWithLock(redis, 'w-1', body);
    expect(body).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(metrics.ticksSkipped.get({ reason: 'redis_error', worldId: 'w-1' })).toBe(1);
    expect(redis.del).not.toHaveBeenCalled(); // never acquired, never release
  });

  it('releases the lock even if the body throws', async () => {
    const redis = makeRedis('OK');
    const body = vi.fn().mockRejectedValue(new Error('agent crashed'));
    await expect(runTickWithLock(redis, 'w-1', body)).rejects.toThrow('agent crashed');
    expect(redis.del).toHaveBeenCalledWith('tick-lock:w-1');
  });
});
