/**
 * Resolves the active WORLD_ID for a fresh install.
 *
 * Priority:
 *   1. `process.env.WORLD_ID` (operator-set, takes precedence)
 *   2. The `.genesis-world-id` file at the repo root, written by
 *      `npm run db:seed` (stabilization Task 8.4).
 *   3. Empty string — caller is responsible for handling unset state.
 *
 * The file path is gitignored. Multiple worlds aren't yet supported,
 * so the most-recent seed wins.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let cached: string | null = null;

export function resolveWorldId(): string {
  if (cached !== null) return cached;

  const fromEnv = process.env.WORLD_ID;
  if (fromEnv && fromEnv.length > 0) {
    cached = fromEnv;
    return cached;
  }

  // packages/simulation/src/util → repo root is ../../../..
  const candidate = join(__dirname, '..', '..', '..', '..', '.genesis-world-id');
  if (existsSync(candidate)) {
    try {
      const fromFile = readFileSync(candidate, 'utf8').trim();
      if (fromFile.length > 0) {
        cached = fromFile;
        return cached;
      }
    } catch {
      // Fall through to empty string
    }
  }

  cached = '';
  return cached;
}

/** Reset the cache — exported so tests can stub. */
export function _resetWorldIdCache(): void {
  cached = null;
}
