/**
 * Tests for the transaction and advisory-lock helpers.
 *
 * The pg pool is replaced via vi.mock('pg') with a fake whose `connect()`
 * returns a recording client. This avoids the real PG connection while
 * keeping db.ts unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ sql: string; params?: unknown[] }> = [];
let nextRows: any[] = [{ ok: true }];
let releaseSpy = vi.fn();

vi.mock('pg', () => {
  class Pool {
    async connect() {
      return {
        query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
          calls.push({ sql, params });
          // BEGIN/COMMIT/ROLLBACK return empty; body queries return nextRows.
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [] };
          }
          if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
            return { rows: [] };
          }
          return { rows: nextRows };
        }),
        release: releaseSpy,
      };
    }
    query() {
      return Promise.resolve({ rows: nextRows });
    }
  }
  return { Pool };
});

beforeEach(() => {
  calls.length = 0;
  nextRows = [{ ok: true }];
  releaseSpy = vi.fn();
});

// IMPORTANT: import after vi.mock setup
import { withTransaction, withAdvisoryLock } from '../db.js';

describe('withTransaction', () => {
  it('issues BEGIN/COMMIT around the body and releases the connection', async () => {
    await withTransaction(async (tx) => {
      await tx.execute('UPDATE foo SET bar = 1');
    });
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(sqls).toContain('UPDATE foo SET bar = 1');
    expect(releaseSpy).toHaveBeenCalledOnce();
  });

  it('rolls back when the body throws and rethrows the error', async () => {
    await expect(
      withTransaction(async (tx) => {
        await tx.execute('INSERT INTO bar VALUES (1)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const sqls = calls.map((c) => c.sql);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(releaseSpy).toHaveBeenCalledOnce();
  });

  it('exposes query / queryOne / execute on the tx client', async () => {
    nextRows = [{ ok: true }];
    await withTransaction(async (tx) => {
      const rows = await tx.query<{ ok: boolean }>('SELECT * FROM foo');
      expect(rows[0]).toEqual({ ok: true });
      const row = await tx.queryOne<{ ok: boolean }>('SELECT * FROM foo');
      expect(row).toEqual({ ok: true });
      await tx.execute('INSERT INTO foo VALUES (1)');
    });
  });

  it('returns null from queryOne when there are no rows', async () => {
    nextRows = [];
    const result = await withTransaction(async (tx) =>
      tx.queryOne<{ id: string }>('SELECT id FROM nope'),
    );
    expect(result).toBeNull();
  });
});

describe('withAdvisoryLock', () => {
  it('acquires and releases the lock with the given key', async () => {
    await withAdvisoryLock(42, async () => 'result');
    const lockCall   = calls.find((c) => c.sql.includes('pg_advisory_lock'));
    const unlockCall = calls.find((c) => c.sql.includes('pg_advisory_unlock'));
    expect(lockCall?.params).toEqual(['42']);
    expect(unlockCall?.params).toEqual(['42']);
    expect(releaseSpy).toHaveBeenCalledOnce();
  });

  it('returns the body result', async () => {
    const result = await withAdvisoryLock(7, async () => ({ done: true }));
    expect(result).toEqual({ done: true });
  });

  it('still unlocks and releases when the body throws', async () => {
    await expect(
      withAdvisoryLock(99, async () => { throw new Error('inner'); }),
    ).rejects.toThrow('inner');
    const sqls = calls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
    expect(releaseSpy).toHaveBeenCalledOnce();
  });

  it('accepts bigint keys', async () => {
    await withAdvisoryLock(1234567890123n, async () => null);
    const lockCall = calls.find((c) => c.sql.includes('pg_advisory_lock'));
    expect(lockCall?.params).toEqual(['1234567890123']);
  });
});
