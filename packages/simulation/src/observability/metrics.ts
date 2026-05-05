/**
 * Tiny in-process metrics registry.
 *
 * Just enough to expose parse-failure counters and similar signals for tests
 * and ad-hoc inspection. Phase 4 task 4.1 will wire a circuit breaker that
 * reads these. Phase 8 task 8.* may swap this for Prometheus client; the
 * surface is deliberately minimal so a swap is mechanical.
 */

type Labels = Record<string, string>;

class Counter {
  private values = new Map<string, number>();
  constructor(public readonly name: string) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = serialize(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  get(labels: Labels = {}): number {
    return this.values.get(serialize(labels)) ?? 0;
  }

  reset(): void {
    this.values.clear();
  }

  total(): number {
    let n = 0;
    for (const v of this.values.values()) n += v;
    return n;
  }
}

function serialize(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join('|');
}

export const metrics = {
  llmParseFailures:   new Counter('llm_parse_failures'),
  llmCallErrors:      new Counter('llm_call_errors'),
  llmCircuitOpens:    new Counter('llm_circuit_opens'),
  llmCircuitRejected: new Counter('llm_circuit_rejected'),
  ticksSkipped:       new Counter('ticks_skipped'),
};

export type MetricsRegistry = typeof metrics;
