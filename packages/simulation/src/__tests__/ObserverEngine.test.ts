/**
 * Tests for ObserverEngine.
 *
 * The engine is heavy DB orchestration plus LLM (biographies, narratives).
 * The pure-ish slice is the weather-effect classification table inside
 * triggerWeather: severity scales the multiplier and HP drain. We exercise
 * that math by reading what triggerWeather writes.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObserverEngine } from '../observer/ObserverEngine.js';

const engine = new ObserverEngine();

describe('ObserverEngine.triggerWeather — severity scaling', () => {
  it('drought at severity 1 produces resource_mult ≈ 0.3', async () => {
    let captured: any[] | undefined;
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockImplementation(async (_sql: string, params: any[]) => {
        captured = params;
        return { weather_id: 'w-1' } as any;
      });
    const executeSpy = vi.spyOn(await import('../db.js'), 'execute')
      .mockResolvedValue(undefined as any);

    await engine.triggerWeather('world-1', 'drought', 25, 25, 5, /* severity */ 1, 720, 1000);
    expect(captured?.[8]).toBeCloseTo(0.3, 5);
    expect(captured?.[9]).toBeCloseTo(0.003, 5);

    queryOneSpy.mockRestore();
    executeSpy.mockRestore();
  });

  it('abundance at severity 0.5 produces a multiplier between 1.0 and 2.0', async () => {
    let captured: any[] | undefined;
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockImplementation(async (_sql: string, params: any[]) => {
        captured = params;
        return { weather_id: 'w-2' } as any;
      });
    const executeSpy = vi.spyOn(await import('../db.js'), 'execute')
      .mockResolvedValue(undefined as any);

    await engine.triggerWeather('world-1', 'abundance', 25, 25, 5, /* severity */ 0.5, 720, 1000);
    expect(captured?.[8]).toBeCloseTo(1.5, 5);
    expect(captured?.[9]).toBeCloseTo(0, 5);

    queryOneSpy.mockRestore();
    executeSpy.mockRestore();
  });

  it('storm at severity 0 has no effect (drain rate 0, mult 1)', async () => {
    let captured: any[] | undefined;
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockImplementation(async (_sql: string, params: any[]) => {
        captured = params;
        return { weather_id: 'w-3' } as any;
      });
    const executeSpy = vi.spyOn(await import('../db.js'), 'execute')
      .mockResolvedValue(undefined as any);

    await engine.triggerWeather('world-1', 'storm', 25, 25, 5, /* severity */ 0, 720, 1000);
    expect(captured?.[8]).toBeCloseTo(1.0, 5); // 1 + (0.7-1)*0 = 1
    expect(captured?.[9]).toBeCloseTo(0, 5);   // 0.005 * 0 = 0

    queryOneSpy.mockRestore();
    executeSpy.mockRestore();
  });

  it('blight at severity 1 has the lowest resource_mult of the damaging weathers', async () => {
    let captured: any[] | undefined;
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockImplementation(async (_sql: string, params: any[]) => {
        captured = params;
        return { weather_id: 'w-4' } as any;
      });
    const executeSpy = vi.spyOn(await import('../db.js'), 'execute')
      .mockResolvedValue(undefined as any);

    await engine.triggerWeather('world-1', 'blight', 25, 25, 5, 1, 720, 1000);
    expect(captured?.[8]).toBeCloseTo(0.2, 5);

    queryOneSpy.mockRestore();
    executeSpy.mockRestore();
  });
});
