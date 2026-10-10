import { QueryResultSchema } from '@embers/ledger';
import type { AnalyticsResult, QuerySpec } from '@embers/ledger';
import { describe, expect, it } from 'vitest';

import {
  LEADERBOARD_SIZE,
  activeAccountsSpec,
  activityCaption,
  dailyWindowStart,
  isoMinute,
  listingsSpec,
  loadTrades,
  rankTrades,
  numCell,
  proceedsBoardSpec,
  propertyBoard,
  propertyBoardSpec,
  rankRecords,
  resultRecords,
  salesSpec,
  scopeRange,
  strCell,
  tradeSideSpec,
  trailingRange,
  treasureBoardSpec,
  usernameMap,
  usernamesSpec,
} from './analytics';
import { fixture } from './fixtures.test-helper';

const NOW = Date.parse('2026-10-10T15:42:31.250Z');

function result(columns: string[], rows: Array<Array<string | number | null>>): AnalyticsResult {
  return {
    columns: columns.map((name, i) => ({ name, type: typeof rows[0]?.[i] === 'number' ? 'number' : 'string' })),
    rows,
    stats: { rows: rows.length, elapsed_ms: 1, rows_read: 1, bytes_read: 1, truncated: false, table: 'events', dedup: 'approximate' },
    sql: '',
  };
}

describe('results', () => {
  it('turns rows into records keyed by column', () => {
    const recs = resultRecords(fixture('POST_analytics_query', QueryResultSchema));
    expect(recs[0]).toEqual({ city: 'Los Angeles', sales: 420, median_price: 15000 });
    expect(numCell(recs[0], 'sales')).toBe(420);
    expect(numCell(recs[0], 'city')).toBeNull();
    expect(numCell(undefined, 'sales')).toBeNull();
    expect(strCell(recs[0], 'city')).toBe('Los Angeles');
    expect(strCell(recs[0], 'sales')).toBe('');
  });
});

describe('time ranges', () => {
  it('drops seconds so a minute of reads shares a key', () => {
    expect(isoMinute(NOW)).toBe('2026-10-10T15:42:00Z');
    expect(trailingRange(24, NOW)).toEqual({ after: '2026-10-09T15:42:00Z', before: '2026-10-10T15:42:00Z' });
  });

  it('maps the PRD timescopes', () => {
    expect(scopeRange('today', NOW)).toEqual({ after: '2026-10-10T00:00:00Z', before: '2026-10-10T15:42:00Z' });
    expect(scopeRange('week', NOW).after).toBe('2026-10-03T15:42:00Z');
    expect(scopeRange('month', NOW).after).toBe('2026-09-10T15:42:00Z');
  });
});

describe('chain activity window', () => {
  it('starts 29 days before today for a 30-day window, because after is inclusive', () => {
    expect(dailyWindowStart(30, NOW)).toBe('2026-09-11T00:00:00Z');
    const days = (Date.parse('2026-10-10T00:00:00Z') - Date.parse(dailyWindowStart(30, NOW))) / 86_400_000 + 1;
    expect(days).toBe(30);
    expect(dailyWindowStart(1, NOW)).toBe('2026-10-10T00:00:00Z');
  });

  it('captions the window it asked for, and says when the ledger has fewer days', () => {
    expect(activityCaption(3_387_506, 30, 30)).toBe('3,387,506 transactions over the last 30 UTC days, today so far');
    expect(activityCaption(3_387_506, 30, 7)).toBe('3,387,506 transactions over the last 30 UTC days, today so far (the ledger has 7 of those days)');
  });
});

describe('specs', () => {
  const range = trailingRange(24, NOW);

  it('asks for the home figures', () => {
    expect(activeAccountsSpec(range)).toEqual({ source: 'actions', range, measures: [{ fn: 'uniq', field: 'actor', alias: 'accounts' }] });
    expect(listingsSpec(range).source).toBe('listings');
    expect(salesSpec(range).measures.map((m) => m.alias)).toEqual(['sales', 'volume_upx']);
  });

  it('ranks property buyers, filtered by city when given', () => {
    const spec = propertyBoardSpec(range, 'volume_upx', 'Rome');
    expect(spec.filters).toEqual([{ field: 'city', op: 'eq', value: 'Rome' }]);
    expect(spec.orderBy).toEqual([{ measure: 'volume_upx', dir: 'desc' }]);
    expect(spec.limit).toBe(LEADERBOARD_SIZE + 1);
    expect(propertyBoardSpec(range, 'bought').filters).toBeUndefined();
  });

  it('builds the Upland boards', () => {
    expect(treasureBoardSpec(range).dimensions).toEqual([{ field: 'user_name' }]);
    expect(proceedsBoardSpec(range).measures[0]).toEqual({ fn: 'sum', field: 'seller_proceeds_upx', alias: 'proceeds_upx' });
    expect(tradeSideSpec(range, 'seller').dimensions).toEqual([{ field: 'seller' }]);
    expect(tradeSideSpec(range, 'buyer', 4000).limit).toBe(4000);
  });

  it('looks usernames up for a set of accounts', () => {
    const spec = usernamesSpec(['a', 'b']);
    expect(spec.filters).toEqual([{ field: 'account', op: 'in', value: ['a', 'b'] }]);
    expect(spec.limit).toBe(2);
    expect(usernamesSpec([]).limit).toBe(1);
  });
});

describe('boards', () => {
  it('ranks records, skipping blank names and capping at 100', () => {
    const rows = [['', 9, 1], ...Array.from({ length: 120 }, (_, i) => [`acct${i}`, 200 - i, i])];
    const board = rankRecords(resultRecords(result(['buyer', 'bought', 'volume_upx'], rows)), 'buyer', 'bought', 'volume_upx');
    expect(board).toHaveLength(LEADERBOARD_SIZE);
    expect(board[0]).toEqual({ rank: 1, who: 'acct0', value: 200, extra: 0, extra2: null });
  });

  it('shapes the property board around the chosen measure', () => {
    const r = result(['buyer', 'bought', 'volume_upx', 'median_upx'], [['alice', 3, 90000, 30000]]);
    expect(propertyBoard(r, 'bought')[0]).toEqual({ rank: 1, who: 'alice', value: 3, extra: 90000, extra2: 30000 });
    expect(propertyBoard(r, 'volume_upx')[0]).toEqual({ rank: 1, who: 'alice', value: 90000, extra: 3, extra2: 30000 });
  });

  it('merges both sides of trading into one ranking; complete lists make it exact', () => {
    const buys = result(['buyer', 'trades'], [['alice', 5], ['bob', 2], ['', 7]]);
    const sells = result(['seller', 'trades'], [['bob', 4], ['carol', 3], ['', 1]]);
    expect(rankTrades(buys, sells, 1000)).toEqual({
      rows: [
        { rank: 1, who: 'bob', value: 6, extra: 2, extra2: 4 },
        { rank: 2, who: 'alice', value: 5, extra: 5, extra2: 0 },
        { rank: 3, who: 'carol', value: 3, extra: 0, extra2: 3 },
      ],
      exact: true,
      depth: 1000,
    });
  });

  it('breaks ties by account so the order is stable', () => {
    const buys = result(['buyer', 'trades'], [['zed', 1], ['amy', 1]]);
    expect(rankTrades(buys, result(['seller', 'trades'], []), 1000).rows.map((r) => r.who)).toEqual(['amy', 'zed']);
  });

  /**
   * Codex review on #11: 1000 one-sided traders with 100 buys and 1000 with
   * 100 sells fill both top-1000 lists, so "x" with 99 buys and 99 sells
   * (198, the true #1) is in neither.
   */
  const buyers = Array.from({ length: 1000 }, (_, i) => [`b${String(i).padStart(4, '0')}`, 100] as [string, number]);
  const sellers = Array.from({ length: 1000 }, (_, i) => [`s${String(i).padStart(4, '0')}`, 100] as [string, number]);
  const allBuys: Array<[string, number]> = [...buyers, ['x', 99]];
  const allSells: Array<[string, number]> = [...sellers, ['x', 99]];
  const side = (key: string, rows: Array<[string, number]>, limit: number) => result([key, 'trades'], rows.slice(0, limit));

  it('does not call a ranking exact when an account below both cuts could top it (99 buys + 99 sells)', () => {
    const board = rankTrades(side('buyer', allBuys, 1000), side('seller', allSells, 1000), 1000);
    expect(board.exact).toBe(false);
    expect(board.rows.some((r) => r.who === 'x')).toBe(false);
  });

  it('reads deeper until the ranking is exact, and then ranks the 99/99 account first', async () => {
    const limits: number[] = [];
    const query = async (spec: QuerySpec): Promise<AnalyticsResult> => {
      const limit = spec.limit ?? 1000;
      limits.push(limit);
      const isBuyer = JSON.stringify(spec.dimensions) === JSON.stringify([{ field: 'buyer' }]);
      return isBuyer ? side('buyer', allBuys, limit) : side('seller', allSells, limit);
    };
    const board = await loadTrades(trailingRange(24, NOW), query);
    expect(limits).toEqual([1000, 1000, 4000, 4000]);
    expect(board.exact).toBe(true);
    expect(board.depth).toBe(4000);
    expect(board.rows[0]).toEqual({ rank: 1, who: 'x', value: 198, extra: 99, extra2: 99 });
    expect(board.rows).toHaveLength(LEADERBOARD_SIZE);
  });

  it('reports a ranking it cannot prove at the deepest read as not exact', async () => {
    // Every list is always full at any depth, and one-sided totals tie the unseen bound.
    const full = (key: string, limit: number) => result([key, 'trades'], Array.from({ length: limit }, (_, i) => [`${key}${i}`, 50]));
    const board = await loadTrades(trailingRange(24, NOW), async (spec) => full(String((spec.dimensions?.[0] as { field: string }).field), spec.limit ?? 1000));
    expect(board.exact).toBe(false);
    expect(board.depth).toBe(10_000);
  });

  it('is exact only once neither list is cut off where an unseen account could still rank', () => {
    // At depth 2 the buy list is full: an unseen account could have up to 3 buys and outrank nobody-yet (fewer than 100 rows).
    const buys = result(['buyer', 'trades'], [['alice', 9], ['bob', 3]]);
    const sells = result(['seller', 'trades'], [['bob', 1]]);
    expect(rankTrades(buys, sells, 2).exact).toBe(false);
    expect(rankTrades(buys, sells, 3).exact).toBe(true);
  });

  it('maps accounts to usernames, ignoring blanks', () => {
    const r = result(['account', 'username', 'n'], [['abc', 'kingbo', 1], ['def', '', 1]]);
    expect([...usernameMap(r)]).toEqual([['abc', 'kingbo']]);
  });
});
