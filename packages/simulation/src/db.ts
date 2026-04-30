import { Pool, type PoolClient } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: unknown[]): Promise<void> {
  await getPool().query(sql, params);
}

/**
 * Transaction client passed into the body of `withTransaction`.
 * Same shape as the module-level helpers but bound to a single connection
 * inside a BEGIN/COMMIT block.
 */
export interface TransactionClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

function bindClient(client: PoolClient): TransactionClient {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const r = await client.query(sql, params);
      return r.rows as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const r = await client.query(sql, params);
      return (r.rows[0] as T | undefined) ?? null;
    },
    async execute(sql: string, params?: unknown[]): Promise<void> {
      await client.query(sql, params);
    },
  };
}

/**
 * Run `fn` inside a Postgres transaction. Commits on resolution, rolls
 * back on rejection. The connection is released back to the pool either
 * way. Pass the resulting `TransactionClient` to engine methods that
 * need to participate in the same transaction.
 *
 * Multi-table operations that are corruption-prone on partial failure
 * (trade execution, exile + group changes, raid + casualty + loot)
 * should always be wrapped in this.
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(bindClient(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback failed after error:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` while holding a Postgres advisory lock. Used to serialise
 * cross-process critical sections like world seeding and migration
 * runs. The lock is automatically released when the connection
 * returns to the pool (we issue an explicit unlock for symmetry).
 *
 * `lockKey` must fit in a bigint (Postgres advisory keys are int8).
 */
export async function withAdvisoryLock<T>(
  lockKey: bigint | number,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockKey.toString()]);
    return await fn();
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey.toString()]);
    } catch (err) {
      console.error('[db] advisory unlock failed:', err);
    }
    client.release();
  }
}
