/**
 * Tests for TradeEngine pure-logic helpers:
 *   - createRecord (constructs a TradeRecord without DB)
 *   - validateInventory logic (simulated)
 *   - transferItems logic (simulated)
 *   - executeTrade with mocked DB + Claude
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradeEngine } from '../social/TradeEngine.js';
import { makeAgent, makeAgentB, makeTradeOffer, AGENT_ID_A, AGENT_ID_B, WORLD_ID } from './fixtures.js';

// Bypass the real Postgres pool: trade settlement routes through
// withTransaction, which would otherwise try to connect.
vi.mock('../db.js', async (orig) => {
  const actual = await orig<typeof import('../db.js')>();
  return {
    ...actual,
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
        queryOne: vi.fn().mockResolvedValue(null),
      };
      return fn(tx);
    },
    execute: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
  };
});

// ─── Expose private helpers ─────────────────────────────────────────────────

class TestableTradeEngine extends TradeEngine {
  constructor() { super(); }

  createRecordPublic(...args: Parameters<any>) {
    return (this as any).createRecord(...args);
  }
}

// ─── createRecord ────────────────────────────────────────────────────────────

describe('TradeEngine.createRecord', () => {
  const engine = new TestableTradeEngine();
  const offerer  = makeAgent();
  const receiver = makeAgentB();
  const offer    = makeTradeOffer();

  it('sets correct world_id, tick, day', () => {
    const rec = engine.createRecordPublic(offerer, receiver, offer, 200, 2, 'rejected', 'no items');
    expect(rec.world_id).toBe(WORLD_ID);
    expect(rec.tick).toBe(200);
    expect(rec.day).toBe(2);
  });

  it('sets correct agent IDs', () => {
    const rec = engine.createRecordPublic(offerer, receiver, offer, 1, 1, 'rejected', 'reason');
    expect(rec.offerer_agent_id).toBe(AGENT_ID_A);
    expect(rec.receiver_agent_id).toBe(AGENT_ID_B);
  });

  it('copies offered and requested items verbatim', () => {
    const rec = engine.createRecordPublic(offerer, receiver, offer, 1, 1, 'pending', '');
    expect(rec.offered_items).toEqual(offer.offered_items);
    expect(rec.requested_items).toEqual(offer.requested_items);
  });

  it('stores provided status', () => {
    const accepted = engine.createRecordPublic(offerer, receiver, offer, 1, 1, 'accepted', 'ok');
    expect(accepted.status).toBe('accepted');
    const rejected = engine.createRecordPublic(offerer, receiver, offer, 1, 1, 'rejected', 'no');
    expect(rejected.status).toBe('rejected');
  });

  it('stores outcome_reason', () => {
    const rec = engine.createRecordPublic(offerer, receiver, offer, 1, 1, 'rejected', 'Offerer lacks items');
    expect(rec.outcome_reason).toBe('Offerer lacks items');
  });
});

// ─── executeTrade with mocked dependencies ──────────────────────────────────

describe('TradeEngine.executeTrade — mocked DB and Claude', () => {
  let engine: TradeEngine;

  beforeEach(() => {
    vi.resetModules();
    engine = new TradeEngine();
  });

  it('rejects immediately when offerer lacks items (validateInventory returns false)', async () => {
    // Mock validateInventory to say offerer has nothing
    (engine as any).validateInventory = vi.fn().mockResolvedValue(false);
    (engine as any).persist = vi.fn().mockImplementation((t: any) => Promise.resolve({ ...t, trade_id: 'mock-id' }));
    (engine as any).relEngine = { applyTradeChanges: vi.fn().mockResolvedValue(undefined) };

    const trade = await engine.executeTrade(
      makeAgent(), makeAgentB(), makeTradeOffer(), 100, 1
    );

    expect(trade.status).toBe('rejected');
    expect(trade.outcome_reason).toContain('lacks items');
  });

  it('returns accepted trade when receiver Claude says accept and both have items', async () => {
    (engine as any).validateInventory = vi.fn().mockResolvedValue(true);
    (engine as any).getInventory = vi.fn().mockResolvedValue([{ resource_type: 'water', amount: 20 }]);
    (engine as any).getRelationship = vi.fn().mockResolvedValue(null);
    (engine as any).llm = {
      getTradeResponse: vi.fn().mockResolvedValue({ decision: 'accept', thought: 'Good deal', reason: 'I need food' }),
    };
    (engine as any).promptBuilder = { buildTradeDecisionPrompt: vi.fn().mockReturnValue('prompt') };
    (engine as any).transferItemsTx = vi.fn().mockResolvedValue(undefined);
    (engine as any).persist = vi.fn().mockImplementation((t: any) => Promise.resolve({ ...t, trade_id: 'mock-id' }));
    (engine as any).relEngine = { applyTradeChanges: vi.fn().mockResolvedValue(undefined) };

    const trade = await engine.executeTrade(
      makeAgent(), makeAgentB(), makeTradeOffer(), 100, 1
    );

    expect(trade.status).toBe('accepted');
    expect((engine as any).transferItemsTx).toHaveBeenCalledTimes(2); // both directions
  });

  it('returns rejected trade when Claude says reject', async () => {
    (engine as any).validateInventory = vi.fn().mockResolvedValue(true);
    (engine as any).getInventory = vi.fn().mockResolvedValue([]);
    (engine as any).getRelationship = vi.fn().mockResolvedValue(null);
    (engine as any).llm = {
      getTradeResponse: vi.fn().mockResolvedValue({ decision: 'reject', thought: 'No thanks', reason: 'Not worth it' }),
    };
    (engine as any).promptBuilder = { buildTradeDecisionPrompt: vi.fn().mockReturnValue('prompt') };
    (engine as any).persist = vi.fn().mockImplementation((t: any) => Promise.resolve({ ...t, trade_id: 'mock-id' }));
    (engine as any).relEngine = { applyTradeChanges: vi.fn().mockResolvedValue(undefined) };

    const trade = await engine.executeTrade(
      makeAgent(), makeAgentB(), makeTradeOffer(), 100, 1
    );

    expect(trade.status).toBe('rejected');
    expect(trade.outcome_reason).toBe('Not worth it');
  });

  it('handles counter-offer and accepts when offerer has counter items', async () => {
    let callCount = 0;
    (engine as any).validateInventory = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(true); // offerer has, receiver has counter items
    });
    (engine as any).getInventory = vi.fn().mockResolvedValue([]);
    (engine as any).getRelationship = vi.fn().mockResolvedValue(null);
    (engine as any).llm = {
      getTradeResponse: vi.fn().mockResolvedValue({
        decision: 'counter',
        thought: 'I want less',
        reason: 'Reduce ask',
        counter_offer: {
          offered_items: { food: 8 },
          requested_items: { water: 3 },
        },
      }),
    };
    (engine as any).promptBuilder = { buildTradeDecisionPrompt: vi.fn().mockReturnValue('prompt') };
    (engine as any).transferItemsTx = vi.fn().mockResolvedValue(undefined);
    (engine as any).persist = vi.fn().mockImplementation((t: any) => Promise.resolve({ ...t, trade_id: 'mock-id' }));
    (engine as any).relEngine = { applyTradeChanges: vi.fn().mockResolvedValue(undefined) };

    const trade = await engine.executeTrade(
      makeAgent(), makeAgentB(), makeTradeOffer(), 100, 1
    );

    // Should auto-accept the counter
    expect(trade.status).toBe('accepted');
    expect(trade.outcome_reason).toContain('Counter accepted');
  });

  it('records countered status when offerer lacks counter items', async () => {
    // First call: offerer has original items. Subsequent calls: offerer lacks counter items.
    let callCount = 0;
    (engine as any).validateInventory = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(true);  // offerer has offered items
      return Promise.resolve(false);                       // offerer lacks counter items
    });
    (engine as any).getInventory = vi.fn().mockResolvedValue([]);
    (engine as any).getRelationship = vi.fn().mockResolvedValue(null);
    (engine as any).llm = {
      getTradeResponse: vi.fn().mockResolvedValue({
        decision: 'counter',
        thought: 'I want less',
        reason: 'Adjust',
        counter_offer: { offered_items: { food: 5 }, requested_items: { water: 2 } },
      }),
    };
    (engine as any).promptBuilder = { buildTradeDecisionPrompt: vi.fn().mockReturnValue('prompt') };
    (engine as any).persist = vi.fn().mockImplementation((t: any) => Promise.resolve({ ...t, trade_id: 'mock-id' }));
    (engine as any).relEngine = { applyTradeChanges: vi.fn().mockResolvedValue(undefined) };

    const trade = await engine.executeTrade(
      makeAgent(), makeAgentB(), makeTradeOffer(), 100, 1
    );

    expect(trade.status).toBe('countered');
  });

  it('calls relEngine.applyTradeChanges after a persisted trade (not on early-return)', async () => {
    // When offerer HAS items, the trade flows through persist → applyTradeChanges
    (engine as any).validateInventory = vi.fn().mockResolvedValue(true);
    (engine as any).getInventory = vi.fn().mockResolvedValue([]);
    (engine as any).getRelationship = vi.fn().mockResolvedValue(null);
    (engine as any).llm = {
      getTradeResponse: vi.fn().mockResolvedValue({ decision: 'reject', thought: 'no', reason: 'nope' }),
    };
    (engine as any).promptBuilder = { buildTradeDecisionPrompt: vi.fn().mockReturnValue('prompt') };
    const applyTradeChanges = vi.fn().mockResolvedValue(undefined);
    (engine as any).persist = vi.fn().mockImplementation((t: any) => Promise.resolve({ ...t, trade_id: 'mock-id' }));
    (engine as any).relEngine = { applyTradeChanges };

    await engine.executeTrade(makeAgent(), makeAgentB(), makeTradeOffer(), 100, 1);

    expect(applyTradeChanges).toHaveBeenCalledOnce();
  });

  it('does NOT call relEngine when offerer lacks items (early return path)', async () => {
    (engine as any).validateInventory = vi.fn().mockResolvedValue(false);
    const applyTradeChanges = vi.fn().mockResolvedValue(undefined);
    (engine as any).relEngine = { applyTradeChanges };

    await engine.executeTrade(makeAgent(), makeAgentB(), makeTradeOffer(), 100, 1);

    expect(applyTradeChanges).not.toHaveBeenCalled();
  });
});
