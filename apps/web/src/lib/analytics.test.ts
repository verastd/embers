import { QueryResultSchema } from '@embers/ledger';
import type { AnalyticsResult } from '@embers/ledger';
import { describe, expect, it } from 'vitest';

import {
  LEADERBOARD_SIZE,
  activeAccountsSpec,
  isoMinute,
  listingsSpec,
  mergeTrades,
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

  it('merges both sides of trading into one ranking', () => {
    const buys = result(['buyer', 'trades'], [['alice', 5], ['bob', 2], ['', 7]]);
    const sells = result(['seller', 'trades'], [['bob', 4], ['carol', 3], ['', 1]]);
    expect(mergeTrades(buys, sells)).toEqual([
      { rank: 1, who: 'bob', value: 6, extra: 2, extra2: 4 },
      { rank: 2, who: 'alice', value: 5, extra: 5, extra2: 0 },
      { rank: 3, who: 'carol', value: 3, extra: 0, extra2: 3 },
    ]);
  });

  it('breaks ties by account so the order is stable', () => {
    const buys = result(['buyer', 'trades'], [['zed', 1], ['amy', 1]]);
    expect(mergeTrades(buys, result(['seller', 'trades'], [])).map((r) => r.who)).toEqual(['amy', 'zed']);
  });

  it('maps accounts to usernames, ignoring blanks', () => {
    const r = result(['account', 'username', 'n'], [['abc', 'kingbo', 1], ['def', '', 1]]);
    expect([...usernameMap(r)]).toEqual([['abc', 'kingbo']]);
  });
});
