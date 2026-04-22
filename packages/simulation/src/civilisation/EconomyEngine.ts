import { query, queryOne, execute } from '../db.js';
import type { Agent } from '../types.js';

export interface Currency {
  currency_id: string;
  world_id: string;
  group_id?: string;
  name: string;
  symbol: string;
  total_supply: number;
  created_tick: number;
}

export interface Market {
  market_id: string;
  world_id: string;
  group_id?: string;
  x: number;
  y: number;
  name: string;
  is_open: boolean;
  transaction_count: number;
  created_tick: number;
}

export interface MarketListing {
  listing_id: string;
  market_id: string;
  seller_id: string;
  resource_type: string;
  quantity: number;
  price_per_unit: number;
  currency_id: string;
  listed_tick: number;
  expires_tick?: number;
  is_active: boolean;
}

export interface MarketTransaction {
  tx_id?: string;
  world_id: string;
  market_id: string;
  listing_id?: string;
  buyer_id: string;
  seller_id: string;
  resource_type: string;
  quantity: number;
  price_per_unit: number;
  total_price: number;
  tick: number;
  day: number;
}

// Initial coin supply when a group creates a currency
const INITIAL_SUPPLY_PER_MEMBER = 50;
// Listings expire after 2 days if not bought
const LISTING_EXPIRY_TICKS = 2880;
// Price adjustment factor: each transaction moves market price by this %
const PRICE_DRIFT_FACTOR = 0.02;

/**
 * EconomyEngine — Phase 5 Civilisation
 *
 * Manages the formal economy layer:
 *   - `createCurrency`     — group mints their own currency
 *   - `mintCoins`          — add coins to an agent's wallet
 *   - `createMarket`       — establish a market at a map location
 *   - `listItem`           — agent posts a sell order
 *   - `buyFromMarket`      — agent purchases a listing
 *   - `discoverPrice`      — compute fair market price from recent trades
 *   - `runMarketTick`      — expire stale listings, update price history
 */
export class EconomyEngine {

  // ── Currency ──────────────────────────────────────────────────────────────────

  async createCurrency(
    founder: Agent,
    name: string,
    symbol: string,
    worldId: string,
    tick: number
  ): Promise<Currency | null> {
    // One currency per group max
    if (founder.group_id) {
      const existing = await queryOne<{ currency_id: string }>(
        `SELECT currency_id FROM civilisation.currencies WHERE group_id = $1`,
        [founder.group_id]
      );
      if (existing) return null;
    }

    const currency = await queryOne<Currency>(
      `INSERT INTO civilisation.currencies
         (world_id, group_id, name, symbol, total_supply, created_tick)
       VALUES ($1,$2,$3,$4,0,$5)
       RETURNING *`,
      [worldId, founder.group_id ?? null, name, symbol, tick]
    );
    if (!currency) return null;

    // Mint initial supply for all group members
    if (founder.group_id) {
      const members = await query<{ agent_id: string }>(
        `SELECT agent_id FROM social.group_members WHERE group_id = $1`,
        [founder.group_id]
      );

      const mintAmount = INITIAL_SUPPLY_PER_MEMBER;
      for (const member of members) {
        await this.mintCoins(member.agent_id, currency.currency_id, mintAmount);
      }
      await execute(
        `UPDATE civilisation.currencies SET total_supply = $2 WHERE currency_id = $1`,
        [currency.currency_id, mintAmount * members.length]
      );
    }

    return currency;
  }

  async mintCoins(agentId: string, currencyId: string, amount: number): Promise<void> {
    await execute(
      `INSERT INTO civilisation.wallets (agent_id, currency_id, balance, total_earned)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (agent_id, currency_id)
       DO UPDATE SET
         balance = civilisation.wallets.balance + $3,
         total_earned = civilisation.wallets.total_earned + $3`,
      [agentId, currencyId, amount]
    );
  }

  async getBalance(agentId: string, currencyId: string): Promise<number> {
    const row = await queryOne<{ balance: number }>(
      `SELECT balance FROM civilisation.wallets WHERE agent_id = $1 AND currency_id = $2`,
      [agentId, currencyId]
    );
    return row?.balance ?? 0;
  }

  // ── Markets ───────────────────────────────────────────────────────────────────

  async createMarket(
    founder: Agent,
    x: number,
    y: number,
    name: string,
    worldId: string,
    tick: number
  ): Promise<Market | null> {
    // Can't create a market on water/mountain
    const tile = await queryOne<{ is_passable: boolean }>(
      `SELECT is_passable FROM worlds.map_tiles WHERE world_id = $1 AND x = $2 AND y = $3`,
      [worldId, x, y]
    );
    if (!tile?.is_passable) return null;

    const market = await queryOne<Market>(
      `INSERT INTO civilisation.markets
         (world_id, group_id, x, y, name, created_tick)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [worldId, founder.group_id ?? null, x, y, name, tick]
    );
    return market ?? null;
  }

  // ── Listings ──────────────────────────────────────────────────────────────────

  async listItem(
    seller: Agent,
    marketId: string,
    resourceType: string,
    quantity: number,
    pricePerUnit: number,
    currencyId: string,
    tick: number
  ): Promise<MarketListing | null> {
    // Verify seller has enough of the resource
    const inv = await queryOne<{ amount: number }>(
      `SELECT amount FROM economy.inventory WHERE agent_id = $1 AND resource_type = $2`,
      [seller.agent_id, resourceType]
    );
    if (!inv || inv.amount < quantity) return null;

    // Lock the items (deduct from inventory)
    await execute(
      `UPDATE economy.inventory SET amount = amount - $3
       WHERE agent_id = $1 AND resource_type = $2`,
      [seller.agent_id, resourceType, quantity]
    );

    const listing = await queryOne<MarketListing>(
      `INSERT INTO civilisation.market_listings
         (market_id, seller_id, resource_type, quantity, price_per_unit,
          currency_id, listed_tick, expires_tick)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [marketId, seller.agent_id, resourceType, quantity, pricePerUnit,
       currencyId, tick, tick + LISTING_EXPIRY_TICKS]
    );
    return listing ?? null;
  }

  // ── Buying ────────────────────────────────────────────────────────────────────

  async buyFromMarket(
    buyer: Agent,
    listingId: string,
    quantityToBuy: number,
    worldId: string,
    tick: number,
    day: number
  ): Promise<MarketTransaction | null> {
    const listing = await queryOne<MarketListing>(
      `SELECT * FROM civilisation.market_listings
       WHERE listing_id = $1 AND is_active = TRUE`,
      [listingId]
    );
    if (!listing || listing.quantity < quantityToBuy) return null;

    const totalCost = listing.price_per_unit * quantityToBuy;

    // Verify buyer has enough currency
    const buyerBalance = await this.getBalance(buyer.agent_id, listing.currency_id);
    if (buyerBalance < totalCost) return null;

    // Deduct currency from buyer
    await execute(
      `UPDATE civilisation.wallets
       SET balance = balance - $3, total_spent = total_spent + $3
       WHERE agent_id = $1 AND currency_id = $2`,
      [buyer.agent_id, listing.currency_id, totalCost]
    );

    // Credit currency to seller
    await execute(
      `INSERT INTO civilisation.wallets (agent_id, currency_id, balance, total_earned)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (agent_id, currency_id)
       DO UPDATE SET
         balance = civilisation.wallets.balance + $3,
         total_earned = civilisation.wallets.total_earned + $3`,
      [listing.seller_id, listing.currency_id, totalCost]
    );

    // Transfer resource to buyer
    await execute(
      `INSERT INTO economy.inventory (agent_id, resource_type, amount, acquired_method)
       VALUES ($1, $2, $3, 'purchased')
       ON CONFLICT (agent_id, resource_type)
       DO UPDATE SET amount = economy.inventory.amount + $3`,
      [buyer.agent_id, listing.resource_type, quantityToBuy]
    );

    // Update listing quantity
    const newQty = listing.quantity - quantityToBuy;
    if (newQty <= 0) {
      await execute(
        `UPDATE civilisation.market_listings SET is_active = FALSE, quantity = 0 WHERE listing_id = $1`,
        [listingId]
      );
    } else {
      await execute(
        `UPDATE civilisation.market_listings SET quantity = $2 WHERE listing_id = $1`,
        [listingId, newQty]
      );
    }

    // Update transaction count on market
    const market = await queryOne<{ market_id: string }>(
      `SELECT market_id FROM civilisation.market_listings WHERE listing_id = $1`,
      [listingId]
    );
    if (market) {
      await execute(
        `UPDATE civilisation.markets SET transaction_count = transaction_count + 1 WHERE market_id = $1`,
        [market.market_id]
      );
    }

    // Record transaction
    const tx = await queryOne<MarketTransaction>(
      `INSERT INTO civilisation.market_transactions
         (world_id, market_id, listing_id, buyer_id, seller_id,
          resource_type, quantity, price_per_unit, total_price, tick, day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        worldId, listing.market_id, listingId,
        buyer.agent_id, listing.seller_id,
        listing.resource_type, quantityToBuy,
        listing.price_per_unit, totalCost,
        tick, day,
      ]
    );

    return tx ?? null;
  }

  // ── Price discovery ───────────────────────────────────────────────────────────

  /**
   * discoverPrice — returns the current fair market price for a resource
   * based on the weighted average of recent transactions.
   * Returns null if insufficient data (< 3 transactions).
   */
  async discoverPrice(
    worldId: string,
    resourceType: string,
    lookbackDays = 3
  ): Promise<number | null> {
    const row = await queryOne<{ avg_price: number; volume: number }>(
      `SELECT AVG(price_per_unit) AS avg_price, SUM(quantity) AS volume
       FROM civilisation.market_transactions
       WHERE world_id = $1
         AND resource_type = $2
         AND day >= (SELECT MAX(day) FROM civilisation.market_transactions WHERE world_id = $1) - $3`,
      [worldId, resourceType, lookbackDays]
    );
    if (!row || row.volume < 3) return null;
    return Math.round(row.avg_price);
  }

  /**
   * runMarketTick — called once per day.
   * - Expires stale listings (return goods to seller)
   * - Aggregates daily price history
   */
  async runMarketTick(worldId: string, tick: number, day: number): Promise<void> {
    // Return expired listing resources to sellers
    const expired = await query<MarketListing>(
      `UPDATE civilisation.market_listings
       SET is_active = FALSE
       WHERE expires_tick <= $1 AND is_active = TRUE
       RETURNING *`,
      [tick]
    );

    for (const listing of expired) {
      await execute(
        `INSERT INTO economy.inventory (agent_id, resource_type, amount, acquired_method)
         VALUES ($1, $2, $3, 'listing_expired')
         ON CONFLICT (agent_id, resource_type)
         DO UPDATE SET amount = economy.inventory.amount + $3`,
        [listing.seller_id, listing.resource_type, listing.quantity]
      );
    }

    // Update daily price history
    const resources = await query<{ resource_type: string }>(
      `SELECT DISTINCT resource_type FROM civilisation.market_transactions
       WHERE world_id = $1 AND day = $2`,
      [worldId, day]
    );

    for (const r of resources) {
      await execute(
        `INSERT INTO civilisation.price_history (world_id, resource_type, day, avg_price, min_price, max_price, volume)
         SELECT world_id, resource_type, day,
                AVG(price_per_unit), MIN(price_per_unit), MAX(price_per_unit), SUM(quantity)
         FROM civilisation.market_transactions
         WHERE world_id = $1 AND resource_type = $2 AND day = $3
         GROUP BY world_id, resource_type, day
         ON CONFLICT (world_id, resource_type, day) DO UPDATE
           SET avg_price = EXCLUDED.avg_price,
               min_price = EXCLUDED.min_price,
               max_price = EXCLUDED.max_price,
               volume    = EXCLUDED.volume`,
        [worldId, r.resource_type, day]
      );
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────────

  async getNearbyMarkets(worldId: string, x: number, y: number, radius: number): Promise<Market[]> {
    return query<Market>(
      `SELECT * FROM civilisation.markets
       WHERE world_id = $1 AND is_open = TRUE
         AND ABS(x - $2) <= $4 AND ABS(y - $3) <= $4`,
      [worldId, x, y, radius]
    );
  }

  async getMarketListings(marketId: string): Promise<MarketListing[]> {
    return query<MarketListing>(
      `SELECT * FROM civilisation.market_listings
       WHERE market_id = $1 AND is_active = TRUE
       ORDER BY price_per_unit ASC`,
      [marketId]
    );
  }

  async getWorldCurrency(worldId: string, groupId?: string): Promise<Currency | null> {
    if (groupId) {
      return queryOne<Currency>(
        `SELECT * FROM civilisation.currencies WHERE world_id = $1 AND group_id = $2`,
        [worldId, groupId]
      );
    }
    // Fall back to the first world currency
    return queryOne<Currency>(
      `SELECT * FROM civilisation.currencies WHERE world_id = $1 AND group_id IS NULL LIMIT 1`,
      [worldId]
    );
  }

  async getPriceHistory(worldId: string, resourceType: string, days = 30): Promise<Array<{ day: number; avg_price: number; volume: number }>> {
    return query(
      `SELECT day, avg_price, volume FROM civilisation.price_history
       WHERE world_id = $1 AND resource_type = $2
       ORDER BY day DESC LIMIT $3`,
      [worldId, resourceType, days]
    );
  }
}
