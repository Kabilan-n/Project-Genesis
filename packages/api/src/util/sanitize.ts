/**
 * User-input sanitization for fields that end up inside LLM prompts.
 *
 * Agent `name` and `appearance` are user-controlled and get string-interpolated
 * into every Anthropic prompt this agent appears in (PromptBuilder.formatXxx
 * embeds agent.name verbatim). Without sanitization a malicious user can
 * inject prompt-control sequences ("Ignore previous instructions…"), JSON
 * fences that confuse the parser, or Anthropic-style control tokens.
 *
 * Strategy:
 *  - `name`: tight allowlist of letters, digits, spaces, hyphens, apostrophes
 *    so real names like "O'Brien" / "Anne-Marie" still pass.
 *  - `appearance`: strip newlines, code fences, and common LLM control
 *    tokens; cap length.
 *  - Normalize to NFKC first so visually-identical Unicode lookalikes
 *    can't bypass the allowlist.
 *  - If sanitization changes the input by more than CHANGE_THRESHOLD, the
 *    caller should reject the request rather than silently accept a
 *    heavily-modified string — that's a strong signal of injection intent.
 */

export interface SanitizeResult {
  /** The cleaned string. Always safe to feed into prompts. */
  value: string;
  /** Fraction of characters changed (0 = identical, 1 = entirely replaced). */
  changeRatio: number;
  /** Convenience flag: caller should refuse the input rather than accept it. */
  rejected: boolean;
  /** Human-readable reason when rejected. */
  reason?: string;
}

const NAME_ALLOW = /[^a-zA-Z0-9 \-']/g;
const NAME_MAX_LEN = 40;
const NAME_MIN_LEN = 2;

const APPEARANCE_MAX_LEN = 200;
const CONTROL_TOKEN_PATTERNS = [
  /<\|.*?\|>/g,                   // Anthropic-/OpenAI-style control tokens
  /\[\/?INST\]/gi,                // Llama instruction markers
  /<\/?(?:system|user|assistant)>/gi, // chat-template tags
];

const CHANGE_THRESHOLD = 0.2; // reject if >20% of chars were stripped/modified

/**
 * Normalize the string for comparison purposes: NFKC dropping invisible
 * BiDi controls + zero-width joiners. Used both to compute the change
 * ratio against and as the basis for the cleaned output.
 */
function normalize(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[​-‏‪-‮⁠-⁯]/g, ''); // ZWSP, BiDi, etc.
}

function changeRatio(before: string, after: string): number {
  if (!before.length) return after.length === 0 ? 0 : 1;
  // Cheap proxy: difference in length over the original length. The
  // strict allowlist for `name` makes this a tight upper bound; for
  // `appearance` we additionally check whether any control tokens
  // were stripped (those rejections short-circuit before this point).
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
      value: cleaned,
      changeRatio: 1,
      rejected: true,
      reason: `Name must contain at least ${NAME_MIN_LEN} alphanumeric characters.`,
    };
  }

  // A name with only digits or only punctuation is not a name.
  if (!/[a-zA-Z]/.test(cleaned)) {
    return {
      value: cleaned,
      changeRatio: 1,
      rejected: true,
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

  // Any control-token stripping is treated as an injection attempt
  // regardless of the change ratio — these tokens are diagnostic on
  // their own.
  if (strippedControlToken) {
    return {
      value: cleaned,
      changeRatio: 1,
      rejected: true,
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
