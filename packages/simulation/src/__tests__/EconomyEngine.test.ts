/**
 * Tests for EconomyEngine.
 *
 * The engine is almost entirely DB orchestration. The most testable behaviors
 * are the early-exit guards on createCurrency / listItem / buyFromMarket.
 * We mock the db module to assert the outcome of each guard branch.
 */
import { describe, it, expect, vi } from 'vitest';
import { EconomyEngine } from '../civilisation/EconomyEngine.js';
import { makeAgent } from './fixtures.js';

describe('EconomyEngine.createCurrency — uniqueness per group', () => {
  it('returns null when the group already has a currency', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ currency_id: 'existing' } as any);
    const eng = new EconomyEngine();
    const result = await eng.createCurrency(
      makeAgent({ group_id: 'g-1' }), 'Coin', 'CN', 'world-1', 100,
    );
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });
});

describe('EconomyEngine.listItem — inventory verification', () => {
  it('returns null when seller has insufficient inventory', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ amount: 5 } as any); // only 5 in inventory
    const eng = new EconomyEngine();
    const result = await eng.listItem(
      makeAgent(), 'mkt-1', 'food', /* quantity */ 10, /* price */ 2, 'cur-1', 100,
    );
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });

  it('returns null when seller has no inventory row at all', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce(null as any);
    const eng = new EconomyEngine();
    const result = await eng.listItem(
      makeAgent(), 'mkt-1', 'wood', 5, 1, 'cur-1', 100,
    );
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });
});

describe('EconomyEngine.buyFromMarket — funds and quantity guards', () => {
  it('returns null when listing does not exist', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce(null as any);
    const eng = new EconomyEngine();
    const result = await eng.buyFromMarket(makeAgent(), 'listing-x', 1, 'world-1', 100, 1);
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });

  it('returns null when buyer cannot afford the listing', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      // 1st call: the listing
      .mockResolvedValueOnce({
        listing_id: 'l-1', seller_id: 's-1', resource_type: 'food',
        quantity: 10, price_per_unit: 5, currency_id: 'cur-1',
        market_id: 'mkt-1', is_active: true,
      } as any)
      // 2nd call: getBalance returns insufficient
      .mockResolvedValueOnce({ balance: 1 } as any);
    const eng = new EconomyEngine();
    const result = await eng.buyFromMarket(makeAgent(), 'l-1', 5, 'world-1', 100, 1);
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });

  it('returns null when requested quantity exceeds listing', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({
        listing_id: 'l-1', seller_id: 's-1', resource_type: 'food',
        quantity: 5, price_per_unit: 1, currency_id: 'cur-1',
        market_id: 'mkt-1', is_active: true,
      } as any);
    const eng = new EconomyEngine();
    const result = await eng.buyFromMarket(makeAgent(), 'l-1', /* over */ 10, 'world-1', 100, 1);
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });
});

describe('EconomyEngine.discoverPrice — minimum-volume threshold', () => {
  it('returns null when fewer than 3 units have been traded', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ avg_price: 5, volume: 2 } as any);
    const eng = new EconomyEngine();
    expect(await eng.discoverPrice('world-1', 'food')).toBeNull();
    queryOneSpy.mockRestore();
  });

  it('rounds the discovered price to an integer', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ avg_price: 5.7, volume: 12 } as any);
    const eng = new EconomyEngine();
    expect(await eng.discoverPrice('world-1', 'food')).toBe(6);
    queryOneSpy.mockRestore();
  });
});
