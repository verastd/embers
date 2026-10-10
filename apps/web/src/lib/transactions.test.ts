import { describe, expect, it } from 'vitest';
import { OfferPageSchema, SalePageSchema } from '@embers/ledger';

import { fixture } from './fixtures.test-helper';
import { fromOffer, fromSale, mergeFeeds, periodStart, toCsv } from './transactions';
import type { TxRow } from './transactions';

const sales = fixture('GET_sales', SalePageSchema).data;
const offers = fixture('GET_offers', OfferPageSchema).data;

function row(key: string, timestamp: string | null): TxRow {
  return { ...fromSale(sales[0]!), key, timestamp };
}

describe('fromSale / fromOffer (captured examples)', () => {
  it('keeps the sale polarity: buyer is the event account', () => {
    const r = fromSale(sales[0]!);
    expect(r).toMatchObject({ type: 'sale', buyer: 'ymc55j4fboxi', seller: 'tlifor1bq435', price_upx: 29999, address: '2506 SEARSDALE AVE', buyer_username: '' });
    expect(r.key).toBe(`sale|${sales[0]!.trx_id}|${sales[0]!.property_id}`);
  });

  it('reads an accepted offer with its buyer username and no neighborhood', () => {
    const r = fromOffer(offers[0]!);
    expect(r).toMatchObject({ type: 'offer', buyer: 'e4xryauqnpei', buyer_username: 'milredi8041', seller: 'hsbkyhq3ycen', price_upx: 20000, neighborhood: '', city: 'Singapore' });
  });
});

describe('mergeFeeds', () => {
  it('merges newest first when both feeds are complete', () => {
    const merged = mergeFeeds([
      { rows: sales.map(fromSale), hasMore: false },
      { rows: offers.map(fromOffer), hasMore: false },
    ]);
    expect(merged.hidden).toBe(0);
    expect(merged.rows).toHaveLength(sales.length + offers.length);
    const times = merged.rows.map((r) => r.timestamp ?? '');
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('holds back rows older than what a feed with more pages has loaded', () => {
    const a = [row('a1', '2026-10-09T10:00:00Z'), row('a2', '2026-10-09T08:00:00Z')];
    const b = [row('b1', '2026-10-09T09:00:00Z'), row('b2', '2026-10-09T05:00:00Z'), row('b3', '2026-10-09T01:00:00Z')];
    const merged = mergeFeeds([
      { rows: a, hasMore: true },
      { rows: b, hasMore: false },
    ]);
    expect(merged.rows.map((r) => r.key)).toEqual(['a1', 'b1', 'a2']);
    expect(merged.hidden).toBe(2);
  });

  it('cuts at the newest boundary when both have more', () => {
    const a = [row('a1', '2026-10-09T10:00:00Z'), row('a2', '2026-10-09T04:00:00Z')];
    const b = [row('b1', '2026-10-09T09:00:00Z'), row('b2', '2026-10-09T06:00:00Z')];
    const merged = mergeFeeds([
      { rows: a, hasMore: true },
      { rows: b, hasMore: true },
    ]);
    expect(merged.rows.map((r) => r.key)).toEqual(['a1', 'b1', 'b2']);
    expect(merged.hidden).toBe(1);
  });

  it('ignores an empty feed with more, and sorts null timestamps last', () => {
    const merged = mergeFeeds([
      { rows: [], hasMore: true },
      { rows: [row('x', null), row('y', '2026-10-09T00:00:00Z')], hasMore: false },
    ]);
    expect(merged.rows.map((r) => r.key)).toEqual(['y', 'x']);
  });
});

describe('toCsv', () => {
  it('writes a header, one line per row, quoting and neutralising formulas', () => {
    const r = { ...fromSale(sales[0]!), address: '1 "MAIN", ST', city: '=HYPERLINK("x")' };
    const csv = toCsv([r, fromOffer(offers[0]!)]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('timestamp,type,property_id,address,city,neighborhood,buyer,buyer_username,seller,price_upx,mint_price_upx,price_to_mint,trx_id');
    expect(lines[1]).toContain('"1 ""MAIN"", ST"');
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[2]).toContain('Accepted offer');
    expect(toCsv([])).toBe('timestamp,type,property_id,address,city,neighborhood,buyer,buyer_username,seller,price_upx,mint_price_upx,price_to_mint,trx_id\r\n');
  });

  it('writes null cells as empty', () => {
    expect(toCsv([row('k', null)]).split('\r\n')[1]?.startsWith(',Sale,')).toBe(true);
  });
});

describe('periodStart', () => {
  const now = Date.UTC(2026, 9, 10, 15, 30);
  it('covers exactly N UTC calendar days including today, or nothing for all time', () => {
    expect(periodStart('all', now)).toBeUndefined();
    // Oct 4..Oct 10 is 7 dates; Oct 3 would make 8.
    expect(periodStart('7d', now)).toBe('2026-10-04T00:00:00Z');
    expect(periodStart('30d', now)).toBe('2026-09-11T00:00:00Z');
    expect(periodStart('90d', now)).toBe('2026-07-13T00:00:00Z');
    for (const [period, days] of [['7d', 7], ['30d', 30], ['90d', 90]] as const) {
      const start = Date.parse(periodStart(period, now) ?? '');
      expect((Date.UTC(2026, 9, 10) - start) / 86_400_000 + 1).toBe(days);
    }
  });
  it('is stable through the day', () => {
    expect(periodStart('7d', Date.UTC(2026, 9, 10, 0, 0, 1))).toBe(periodStart('7d', Date.UTC(2026, 9, 10, 23, 59, 59)));
  });
});
