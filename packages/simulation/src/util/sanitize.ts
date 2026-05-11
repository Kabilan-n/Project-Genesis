/**
 * User-input sanitization for fields embedded in LLM prompts.
 *
 * The API does the primary sanitization at the request boundary
 * (see packages/api/src/util/sanitize.ts), but this copy lives in the
 * simulation package as defense-in-depth: any future call site that
 * synthesises agent.name or appearance.description from another source
 * (admin tools, imports, the reproduction engine) can guard the same way.
 *
 * The two copies are intentionally kept byte-for-byte identical. A future
 * shared workspace package can consolidate them.
 */

export interface SanitizeResult {
  value: string;
  changeRatio: number;
  rejected: boolean;
  reason?: string;
}

const NAME_ALLOW = /[^a-zA-Z0-9 \-']/g;
const NAME_MAX_LEN = 40;
const NAME_MIN_LEN = 2;
const APPEARANCE_MAX_LEN = 200;

const CONTROL_TOKEN_PATTERNS = [
  /<\|.*?\|>/g,
  /\[\/?INST\]/gi,
  /<\/?(?:system|user|assistant)>/gi,
];

const CHANGE_THRESHOLD = 0.2;

function normalize(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[​-‏‪-‮⁠-⁯]/g, '');
}

function changeRatio(before: string, after: string): number {
  if (!before.length) return after.length === 0 ? 0 : 1;
  return Math.min(1, Math.abs(before.length - after.length) / before.length);
}

export function sanitizeAgentName(input: string): SanitizeResult {
  const normalized = normalize(input);
  const cleaned = normalized
    .replace(NAME_ALLOW, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX_LEN);

  if (cleaned.length < NAME_MIN_LEN) {
    return {
      value: cleaned, changeRatio: 1, rejected: true,
      reason: `Name must contain at least ${NAME_MIN_LEN} alphanumeric characters.`,
    };
  }
  if (!/[a-zA-Z]/.test(cleaned)) {
    return {
      value: cleaned, changeRatio: 1, rejected: true,
      reason: 'Name must contain at least one letter.',
    };
  }

  const ratio = changeRatio(input, cleaned);
  return {
    value: cleaned,
    changeRatio: ratio,
    rejected: ratio > CHANGE_THRESHOLD,
    reason: ratio > CHANGE_THRESHOLD
      ? 'Name contained too many disallowed characters.'
      : undefined,
  };
}

export function sanitizeAppearance(input: string): SanitizeResult {
  const normalized = normalize(input);
  let cleaned = normalized
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/```/g, '');
  let strippedControlToken = false;
  for (const pattern of CONTROL_TOKEN_PATTERNS) {
    if (pattern.test(cleaned)) {
      strippedControlToken = true;
      cleaned = cleaned.replace(pattern, '');
    }
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim().slice(0, APPEARANCE_MAX_LEN);

  if (strippedControlToken) {
    return {
      value: cleaned, changeRatio: 1, rejected: true,
      reason: 'Appearance contained LLM control tokens.',
    };
  }

  const ratio = changeRatio(input, cleaned);
  return {
    value: cleaned,
    changeRatio: ratio,
    rejected: ratio > CHANGE_THRESHOLD,
    reason: ratio > CHANGE_THRESHOLD
      ? 'Appearance was modified too heavily; please rephrase.'
      : undefined,
  };
}
