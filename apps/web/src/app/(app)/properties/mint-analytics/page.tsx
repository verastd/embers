'use client';

/**
 * Mint analytics (F-408): property mints over a timeframe, for every city,
 * one city or one neighborhood.
 *
 * - KPIs: mints in the window, split by how they were paid (UPX on chain,
 *   or settled off chain), top city and top neighborhood. One `POST
 *   /analytics/query` over the property dimension (`minted_at` in range,
 *   grouped by city, neighborhood and mint kind).
 * - Top minters: the ten chain accounts with the most mint events in the
 *   window (`POST /analytics/query`, source `events`). The chain's mint
 *   record does not name the city, so this list always covers every city.
 * - Mints: the newest mints (`/properties?sort=minted_at`), 50 per Load more,
 *   stopping at the start of the window.
 *
 * Not shown, because no ledger route has them: the FSA filter and FSA
 * counts (the ledger records how a mint was paid, not whether the property
 * is FSA), the user-level filter and level badges (no player levels), the
 * username filter (mints are keyed by chain account), and the minter on
 * each mint row.
 */
import { useSearchParams } from 'next/navigation';
import { AsyncButton, Block, DataState, DataTable, FilterBar, FilterField, PageHeader, Skeleton, StatTile, TileRow } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { Property, QueryResult as LedgerQueryResult } from '@embers/ledger';
import { Suspense, useMemo } from 'react';

import { ChipsField } from '@/components/data/ChipsField';
import { SearchFilterField } from '@/components/data/fields';
import { filterBarState } from '@/components/data/filterbar';
import { Region } from '@/components/data/Region';
import { countApplied, readEnum, readText } from '@/lib/filters';
import { formatInstant, formatInt, formatUpx, NONE } from '@/lib/format';
import { useLedgerQuery, useOffsetFeed } from '@/lib/hooks';
import type { QueryResult } from '@/lib/hooks';
import { instantRange, lastDays, mintBreakdownSpec, mintKindLabel, mintSummary, topMinters, topMintersSpec } from '@/lib/properties-analytics';
import type { Minter } from '@/lib/properties-analytics';
import { describeError, queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';

const KEYS = ['days', 'city', 'neighborhood'] as const;
const TIMEFRAMES = ['7', '30', '60', '90'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const DEFAULT_TIMEFRAME: Timeframe = '30';
const PAGE = 50;

const MINT_COLUMNS: Column<Property>[] = [
  { key: 'minted_at', label: 'Minted (UTC)', muted: true, render: (p) => formatInstant(p.minted_at) },
  { key: 'address', label: 'Address', render: (p) => p.address || `#${p.property_id}` },
  { key: 'neighborhood', label: 'Neighborhood', muted: true, render: (p) => p.neighborhood || NONE },
  { key: 'city', label: 'City', muted: true, render: (p) => p.city || NONE },
  { key: 'mint_kind', label: 'Paid', render: (p) => mintKindLabel(p.mint_kind) },
  { key: 'mint_price_upx', label: 'Mint price', num: true, render: (p) => (p.mint_price_upx > 0 ? formatUpx(p.mint_price_upx) : NONE) },
];

const MINTER_COLUMNS: Column<Minter>[] = [
  { key: 'rank', label: '#', num: true, width: 48, render: (m) => formatInt(m.rank) },
  { key: 'account', label: 'Account', mono: true, render: (m) => m.account },
  { key: 'mints', label: 'Mints', num: true, render: (m) => formatInt(m.mints) },
];

export default function MintAnalyticsPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <MintAnalytics />
    </Suspense>
  );
}

function tileState(q: QueryResult<unknown>): 'loading' | 'error' | 'ready' {
  if (q.view === 'error' || q.view === 'unauthenticated' || q.view === 'not-found') return 'error';
  return q.data === undefined ? 'loading' : 'ready';
}

function MintAnalytics() {
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(KEYS);
  const timeframe = readEnum(params, 'days', TIMEFRAMES) ?? DEFAULT_TIMEFRAME;
  const city = readText(params, 'city', 64);
  const neighborhood = readText(params, 'neighborhood');
  const range = lastDays(Number(timeframe));
  const start = instantRange(range).after;

  const spec = mintBreakdownSpec({ range, city, neighborhood });
  const breakdown = useLedgerQuery<LedgerQueryResult>(queryKey('/analytics/query#mints', spec), (c, signal) => c.analytics.query(spec, { signal }), {
    heavy: true,
    keepPrevious: true,
    isEmpty: (r) => r.rows.length === 0,
  });
  const summary = useMemo(() => (breakdown.data ? mintSummary(breakdown.data) : null), [breakdown.data]);

  const mintersSpec = topMintersSpec(range);
  const minters = useLedgerQuery<LedgerQueryResult>(queryKey('/analytics/query#minters', mintersSpec), (c, signal) => c.analytics.query(mintersSpec, { signal }), {
    heavy: true,
    keepPrevious: true,
    isEmpty: (r) => r.rows.length === 0,
  });
  const minterRows = useMemo(() => (minters.data ? topMinters(minters.data) : []), [minters.data]);

  const listParams = { city, neighborhood, sort: 'minted_at' as const, order: 'desc' as const };
  const feed = useOffsetFeed<Property>(queryKey('/properties#mints', { ...listParams, start }), (page, c, signal) => c.properties.list({ ...listParams, ...page }, { signal }), PAGE);
  const mintRows = feed.items.filter((p) => p.minted_at !== null && p.minted_at >= start);
  const reachedStart = feed.items.some((p) => p.minted_at === null || p.minted_at < start);
  const moreInWindow = feed.hasMore && !reachedStart;

  const d = filters.draft;
  const draftTimeframe = TIMEFRAMES.find((t) => t === d.days) ?? DEFAULT_TIMEFRAME;
  const applied = countApplied({ days: params.get('days') ?? undefined, city, neighborhood }, ['days', 'city', 'neighborhood']);
  const place = neighborhood ? `${neighborhood}${city ? `, ${city}` : ''}` : (city ?? 'all cities');
  const kpi = tileState(breakdown);
  const retry = () => breakdown.refetch();
  const resetAction = applied > 0 ? { label: 'Reset filters', onClick: filters.reset } : undefined;

  return (
    <>
      <PageHeader title="Mint analytics" lede="Who minted what, where and how it was paid, from the Upland ledger's mint records." />

      <FilterBar
        state={filterBarState(filters.dirty, (breakdown.fetching || feed.fetching) && !feed.loadingMore, applied)}
        appliedCount={applied}
        applyLabel="Analyze"
        applyPendingLabel="Analyzing…"
        onApply={async () => filters.apply()}
        onReset={filters.reset}
      >
        <ChipsField<Timeframe>
          label="Timeframe"
          value={draftTimeframe}
          onChange={(t) => filters.set('days', t === DEFAULT_TIMEFRAME ? '' : t)}
          options={TIMEFRAMES.map((t) => ({ value: t, label: `${t} days` }))}
        />
        <FilterField label="City">
          <SearchFilterField kind="city" label="City" value={d.city} onChange={(v) => filters.set('city', v)} width={200} />
        </FilterField>
        <FilterField label="Neighborhood">
          <SearchFilterField kind="neighborhood" label="Neighborhood" value={d.neighborhood} onChange={(v) => filters.set('neighborhood', v)} width={220} />
        </FilterField>
      </FilterBar>

      <Block id="kpis" title="Summary" note={`Mints in ${place}, last ${timeframe} days (UTC days, today included).`}>
        {breakdown.view === 'empty' ? (
          <DataState state="empty" emptyMessage={`No mints recorded in ${place} in the last ${timeframe} days`} emptyAction={resetAction?.label} onEmptyAction={resetAction?.onClick} />
        ) : (
          <>
            {summary?.truncated && (
              <DataState state="partial" partialMessage="The ledger capped this answer, so these counts are a lower bound. Narrow the place or timeframe." onRetryPartial={retry} />
            )}
            <DataState state={breakdown.view === 'refreshing' ? 'refreshing' : 'ready'}>
              <TileRow min={170}>
                <StatTile label="Mints" value={formatInt(summary?.total ?? 0)} state={kpi} onRetry={retry} />
                <StatTile label="Paid in UPX on chain" value={formatInt(summary?.onChainUpx ?? 0)} state={kpi} onRetry={retry} />
                <StatTile label="Settled off chain" value={formatInt(summary?.offChain ?? 0)} state={kpi} onRetry={retry} hint="FIAT or reward mints: no UPX moved on chain." />
                <StatTile label={summary?.topCity ? `Top city · ${formatInt(summary.topCity.count)} mints` : 'Top city'} value={summary?.topCity?.name ?? NONE} state={kpi} onRetry={retry} />
                <StatTile
                  label={summary?.topNeighborhood ? `Top neighborhood · ${formatInt(summary.topNeighborhood.count)} mints` : 'Top neighborhood'}
                  value={summary?.topNeighborhood?.name ?? NONE}
                  state={kpi}
                  onRetry={retry}
                />
              </TileRow>
            </DataState>
            {summary !== null && summary.withoutNeighborhood > 0 && (
              <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                {formatInt(summary.withoutNeighborhood)} of these mints have no neighborhood in the ledger and are left out of Top neighborhood.
              </p>
            )}
          </>
        )}
      </Block>

      <Block id="minters" title="Top minters" note={`Every city, last ${timeframe} days. The chain's mint record does not name the city.`}>
          <Region
            query={minters}
            skeleton={<DataTable<Minter> columns={MINTER_COLUMNS} rows={[]} loading skeletonRows={10} />}
            emptyMessage={`No mints recorded in the last ${timeframe} days`}
            emptyAction={timeframe !== '90' ? { label: 'Show 90 days', onClick: () => filters.applyNow({ days: '90' }) } : undefined}
          >
            {() => <DataTable<Minter> columns={MINTER_COLUMNS} rows={minterRows} rowKey={(m) => m.account} />}
          </Region>
        </Block>

        <Block id="mints" title="Mints" note={`Newest first, ${place}.`}>
          <Region
            query={feed}
            skeleton={<DataTable<Property> columns={MINT_COLUMNS} rows={[]} loading skeletonRows={10} />}
            emptyMessage={`No mints recorded in ${place}`}
            emptyAction={resetAction}
          >
            {() =>
              mintRows.length === 0 ? (
                <DataState state="empty" emptyMessage={`No mints in ${place} in the last ${timeframe} days`} emptyAction={resetAction?.label} onEmptyAction={resetAction?.onClick} />
              ) : (
                <DataTable<Property>
                  columns={MINT_COLUMNS}
                  rows={mintRows}
                  rowKey={(p) => p.property_id}
                  maxHeight={640}
                  footer={
                    <>
                      <span>{formatInt(mintRows.length)} shown</span>
                      {moreInWindow ? (
                        <AsyncButton label={`Load ${PAGE} more`} pendingLabel="Loading…" variant="secondary" size="dense" onAction={() => feed.loadMore()} />
                      ) : (
                        <span>{reachedStart ? 'Start of the timeframe' : 'End of results'}</span>
                      )}
                      {feed.loadMoreError && (
                        <span role="alert" style={{ flexBasis: '100%', color: 'var(--state-error)', font: 'var(--type-body-sm)' }}>
                          {describeError(feed.loadMoreError).title}. The rows above are still current.
                        </span>
                      )}
                    </>
                  }
                />
              )
            }
          </Region>
        </Block>
    </>
  );
}
