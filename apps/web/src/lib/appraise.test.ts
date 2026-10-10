import { describe, expect, it } from 'vitest';
import { SalePageSchema } from '@embers/ledger';
import type { Sale } from '@embers/ledger';

import { appraise, belowFloor, confidenceFor, median, needsCityComparables, pickComparables, withExtra } from './appraise';
import { fixture } from './fixtures.test-helper';

const captured = fixture('GET_sales', SalePageSchema).data;
const base = captured[0]!;

function sale(id: string, mint: number, price: number, at = '2026-10-01T00:00:00.000Z', extra: Partial<Sale> = {}): Sale {
  return { ...base, property_id: id, mint_price_upx: mint, price_upx: price, price_to_mint: mint > 0 ? price / mint : 0, timestamp: at, ...extra };
}

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('pickComparables', () => {
  it('skips the property itself, unknown mints and unpriced sales (the captured sales have no mint)', () => {
    expect(pickComparables(captured, 'x', 10_000)).toEqual([]);
    const sales = [sale('self', 10_000, 20_000), sale('a', 10_000, 15_000), sale('b', 0, 9_000), sale('c', 10_000, 0)];
    expect(pickComparables(sales, 'self', 10_000).map((c) => c.property_id)).toEqual(['a']);
  });

  it('keeps the newest sale per property and orders by closeness in mint price', () => {
    const sales = [sale('far', 100_000, 150_000), sale('near', 11_000, 22_000, '2026-09-01T00:00:00.000Z'), sale('near', 11_000, 33_000, '2026-10-05T00:00:00.000Z'), sale('mid', 20_000, 30_000)];
    const comps = pickComparables(sales, 'self', 10_000);
    expect(comps.map((c) => c.property_id)).toEqual(['near', 'mid', 'far']);
    expect(comps[0]?.price_upx).toBe(33_000);
  });

  it('caps at the max', () => {
    const sales = Array.from({ length: 15 }, (_, i) => sale(`p${i}`, 10_000 + i, 20_000));
    expect(pickComparables(sales, 'self', 10_000)).toHaveLength(10);
    expect(pickComparables(sales, 'self', 10_000, 3)).toHaveLength(3);
  });
});

describe('appraise', () => {
  const local = [sale('a', 10_000, 15_000), sale('b', 10_000, 20_000), sale('c', 10_000, 25_000)];
  const city = Array.from({ length: 9 }, (_, i) => sale(`c${i}`, 10_000, 30_000));

  it('uses the neighborhood when it has 3 or more comparables', () => {
    const a = appraise({ propertyId: 'self', mintPriceUpx: 10_000, lastSaleUpx: 0, neighborhoodSales: local, citySales: city });
    expect(a).toMatchObject({ basis: 'mint-model', level: 'neighborhood', ratio: 2, estimateUpx: 20_000, confidence: 'Low' });
    expect(a.comparables).toHaveLength(3);
  });

  it('falls back to the city with fewer than 3 in the neighborhood', () => {
    expect(needsCityComparables({ propertyId: 'self', mintPriceUpx: 10_000, neighborhoodSales: local.slice(0, 2) })).toBe(true);
    expect(needsCityComparables({ propertyId: 'self', mintPriceUpx: 10_000, neighborhoodSales: local })).toBe(false);
    expect(needsCityComparables({ propertyId: 'self', mintPriceUpx: 0, neighborhoodSales: [] })).toBe(false);
    const a = appraise({ propertyId: 'self', mintPriceUpx: 10_000, lastSaleUpx: 0, neighborhoodSales: local.slice(0, 2), citySales: city });
    expect(a).toMatchObject({ basis: 'mint-model', level: 'city', estimateUpx: 30_000, confidence: 'Medium' });
  });

  it('uses the last sale without a mint price or comparables', () => {
    expect(appraise({ propertyId: base.property_id, mintPriceUpx: 0, lastSaleUpx: 29_999, neighborhoodSales: captured, citySales: captured })).toMatchObject({
      basis: 'last-sale',
      estimateUpx: 29_999,
      confidence: 'Low',
      comparables: [],
    });
    expect(appraise({ propertyId: 'self', mintPriceUpx: 10_000, lastSaleUpx: 12_000, neighborhoodSales: [], citySales: [] }).basis).toBe('last-sale');
  });

  it('says nothing without a mint price, comparables or a sale', () => {
    expect(appraise({ propertyId: 'self', mintPriceUpx: 0, lastSaleUpx: 0, neighborhoodSales: [], citySales: [] })).toMatchObject({ basis: 'none', estimateUpx: null, confidence: null });
  });
});

describe('confidence, extra and floor', () => {
  it('grades by comparable count and level', () => {
    expect(confidenceFor(8, 'neighborhood')).toBe('High');
    expect(confidenceFor(5, 'neighborhood')).toBe('Medium');
    expect(confidenceFor(4, 'neighborhood')).toBe('Low');
    expect(confidenceFor(10, 'city')).toBe('Medium');
    expect(confidenceFor(7, 'city')).toBe('Low');
  });

  it('adds the extra percentage', () => {
    expect(withExtra(20_000, 10)).toBeCloseTo(22_000);
    expect(withExtra(20_000, -5)).toBeCloseTo(19_000);
    expect(withExtra(20_000, 0)).toBe(20_000);
  });

  it('flags an estimate under the floor only when there is one', () => {
    expect(belowFloor(9_000, 10_000)).toBe(true);
    expect(belowFloor(11_000, 10_000)).toBe(false);
    expect(belowFloor(9_000, null)).toBe(false);
    expect(belowFloor(null, 10_000)).toBe(false);
    expect(belowFloor(9_000, 0)).toBe(false);
  });
});
