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
 * Trades are counted from both sides of each sale, which the ledger groups
 * one side at a time. Each side is read this deep so the merged top 100
 * cannot miss an account that is mid-table on both sides.
 */
export const TRADE_SIDE_DEPTH = 1000;

export function tradeSideSpec(range: Range, side: 'buyer' | 'seller'): QuerySpec {
  return {
    source: 'sales',
    range,
    dimensions: [{ field: side }],
    measures: [{ fn: 'count', alias: 'trades' }],
    orderBy: [{ measure: 'trades', dir: 'desc' }],
    limit: TRADE_SIDE_DEPTH,
  };
}

/** Buys + sells per account, ranked; `extra` is buys, `extra2` sells. */
export function mergeTrades(buys: AnalyticsResult, sells: AnalyticsResult): BoardRow[] {
  const totals = new Map<string, { buys: number; sells: number }>();
  for (const r of resultRecords(buys)) {
    const who = strCell(r, 'buyer');
    if (who.trim() === '') continue;
    totals.set(who, { buys: numCell(r, 'trades') ?? 0, sells: 0 });
  }
  for (const r of resultRecords(sells)) {
    const who = strCell(r, 'seller');
    if (who.trim() === '') continue;
    const t = totals.get(who) ?? { buys: 0, sells: 0 };
    t.sells = numCell(r, 'trades') ?? 0;
    totals.set(who, t);
  }
  return [...totals.entries()]
    .map(([who, t]) => ({ who, value: t.buys + t.sells, extra: t.buys, extra2: t.sells }))
    .sort((a, b) => b.value - a.value || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0))
    .slice(0, LEADERBOARD_SIZE)
    .map((r, i) => ({ rank: i + 1, ...r }));
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
