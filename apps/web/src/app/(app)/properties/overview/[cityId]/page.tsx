'use client';

/**
 * City overview (F-402). The route segment is the city's name as the ledger
 * keys it (`/properties/overview/Los%20Angeles`).
 *
 * - KPI tiles over the window from `/market/cities?city=`, plus the floor:
 *   the lowest open UPX and USD asks from `/listings?open=true` (listings of
 *   the last 180 days still live), each its own tile with its own states.
 * - Neighborhood table: traded properties, recorded sales and median last
 *   sale per neighborhood from the property dimension (`POST
 *   /analytics/query`, source `properties`), joined to Upland's neighborhood
 *   list (`/neighborhoods?city=`) for names and area. If only the list
 *   fails, the table still shows with a partial banner and its own Retry.
 *
 * - Property status tiles: the city's properties by Upland status, from
 *   the property dimension (`property-status.tsx`).
 *
 * Not shown, because no ledger route has them: the
 * collection table (no property-to-collection link), and the neighborhood
 * map (no map component in the design system yet; MapLibre would be a new
 * dependency).
 */
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Block, Button, DataState, DataTable, PageHeader, Skeleton, StatTile, TileRow } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { Listing, Neighborhood, QueryResult as LedgerQueryResult } from '@embers/ledger';
import { Suspense, useMemo } from 'react';

import { DataThrough, readWindow, useCityDays, windowPhrase, WindowChips } from '@/components/data/market-window';
import { StatusTiles, useStatusCounts } from '@/components/data/property-status';
import { Region } from '@/components/data/Region';
import { formatDay, formatInt, formatMultiple, formatUpx, formatUsd, NONE } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import type { QueryResult } from '@/lib/hooks';
import { cityFromSegment, cityStats, latestDay, marketStaleMinutes, neighborhoodRows, neighborhoodTradeSpec } from '@/lib/properties-analytics';
import type { DatedValue, NeighborhoodRow } from '@/lib/properties-analytics';
import { describeError, queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';

const KEYS = ['window'] as const;

const HOOD_COLUMNS: Column<NeighborhoodRow>[] = [
  { key: 'name', label: 'Neighborhood', render: (n) => (n.name === '' ? <span style={{ color: 'var(--text-muted)' }}>Not recorded</span> : n.name) },
  { key: 'traded', label: 'Traded properties', hint: 'Properties with at least one sale in the chain record (from April 2025).', num: true, render: (n) => formatInt(n.tradedProperties) },
  { key: 'sales', label: 'Sales recorded', num: true, render: (n) => formatInt(n.sales) },
  { key: 'median', label: 'Median last sale', hint: "Median of each traded property's most recent sale price.", num: true, render: (n) => (n.medianLastSaleUpx === null ? NONE : formatUpx(n.medianLastSaleUpx)) },
  { key: 'area', label: 'Area', num: true, render: (n) => (n.areaM2 === null ? NONE : `${(n.areaM2 / 1_000_000).toFixed(2)} km²`) },
];

export default function CityOverviewPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <CityOverview />
    </Suspense>
  );
}

function tileState(q: QueryResult<unknown>): 'loading' | 'error' | 'ready' {
  if (q.view === 'error' || q.view === 'unauthenticated' || q.view === 'not-found') return 'error';
  return q.data === undefined ? 'loading' : 'ready';
}

const dated = (v: DatedValue | null, fmt: (n: number) => string): string => (v === null ? NONE : fmt(v.value));

function CityOverview() {
  const router = useRouter();
  const routeParams = useParams<{ cityId: string }>();
  const city = cityFromSegment(routeParams?.cityId);
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(KEYS);
  const win = readWindow(params.get('window'));

  const days = useCityDays(win, city ?? undefined);
  const stats = useMemo(() => cityStats(days.data ?? []).find((c) => c.city === city) ?? null, [days.data, city]);
  const latest = latestDay(days.data ?? []);
  const status = useStatusCounts(city ?? undefined, city !== null);

  const floorUpx = useLedgerQuery<Listing | null>(city ? queryKey('/listings#floor-upx', { city }) : null, async (c, signal) => {
    const page = await c.listings.list({ city: city!, open: true, book: 'upx', sort: 'ask_upx', order: 'asc', min_ask: 1, limit: 1 }, { signal });
    return page.data[0] ?? null;
  });
  const floorUsd = useLedgerQuery<Listing | null>(city ? queryKey('/listings#floor-usd', { city }) : null, async (c, signal) => {
    const page = await c.listings.list({ city: city!, open: true, book: 'fiat', sort: 'ask_fiat', order: 'asc', limit: 1 }, { signal });
    return page.data[0] ?? null;
  });

  const trades = useLedgerQuery<LedgerQueryResult>(
    city ? queryKey('/analytics/query#neighborhood-trades', { city }) : null,
    (c, signal) => c.analytics.query(neighborhoodTradeSpec(city!), { signal }),
    { heavy: true, isEmpty: (r) => r.rows.length === 0 },
  );
  const reference = useLedgerQuery<Neighborhood[]>(city ? queryKey('/neighborhoods', { city, limit: 1000 }) : null, async (c, signal) => {
    const page = await c.neighborhoods.list({ city: city!, limit: 1000 }, { signal });
    return page.data;
  });
  const hoodRows = useMemo(() => (trades.data ? neighborhoodRows(trades.data, reference.data ?? null) : []), [trades.data, reference.data]);

  if (city === null) {
    return (
      <>
        <PageHeader title="City overview" />
        <DataState state="empty" emptyMessage="That is not a city name." emptyAction="All cities" onEmptyAction={() => router.push('/properties/overview')} />
      </>
    );
  }

  const state = tileState(days);
  const retry = () => days.refetch();
  const floorTile = (q: QueryResult<Listing | null>, label: string, value: (l: Listing) => string) => (
    <StatTile
      label={label}
      value={q.data ? value(q.data) : 'None open'}
      state={tileState(q)}
      onRetry={() => q.refetch()}
      hint={q.data ? `${q.data.address}, listed ${formatDay(q.data.timestamp)}` : undefined}
    />
  );
  const referenceFailed = reference.view === 'error' || reference.view === 'unauthenticated';

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/properties/overview" style={{ color: 'inherit' }}>
            Properties overview
          </Link>
        }
        title={city}
        lede="Market activity, floor asks and neighborhoods for one city, from the Upland ledger."
        aside={<DataThrough day={latest} />}
      />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', justifyContent: 'space-between' }}>
        <WindowChips value={win} onChange={(w) => filters.applyNow({ window: w === '7' ? '' : w })} />
        <Button as={Link} href={`/properties/statistics?city=${encodeURIComponent(city)}`} variant="secondary" size="dense" icon="chart-line">
          Statistics for {city}
        </Button>
      </div>

      <Block id="kpis" title="Market" note={`Totals over ${windowPhrase(win)}; medians from the latest day that had one.`}>
        {days.view === 'empty' ? (
          <DataState
            state="empty"
            emptyMessage={`No market activity recorded for ${city} in ${windowPhrase(win)}`}
            emptyAction={win !== '30' ? 'Show the last 30 days' : 'All cities'}
            onEmptyAction={() => (win !== '30' ? filters.applyNow({ window: '30' }) : router.push('/properties/overview'))}
          />
        ) : (
          <DataState state={days.view === 'refreshing' ? 'refreshing' : 'ready'}>
            <TileRow min={160}>
              <StatTile label="Sales" value={formatInt(stats?.sales ?? 0)} state={state} onRetry={retry} />
              <StatTile label="Sales volume" value={formatUpx(stats?.volumeUpx ?? 0, { compact: true })} state={state} onRetry={retry} />
              <StatTile label="Median sale" value={dated(stats?.medianSaleUpx ?? null, (n) => formatUpx(n))} state={state} onRetry={retry} />
              <StatTile label="Sale ÷ mint" value={dated(stats?.medianSaleToMint ?? null, formatMultiple)} state={state} onRetry={retry} />
              <StatTile label="New listings" value={formatInt(stats?.listingsNew ?? 0)} state={state} onRetry={retry} />
              <StatTile label="Mints" value={formatInt(stats?.mints ?? 0)} state={state} onRetry={retry} />
            </TileRow>
          </DataState>
        )}
      </Block>

      <Block id="status" title="Property status" note={`Every ${city} property by its Upland status.`}>
        <StatusTiles query={status} city={city} />
      </Block>

      <Block id="floor" title="Floor" note="Lowest open ask in each currency, among listings of the last 180 days that are still live.">
        <TileRow min={200}>
          {floorTile(floorUpx, 'Floor ask (UPX)', (l) => formatUpx(l.ask_upx))}
          {floorTile(floorUsd, 'Floor ask (USD)', (l) => formatUsd(l.ask_fiat))}
        </TileRow>
      </Block>

      <Block id="neighborhoods" title="Neighborhoods" note="Traded properties and their sales since the chain record begins (April 2025).">
        <Region
          query={trades}
          skeleton={<DataTable<NeighborhoodRow> columns={HOOD_COLUMNS} rows={[]} loading skeletonRows={10} />}
          emptyMessage={`No traded properties recorded in ${city}`}
          emptyAction={{ label: 'All cities', onClick: () => router.push('/properties/overview') }}
          staleMinutes={marketStaleMinutes(latest)}
        >
          {() => (
            <div style={{ display: 'grid', gap: 10 }}>
              {referenceFailed && (
                <DataState
                  state="partial"
                  partialMessage={`Could not fetch ${city}'s neighborhood list${reference.error ? ` (${describeError(reference.error).code})` : ''}. Areas and untraded neighborhoods are missing.`}
                  onRetryPartial={() => reference.refetch()}
                />
              )}
              <DataTable<NeighborhoodRow> columns={HOOD_COLUMNS} rows={hoodRows} rowKey={(n) => n.name || '(not recorded)'} maxHeight={560} footer={<span>{formatInt(hoodRows.length)} neighborhoods</span>} />
            </div>
          )}
        </Region>
      </Block>
    </>
  );
}
