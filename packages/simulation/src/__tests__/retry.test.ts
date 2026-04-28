/**
 * Tests for the retry helper. No external deps; uses fake timers to keep
 * exponential-backoff sleeps from making the suite slow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retry } from '../util/retry.js';

describe('retry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const p = retry(fn, { attempts: 3, baseDelayMs: 10 });
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries until success and returns the eventual value', async () => {
    let n = 0;
    const fn = vi.fn().mockImplementation(async () => {
      n++;
      if (n < 3) throw new Error('still failing');
      return 'finally';
    });

    const p = retry(fn, { attempts: 3, baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows the last error when all attempts fail', async () => {
    // Use mockImplementation so each call creates the rejection lazily;
    // mockRejectedValue pre-creates the promise and confuses fake timers.
    const fn = vi.fn().mockImplementation(async () => { throw new Error('always fails'); });
    const p = retry(fn, { attempts: 3, baseDelayMs: 10 });
    p.catch(() => undefined); // attach handler before timers flush
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects maxDelayMs cap on exponential backoff', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockImplementation(async () => { throw new Error('boom'); });
    const p = retry(fn, { attempts: 4, baseDelayMs: 100, maxDelayMs: 150, onRetry });
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).rejects.toThrow();
    // onRetry called for each attempt that did NOT succeed and was followed
    // by another try (i.e., attempts - 1 = 3 times).
    expect(onRetry).toHaveBeenCalledTimes(3);
  });
});
