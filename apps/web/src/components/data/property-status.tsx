'use client';

/**
 * Upland property status counts (F-401 KPIs and city columns, F-402 KPIs):
 * how many properties are Owned, For sale, Locked, Unlocked (not minted
 * yet) or On Review, from one `POST /analytics/query` over the property
 * dimension (source `properties`, grouped by city and `api_status`). The
 * status is Upland's own, crawled daily; properties without one are counted
 * as "not reported", never folded into a status.
 */
import { Block, DataState, DataTable, StatTile, TileRow } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { QueryResult as LedgerQueryResult } from '@embers/ledger';
import Link from 'next/link';
import { useMemo } from 'react';

import { Region } from './Region';
import { formatInt, formatPercent } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import type { QueryResult } from '@/lib/hooks';
import { cityHref, statusCounts, statusCountsSpec, totalStatusCounts, UPLAND_STATUSES } from '@/lib/properties-analytics';
import type { StatusCounts, UplandStatus } from '@/lib/properties-analytics';
import { queryKey } from '@/lib/query-core';

const LABELS: Record<UplandStatus, string> = {
  Owned: 'Owned',
  'For sale': 'For sale',
  Locked: 'Locked',
  Unlocked: 'Unminted',
  'On Review': 'On review',
};
const HINTS: Partial<Record<UplandStatus, string>> = {
  Unlocked: 'Upland status "Unlocked": open to mint, not minted yet.',
  'For sale': 'Listed for sale in Upland, in UPX or USD (the status does not say which).',
};

export function useStatusCounts(city?: string, enabled = true): QueryResult<LedgerQueryResult> {
  const spec = statusCountsSpec(city);
  return useLedgerQuery<LedgerQueryResult>(enabled ? queryKey('/analytics/query#status', spec) : null, (c, signal) => c.analytics.query(spec, { signal }), {
    heavy: true,
    isEmpty: (r) => r.rows.length === 0,
  });
}

function tileState(q: QueryResult<unknown>): 'loading' | 'error' | 'ready' {
  if (q.view === 'error' || q.view === 'unauthenticated' || q.view === 'not-found') return 'error';
  return q.data === undefined ? 'loading' : 'ready';
}

/** Total plus one tile per status, for all cities or one. */
export function StatusTiles({ query, city }: { query: QueryResult<LedgerQueryResult>; city?: string }) {
  const counts = useMemo(() => {
    const rows = query.data ? statusCounts(query.data) : [];
    return city ? (rows.find((r) => r.city === city) ?? null) : totalStatusCounts(rows);
  }, [query.data, city]);
  const state = tileState(query);
  const retry = () => query.refetch();
  if (query.view === 'empty' || (state === 'ready' && (counts === null || counts.total === 0))) {
    return <DataState state="empty" emptyMessage={city ? `The ledger has no properties recorded for ${city}` : 'The ledger has no properties recorded'} />;
  }
  return (
    <>
      <TileRow min={150}>
        <StatTile label="Properties" value={formatInt(counts?.total ?? 0)} state={state} onRetry={retry} />
        {UPLAND_STATUSES.map((s) => (
          <StatTile key={s} label={LABELS[s]} value={formatInt(counts?.byStatus[s] ?? 0)} hint={HINTS[s]} state={state} onRetry={retry} />
        ))}
      </TileRow>
      {counts !== null && counts.notReported > 0 && (
        <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
          {formatInt(counts.notReported)} properties ({formatPercent(counts.notReported / counts.total)}) have no Upland status in the ledger and are counted in Properties only.
        </p>
      )}
    </>
  );
}

const COLUMNS: Column<StatusCounts>[] = [
  {
    key: 'city',
    label: 'City',
    render: (c) => (
      <Link href={cityHref(c.city)} style={{ color: 'var(--text-link)' }}>
        {c.city}
      </Link>
    ),
  },
  { key: 'total', label: 'Properties', num: true, render: (c) => formatInt(c.total) },
  ...UPLAND_STATUSES.map((s): Column<StatusCounts> => ({ key: s, label: LABELS[s], hint: HINTS[s], num: true, render: (c) => formatInt(c.byStatus[s]) })),
  { key: 'minted', label: 'Minted', hint: 'Share of properties that are not Unminted.', num: true, render: (c) => (c.total > 0 ? formatPercent(1 - c.byStatus.Unlocked / c.total) : '—') },
];

/** Status counts for every city (F-401). */
export function StatusByCity({ query }: { query: QueryResult<LedgerQueryResult> }) {
  const rows = useMemo(() => (query.data ? statusCounts(query.data) : []), [query.data]);
  return (
    <Block id="status-cities" title="Property status by city" note="Upland's own status for every property, crawled daily.">
      <Region query={query} skeleton={<DataTable<StatusCounts> columns={COLUMNS} rows={[]} loading skeletonRows={10} />} emptyMessage="The ledger has no properties recorded">
        {() => <DataTable<StatusCounts> columns={COLUMNS} rows={rows} rowKey={(c) => c.city} maxHeight={560} footer={<span>{formatInt(rows.length)} cities</span>} />}
      </Region>
    </Block>
  );
}
