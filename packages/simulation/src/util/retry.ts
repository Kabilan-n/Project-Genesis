/**
 * Simple async retry with exponential backoff.
 *
 * No dependencies; designed for transient I/O failures (Postgres connection
 * resets, transient network blips). Errors thrown by `fn` are retried up to
 * `attempts` times. After the final attempt, the last error is rethrown.
 *
 * Backoff:
 *   delay(n) = min(maxDelayMs, baseDelayMs * 2^(n-1))
 * with optional jitter.
 */
export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitter?: boolean;
  onRetry?: (err: unknown, attempt: number) => void;
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const maxDelay = opts.maxDelayMs ?? 1000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.attempts) break;

      let delay = Math.min(maxDelay, opts.baseDelayMs * 2 ** (attempt - 1));
      if (opts.jitter) delay = Math.floor(delay * (0.5 + Math.random()));

      opts.onRetry?.(err, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}
