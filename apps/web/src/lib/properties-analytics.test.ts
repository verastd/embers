import { describe, expect, it } from 'vitest';
import { AnalyticsResultSchema, CityDayListSchema, NeighborhoodPageSchema, SalesAnalyticsSchema } from '@embers/ledger';
import type { AnalyticsResult, CityDay } from '@embers/ledger';

import { fixture } from './fixtures.test-helper';
import {
  appliedRange,
  CITY_SORTS,
  cityDaysParams,
  cityFromSegment,
  cityHref,
  cityStats,
  dailyActivity,
  dailyPrices,
  daysBetween,
  instantRange,
  isDay,
  lastDays,
  latestDay,
  marketStaleMinutes,
  marketTotals,
  mintBreakdownSpec,
  mintKindLabel,
  mintSummary,
  neighborhoodRows,
  neighborhoodTradeSpec,
  onlyLatestDay,
  rangeLength,
  rangeProblem,
  rangeStaleMinutes,
  records,
  salesSeriesByDay,
  sortCities,
  statusCounts,
  statusCountsSpec,
  totalStatusCounts,
  UPLAND_STATUSES,
  topMinters,
  topMintersSpec,
} from './properties-analytics';

const cities = fixture('GET_market_cities', CityDayListSchema);
const sales = fixture('GET_analytics_sales', SalesAnalyticsSchema);
const hoods = fixture('GET_neighborhoods', NeighborhoodPageSchema);
const NOW = Date.parse('2026-10-09T12:00:00Z');

const day = (d: string, city: string, over: Partial<CityDay> = {}): CityDay => ({
  day: d,
  city,
  sales: 1,
  volume_upx: 100,
  median_sale_upx: 100,
  median_ask_upx: 120,
  median_ask_usd: 2,
  listings_new: 2,
  listings_removed: 1,
  mints: 0,
  median_mint_upx: null,
  median_sale_to_mint: 1.5,
  yield_payout_upx: 0,
  distinct_buyers: 1,
  distinct_sellers: 1,
  ...over,
});

const result = (columns: string[], rows: AnalyticsResult['rows'], truncated = false): AnalyticsResult =>
  AnalyticsResultSchema.parse({
    columns: columns.map((name) => ({ name, type: 'string' })),
    rows,
    stats: { rows: rows.length, elapsed_ms: 1, rows_read: 1, bytes_read: 1, truncated, table: 'properties', dedup: 'exact' },
    sql: '',
  });

describe('day ranges', () => {
  it('counts today in the last N days and lists every day', () => {
    expect(lastDays(7, NOW)).toEqual({ after: '2026-10-03', before: '2026-10-09' });
    expect(lastDays(0, NOW)).toEqual({ after: '2026-10-09', before: '2026-10-09' });
    expect(daysBetween({ after: '2026-09-29', before: '2026-10-02' })).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(daysBetween({ after: '2026-10-02', before: '2026-10-01' })).toEqual([]);
    expect(daysBetween({ after: 'nope', before: '2026-10-01' })).toEqual([]);
    expect(rangeLength(lastDays(30, NOW))).toBe(30);
  });

  it('accepts only real calendar days', () => {
    expect(isDay('2026-10-09')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-1-9')).toBe(false);
  });

  it('bounds instants to whole UTC days', () => {
    expect(instantRange({ after: '2026-10-01', before: '2026-10-02' })).toEqual({ after: '2026-10-01T00:00:00.000Z', before: '2026-10-02T23:59:59.999Z' });
  });
});

describe('freshness', () => {
  it('finds the newest day and calls the layer stale only before yesterday', () => {
    expect(latestDay(cities)).toBe('2026-10-08');
    expect(latestDay([])).toBeNull();
    expect(marketStaleMinutes('2026-10-08', NOW)).toBeNull();
    expect(marketStaleMinutes('2026-10-07', NOW)).toBe(36 * 60);
    expect(marketStaleMinutes(null, NOW)).toBeNull();
  });
});

describe('cityStats (GET_market_cities)', () => {
  it('rolls up each city and ranks by UPX volume', () => {
    const stats = cityStats(cities);
    expect(stats.map((c) => c.city)).toEqual(['Las Vegas', 'Los Angeles', 'Rome']);
    const lv = stats[0]!;
    expect(lv).toMatchObject({ sales: 17, volumeUpx: 1013455, listingsNew: 15, mints: 7, days: 1 });
    expect(lv.medianSaleToMint).toEqual({ value: 1.1311068439892846, day: '2026-10-08' });
    expect(stats[1]!.medianMintUpx).toBeNull();
  });

  it('sums a window and keeps the latest median with its day', () => {
    const rows = [day('2026-10-02', 'X', { median_sale_upx: 50 }), day('2026-10-03', 'X', { median_sale_upx: null, sales: 0 }), day('2026-10-01', 'X')];
    const [x] = cityStats(rows);
    expect(x).toMatchObject({ sales: 2, volumeUpx: 300, listingsNew: 6, listingsRemoved: 3, days: 3 });
    expect(x!.medianSaleUpx).toEqual({ value: 50, day: '2026-10-02' });
    expect(x!.medianAskUpx).toEqual({ value: 120, day: '2026-10-03' });
  });

  it('keeps only the newest day when asked', () => {
    const rows = [day('2026-10-02', 'X'), day('2026-10-03', 'Y'), day('2026-10-03', 'X')];
    expect(onlyLatestDay(rows).map((r) => r.city)).toEqual(['Y', 'X']);
    expect(onlyLatestDay([])).toEqual([]);
  });

  it('totals the window', () => {
    expect(marketTotals(cityStats(cities))).toEqual({ sales: 59, volumeUpx: 2517190, listingsNew: 92, listingsRemoved: 63, mints: 7, citiesWithSales: 3 });
  });

  it('sorts by any column with missing values last both ways', () => {
    const stats = cityStats(cities);
    expect(sortCities(stats, 'city', 'asc').map((c) => c.city)).toEqual(['Las Vegas', 'Los Angeles', 'Rome']);
    expect(sortCities(stats, 'sales', 'desc').map((c) => c.city)).toEqual(['Los Angeles', 'Las Vegas', 'Rome']);
    expect(sortCities(stats, 'sale_to_mint', 'asc').map((c) => c.city)).toEqual(['Las Vegas', 'Rome', 'Los Angeles']);
    expect(sortCities(stats, 'sale_to_mint', 'desc').map((c) => c.city)).toEqual(['Rome', 'Las Vegas', 'Los Angeles']);
    for (const key of CITY_SORTS) expect(sortCities(stats, key, 'asc')).toHaveLength(3);
    const tie = cityStats([day('2026-10-01', 'B', { median_ask_usd: null }), day('2026-10-01', 'A', { median_ask_usd: null })]);
    expect(sortCities(tie, 'median_ask_usd', 'asc').map((c) => c.city)).toEqual(['A', 'B']);
    expect(sortCities(tie, 'volume', 'desc').map((c) => c.city)).toEqual(['A', 'B']);
  });
});

describe('daily series', () => {
  const days = ['2026-10-07', '2026-10-08'];
  it('sums activity per day over cities, zero where none', () => {
    expect(dailyActivity([...cities, day('2026-09-01', 'Z')], days)).toEqual([
      { day: '2026-10-07', sales: 0, listingsNew: 0, listingsRemoved: 0, mints: 0 },
      { day: '2026-10-08', sales: 59, listingsNew: 92, listingsRemoved: 63, mints: 7 },
    ]);
  });

  it("aligns one city's medians to the axis", () => {
    expect(dailyPrices(cities, 'Rome', days)).toEqual([
      { day: '2026-10-07', medianSaleUpx: null, medianAskUpx: null, medianAskUsd: null, medianSaleToMint: null },
      { day: '2026-10-08', medianSaleUpx: 23333, medianAskUpx: 37500, medianAskUsd: 9, medianSaleToMint: 2.567997685185185 },
    ]);
  });

  it('aligns the chain-wide sales series (GET_analytics_sales)', () => {
    const out = salesSeriesByDay(sales.series, ['2026-10-01', '2026-10-02']);
    expect(out[0]).toEqual({ day: '2026-10-01', median: null, sales: 0 });
    expect(out[1]).toEqual({ day: '2026-10-02', median: 19363.05, sales: 323 });
    const odd = result(['day', 'median_price', 'sales'], [[null, 1, 2], ['2026-10-01T00:00:00.000Z', null, null]]);
    expect(salesSeriesByDay(odd, ['2026-10-01'])).toEqual([{ day: '2026-10-01', median: null, sales: 0 }]);
  });
});

describe('mint analytics', () => {
  it('asks the property dimension for mints in the window and place', () => {
    const spec = mintBreakdownSpec({ range: { after: '2026-10-01', before: '2026-10-02' }, city: 'Rome', neighborhood: 'PRATI' });
    expect(spec.source).toBe('properties');
    expect(spec.filters).toEqual([
      { field: 'minted_at', op: 'between', value: ['2026-10-01T00:00:00.000Z', '2026-10-02T23:59:59.999Z'] },
      { field: 'city', op: 'eq', value: 'Rome' },
      { field: 'neighborhood', op: 'eq', value: 'PRATI' },
    ]);
    expect(mintBreakdownSpec({ range: { after: '2026-10-01', before: '2026-10-02' } }).filters).toHaveLength(1);
    expect(topMintersSpec({ after: '2026-10-01', before: '2026-10-02' })).toMatchObject({ source: 'events', range: { after: '2026-10-01T00:00:00.000Z' }, limit: 10 });
  });

  it('summarizes kinds, top city and top neighborhood', () => {
    const r = result(
      ['city', 'neighborhood', 'mint_kind', 'mints'],
      [
        ['Rome', 'PRATI', 'fsa_upx', 5],
        ['Rome', 'PRATI', 'i44', 2],
        ['Rome', '', 'a44', 4],
        ['Detroit', 'THE EYE', 'fsa_upx', 6],
        ['Detroit', 'THE EYE', '', '1'],
        ['', '', 'fsa_upx', null],
      ],
      true,
    );
    const s = mintSummary(r);
    expect(s).toMatchObject({ total: 18, onChainUpx: 11, offChain: 6, other: 1, withoutNeighborhood: 4, truncated: true });
    expect(s.topCity).toEqual({ name: 'Rome', city: 'Rome', count: 11 });
    expect(s.topNeighborhood).toEqual({ name: 'PRATI', city: 'Rome', count: 7 });
    const tie = mintSummary(result(['city', 'neighborhood', 'mint_kind', 'mints'], [['B', 'Y', 'fsa_upx', 1], ['A', 'X', 'fsa_upx', 1]]));
    expect(tie.topCity?.name).toBe('A');
    expect(tie.topNeighborhood?.name).toBe('X');
    expect(mintSummary(result(['mints'], [])).topCity).toBeNull();
  });

  it('ranks minters', () => {
    const r = result(['account', 'mints'], [['b', 3], ['a', 3], ['c', 9], ['', 1]]);
    expect(topMinters(r)).toEqual([
      { rank: 1, account: 'c', mints: 9 },
      { rank: 2, account: 'a', mints: 3 },
      { rank: 3, account: 'b', mints: 3 },
    ]);
  });

  it('labels mint kinds', () => {
    expect(mintKindLabel('fsa_upx')).toBe('UPX on chain');
    expect(mintKindLabel('i44')).toBe('Settled off chain');
    expect(mintKindLabel('zz')).toBe('zz');
    expect(mintKindLabel('')).toBe('Unknown');
  });
});

describe('neighborhoods', () => {
  it('asks for traded properties of one city', () => {
    const spec = neighborhoodTradeSpec('San Francisco');
    expect(spec.filters).toContainEqual({ field: 'city', op: 'eq', value: 'San Francisco' });
    expect(spec.dimensions).toEqual([{ field: 'neighborhood' }]);
  });

  it('joins trades to the reference list (GET_neighborhoods); unrecorded last', () => {
    const r = result(
      ['neighborhood', 'traded', 'sales', 'median_last_sale'],
      [
        ['', 10, 40, 900],
        ['ANZA VISTA', 3, 5, 1200],
        ['GHOST', 1, 5, 0],
      ],
    );
    const rows = neighborhoodRows(r, hoods.data);
    expect(rows.map((n) => n.name)).toEqual(['ANZA VISTA', 'GHOST', 'ALAMO SQUARE', 'APPAREL CITY', '']);
    expect(rows[0]).toMatchObject({ tradedProperties: 3, sales: 5, medianLastSaleUpx: 1200, areaM2: 301374.5578171015 });
    expect(rows[1]).toMatchObject({ medianLastSaleUpx: null, areaM2: null });
    expect(rows[2]).toMatchObject({ tradedProperties: 0, sales: 0, medianLastSaleUpx: null });
    expect(neighborhoodRows(r, null).map((n) => n.name)).toEqual(['ANZA VISTA', 'GHOST', '']);
    expect(neighborhoodRows(r, [{ name: 'Z', area_m2: 0 }]).find((n) => n.name === 'Z')?.areaM2).toBeNull();
  });

  it('reads records by column name', () => {
    expect(records(result(['a', 'b'], [[1]]))).toEqual([{ a: 1, b: null }]);
  });
});

describe('city route segment', () => {
  it('round-trips a city name', () => {
    expect(cityHref('Los Angeles')).toBe('/properties/overview/Los%20Angeles');
    expect(cityFromSegment('Los%20Angeles')).toBe('Los Angeles');
    expect(cityFromSegment('S%C3%A3o%20Paulo')).toBe('São Paulo');
    expect(cityFromSegment('%E0%A4%A')).toBeNull();
    expect(cityFromSegment('%20')).toBeNull();
    expect(cityFromSegment(undefined)).toBeNull();
    expect(cityFromSegment('x'.repeat(65))).toBeNull();
  });
});

describe('rangeProblem', () => {
  it('accepts the default and valid ranges, refuses the rest in words', () => {
    expect(rangeProblem('', '', '')).toBeNull();
    expect(rangeProblem('2026-10-01', '2026-10-08', '')).toBeNull();
    expect(rangeProblem('2026-13-01', '', '')).toMatch(/YYYY-MM-DD/);
    expect(rangeProblem('2026-10-01', '', '')).toBe('Set both From and To, or neither');
    expect(rangeProblem('2026-10-08', '2026-10-01', '')).toBe('From must not be after To');
    expect(rangeProblem('2024-01-01', '2026-10-01', 'Rome')).toBe('Up to 365 days at a time');
    expect(rangeProblem('2026-06-01', '2026-10-01', '')).toMatch(/All cities: up to 60 days/);
    expect(rangeProblem('2026-06-01', '2026-10-01', 'Rome')).toBeNull();
  });
});

describe('review fixes (#10)', () => {
  it('refuses an unbounded URL range without walking it (?from=0000-01-01&to=9999-12-31)', () => {
    const t0 = Date.now();
    const r = appliedRange('0000-01-01', '9999-12-31', undefined, 30, NOW);
    expect(r).toEqual({ range: null, problem: 'Up to 365 days at a time' });
    expect(appliedRange('0000-01-01', '9999-12-31', 'Rome', 30, NOW).range).toBeNull();
    expect(daysBetween({ after: '0000-01-01', before: '9999-12-31' })).toEqual([]);
    expect(rangeLength({ after: '0000-01-01', before: '9999-12-31' })).toBeGreaterThan(3_000_000);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('applies the 60-day all-cities limit and the defaults from the URL too', () => {
    expect(appliedRange('2026-06-01', '2026-10-01', undefined, 30, NOW).problem).toMatch(/All cities: up to 60 days/);
    expect(appliedRange('2026-06-01', '2026-10-01', 'Rome', 30, NOW)).toEqual({ range: { after: '2026-06-01', before: '2026-10-01' }, problem: null });
    expect(appliedRange(undefined, undefined, undefined, 30, NOW)).toEqual({ range: lastDays(30, NOW), problem: null });
    expect(appliedRange('2026-10-08', '2026-10-01', 'Rome', 30, NOW).problem).toBe('From must not be after To');
    expect(appliedRange('2026-10-01', undefined, 'Rome', 30, NOW).problem).toBe('Set both From and To, or neither');
    expect(daysBetween({ after: '2025-01-01', before: '2026-01-01' })).toHaveLength(366);
  });

  it('judges staleness only for ranges that reach the freshness window', () => {
    // NOW is 2026-10-09: yesterday is 2026-10-08.
    expect(rangeStaleMinutes({ after: '2026-09-01', before: '2026-09-30' }, '2026-09-30', NOW)).toBeNull();
    expect(rangeStaleMinutes({ after: '2026-09-10', before: '2026-10-08' }, '2026-10-07', NOW)).toBe(36 * 60);
    expect(rangeStaleMinutes({ after: '2026-09-10', before: '2026-10-09' }, '2026-10-08', NOW)).toBeNull();
  });

  it('"Latest day" asks for the newest rows with no date cutoff', () => {
    expect(cityDaysParams('latest', undefined, NOW)).toEqual({ city: undefined, limit: 500 });
    expect(cityDaysParams('latest', 'Rome', NOW)).toEqual({ city: 'Rome', limit: 1 });
    expect(cityDaysParams('7', 'Rome', NOW)).toEqual({ city: 'Rome', after: '2026-10-03', before: '2026-10-09', limit: 5000 });
    // A build outage of weeks still yields that last day's rows.
    const old = [day('2026-08-01', 'X'), day('2026-08-01', 'Y'), day('2026-07-31', 'X')];
    expect(onlyLatestDay(old).map((r) => r.city)).toEqual(['X', 'Y']);
    expect(marketStaleMinutes(latestDay(old), NOW)).toBeGreaterThan(60 * 24 * 60);
  });
});

describe('Upland status counts', () => {
  it('asks the property dimension by city and status, optionally for one city', () => {
    expect(statusCountsSpec()).toEqual({ source: 'properties', dimensions: [{ field: 'city' }, { field: 'api_status' }], measures: [{ fn: 'count', alias: 'properties' }], limit: 10_000 });
    expect(statusCountsSpec('Rome').filters).toEqual([{ field: 'city', op: 'eq', value: 'Rome' }]);
  });

  it('counts each status per city, keeps unknown statuses apart, and totals', () => {
    const r = result(
      ['city', 'api_status', 'properties'],
      [
        ['Rome', 'Owned', 100],
        ['Rome', 'for sale', 20],
        ['Rome', 'Unlocked', 300],
        ['Rome', '', 5],
        ['Detroit', 'Locked', 50],
        ['Detroit', 'On Review', 2],
        ['Detroit', 'Weird', 1],
        ['', 'Owned', 9],
      ],
    );
    const rows = statusCounts(r);
    expect(rows.map((c) => c.city)).toEqual(['Rome', 'Detroit']);
    expect(rows[0]).toEqual({ city: 'Rome', total: 425, byStatus: { Owned: 100, 'For sale': 20, Locked: 0, Unlocked: 300, 'On Review': 0 }, notReported: 5 });
    expect(rows[1]!.notReported).toBe(1);
    const t = totalStatusCounts(rows);
    expect(t).toMatchObject({ city: 'All cities', total: 478, notReported: 6 });
    expect(t.byStatus).toEqual({ Owned: 100, 'For sale': 20, Locked: 50, Unlocked: 300, 'On Review': 2 });
    expect(UPLAND_STATUSES).toHaveLength(5);
  });
});
