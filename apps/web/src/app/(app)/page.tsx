'use client';

/**
 * Home (F-190), built from what the ledger has:
 * - Live strip: active accounts and property sales over 24 h, listings in
 *   the last hour, UPX moved on chain over 24 h. Each tile reads on its own
 *   and fails on its own (PRD AC: one failed tile never blocks the others);
 *   the strip polls every 60 s while the tab is visible (LiveIndicator).
 * - Chain activity: transactions per day over 30 days.
 * - Latest sales: a ticker over the newest property sales, and the same
 *   rows as a table (the ticker is never the only place they appear).
 * - Explore: every shipped tool, as a feature grid. The private beta has no
 *   tiers, so it is one group.
 * The PRD's sponsor carousel, seed price, next treasure spawn, pricing block
 * and Discord link need data or features that do not exist yet; they are
 * left out rather than shown empty.
 */
import { Block, DataTable, FeatureGrid, LiveIndicator, LiveTicker, PageHeader, Skeleton, StatTile, TileRow } from '@embers/ui';
import type { Column, FeatureGroup, LiveStatus } from '@embers/ui';
import { TimeSeriesChart } from '@embers/ui/charts';
import type { AnalyticsResult, Overview, QuerySpec, Sale } from '@embers/ledger';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { Region } from '@/components/data/Region';
import { NAV } from '@/components/shell/nav';
import { UserLink } from '@/components/users/parts';
import { activeAccountsSpec, activityCaption, dailyWindowStart, listingsSpec, numCell, resultRecords, salesSpec, trailingRange } from '@/lib/analytics';
import { formatClock, formatInstant, formatInt, formatShortDay, formatUpx } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import type { OffsetPage, QueryResult } from '@/lib/hooks';
import { queryKey } from '@/lib/query-core';
import { usePolling } from '@/lib/usePolling';
import { USER_ROUTES } from '@/lib/users';

const POLL_MS = 60_000;
const DAYS = 30;

/** One analytics figure for a tile: the first row's `measure`. */
function useFigure(name: string, spec: (now: number) => QuerySpec, measure: string) {
  return useLedgerQuery<number | null>(
    queryKey(`/analytics/query#home-${name}`),
    async (c, signal) => {
      const r: AnalyticsResult = await c.analytics.query(spec(Date.now()), { signal });
      return numCell(resultRecords(r)[0], measure);
    },
    { heavy: true, isEmpty: () => false },
  );
}

export default function HomePage() {
  const accounts = useFigure('accounts', (now) => activeAccountsSpec(trailingRange(24, now)), 'accounts');
  const listings = useFigure('listings', (now) => listingsSpec(trailingRange(1, now)), 'listings');
  const sales = useLedgerQuery<{ count: number | null; volume: number | null }>(
    queryKey('/analytics/query#home-sales'),
    async (c, signal) => {
      const rec = resultRecords(await c.analytics.query(salesSpec(trailingRange(24, Date.now())), { signal }))[0];
      return { count: numCell(rec, 'sales'), volume: numCell(rec, 'volume_upx') };
    },
    { heavy: true, isEmpty: () => false },
  );
  const overview = useLedgerQuery<Overview>(queryKey('/analytics/overview'), (c, signal) => c.analytics.overview(undefined, { signal }), { heavy: true, isEmpty: () => false });
  const latest = useLedgerQuery<OffsetPage<Sale>>(queryKey('/sales#home', { limit: 10 }), (c, signal) => c.sales.list({ sort: 'timestamp', order: 'desc', limit: 10 }, { signal }));

  const strip: QueryResult<unknown>[] = [accounts, listings, sales, overview];
  const refreshAll = useCallback(async () => {
    await Promise.all([accounts.refetch(), listings.refetch(), sales.refetch(), overview.refetch(), latest.refetch()]);
  }, [accounts, listings, sales, overview, latest]);
  const poll = usePolling(refreshAll, POLL_MS);

  const updatedAt = Math.max(0, ...strip.map((q) => q.updatedAt ?? 0));
  const failed = strip.filter((q) => q.view === 'error' || q.view === 'unauthenticated').length;
  const live: LiveStatus = poll.paused ? 'paused' : failed === strip.length ? 'error' : updatedAt === 0 ? 'connecting' : 'live';

  const upx = overview.data?.transfers_24h_by_symbol.find((t) => t.symbol === 'UPX');

  return (
    <>
      <PageHeader
        title="Embers"
        lede="Upland, read straight from the chain: players, properties and the market, with every figure traced to the ledger."
        aside={
          <LiveIndicator
            status={live}
            updatedAt={updatedAt > 0 ? formatClock(new Date(updatedAt)) : undefined}
            nextPollIn={poll.nextPollIn}
            reason="Ledger unreachable"
            onRetry={poll.pollNow}
            onResume={poll.pollNow}
          />
        }
      />

      <Block id="live" title="Live" note="Rolling windows ending now; refreshed every minute while this tab is open.">
        <TileRow min={180}>
          <Figure q={accounts} label="Active accounts · 24 h" value={accounts.data} hint="Distinct accounts that signed a chain action" paused={poll.paused} />
          <Figure q={listings} label="Listings · last hour" value={listings.data} paused={poll.paused} />
          <Figure q={sales} label="Property sales · 24 h" value={sales.data?.count} paused={poll.paused} />
          <Figure q={sales} label="Sales volume · 24 h" value={sales.data?.volume} upx paused={poll.paused} />
          <Figure q={overview} label="UPX moved · 24 h" value={overview.data ? (upx?.amount ?? 0) : undefined} upx hint="UPX token transfers on chain" paused={poll.paused} />
        </TileRow>
      </Block>

      <ActivityChart />

      <LatestSales q={latest} />

      <Block id="explore" title="Explore" note="Every tool in Embers.">
        <ExploreGrid />
      </Block>
    </>
  );
}

function Figure({ q, label, value, hint, upx, paused }: { q: QueryResult<unknown>; label: string; value: number | null | undefined; hint?: string; upx?: boolean; paused: boolean }) {
  const failed = q.view === 'error' || q.view === 'unauthenticated';
  const state = failed ? 'error' : value === undefined ? 'loading' : 'ready';
  const text = value === undefined ? undefined : upx ? formatUpx(value, { compact: true, unit: false }) : formatInt(value);
  const live: LiveStatus = failed ? 'error' : paused ? 'paused' : state === 'loading' ? 'connecting' : 'live';
  return <StatTile label={label} value={text} unit={upx ? 'UPX' : undefined} hint={hint} state={state} live={live} onRetry={q.refetch} />;
}

/* --- chain activity ------------------------------------------------------------ */

function ActivityChart() {
  const after = dailyWindowStart(DAYS, Date.now());
  const q = useLedgerQuery<AnalyticsResult>(queryKey('/analytics/timeseries#home', { after }), (c, signal) => c.analytics.timeseries({ metric: 'transactions', bucket: 'day', after }, { signal }), {
    heavy: true,
    isEmpty: (r) => r.rows.length === 0,
  });
  const series = useMemo(() => {
    const rows = q.data?.rows ?? [];
    return {
      categories: rows.map((r) => String(r[0] ?? '').slice(0, 10)),
      values: rows.map((r) => (typeof r[1] === 'number' ? r[1] : null)),
    };
  }, [q.data]);
  const total = series.values.reduce<number>((s, v) => s + (v ?? 0), 0);
  return (
    <Block id="activity" title="Chain activity" note={`Transactions per UTC day over the last ${DAYS} days, today so far. Live from the chain.`}>
      <Region query={q} skeleton={<Skeleton height={260} />} emptyMessage="No chain activity in this range">
        {() => (
          <div style={{ display: 'grid', gap: 6 }}>
            <TimeSeriesChart
              label={`Transactions per UTC day: ${activityCaption(total, DAYS, series.categories.length)}`}
              categories={series.categories}
              lines={[{ name: 'Transactions', values: series.values, tone: 1 }]}
              formatAxis={formatShortDay}
              formatValue={(v) => formatInt(v)}
              height={240}
            />
            <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
              {activityCaption(total, DAYS, series.categories.length)}
            </span>
          </div>
        )}
      </Region>
    </Block>
  );
}

/* --- latest sales ---------------------------------------------------------------- */

const SALE_COLUMNS: Column<Sale>[] = [
  { key: 'timestamp', label: 'Time (UTC)', muted: true, render: (s) => formatInstant(s.timestamp) },
  { key: 'address', label: 'Property', render: (s) => s.address || `#${s.property_id}` },
  { key: 'city', label: 'City', muted: true, render: (s) => s.city || '—' },
  { key: 'price_upx', label: 'Price', num: true, render: (s) => formatUpx(s.price_upx) },
  { key: 'buyer', label: 'Buyer', render: (s) => <UserLink to={s.buyer} /> },
];

function LatestSales({ q }: { q: QueryResult<OffsetPage<Sale>> }) {
  return (
    <Block id="sales" title="Latest sales" note="Property sales decoded from the chain every 15 min.">
      <Region query={q} skeleton={<DataTable<Sale> columns={SALE_COLUMNS} rows={[]} loading skeletonRows={10} />} emptyMessage="No property sales recorded yet">
        {(page) => (
          <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
            <LiveTicker<Sale>
              label="Latest property sales"
              items={page.data}
              renderItem={(s) => (
                <>
                  <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{[s.address, s.city].filter(Boolean).join(', ')}</strong>
                  <span className="em-num">{formatUpx(s.price_upx)}</span>
                </>
              )}
              style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}
            />
            <DataTable<Sale> columns={SALE_COLUMNS} rows={page.data} rowKey={(s) => `${s.trx_id}:${s.property_id}`} />
          </div>
        )}
      </Region>
    </Block>
  );
}

/* --- explore ------------------------------------------------------------------- */

const DESCRIPTIONS: Record<string, string> = {
  [USER_ROUTES.search]: 'Find a player by username and open their trading, income and holdings.',
  '/properties/search': 'Search properties by place, status, owner, asking price and markup.',
  [USER_ROUTES.leaderboardUsers]: 'Top 100 players by trading, UPX flows and activity.',
  [USER_ROUTES.leaderboardProperties]: 'Who bought the most properties, per city and timescope.',
  [USER_ROUTES.leaderboardUpland]: 'Treasure finds, sale proceeds and trades.',
};

const narrowQuery = '(max-width: 640px)';
const midQuery = '(max-width: 1024px)';
function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const lists = [window.matchMedia(narrowQuery), window.matchMedia(midQuery)];
  lists.forEach((m) => m.addEventListener('change', cb));
  return () => lists.forEach((m) => m.removeEventListener('change', cb));
}
function columnsNow(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 3;
  return window.matchMedia(narrowQuery).matches ? 1 : window.matchMedia(midQuery).matches ? 2 : 3;
}

function ExploreGrid() {
  const columns = useSyncExternalStore(subscribe, columnsNow, () => 3);
  const groups: FeatureGroup[] = [
    {
      tier: 'free',
      title: 'Open to everyone during the private beta',
      tiles: NAV.filter((g) => g.id !== 'home').flatMap((g) =>
        g.items.map((item) => ({
          title: `${g.label} · ${item.label}`,
          description: DESCRIPTIONS[item.href] ?? `Open ${item.label} in ${g.label}.`,
          icon: item.icon ?? g.icon ?? 'arrow-right',
          href: item.href,
        })),
      ),
    },
  ];
  return <FeatureGrid groups={groups} columns={columns} />;
}
