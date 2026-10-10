'use client';

/**
 * Live property minting (F-405). Mints are the ledger's decoded
 * `property_minted` events (refreshed every 15 min), read with
 * `POST /analytics/query` (see `lib/mints.ts` for the specs): 24 h KPIs,
 * the top 10 minters and the latest 50 mints. Addresses and usernames are
 * looked up by id in the property and account dimensions; when a lookup
 * fails, the rows stay (by id) under a partial banner with Retry.
 *
 * Polled every 60 s with the LiveIndicator. Every query here takes the
 * ledger's shared heavy-query slot, so they run one after another.
 *
 * Not shown, because the ledger has no data for it: the minter's level.
 */
import { Block, Card, DataTable, PageHeader, StatTile, StatusBanner, TileRow } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { QueryResult } from '@embers/ledger';
import { useCallback, useMemo, useRef } from 'react';

import { LiveControls } from '@/components/data/LiveControls';
import { Region } from '@/components/data/Region';
import { formatClockUtc, formatDay, formatInstant, formatInt, formatUpx, NONE } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import { accountLookupSpec, distinct, latestMints, latestMintsSpec, mintKpis, mintKpiSpec, placesById, propertyLookupSpec, topMinters, topMintersSpec, usernamesByAccount } from '@/lib/mints';
import type { Minter, MintRow, PlaceInfo } from '@/lib/mints';
import { queryKey } from '@/lib/query-core';
import { useLiveLedgerQuery, useLivePoll, useNewRows } from '@/lib/useLive';

const POLL_MS = 60_000;
const LATEST = 50;
const linkStyle = { color: 'var(--text-link)', textDecoration: 'none' } as const;

type Names = Map<string, string>;
type Places = Map<string, PlaceInfo>;

function playerLabel(account: string, names: Names): string {
  const name = names.get(account);
  return name ? `${name}` : account || NONE;
}

function mintColumns(names: Names, places: Places): Column<MintRow>[] {
  const place = (m: MintRow): PlaceInfo | undefined => places.get(m.property_id);
  return [
    {
      key: 'timestamp',
      label: 'Time (UTC)',
      render: (m) => (
        <time dateTime={m.timestamp} title={formatInstant(m.timestamp)}>
          {formatDay(m.timestamp)} {formatClockUtc(m.timestamp).replace(' UTC', '')}
        </time>
      ),
    },
    { key: 'player', label: 'Player', render: (m) => <span title={m.account}>{playerLabel(m.account, names)}</span> },
    { key: 'address', label: 'Address', render: (m) => place(m)?.address || `#${m.property_id}` },
    { key: 'neighborhood', label: 'Neighborhood', muted: true, render: (m) => place(m)?.neighborhood || NONE },
    { key: 'city', label: 'City', muted: true, render: (m) => place(m)?.city || NONE },
    { key: 'type', label: 'Type', hint: 'FSA = the ledger decoded the mint as an FSA purchase settled in UPX (Upland action a4).', render: (m) => (m.fsa ? 'FSA' : NONE) },
    { key: 'mint_price_upx', label: 'Mint price', num: true, render: (m) => (m.mint_price_upx === null ? NONE : formatUpx(m.mint_price_upx)) },
    {
      key: 'link',
      label: 'Link',
      render: (m) => (
        <a href={`https://play.upland.me/?prop_id=${m.property_id}`} target="_blank" rel="noreferrer" style={linkStyle}>
          Open in Upland
        </a>
      ),
    },
  ];
}

function minterColumns(names: Names): Column<Minter>[] {
  return [
    { key: 'rank', label: 'Rank', num: true, width: 64, render: (m) => formatInt(m.rank) },
    { key: 'player', label: 'Player', render: (m) => <span title={m.account}>{playerLabel(m.account, names)}</span> },
    { key: 'mints', label: 'Mints, 24 h', num: true, render: (m) => formatInt(m.mints) },
  ];
}

const mintKey = (m: MintRow): string => m.key;

export default function LiveMintingPage() {
  const kpis = useLiveLedgerQuery<QueryResult>('mints/kpis', (c, signal) => c.analytics.query(mintKpiSpec(Date.now()), { signal }), { heavy: true });
  const top = useLiveLedgerQuery<QueryResult>('mints/top', (c, signal) => c.analytics.query(topMintersSpec(Date.now()), { signal }), {
    heavy: true,
    isEmpty: (r) => r.rows.length === 0,
  });
  const latest = useLiveLedgerQuery<QueryResult>('mints/latest', (c, signal) => c.analytics.query(latestMintsSpec(Date.now(), LATEST), { signal }), {
    heavy: true,
    isEmpty: (r) => r.rows.length === 0,
  });

  const mints = useMemo(() => (latest.data ? latestMints(latest.data) : []), [latest.data]);
  const minters = useMemo(() => (top.data ? topMinters(top.data) : []), [top.data]);
  const summary = useMemo(() => (kpis.data ? mintKpis(kpis.data) : null), [kpis.data]);

  const ids = useMemo(() => distinct(mints.map((m) => m.property_id)).sort(), [mints]);
  const accounts = useMemo(() => distinct([...mints.map((m) => m.account), ...minters.map((m) => m.account)]).sort(), [mints, minters]);
  const placesQ = useLedgerQuery<QueryResult>(ids.length > 0 ? queryKey('mints/places', { ids: ids.join(',') }) : null, (c, signal) => c.analytics.query(propertyLookupSpec(ids), { signal }), {
    heavy: true,
    keepPrevious: true,
  });
  const namesQ = useLedgerQuery<QueryResult>(accounts.length > 0 ? queryKey('mints/names', { accounts: accounts.join(',') }) : null, (c, signal) => c.analytics.query(accountLookupSpec(accounts), { signal }), {
    heavy: true,
    keepPrevious: true,
  });
  const places = useMemo<Places>(() => (placesQ.data ? placesById(placesQ.data) : new Map()), [placesQ.data]);
  const names = useMemo<Names>(() => (namesQ.data ? usernamesByAccount(namesQ.data) : new Map()), [namesQ.data]);

  const { poll: pollKpis } = kpis;
  const { poll: pollTop } = top;
  const { poll: pollLatest } = latest;
  const poll = useCallback(async () => (await Promise.all([pollKpis(), pollTop(), pollLatest()])).every(Boolean), [pollKpis, pollTop, pollLatest]);
  const firstError = latest.error ?? kpis.error ?? top.error;
  const { refetch: refetchKpis } = kpis;
  const { refetch: refetchTop } = top;
  const { refetch: refetchLatest } = latest;
  const retryFirst = useCallback(() => Promise.all([refetchKpis(), refetchTop(), refetchLatest()]), [refetchKpis, refetchTop, refetchLatest]);
  const live = useLivePoll({ intervalMs: POLL_MS, poll, hasData: latest.data !== undefined, firstError, retryFirst });

  const anchor = useRef<HTMLDivElement>(null);
  const fresh = useNewRows(mints, mintKey, 'mints', anchor);
  const lookupFailed = placesQ.view === 'error' || namesQ.view === 'error';

  const tileState = (q: { view: string }): 'loading' | 'error' | 'ready' => (q.view === 'loading' || q.view === 'idle' ? 'loading' : q.view === 'error' || q.view === 'unauthenticated' ? 'error' : 'ready');
  const top3 = minters.slice(0, 3).map((m) => playerLabel(m.account, names));

  return (
    <>
      <PageHeader
        title="Live minting"
        lede="Properties minted on Upland, from the chain. Polled every minute; the ledger decodes new mints every 15 minutes."
        aside={<LiveControls live={live} newCount={fresh.newCount} onJumpToNew={fresh.jumpToNew} />}
      />

      <section aria-label="Last 24 hours">
        <TileRow min={200}>
          <StatTile label="Mints, 24 h" state={tileState(kpis)} value={summary ? formatInt(summary.total) : undefined} onRetry={kpis.refetch} />
          <StatTile label="FSA mints, 24 h" hint="Mints the ledger decoded as FSA purchases settled in UPX" state={tileState(kpis)} value={summary ? formatInt(summary.fsa) : undefined} onRetry={kpis.refetch} />
          <StatTile
            label="Top city, 24 h"
            state={tileState(kpis)}
            value={summary ? (summary.topCity?.city ?? 'No mints') : undefined}
            unit={summary?.topCity ? `${formatInt(summary.topCity.mints)} mints` : undefined}
            onRetry={kpis.refetch}
          />
          <StatTile label="Top 3 minters, 24 h" state={tileState(top)} value={top.data ? (top3.length > 0 ? top3.join(', ') : 'No mints') : undefined}
            hint="Counts are in the Top 10 table" onRetry={top.refetch} />
        </TileRow>
      </section>

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', alignItems: 'start' }}>
        <Block id="minters" title="Top 10 minters" note="Last 24 hours, by number of mints." style={{ gridColumn: 'span 1' }}>
          <Region
            query={top}
            skeleton={<DataTable<Minter> columns={minterColumns(names)} rows={[]} loading skeletonRows={10} />}
            emptyMessage="No mints in the last 24 hours"
            emptyAction={{ label: 'Check again', onClick: () => void top.refetch() }}
            staleMinutes={live.staleMinutes}
          >
            {() => <DataTable<Minter> columns={minterColumns(names)} rows={minters} rowKey={(m) => m.account} />}
          </Region>
        </Block>

        <Block id="latest" title={`Latest ${LATEST} mints`} note="Newest first, from the last 7 days." style={{ gridColumn: '1 / -1' }}>
          <div ref={anchor} style={{ display: 'grid', gap: 12, minWidth: 0, scrollMarginTop: 80 }}>
            {lookupFailed && (
              <StatusBanner
                kind="partial"
                actionLabel="Retry"
                onAction={() => Promise.all([placesQ.view === 'error' ? placesQ.refetch() : null, namesQ.view === 'error' ? namesQ.refetch() : null])}
              >
                Could not look up {placesQ.view === 'error' ? 'addresses' : 'usernames'} for these mints. They are listed by {placesQ.view === 'error' ? 'property id' : 'chain account'} until a retry succeeds.
              </StatusBanner>
            )}
            <Region
              query={latest}
              skeleton={<DataTable<MintRow> columns={mintColumns(names, places)} rows={[]} loading skeletonRows={10} />}
              emptyMessage="No mints in the last 7 days"
              emptyAction={{ label: 'Check again', onClick: () => void latest.refetch() }}
              staleMinutes={live.staleMinutes}
            >
              {() => <DataTable<MintRow & { __new?: boolean }> columns={mintColumns(names, places)} rows={fresh.rows} rowKey={mintKey} footer={<span>{formatInt(mints.length)} mints shown</span>} />}
            </Region>
          </div>
        </Block>
      </div>

      <Card>
        <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          Mint price is what the mint action declared; mints without one show a dash. Player is the account the property was minted to, shown by its Upland username when the ledger knows it.
        </p>
      </Card>
    </>
  );
}
