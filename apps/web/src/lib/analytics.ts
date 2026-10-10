/**
 * The `POST /analytics/query` specs behind Home (F-190) and the leaderboards
 * (F-1606), and the shaping of their results. Pure: every spec takes its
 * time range as input, so a cache key never depends on the clock.
 *
 * Columns used here are the ledger's allow-listed ones per source
 * (upland-ledger `analytics/compile.ts`): `sales` (buyer, seller, price_upx,
 * seller_proceeds_upx, city), `treasures` (user_name, reward_upx),
 * `listings`, `actions` (uniq actor) and `accounts` (account, username).
 */
import type { AnalyticsResult, QuerySpec } from '@embers/ledger';

export type Cell = string | number | null;
export type Rec = Record<string, Cell>;

/** Result rows as objects keyed by column name. */
export function resultRecords(r: AnalyticsResult): Rec[] {
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i] ?? null])));
}

/** A numeric cell, or null when it is missing or not a finite number. */
export function numCell(rec: Rec | undefined, key: string): number | null {
  const v = rec?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function strCell(rec: Rec | undefined, key: string): string {
  const v = rec?.[key];
  return typeof v === 'string' ? v : '';
}

/* --- time ------------------------------------------------------------------ */

export interface Range {
  after: string;
  before: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** ISO instant without milliseconds; seconds dropped so a minute's reads share a cache key. */
export function isoMinute(ms: number): string {
  const d = new Date(Math.floor(ms / 60_000) * 60_000);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The trailing `hours` before `now`. */
export function trailingRange(hours: number, now: number): Range {
  return { after: isoMinute(now - hours * HOUR), before: isoMinute(now) };
}

/** PRD F-1606 timescopes: Today (UTC), Last week, Last month. */
export const SCOPES = ['today', 'week', 'month'] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = { today: 'Today', week: 'Last week', month: 'Last month' };

export function scopeRange(scope: Scope, now: number): Range {
  if (scope === 'today') return { after: isoMinute(Math.floor(now / DAY) * DAY), before: isoMinute(now) };
  return trailingRange(scope === 'week' ? 7 * 24 : 30 * 24, now);
}

/* --- Home (F-190) chain activity --------------------------------------------- */

/**
 * The first UTC day of a `days`-day window that ends with today. The
 * ledger's `after` is inclusive, so the start is `days - 1` days back:
 * 30 days means today and the 29 before it.
 */
export function dailyWindowStart(days: number, now: number): string {
  const d = new Date(Math.floor(now / DAY) * DAY - (days - 1) * DAY);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The line under the activity chart; says so when the ledger has fewer days than the window. */
export function activityCaption(total: number, days: number, daysWithData: number): string {
  const sum = new Intl.NumberFormat('en-US').format(total);
  const base = `${sum} transactions over the last ${days} UTC days, today so far`;
  return daysWithData < days ? `${base} (the ledger has ${daysWithData} of those days)` : base;
}

/* --- Home (F-190) live strip ------------------------------------------------ */

/** Distinct accounts that signed an action in the range (the chain's DAU over 24 h). */
export function activeAccountsSpec(range: Range): QuerySpec {
  return { source: 'actions', range, measures: [{ fn: 'uniq', field: 'actor', alias: 'accounts' }] };
}

/** Listings created in the range. */
export function listingsSpec(range: Range): QuerySpec {
  return { source: 'listings', range, measures: [{ fn: 'count', alias: 'listings' }] };
}

/** Property sales in the range: how many, and their total price. */
export function salesSpec(range: Range): QuerySpec {
  return {
    source: 'sales',
    range,
    measures: [
      { fn: 'count', alias: 'sales' },
      { fn: 'sum', field: 'price_upx', alias: 'volume_upx' },
    ],
  };
}

/* --- leaderboards (F-1606) --------------------------------------------------- */

export const LEADERBOARD_SIZE = 100;

export interface BoardRow {
  rank: number;
  /** A username (treasures) or a chain account (sales). */
  who: string;
  /** The ranked value. */
  value: number;
  /** Second figure shown beside it, when the board has one. */
  extra: number | null;
  /** Third figure (median price on the properties board). */
  extra2: number | null;
}

/** Ranks records by `valueKey` as the ledger ordered them, dropping blank names. */
export function rankRecords(recs: readonly Rec[], whoKey: string, valueKey: string, extraKey?: string, extra2Key?: string): BoardRow[] {
  return recs
    .filter((r) => strCell(r, whoKey).trim() !== '')
    .slice(0, LEADERBOARD_SIZE)
    .map((r, i) => ({
      rank: i + 1,
      who: strCell(r, whoKey),
      value: numCell(r, valueKey) ?? 0,
      extra: extraKey ? numCell(r, extraKey) : null,
      extra2: extra2Key ? numCell(r, extra2Key) : null,
    }));
}

/* Properties board: who bought the most (or spent the most on) properties. */

export const PROPERTY_BOARD_SORTS = ['bought', 'volume_upx'] as const;
export type PropertyBoardSort = (typeof PROPERTY_BOARD_SORTS)[number];

export function propertyBoardSpec(range: Range, sort: PropertyBoardSort, city?: string): QuerySpec {
  return {
    source: 'sales',
    range,
    filters: city ? [{ field: 'city', op: 'eq', value: city }] : undefined,
    dimensions: [{ field: 'buyer' }],
    measures: [
      { fn: 'count', alias: 'bought' },
      { fn: 'sum', field: 'price_upx', alias: 'volume_upx' },
      { fn: 'median', field: 'price_upx', alias: 'median_upx' },
    ],
    orderBy: [{ measure: sort, dir: 'desc' }],
    // One spare for a blank buyer, which rankRecords drops.
    limit: LEADERBOARD_SIZE + 1,
  };
}

export function propertyBoard(r: AnalyticsResult, sort: PropertyBoardSort): BoardRow[] {
  const other = sort === 'bought' ? 'volume_upx' : 'bought';
  return rankRecords(resultRecords(r), 'buyer', sort, other, 'median_upx');
}

/* Upland board: Treasures claimed, Total UPX proceeds, Trades. */

export const UPLAND_BOARDS = ['treasures', 'proceeds', 'trades'] as const;
export type UplandBoard = (typeof UPLAND_BOARDS)[number];
export const UPLAND_BOARD_LABELS: Record<UplandBoard, string> = {
  treasures: 'Treasures claimed',
  proceeds: 'Total UPX proceeds',
  trades: 'Trades',
};

export function treasureBoardSpec(range: Range): QuerySpec {
  return {
    source: 'treasures',
    range,
    dimensions: [{ field: 'user_name' }],
    measures: [
      { fn: 'count', alias: 'claimed' },
      { fn: 'sum', field: 'reward_upx', alias: 'reward_upx' },
    ],
    orderBy: [{ measure: 'claimed', dir: 'desc' }],
    limit: LEADERBOARD_SIZE + 1,
  };
}

export function proceedsBoardSpec(range: Range): QuerySpec {
  return {
    source: 'sales',
    range,
    dimensions: [{ field: 'seller' }],
    measures: [
      { fn: 'sum', field: 'seller_proceeds_upx', alias: 'proceeds_upx' },
      { fn: 'count', alias: 'sold' },
    ],
    orderBy: [{ measure: 'proceeds_upx', dir: 'desc' }],
    limit: LEADERBOARD_SIZE + 1,
  };
}

/**
 * Trades are counted from both sides of each sale. The query compiler groups
 * one column at a time and the `sales` source has no union of buyer and
 * seller, so each side is read as its own ranked list and merged.
 *
 * A merged top 100 from two truncated lists can be wrong: an account just
 * below the cut on both sides (99 buys, 99 sells) beats one at the top of a
 * single side (100 buys). So the merge tracks bounds. When a list came back
 * full, an account missing from it can have up to that list's smallest
 * value on that side. The ranking is exact only when every shown row is
 * fully known and nothing unseen or half-seen could reach the 100th total;
 * otherwise the lists are read deeper, up to the ledger's row limit.
 */
export const TRADE_DEPTHS = [1000, 4000, 10_000] as const;

export function tradeSideSpec(range: Range, side: 'buyer' | 'seller', limit: number = TRADE_DEPTHS[0]): QuerySpec {
  return {
    source: 'sales',
    range,
    dimensions: [{ field: side }],
    measures: [{ fn: 'count', alias: 'trades' }],
    orderBy: [{ measure: 'trades', dir: 'desc' }],
    limit,
  };
}

export interface TradesBoard {
  rows: BoardRow[];
  /** True when no account outside what was read could change the top 100. */
  exact: boolean;
  /** Rows read per side. */
  depth: number;
}

function sideCounts(r: AnalyticsResult, key: string): { counts: Map<string, number>; cap: number } {
  const counts = new Map<string, number>();
  let min = Number.POSITIVE_INFINITY;
  for (const rec of resultRecords(r)) {
    const n = numCell(rec, 'trades') ?? 0;
    min = Math.min(min, n);
    const who = strCell(rec, key);
    if (who.trim() !== '') counts.set(who, n);
  }
  return { counts, cap: Number.isFinite(min) ? min : 0 };
}

/** Buys + sells per account, ranked, with whether the ranking is provably exact at this depth. */
export function rankTrades(buys: AnalyticsResult, sells: AnalyticsResult, depth: number): TradesBoard {
  const b = sideCounts(buys, 'buyer');
  const s = sideCounts(sells, 'seller');
  // A list shorter than the depth is complete: missing from it means none on that side.
  const bCap = buys.rows.length >= depth ? b.cap : 0;
  const sCap = sells.rows.length >= depth ? s.cap : 0;
  const all = [...new Set([...b.counts.keys(), ...s.counts.keys()])].map((who) => {
    const buy = b.counts.get(who);
    const sell = s.counts.get(who);
    return { who, buys: buy ?? 0, sells: sell ?? 0, lower: (buy ?? 0) + (sell ?? 0), upper: (buy ?? bCap) + (sell ?? sCap) };
  });
  all.sort((x, y) => y.lower - x.lower || (x.who < y.who ? -1 : x.who > y.who ? 1 : 0));
  const top = all.slice(0, LEADERBOARD_SIZE);
  const threshold = top.length === LEADERBOARD_SIZE ? (top[LEADERBOARD_SIZE - 1]?.lower ?? 0) : 0;
  const unseen = bCap + sCap;
  const exact =
    top.every((r) => r.lower === r.upper) &&
    all.slice(LEADERBOARD_SIZE).every((r) => r.lower === r.upper || r.upper < threshold) &&
    (unseen === 0 || unseen < threshold);
  return {
    rows: top.map((r, i) => ({ rank: i + 1, who: r.who, value: r.lower, extra: r.buys, extra2: r.sells })),
    exact,
    depth,
  };
}

/** Reads both sides, deeper each round, until the merged top 100 is exact or the ledger's limit is reached. */
export async function loadTrades(range: Range, query: (spec: QuerySpec) => Promise<AnalyticsResult>): Promise<TradesBoard> {
  let board: TradesBoard = { rows: [], exact: false, depth: 0 };
  for (const depth of TRADE_DEPTHS) {
    // One after the other: both are heavy reads sharing the ledger's one slot.
    const buys = await query(tradeSideSpec(range, 'buyer', depth));
    const sells = await query(tradeSideSpec(range, 'seller', depth));
    board = rankTrades(buys, sells, depth);
    if (board.exact) return board;
  }
  return board;
}

/* Account → username, for boards that rank chain accounts. */

export function usernamesSpec(accounts: readonly string[]): QuerySpec {
  return {
    source: 'accounts',
    filters: [{ field: 'account', op: 'in', value: [...accounts] }],
    dimensions: [{ field: 'account' }, { field: 'username' }],
    measures: [{ fn: 'count', alias: 'n' }],
    limit: Math.max(1, accounts.length),
  };
}

export function usernameMap(r: AnalyticsResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const rec of resultRecords(r)) {
    const account = strCell(rec, 'account');
    const username = strCell(rec, 'username').trim();
    if (account && username) out.set(account, username);
  }
  return out;
}
