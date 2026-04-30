/**
 * Circuit-breaker shared config for LLM providers.
 *
 * Without a breaker, an LLM provider outage produces a stampede of
 * timing-out requests — every agent's tick hangs for the full timeout
 * before falling back. The breaker short-circuits to the fallback after a
 * threshold of failures is observed, so the simulation keeps progressing
 * even when Claude (or OpenAI, or Ollama) is unreachable.
 *
 * Lifecycle:
 *   closed    — normal operation; failures count toward the threshold.
 *   open      — fallback returned immediately; one timer wait then half-open.
 *   half-open — a single probe is allowed; success closes, failure re-opens.
 *
 * Each provider gets its OWN breaker so a Claude outage doesn't poison
 * the OpenAI fallback (and vice versa).
 */
import CircuitBreaker from 'opossum';
import { metrics } from '../observability/metrics.js';
import { engineLogger } from '../observability/logger.js';

const log = engineLogger('breaker');

export const BREAKER_OPTIONS: CircuitBreaker.Options = {
  timeout: 15_000,                // 15s per request
  errorThresholdPercentage: 50,   // open when 50% of recent calls fail
  resetTimeout: 30_000,           // 30s before half-open probe
  volumeThreshold: 5,             // need 5 calls before threshold applies
  rollingCountTimeout: 30_000,    // window the threshold is computed over
};

export interface BreakerEvents {
  /** label identifying the provider, e.g. 'anthropic' / 'openai' */
  label: string;
}

export function attachBreakerEvents<TArgs extends unknown[], TResult>(
  breaker: CircuitBreaker<TArgs, TResult>,
  events: BreakerEvents,
): void {
  breaker.on('open', () => {
    metrics.llmCircuitOpens.inc({ provider: events.label });
    log.error({ provider: events.label }, 'llm_circuit_opened');
  });
  breaker.on('halfOpen', () => {
    log.warn({ provider: events.label }, 'llm_circuit_halfopen');
  });
  breaker.on('close', () => {
    log.info({ provider: events.label }, 'llm_circuit_closed');
  });
  breaker.on('reject', () => {
    metrics.llmCircuitRejected.inc({ provider: events.label });
  });
}
