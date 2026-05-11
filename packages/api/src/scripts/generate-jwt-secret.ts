/**
 * Generates a strong JWT signing secret. Output is base64-encoded so it's
 * safe to paste into .env without escaping. 48 random bytes → 64 base64
 * chars, well above the 32-char production minimum enforced in index.ts.
 *
 * Usage: `npm run generate:jwt-secret` (script defined in packages/api/package.json).
 */
import { randomBytes } from 'crypto';

const secret = randomBytes(48).toString('base64');
process.stdout.write(secret + '\n');
