/**
 * Tests for the LLM circuit breaker.
 *
 * Uses opossum directly with the project's BREAKER_OPTIONS (overridden
 * to small thresholds for fast tests) to verify the closed → open →
 * half-open → closed lifecycle.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import CircuitBreaker from 'opossum';
import { attachBreakerEvents } from '../llm/breaker.js';
import { metrics } from '../observability/metrics.js';

afterEach(() => {
  metrics.llmCircuitOpens.reset();
  metrics.llmCircuitRejected.reset();
});

function makeBreaker(failingFn: () => Promise<string>, overrides: any = {}) {
  return new CircuitBreaker(failingFn, {
    timeout: 200,
    errorThresholdPercentage: 50,
    resetTimeout: 100,
    volumeThreshold: 2,
    rollingCountTimeout: 1000,
    ...overrides,
  });
}

describe('LLM circuit breaker', () => {
  it('opens after enough failures cross the threshold', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const breaker = makeBreaker(fn);
    attachBreakerEvents(breaker, { label: 'test' });

    for (let i = 0; i < 5; i++) {
      try { await breaker.fire(); } catch { /* expected */ }
    }
    expect(breaker.opened).toBe(true);
    expect(metrics.llmCircuitOpens.get({ provider: 'test' })).toBeGreaterThan(0);
  });

  it('rejects calls without invoking the function while open', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const breaker = makeBreaker(fn);
    attachBreakerEvents(breaker, { label: 'test' });

    for (let i = 0; i < 5; i++) {
      try { await breaker.fire(); } catch { /* expected */ }
    }
    fn.mockClear();

    // Subsequent calls while open should reject without calling fn.
    try { await breaker.fire(); } catch { /* expected */ }
    expect(fn).not.toHaveBeenCalled();
    expect(metrics.llmCircuitRejected.get({ provider: 'test' })).toBeGreaterThan(0);
  });

  it('returns the fallback value when one is registered and breaker is open', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const breaker = makeBreaker(fn);
    breaker.fallback(() => 'fallback-value');
    attachBreakerEvents(breaker, { label: 'test' });

    for (let i = 0; i < 5; i++) {
      try { await breaker.fire(); } catch { /* expected */ }
    }
    const result = await breaker.fire();
    expect(result).toBe('fallback-value');
  });

  it('moves to half-open after resetTimeout and closes on a successful probe', async () => {
    let shouldFail = true;
    const fn = vi.fn().mockImplementation(async () => {
      if (shouldFail) throw new Error('boom');
      return 'ok';
    });
    const breaker = makeBreaker(fn, { resetTimeout: 50 });
    attachBreakerEvents(breaker, { label: 'test' });

    for (let i = 0; i < 5; i++) {
      try { await breaker.fire(); } catch { /* expected */ }
    }
    expect(breaker.opened).toBe(true);

    shouldFail = false;
    // Wait for resetTimeout to elapse
    await new Promise((r) => setTimeout(r, 80));

    const result = await breaker.fire();
    expect(result).toBe('ok');
    expect(breaker.closed).toBe(true);
  });
});
