import { describe, expect, it } from 'vitest';
import { QueryResultSchema } from '@embers/ledger';
import type { QueryResult } from '@embers/ledger';

import { fixture } from './fixtures.test-helper';
import {
  FSA_ACTION,
  MINT_EVENT,
  accountLookupSpec,
  distinct,
  latestMints,
  latestMintsSpec,
  mintKpiSpec,
  mintKpis,
  placesById,
  propertyLookupSpec,
  rowsOf,
  topMinters,
  topMintersSpec,
  usernamesByAccount,
} from './mints';

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

function result(columns: Array<[string, 'string' | 'number' | 'time']>, rows: Array<Array<string | number | null>>): QueryResult {
  return QueryResultSchema.parse({
    columns: columns.map(([name, type]) => ({ name, type })),
    rows,
    stats: { rows: rows.length, elapsed_ms: 1, rows_read: 1, bytes_read: 1, truncated: false, table: 'events', dedup: 'approximate' },
    sql: '',
    chain: 'upland',
  });
}

describe('mint query specs', () => {
  it('reads property_minted events in a 24 h window ending now', () => {
    const spec = mintKpiSpec(NOW);
    expect(spec.source).toBe('events');
    expect(spec.filters).toEqual([{ field: 'event_type', op: 'eq', value: MINT_EVENT }]);
    expect(spec.range).toEqual({ after: '2026-10-08T12:00:00.000Z', before: '2026-10-09T12:00:00.000Z' });
    expect(spec.dimensions).toEqual([{ field: 'action' }, { field: 'city_id' }]);
  });

  it('ranks minters by count, top 10', () => {
    const spec = topMintersSpec(NOW);
    expect(spec.orderBy).toEqual([{ measure: 'mints', dir: 'desc' }]);
    expect(spec.limit).toBe(10);
  });

  it('lists the newest mints within 7 days, newest first, at most 4 dimensions', () => {
    const spec = latestMintsSpec(NOW, 50);
    expect(spec.range?.after).toBe('2026-10-02T12:00:00.000Z');
    expect(spec.dimensions).toHaveLength(4);
    expect(spec.orderBy).toEqual([{ dimension: 0, dir: 'desc' }]);
    expect(spec.limit).toBe(50);
  });

  it('looks up places and usernames by id, no range (dimension sources)', () => {
    const p = propertyLookupSpec(['1', '2']);
    expect(p).toMatchObject({ source: 'properties', filters: [{ field: 'property_id', op: 'in', value: ['1', '2'] }], limit: 2 });
    expect(p.range).toBeUndefined();
    const a = accountLookupSpec(['abc']);
    expect(a).toMatchObject({ source: 'accounts', filters: [{ field: 'account', op: 'in', value: ['abc'] }], limit: 1 });
    expect(accountLookupSpec([]).limit).toBe(1);
  });
});

describe('reading mint results', () => {
  it('rowsOf keys cells by column name', () => {
    const r = fixture('POST_analytics_query', QueryResultSchema);
    expect(rowsOf(r)[0]).toEqual({ city: 'Los Angeles', sales: 420, median_price: 15000 });
  });

  it('sums the KPIs: total, FSA (a4) and the top city', () => {
    const r = result(
      [
        ['action', 'string'],
        ['city_id', 'string'],
        ['mints', 'number'],
      ],
      [
        [FSA_ACTION, 'Las Vegas, NV', 7],
        ['a44', 'Las Vegas, NV', 3],
        [FSA_ACTION, 'Cleveland, OH', 4],
        ['i44', '', 2],
      ],
    );
    expect(mintKpis(r)).toEqual({ total: 16, fsa: 11, topCity: { city: 'Las Vegas, NV', mints: 10 } });
  });

  it('has no top city without mints, and breaks ties by name', () => {
    expect(mintKpis(result([['action', 'string'], ['city_id', 'string'], ['mints', 'number']], []))).toEqual({ total: 0, fsa: 0, topCity: null });
    const tie = result(
      [
        ['action', 'string'],
        ['city_id', 'string'],
        ['mints', 'number'],
      ],
      [
        ['a44', 'Rome, RM', 2],
        ['a44', 'Detroit, MI', 2],
      ],
    );
    expect(mintKpis(tie).topCity).toEqual({ city: 'Detroit, MI', mints: 2 });
  });

  it('ranks minters', () => {
    const r = result(
      [
        ['account', 'string'],
        ['mints', 'number'],
      ],
      [
        ['bbb', 3],
        ['aaa', 6],
        ['', 9],
        ['ccc', 3],
      ],
    );
    expect(topMinters(r)).toEqual([
      { rank: 1, account: 'aaa', mints: 6 },
      { rank: 2, account: 'bbb', mints: 3 },
      { rank: 3, account: 'ccc', mints: 3 },
    ]);
  });

  it('reads the latest mints newest first, FSA from the action, no price as null', () => {
    const r = result(
      [
        ['timestamp', 'time'],
        ['property_id', 'string'],
        ['account', 'string'],
        ['action', 'string'],
        ['mint_price_upx', 'number'],
      ],
      [
        ['2026-10-09T00:05:00.000Z', '2', 'acct2', 'a44', 0],
        ['2026-10-09T00:10:00.000Z', '1', 'acct1', 'a4', 10450],
        ['2026-10-09T00:01:00.000Z', '3', 'acct3', 'i44', null],
        ['2026-10-09T00:00:00.000Z', '', 'x', 'a4', 5],
      ],
    );
    const rows = latestMints(r);
    expect(rows.map((m) => m.property_id)).toEqual(['1', '2', '3']);
    expect(rows[0]).toEqual({ key: '2026-10-09T00:10:00.000Z|1', timestamp: '2026-10-09T00:10:00.000Z', property_id: '1', account: 'acct1', action: 'a4', fsa: true, mint_price_upx: 10450 });
    expect(rows[1]?.mint_price_upx).toBeNull();
    expect(rows[2]?.fsa).toBe(false);
  });

  it('maps places and usernames by id', () => {
    const places = placesById(
      result(
        [
          ['property_id', 'string'],
          ['address', 'string'],
          ['city', 'string'],
          ['neighborhood', 'string'],
          ['n', 'number'],
        ],
        [
          ['1', '2506 SEARSDALE AVE', 'Cleveland', '', 1],
          ['', 'nowhere', '', '', 1],
        ],
      ),
    );
    expect([...places.keys()]).toEqual(['1']);
    expect(places.get('1')).toEqual({ address: '2506 SEARSDALE AVE', city: 'Cleveland', neighborhood: '' });
    const names = usernamesByAccount(
      result(
        [
          ['account', 'string'],
          ['username', 'string'],
          ['n', 'number'],
        ],
        [
          ['ymc55j4fboxi', 'kingbo', 1],
          ['abc', '', 1],
        ],
      ),
    );
    expect([...names]).toEqual([['ymc55j4fboxi', 'kingbo']]);
  });

  it('distinct keeps first-seen order and drops blanks', () => {
    expect(distinct(['b', 'a', '', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('coerces numeric strings and ignores junk counts', () => {
    const r = result(
      [
        ['account', 'string'],
        ['mints', 'number'],
      ],
      [['a', 2]],
    );
    // A string count (some ClickHouse versions send UInt64 as strings) still counts.
    const asString = { ...r, rows: [['a', '5'] as Array<string | number | null>, ['b', 'x']] };
    expect(topMinters(asString)).toEqual([
      { rank: 1, account: 'a', mints: 5 },
      { rank: 2, account: 'b', mints: 0 },
    ]);
  });
});
