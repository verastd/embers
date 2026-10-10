/**
 * Shapes ledger payloads for the Properties analytics pages (F-401, F-402,
 * F-407, F-408): per-city roll-ups of `/market/cities`, daily series for the
 * statistics charts, and the `POST /analytics/query` answers the mint and
 * neighborhood views ask for. Pure; tested against the captured examples.
 *
 * What the ledger knows, and so what these never pretend to: `/market/cities`
 * is one row per city per day of market activity (sales, listings, mints,
 * medians). A median of a multi-day window cannot be rebuilt from daily
 * medians, so roll-ups carry the most recent day's median with its date,
 * never an average of medians.
 */
import type { AnalyticsResult, CityDay, QueryFilter, QuerySpec } from '@embers/ledger';

import { utcDayOffset } from './format';

/* --- windows --------------------------------------------------------------------- */

export interface DayRange {
  /** First day, inclusive (YYYY-MM-DD, UTC). */
  after: string;
  /** Last day, inclusive. */
  before: string;
}

/** The last `days` UTC calendar days, today included. */
export function lastDays(days: number, now: number = Date.now()): DayRange {
  return { after: utcDayOffset(Math.max(1, days) - 1, now), before: utcDayOffset(0, now) };
}

/** Hard ceiling on any category axis we build, whatever range reaches us. */
export const MAX_AXIS_DAYS = 400;

/** Days in a range, inclusive; 0 when reversed or invalid. Arithmetic, so any range is cheap to measure. */
export function rangeLength(range: DayRange): number {
  const start = Date.parse(`${range.after}T00:00:00Z`);
  const end = Date.parse(`${range.before}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Every day from `after` to `before` inclusive (empty when reversed), for a
 * gap-free axis. A range longer than MAX_AXIS_DAYS yields nothing rather
 * than millions of categories: callers validate ranges before this.
 */
export function daysBetween(range: DayRange): string[] {
  const n = rangeLength(range);
  if (n === 0 || n > MAX_AXIS_DAYS) return [];
  const start = Date.parse(`${range.after}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** A YYYY-MM-DD that is a real calendar day. */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** Longest range the statistics page asks for at once. */
export const MAX_DAYS = 365;
/** All cities × days must fit one `/market/cities` answer (5,000 rows, ~65 cities). */
export const MAX_DAYS_ALL_CITIES = 60;

/** What is wrong with a draft From/To range, in words; null when it can be applied (both empty = the default). */
export function rangeProblem(from: string, to: string, city: string): string | null {
  const f = from.trim();
  const t = to.trim();
  if ((f && !isDay(f)) || (t && !isDay(t))) return 'Dates are YYYY-MM-DD, e.g. 2026-10-01';
  if (!f && !t) return null;
  if (!f || !t) return 'Set both From and To, or neither';
  if (f > t) return 'From must not be after To';
  const n = rangeLength({ after: f, before: t });
  if (n > MAX_DAYS) return `Up to ${MAX_DAYS} days at a time`;
  if (!city.trim() && n > MAX_DAYS_ALL_CITIES) return `All cities: up to ${MAX_DAYS_ALL_CITIES} days. Pick a city for a longer range.`;
  return null;
}

export interface AppliedRange {
  /** The range to read and chart; null when the URL's range cannot be shown. */
  range: DayRange | null;
  /** Why the URL's range was refused, in words. */
  problem: string | null;
}

/**
 * The statistics range from the URL. No dates means the default (the last
 * `defaultDays`); dates are held to the same rules as the form
 * (`rangeProblem`), so a hand-edited link such as
 * `?from=0000-01-01&to=9999-12-31` is refused instead of read.
 */
export function appliedRange(from: string | undefined, to: string | undefined, city: string | undefined, defaultDays: number, now: number = Date.now()): AppliedRange {
  if (!from && !to) return { range: lastDays(defaultDays, now), problem: null };
  const problem = rangeProblem(from ?? '', to ?? '', city ?? '');
  if (problem !== null) return { range: null, problem };
  return { range: { after: from!, before: to! }, problem: null };
}

/**
 * Staleness only means something when the range reaches the market layer's
 * freshness window (ends yesterday or later). A deliberately historical
 * range is complete, not stale.
 */
export function rangeStaleMinutes(range: DayRange, latest: string | null, now: number = Date.now()): number | null {
  if (range.before < utcDayOffset(1, now)) return null;
  return marketStaleMinutes(latest, now);
}

/**
 * `/market/cities` params for an overview window. "Latest day" sets no date
 * bound: the route answers newest day first, so the first rows are the last
 * day the market layer built, however long ago that was (an outage then
 * shows that day with the stale banner, never an empty page). 500 rows
 * cover one day of every city (~65) many times over.
 */
export function cityDaysParams(win: 'latest' | '7' | '30', city: string | undefined, now: number = Date.now()): { city?: string; after?: string; before?: string; limit: number } {
  if (win === 'latest') return { city, limit: city ? 1 : 500 };
  const range = lastDays(Number(win), now);
  return { city, after: range.after, before: range.before, limit: 5000 };
}

/** Newest day present in the rows, or null. */
export function latestDay(rows: readonly CityDay[]): string | null {
  let best: string | null = null;
  for (const r of rows) if (best === null || r.day > best) best = r.day;
  return best;
}

/**
 * Minutes the market layer is behind its budget, or null when it is fresh.
 * The layer is rebuilt every 6 h, so a newest day older than yesterday means
 * the builds have stopped; the count runs from the end of that day.
 */
export function marketStaleMinutes(latest: string | null, now: number = Date.now()): number | null {
  if (latest === null) return null;
  if (latest >= utcDayOffset(1, now)) return null;
  const endOfDay = Date.parse(`${latest}T00:00:00Z`) + 86_400_000;
  return Math.max(1, Math.round((now - endOfDay) / 60_000));
}

/* --- per-city roll-up ---------------------------------------------------------------- */

/** A median from one day of a window, with that day. */
export interface DatedValue {
  value: number;
  day: string;
}

export interface CityStats {
  city: string;
  sales: number;
  volumeUpx: number;
  listingsNew: number;
  listingsRemoved: number;
  mints: number;
  yieldUpx: number;
  /** Each is the most recent day in the window that had one. */
  medianSaleUpx: DatedValue | null;
  medianAskUpx: DatedValue | null;
  medianAskUsd: DatedValue | null;
  medianSaleToMint: DatedValue | null;
  medianMintUpx: DatedValue | null;
  /** Days of the window this city had any row for. */
  days: number;
}

type MedianKey = 'median_sale_upx' | 'median_ask_upx' | 'median_ask_usd' | 'median_sale_to_mint' | 'median_mint_upx';

function latestMedian(days: readonly CityDay[], key: MedianKey): DatedValue | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    const v = d[key];
    if (v !== null && Number.isFinite(v)) return { value: v, day: d.day };
  }
  return null;
}

const byDay = (a: CityDay, b: CityDay): number => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

/** One row per city: sums over the window and the latest medians. Ordered by UPX volume, then sales, then name. */
export function cityStats(rows: readonly CityDay[]): CityStats[] {
  const groups = new Map<string, CityDay[]>();
  for (const row of rows) {
    const list = groups.get(row.city);
    if (list) list.push(row);
    else groups.set(row.city, [row]);
  }
  const out: CityStats[] = [];
  for (const [city, list] of groups) {
    const days = [...list].sort(byDay);
    const sum = (k: 'sales' | 'volume_upx' | 'listings_new' | 'listings_removed' | 'mints' | 'yield_payout_upx'): number => days.reduce((s, d) => s + d[k], 0);
    out.push({
      city,
      sales: sum('sales'),
      volumeUpx: sum('volume_upx'),
      listingsNew: sum('listings_new'),
      listingsRemoved: sum('listings_removed'),
      mints: sum('mints'),
      yieldUpx: sum('yield_payout_upx'),
      medianSaleUpx: latestMedian(days, 'median_sale_upx'),
      medianAskUpx: latestMedian(days, 'median_ask_upx'),
      medianAskUsd: latestMedian(days, 'median_ask_usd'),
      medianSaleToMint: latestMedian(days, 'median_sale_to_mint'),
      medianMintUpx: latestMedian(days, 'median_mint_upx'),
      days: new Set(days.map((d) => d.day)).size,
    });
  }
  return out.sort((a, b) => b.volumeUpx - a.volumeUpx || b.sales - a.sales || a.city.localeCompare(b.city));
}

/** Only the rows of the newest day present. */
export function onlyLatestDay(rows: readonly CityDay[]): CityDay[] {
  const latest = latestDay(rows);
  return latest === null ? [] : rows.filter((r) => r.day === latest);
}

export interface MarketTotals {
  sales: number;
  volumeUpx: number;
  listingsNew: number;
  listingsRemoved: number;
  mints: number;
  /** Cities with at least one sale in the window. */
  citiesWithSales: number;
}

export function marketTotals(stats: readonly CityStats[]): MarketTotals {
  return {
    sales: stats.reduce((s, c) => s + c.sales, 0),
    volumeUpx: stats.reduce((s, c) => s + c.volumeUpx, 0),
    listingsNew: stats.reduce((s, c) => s + c.listingsNew, 0),
    listingsRemoved: stats.reduce((s, c) => s + c.listingsRemoved, 0),
    mints: stats.reduce((s, c) => s + c.mints, 0),
    citiesWithSales: stats.filter((c) => c.sales > 0).length,
  };
}

export type CitySortKey = 'city' | 'sales' | 'volume' | 'median_sale' | 'median_ask_upx' | 'median_ask_usd' | 'sale_to_mint' | 'listings_new' | 'mints';
export const CITY_SORTS: readonly CitySortKey[] = ['city', 'sales', 'volume', 'median_sale', 'median_ask_upx', 'median_ask_usd', 'sale_to_mint', 'listings_new', 'mints'];

function sortValue(c: CityStats, key: CitySortKey): number | string | null {
  switch (key) {
    case 'city':
      return c.city;
    case 'sales':
      return c.sales;
    case 'volume':
      return c.volumeUpx;
    case 'median_sale':
      return c.medianSaleUpx?.value ?? null;
    case 'median_ask_upx':
      return c.medianAskUpx?.value ?? null;
    case 'median_ask_usd':
      return c.medianAskUsd?.value ?? null;
    case 'sale_to_mint':
      return c.medianSaleToMint?.value ?? null;
    case 'listings_new':
      return c.listingsNew;
    case 'mints':
      return c.mints;
  }
}

/** Sorted copy; cities without the value sort last in both directions, ties by name. */
export function sortCities(stats: readonly CityStats[], key: CitySortKey, dir: 'asc' | 'desc'): CityStats[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...stats].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return a.city.localeCompare(b.city);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : (va as number) - (vb as number);
    return cmp !== 0 ? sign * cmp : a.city.localeCompare(b.city);
  });
}

/* --- daily series (F-407) --------------------------------------------------------------- */

export interface DailyActivity {
  day: string;
  sales: number;
  listingsNew: number;
  listingsRemoved: number;
  mints: number;
}

/** Per-day activity summed over every city in the rows, one entry per day of `days` (0 where none). */
export function dailyActivity(rows: readonly CityDay[], days: readonly string[]): DailyActivity[] {
  const map = new Map<string, DailyActivity>(days.map((d) => [d, { day: d, sales: 0, listingsNew: 0, listingsRemoved: 0, mints: 0 }]));
  for (const r of rows) {
    const e = map.get(r.day);
    if (!e) continue;
    e.sales += r.sales;
    e.listingsNew += r.listings_new;
    e.listingsRemoved += r.listings_removed;
    e.mints += r.mints;
  }
  return days.map((d) => map.get(d)!);
}

export interface DailyPrices {
  day: string;
  medianSaleUpx: number | null;
  medianAskUpx: number | null;
  medianAskUsd: number | null;
  medianSaleToMint: number | null;
}

/** One city's daily medians, aligned to `days` (null where the ledger has none). Rows of other cities are ignored. */
export function dailyPrices(rows: readonly CityDay[], city: string, days: readonly string[]): DailyPrices[] {
  const map = new Map<string, CityDay>();
  for (const r of rows) if (r.city === city) map.set(r.day, r);
  return days.map((day) => {
    const r = map.get(day);
    return {
      day,
      medianSaleUpx: r?.median_sale_upx ?? null,
      medianAskUpx: r?.median_ask_upx ?? null,
      medianAskUsd: r?.median_ask_usd ?? null,
      medianSaleToMint: r?.median_sale_to_mint ?? null,
    };
  });
}

/** `/analytics/sales` series (`[bucket, median_price, sales]`) aligned to `days`. */
export function salesSeriesByDay(result: AnalyticsResult, days: readonly string[]): Array<{ day: string; median: number | null; sales: number }> {
  const map = new Map<string, { median: number | null; sales: number }>();
  for (const row of result.rows) {
    const bucket = row[0];
    if (typeof bucket !== 'string') continue;
    const median = typeof row[1] === 'number' ? row[1] : null;
    const sales = typeof row[2] === 'number' ? row[2] : 0;
    map.set(bucket.slice(0, 10), { median, sales });
  }
  return days.map((day) => ({ day, ...(map.get(day) ?? { median: null, sales: 0 }) }));
}

/* --- analytics/query answers ------------------------------------------------------------ */

export type Cell = string | number | null;

/** Rows as records keyed by column name. */
export function records(result: Pick<AnalyticsResult, 'columns' | 'rows'>): Array<Record<string, Cell>> {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c.name, row[i] ?? null])));
}

const asNumber = (v: Cell | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const asText = (v: Cell | undefined): string => (v === null || v === undefined ? '' : String(v));

/* mints (F-408) */

/** Upland's mint actions: `a4` pays UPX on chain; `a44`/`i44` settle off chain (FIAT, rewards). */
export const MINT_KIND_LABELS: Record<string, string> = {
  fsa_upx: 'UPX on chain',
  a44: 'Settled off chain',
  i44: 'Settled off chain',
};

export function mintKindLabel(kind: string): string {
  return MINT_KIND_LABELS[kind] ?? (kind ? kind : 'Unknown');
}

export interface MintFilters {
  range: DayRange;
  city?: string;
  neighborhood?: string;
}

/** Instants bounding a day range: the first day's 00:00:00.000 to the last day's 23:59:59.999 UTC. */
export function instantRange(range: DayRange): { after: string; before: string } {
  return { after: `${range.after}T00:00:00.000Z`, before: `${range.before}T23:59:59.999Z` };
}

/** Mints in the window, grouped by place and payment kind, from the property dimension. */
export function mintBreakdownSpec(f: MintFilters): QuerySpec {
  const { after, before } = instantRange(f.range);
  const filters: QueryFilter[] = [{ field: 'minted_at', op: 'between', value: [after, before] }];
  if (f.city) filters.push({ field: 'city', op: 'eq', value: f.city });
  if (f.neighborhood) filters.push({ field: 'neighborhood', op: 'eq', value: f.neighborhood });
  return {
    source: 'properties',
    filters,
    dimensions: [{ field: 'city' }, { field: 'neighborhood' }, { field: 'mint_kind' }],
    measures: [{ fn: 'count', alias: 'mints' }],
    orderBy: [{ measure: 'mints', dir: 'desc' }],
    limit: 10_000,
  };
}

/** The ten accounts with the most mint events in the window, every city. */
export function topMintersSpec(range: DayRange, limit = 10): QuerySpec {
  return {
    source: 'events',
    range: instantRange(range),
    filters: [{ field: 'event_type', op: 'eq', value: 'property_minted' }],
    dimensions: [{ field: 'account' }],
    measures: [{ fn: 'count', alias: 'mints' }],
    orderBy: [{ measure: 'mints', dir: 'desc' }],
    limit,
  };
}

export interface PlaceCount {
  name: string;
  city: string;
  count: number;
}

export interface MintSummary {
  total: number;
  onChainUpx: number;
  offChain: number;
  other: number;
  topCity: PlaceCount | null;
  /** Neighborhood with the most mints, among mints that have one recorded. */
  topNeighborhood: PlaceCount | null;
  /** Mints whose property has no neighborhood in the ledger. */
  withoutNeighborhood: number;
  /** The answer hit the row cap, so the totals are a floor. */
  truncated: boolean;
}

export function mintSummary(result: Pick<AnalyticsResult, 'columns' | 'rows' | 'stats'>): MintSummary {
  const rows = records(result);
  const cities = new Map<string, number>();
  const hoods = new Map<string, PlaceCount>();
  const s: MintSummary = { total: 0, onChainUpx: 0, offChain: 0, other: 0, topCity: null, topNeighborhood: null, withoutNeighborhood: 0, truncated: result.stats.truncated };
  for (const r of rows) {
    const n = asNumber(r.mints);
    const city = asText(r.city);
    const hood = asText(r.neighborhood);
    const kind = asText(r.mint_kind);
    s.total += n;
    if (kind === 'fsa_upx') s.onChainUpx += n;
    else if (kind === 'a44' || kind === 'i44') s.offChain += n;
    else s.other += n;
    if (city) cities.set(city, (cities.get(city) ?? 0) + n);
    if (hood) {
      const key = `${city}\u0000${hood}`;
      const prev = hoods.get(key);
      hoods.set(key, { name: hood, city, count: (prev?.count ?? 0) + n });
    } else s.withoutNeighborhood += n;
  }
  for (const [name, count] of cities) {
    if (s.topCity === null || count > s.topCity.count || (count === s.topCity.count && name < s.topCity.name)) s.topCity = { name, city: name, count };
  }
  for (const h of hoods.values()) {
    if (s.topNeighborhood === null || h.count > s.topNeighborhood.count || (h.count === s.topNeighborhood.count && h.name < s.topNeighborhood.name)) s.topNeighborhood = h;
  }
  return s;
}

export interface Minter {
  rank: number;
  account: string;
  mints: number;
}

export function topMinters(result: Pick<AnalyticsResult, 'columns' | 'rows'>): Minter[] {
  return records(result)
    .map((r) => ({ account: asText(r.account), mints: asNumber(r.mints) }))
    .filter((m) => m.account !== '')
    .sort((a, b) => b.mints - a.mints || a.account.localeCompare(b.account))
    .map((m, i) => ({ rank: i + 1, ...m }));
}

/* neighborhoods (F-402) */

/** Traded properties per neighborhood of one city, from the property dimension (lifetime of the chain record). */
export function neighborhoodTradeSpec(city: string): QuerySpec {
  return {
    source: 'properties',
    filters: [
      { field: 'city', op: 'eq', value: city },
      { field: 'sales', op: 'gte', value: 1 },
    ],
    dimensions: [{ field: 'neighborhood' }],
    measures: [
      { fn: 'count', alias: 'traded' },
      { fn: 'sum', field: 'sales', alias: 'sales' },
      { fn: 'median', field: 'last_sale_upx', alias: 'median_last_sale' },
    ],
    orderBy: [{ measure: 'sales', dir: 'desc' }],
    limit: 2_000,
  };
}

export interface NeighborhoodRow {
  /** '' = the ledger has no neighborhood for these properties. */
  name: string;
  tradedProperties: number;
  sales: number;
  medianLastSaleUpx: number | null;
  /** Square metres, from Upland's reference data; null when not known. */
  areaM2: number | null;
}

/**
 * Trade counts per neighborhood, joined to the city's reference list so
 * neighborhoods with no trades still appear (with zeros). Ordered by sales,
 * then name; the "not recorded" bucket last.
 */
export function neighborhoodRows(result: Pick<AnalyticsResult, 'columns' | 'rows'>, reference: ReadonlyArray<{ name: string; area_m2: number }> | null): NeighborhoodRow[] {
  const byName = new Map<string, NeighborhoodRow>();
  for (const r of records(result)) {
    const name = asText(r.neighborhood);
    const median = r.median_last_sale;
    byName.set(name, {
      name,
      tradedProperties: asNumber(r.traded),
      sales: asNumber(r.sales),
      medianLastSaleUpx: typeof median === 'number' && Number.isFinite(median) && median > 0 ? median : null,
      areaM2: null,
    });
  }
  for (const n of reference ?? []) {
    const row = byName.get(n.name);
    const area = Number.isFinite(n.area_m2) && n.area_m2 > 0 ? n.area_m2 : null;
    if (row) row.areaM2 = area;
    else byName.set(n.name, { name: n.name, tradedProperties: 0, sales: 0, medianLastSaleUpx: null, areaM2: area });
  }
  return [...byName.values()].sort((a, b) => {
    if (a.name === '' || b.name === '') return a.name === '' ? 1 : -1;
    return b.sales - a.sales || a.name.localeCompare(b.name);
  });
}

/* --- city route segment ---------------------------------------------------------------- */

/** `/properties/overview/<segment>` for a city: the ledger keys cities by name. */
export function cityHref(city: string): string {
  return `/properties/overview/${encodeURIComponent(city)}`;
}

/** The city name from a route segment; null when it is not a usable name. */
export function cityFromSegment(segment: string | undefined): string | null {
  if (segment === undefined) return null;
  let name: string;
  try {
    name = decodeURIComponent(segment).trim();
  } catch {
    return null;
  }
  return name.length > 0 && name.length <= 64 ? name : null;
}

/* --- Upland status counts (F-401, F-402) ---------------------------------------------- */

/** Upland's own property statuses (Developers API), in display order. */
export const UPLAND_STATUSES = ['Owned', 'For sale', 'Locked', 'Unlocked', 'On Review'] as const;
export type UplandStatus = (typeof UPLAND_STATUSES)[number];

export interface StatusCounts {
  city: string;
  total: number;
  byStatus: Record<UplandStatus, number>;
  /** Properties whose status the ledger does not have (empty or unrecognised). */
  notReported: number;
}

/**
 * Property counts per Upland status from the property dimension (`POST
 * /analytics/query`, source `properties`, no range needed), per city, or
 * for one city.
 */
export function statusCountsSpec(city?: string): QuerySpec {
  return {
    source: 'properties',
    ...(city ? { filters: [{ field: 'city', op: 'eq', value: city }] } : {}),
    dimensions: [{ field: 'city' }, { field: 'api_status' }],
    measures: [{ fn: 'count', alias: 'properties' }],
    limit: 10_000,
  };
}

const STATUS_BY_KEY = new Map<string, UplandStatus>(UPLAND_STATUSES.map((s) => [s.toLowerCase(), s]));

function emptyCounts(city: string): StatusCounts {
  return { city, total: 0, byStatus: { Owned: 0, 'For sale': 0, Locked: 0, Unlocked: 0, 'On Review': 0 }, notReported: 0 };
}

/** Per-city counts, ordered by total properties (then name); rows without a city are left out. */
export function statusCounts(result: Pick<AnalyticsResult, 'columns' | 'rows'>): StatusCounts[] {
  const byCity = new Map<string, StatusCounts>();
  for (const r of records(result)) {
    const city = asText(r.city);
    if (!city) continue;
    const n = asNumber(r.properties);
    const c = byCity.get(city) ?? emptyCounts(city);
    const status = STATUS_BY_KEY.get(asText(r.api_status).trim().toLowerCase());
    if (status) c.byStatus[status] += n;
    else c.notReported += n;
    c.total += n;
    byCity.set(city, c);
  }
  return [...byCity.values()].sort((a, b) => b.total - a.total || a.city.localeCompare(b.city));
}

/** Every city's counts summed. */
export function totalStatusCounts(rows: readonly StatusCounts[]): StatusCounts {
  const t = emptyCounts('All cities');
  for (const c of rows) {
    t.total += c.total;
    t.notReported += c.notReported;
    for (const s of UPLAND_STATUSES) t.byStatus[s] += c.byStatus[s];
  }
  return t;
}
