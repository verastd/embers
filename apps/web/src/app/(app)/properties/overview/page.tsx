'use client';

/**
 * Properties overview, all cities (F-401), from the ledger's per-city daily
 * market layer (`/market/cities`): what traded, was listed and was minted in
 * each city over the window, with the latest daily medians.
 *
 * Property counts by Upland status (owned, for sale, locked, unminted, on
 * review) come from the property dimension (`property-status.tsx`), in
 * tiles and a per-city table. Per-city floor prices are on the city page
 * only (two `/listings` reads per city). Medians are the most recent
 * day's, named with that day: a window median cannot be rebuilt from daily
 * ones.
 *
 * States (PRD 5.3): KPI tiles each load and fail on their own; the table is a
 * DataState with layout skeleton, refreshing (window change keeps the rows
 * dimmed), empty with a way out, error with code, request id and Retry, and
 * stale when the market layer has stopped rebuilding.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Block, DataState, DataTable, PageHeader, Skeleton, StatTile, TileRow } from '@embers/ui';
import type { Column } from '@embers/ui';
import { Suspense, useMemo } from 'react';

import { DataThrough, readWindow, useCityDays, windowPhrase, WindowChips } from '@/components/data/market-window';
import { StatusByCity, StatusTiles, useStatusCounts } from '@/components/data/property-status';
import { Region } from '@/components/data/Region';
import { readEnum } from '@/lib/filters';
import { formatDay, formatInt, formatMultiple, formatUpx, formatUsd, NONE } from '@/lib/format';
import type { QueryResult } from '@/lib/hooks';
import { CITY_SORTS, cityHref, cityStats, latestDay, marketStaleMinutes, marketTotals, sortCities } from '@/lib/properties-analytics';
import type { CitySortKey, CityStats, DatedValue } from '@/lib/properties-analytics';
import { useFilters } from '@/lib/useFilters';

const KEYS = ['window', 'sort', 'order'] as const;

/** A latest-day median with its day in the cell's title. */
function Dated({ v, fmt }: { v: DatedValue | null; fmt: (n: number) => string }) {
  if (v === null) return <>{NONE}</>;
  return <span title={`Median on ${formatDay(v.day)}`}>{fmt(v.value)}</span>;
}

const COLUMNS: Column<CityStats>[] = [
  {
    key: 'city',
    label: 'City',
    sortable: true,
    render: (c) => (
      <Link href={cityHref(c.city)} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--text-link)' }}>
        {c.city}
      </Link>
    ),
  },
  { key: 'sales', label: 'Sales', num: true, sortable: true, render: (c) => formatInt(c.sales) },
  { key: 'volume', label: 'Volume', num: true, sortable: true, render: (c) => formatUpx(c.volumeUpx, { compact: true }) },
  { key: 'median_sale', label: 'Median sale', hint: 'Median sale price on the most recent day in the window that had a sale.', num: true, sortable: true, render: (c) => <Dated v={c.medianSaleUpx} fmt={(n) => formatUpx(n)} /> },
  { key: 'median_ask_upx', label: 'Median ask (UPX)', hint: 'Median UPX ask of new listings on the most recent day that had one.', num: true, sortable: true, render: (c) => <Dated v={c.medianAskUpx} fmt={(n) => formatUpx(n)} /> },
  { key: 'median_ask_usd', label: 'Median ask (USD)', hint: 'Median USD ask of new listings on the most recent day that had one.', num: true, sortable: true, render: (c) => <Dated v={c.medianAskUsd} fmt={formatUsd} /> },
  { key: 'sale_to_mint', label: 'Sale ÷ mint', hint: 'Median sale price over mint price (markup) on the most recent day it could be computed.', num: true, sortable: true, render: (c) => <Dated v={c.medianSaleToMint} fmt={formatMultiple} /> },
  { key: 'listings_new', label: 'New listings', num: true, sortable: true, render: (c) => formatInt(c.listingsNew) },
  { key: 'mints', label: 'Mints', num: true, sortable: true, render: (c) => formatInt(c.mints) },
];

export default function PropertiesOverviewPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <PropertiesOverview />
    </Suspense>
  );
}

function tileState(q: QueryResult<unknown>): 'loading' | 'error' | 'ready' {
  if (q.view === 'error' || q.view === 'unauthenticated' || q.view === 'not-found') return 'error';
  return q.data === undefined ? 'loading' : 'ready';
}

function PropertiesOverview() {
  const router = useRouter();
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(KEYS);
  const win = readWindow(params.get('window'));
  const sortKey: CitySortKey = readEnum(params, 'sort', CITY_SORTS) ?? 'volume';
  const order = readEnum(params, 'order', ['asc', 'desc'] as const) ?? (sortKey === 'city' ? 'asc' : 'desc');

  const days = useCityDays(win);
  const status = useStatusCounts();
  const stats = useMemo(() => cityStats(days.data ?? []), [days.data]);
  const rows = useMemo(() => sortCities(stats, sortKey, order), [stats, sortKey, order]);
  const totals = marketTotals(stats);
  const latest = latestDay(days.data ?? []);
  const state = tileState(days);
  const retry = () => days.refetch();

  return (
    <>
      <PageHeader title="Properties overview" lede="What traded, was listed and was minted in every Upland city, from the ledger's daily market layer." aside={<DataThrough day={latest} />} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <WindowChips value={win} onChange={(w) => filters.applyNow({ window: w === '7' ? '' : w })} />
      </div>

      <Block id="kpis" title="All cities" note={`Totals over ${windowPhrase(win)}.`}>
        <DataState state={days.view === 'refreshing' ? 'refreshing' : 'ready'}>
          <TileRow min={160}>
            <StatTile label="Sales" value={formatInt(totals.sales)} state={state} onRetry={retry} />
            <StatTile label="Sales volume" value={formatUpx(totals.volumeUpx, { compact: true })} state={state} onRetry={retry} />
            <StatTile label="New listings" value={formatInt(totals.listingsNew)} state={state} onRetry={retry} />
            <StatTile label="Listings removed" value={formatInt(totals.listingsRemoved)} state={state} onRetry={retry} />
            <StatTile label="Mints" value={formatInt(totals.mints)} state={state} onRetry={retry} />
            <StatTile label="Cities with sales" value={formatInt(totals.citiesWithSales)} state={state} onRetry={retry} />
          </TileRow>
        </DataState>
      </Block>

      <Block id="status" title="Property status" note="Every Upland property by its Upland status, all cities.">
        <StatusTiles query={status} />
      </Block>

      <Block id="cities" title="Cities" note="Select a city for its own overview. Medians are from the latest day in the window that had one; hover a value for its day.">
        <Region
          query={days}
          skeleton={<DataTable<CityStats> columns={COLUMNS} rows={[]} loading skeletonRows={10} />}
          emptyMessage={`No market activity recorded in ${windowPhrase(win)}`}
          emptyAction={win !== '30' ? { label: 'Show the last 30 days', onClick: () => filters.applyNow({ window: '30' }) } : undefined}
          staleMinutes={marketStaleMinutes(latest)}
        >
          {() => (
            <DataTable<CityStats>
              columns={COLUMNS}
              rows={rows}
              rowKey={(c) => c.city}
              sort={{ key: sortKey, dir: order }}
              onSort={(s) => filters.applyNow({ sort: s.key, order: s.dir })}
              onRowClick={(c) => router.push(cityHref(c.city))}
              maxHeight={640}
              footer={<span>{formatInt(rows.length)} cities</span>}
            />
          )}
        </Region>
      </Block>

      <StatusByCity query={status} />
    </>
  );
}
