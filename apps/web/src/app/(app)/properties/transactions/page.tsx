'use client';

/**
 * Property transactions (F-406): order-book sales (`/sales`) and accepted
 * offers (`/offers`, which `/sales` never shows), newest first, as one
 * table. Both are decoded/market data: sales within 15 min, accepted offers
 * every 6 h. The private beta has no tier gating, so this Premium page is
 * open to everyone.
 *
 * Filters (URL-backed, applied server side): type, city, neighborhood and
 * price (sales only, so they show only for Sales), buyer and seller account,
 * period. Load more reads 500 more of each source; Export CSV writes the
 * whole filtered set (up to 5,000 rows per source), not just what is loaded.
 *
 * Not shown, because the ledger has no data for it: minting, swapping and
 * burned types, collections, price per UP2.
 */
import { useSearchParams } from 'next/navigation';
import { AsyncButton, Block, DataTable, FilterBar, FilterField, NumberField, PageHeader, Segment, Select, Skeleton, TextField } from '@embers/ui';
import type { Column } from '@embers/ui';
import { isAntelopeAccount, paginateOffset } from '@embers/ledger';
import type { Offer, OfferParams, Sale, SaleParams } from '@embers/ledger';
import { Suspense, useMemo } from 'react';

import { SearchFilterField } from '@/components/data/fields';
import { draftNumber, filterBarState, numberDraft } from '@/components/data/filterbar';
import { Region } from '@/components/data/Region';
import { ledgerClient } from '@/lib/client';
import { countApplied, numberDraftError, readAccount, readEnum, readNumber, readText } from '@/lib/filters';
import { formatInstant, formatInt, formatMultiple, formatRelative, formatUpx, NONE, shortHash } from '@/lib/format';
import { useOffsetFeed } from '@/lib/hooks';
import type { QueryResult } from '@/lib/hooks';
import { describeError, queryKey, viewState } from '@/lib/query-core';
import type { QuerySnapshot } from '@/lib/query-core';
import { fromOffer, fromSale, mergeFeeds, PERIODS, periodStart, toCsv } from '@/lib/transactions';
import type { Period, TxRow } from '@/lib/transactions';
import { useFilters } from '@/lib/useFilters';

const KEYS = ['type', 'city', 'neighborhood', 'buyer', 'seller', 'period', 'min_price', 'max_price'] as const;
const PAGE = 500;
const EXPORT_PAGES = 5;
type TxType = 'all' | 'sales' | 'offers';
const PERIOD_LABELS: Record<Period, string> = { all: 'All time', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };
const linkStyle = { color: 'var(--text-link)', textDecoration: 'none' } as const;

function party(account: string, username = ''): string {
  return username ? `${username} (${account})` : account || NONE;
}

const COLUMNS: Column<TxRow>[] = [
  { key: 'timestamp', label: 'Time', muted: true, render: (r) => <time dateTime={r.timestamp ?? undefined} title={formatInstant(r.timestamp)}>{formatRelative(r.timestamp)}</time> },
  { key: 'type', label: 'Type', render: (r) => (r.type === 'sale' ? 'Sale' : 'Accepted offer') },
  {
    key: 'address',
    label: 'Address',
    render: (r) => (
      <a href={`https://play.upland.me/?prop_id=${r.property_id}`} target="_blank" rel="noreferrer" style={linkStyle} title="Open in Upland">
        {r.address || `#${r.property_id}`}
      </a>
    ),
  },
  { key: 'city', label: 'City', muted: true, render: (r) => r.city || NONE },
  { key: 'neighborhood', label: 'Neighborhood', muted: true, render: (r) => r.neighborhood || NONE },
  { key: 'buyer', label: 'Buyer', mono: true, render: (r) => party(r.buyer, r.buyer_username) },
  { key: 'seller', label: 'Seller', mono: true, render: (r) => party(r.seller) },
  { key: 'price_upx', label: 'Price', num: true, render: (r) => (r.price_upx > 0 ? formatUpx(r.price_upx) : NONE) },
  { key: 'price_to_mint', label: 'Markup', num: true, hint: 'Price ÷ mint price. Blank when the mint price is unknown.', render: (r) => formatMultiple(r.price_to_mint) },
  { key: 'trx_id', label: 'Transaction', mono: true, render: (r) => <span title={r.trx_id}>{r.trx_id ? shortHash(r.trx_id) : NONE}</span> },
  {
    key: 'actions',
    label: 'Actions',
    render: (r) => (
      <a href={`/tools/appraiser?id=${r.property_id}`} style={linkStyle}>
        Appraise
      </a>
    ),
  },
];

export default function TransactionsPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <Transactions />
    </Suspense>
  );
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Transactions() {
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(KEYS);
  const type: TxType = readEnum(params, 'type', ['sales', 'offers'] as const) ?? 'all';
  const period: Period = readEnum(params, 'period', Object.keys(PERIODS) as Period[]) ?? 'all';

  const salesReq = useMemo<SaleParams>(
    () => ({
      city: readText(params, 'city', 64),
      neighborhood: type === 'sales' ? readText(params, 'neighborhood') : undefined,
      buyer: readAccount(params, 'buyer'),
      seller: readAccount(params, 'seller'),
      min_price: type === 'sales' ? readNumber(params, 'min_price', { min: 0 }) : undefined,
      max_price: type === 'sales' ? readNumber(params, 'max_price', { min: 0 }) : undefined,
      after: periodStart(period),
      sort: 'timestamp',
      order: 'desc',
    }),
    [params, type, period],
  );
  const offersReq = useMemo<OfferParams>(
    () => ({ city: salesReq.city, buyer: salesReq.buyer, seller: salesReq.seller, after: salesReq.after, sort: 'timestamp', order: 'desc' }),
    [salesReq],
  );

  const sales = useOffsetFeed<Sale>(type !== 'offers' ? queryKey('/sales', salesReq) : null, (page, c, signal) => c.sales.list({ ...salesReq, ...page }, { signal }), PAGE);
  const offers = useOffsetFeed<Offer>(type !== 'sales' ? queryKey('/offers', offersReq) : null, (page, c, signal) => c.offers.list({ ...offersReq, ...page }, { signal }), PAGE);

  const active = [type !== 'offers' ? sales : null, type !== 'sales' ? offers : null].filter((f) => f !== null);
  const merged = useMemo(
    () =>
      mergeFeeds([
        ...(type !== 'offers' ? [{ rows: sales.items.map(fromSale), hasMore: sales.hasMore }] : []),
        ...(type !== 'sales' ? [{ rows: offers.items.map(fromOffer), hasMore: offers.hasMore }] : []),
      ]),
    [type, sales.items, sales.hasMore, offers.items, offers.hasMore],
  );
  const failed = active.find((f) => f.status === 'error');
  const snap: QuerySnapshot<TxRow[]> = {
    status: failed ? 'error' : active.every((f) => f.data !== undefined) ? 'success' : 'loading',
    data: active.every((f) => f.data !== undefined) ? merged.rows : undefined,
    error: failed?.error,
    fetching: active.some((f) => f.fetching),
    updatedAt: undefined,
  };
  const region: QueryResult<TxRow[]> = {
    ...snap,
    view: viewState(snap),
    refetch: async () => {
      await Promise.all(active.filter((f) => f.status === 'error' || !failed).map((f) => f.refetch()));
    },
  };
  const hasMore = active.some((f) => f.hasMore);
  const loadMoreError = active.find((f) => f.loadMoreError)?.loadMoreError;

  const d = filters.draft;
  const draftType: TxType = d.type === 'sales' || d.type === 'offers' ? d.type : 'all';
  const buyerError = d.buyer.trim() && !isAntelopeAccount(d.buyer.trim().toLowerCase()) ? 'Not a chain account (1–12 of a–z, 1–5, .)' : null;
  const sellerError = d.seller.trim() && !isAntelopeAccount(d.seller.trim().toLowerCase()) ? 'Not a chain account (1–12 of a–z, 1–5, .)' : null;
  const priceRange = draftType === 'sales' ? rangeError(d.min_price, d.max_price) : null;
  const applied = countApplied({ type: type === 'all' ? undefined : type, period: period === 'all' ? undefined : period, ...salesReq } as Record<string, unknown>, ['type', 'period', 'city', 'neighborhood', 'buyer', 'seller', 'min_price', 'max_price']);

  const exportCsv = async ({ signal }: { signal: AbortSignal }): Promise<void> => {
    const c = ledgerClient();
    const rows: TxRow[] = [];
    if (type !== 'offers') {
      for await (const page of paginateOffset((p: SaleParams) => c.sales.list(p, { signal }), { ...salesReq, limit: 1000 }, { maxPages: EXPORT_PAGES })) rows.push(...page.data.map(fromSale));
    }
    if (type !== 'sales') {
      for await (const page of paginateOffset((p: OfferParams) => c.offers.list(p, { signal }), { ...offersReq, limit: 1000 }, { maxPages: EXPORT_PAGES })) rows.push(...page.data.map(fromOffer));
    }
    const all = mergeFeeds([{ rows, hasMore: false }]).rows;
    download(`embers-transactions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(all));
  };

  return (
    <>
      <PageHeader title="Property transactions" lede="Property sales on the order book and accepted offers, newest first, with buyer, seller, price and markup over mint." />

      <FilterBar
        state={filterBarState(filters.dirty, region.view === 'loading', applied)}
        appliedCount={applied}
        onApply={async () => {
          const err = buyerError ?? sellerError ?? priceRange;
          if (err) throw new Error(err);
          filters.apply();
        }}
        onReset={filters.reset}
      >
        <FilterField label="Type">
          <Segment<TxType>
            size="dense"
            label="Type"
            value={draftType}
            onChange={(v) => filters.set('type', v === 'all' ? '' : v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'sales', label: 'Sales' },
              { value: 'offers', label: 'Accepted offers' },
            ]}
          />
        </FilterField>
        <FilterField label="City">
          <SearchFilterField kind="city" label="City" value={d.city} onChange={(v) => filters.set('city', v)} width={200} />
        </FilterField>
        {draftType === 'sales' && (
          <FilterField label="Neighborhood">
            <SearchFilterField kind="neighborhood" label="Neighborhood" value={d.neighborhood} onChange={(v) => filters.set('neighborhood', v)} width={220} />
          </FilterField>
        )}
        <TextField label="Buyer" placeholder="Chain account" mono value={d.buyer} onChange={(v) => filters.set('buyer', v)} onEnter={() => filters.apply()} width={170} maxLength={13} icon="user" error={buyerError} />
        <TextField label="Seller" placeholder="Chain account" mono value={d.seller} onChange={(v) => filters.set('seller', v)} onEnter={() => filters.apply()} width={170} maxLength={13} icon="user" error={sellerError} />
        <FilterField label="Period">
          <Select<Period>
            size="dense"
            width={150}
            label="Period"
            value={(Object.keys(PERIODS) as Period[]).find((p) => p === d.period) ?? 'all'}
            onChange={(v) => filters.set('period', v === 'all' ? '' : v)}
            options={(Object.keys(PERIODS) as Period[]).map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
          />
        </FilterField>
        {draftType === 'sales' && (
          <>
            <NumberField label="Min price" prefix="UPX" min={0} step={1000} width={160} value={draftNumber(d.min_price)} onCommit={(v) => filters.set('min_price', numberDraft(v))} error={numberDraftError(d.min_price, { min: 0 }) ?? undefined} />
            <NumberField label="Max price" prefix="UPX" min={0} step={1000} width={160} value={draftNumber(d.max_price)} onCommit={(v) => filters.set('max_price', numberDraft(v))} error={numberDraftError(d.max_price, { min: 0 }) ?? undefined} />
          </>
        )}
      </FilterBar>
      {priceRange && (
        <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-error)' }}>
          {priceRange}
        </span>
      )}

      <Block
        id="results"
        title="Transactions"
        note="Buyer and seller are chain accounts. Accepted offers settle off the order book; the ledger matches them to properties every 6 h."
        aside={region.view === 'ready' || region.view === 'refreshing' ? <AsyncButton label="Export CSV" pendingLabel="Exporting…" successLabel="Exported" icon="download" variant="secondary" size="dense" timeoutMs={60_000} onAction={exportCsv} /> : undefined}
      >
        <Region
          query={region}
          skeleton={<DataTable<TxRow> columns={COLUMNS} rows={[]} loading skeletonRows={10} />}
          emptyMessage={applied > 0 ? 'No transactions match these filters' : 'No transactions recorded yet'}
          emptyAction={applied > 0 ? { label: 'Reset filters', onClick: filters.reset } : { label: 'Check again', onClick: () => void region.refetch() }}
        >
          {(rows) => (
            <DataTable<TxRow>
              columns={COLUMNS}
              rows={rows}
              rowKey={(r) => r.key}
              footer={
                <>
                  <span>
                    {formatInt(rows.length)} shown{merged.hidden > 0 ? ` (${formatInt(merged.hidden)} older rows wait for the next page of the other source)` : ''}
                  </span>
                  {hasMore ? (
                    <AsyncButton
                      label={`Load ${PAGE} more`}
                      pendingLabel="Loading…"
                      variant="secondary"
                      size="dense"
                      onAction={() => Promise.all(active.filter((f) => f.hasMore).map((f) => f.loadMore()))}
                    />
                  ) : (
                    <span>End of results</span>
                  )}
                  {loadMoreError && (
                    <span role="alert" style={{ flexBasis: '100%', color: 'var(--state-error)', font: 'var(--type-body-sm)' }}>
                      {describeError(loadMoreError).title}. The rows above are still current.
                    </span>
                  )}
                </>
              }
            />
          )}
        </Region>
      </Block>
    </>
  );
}

function rangeError(min: string, max: string): string | null {
  if (numberDraftError(min, { min: 0 }) || numberDraftError(max, { min: 0 })) return 'Fix the price range first';
  if (min && max && Number(min) > Number(max)) return 'Min price must not exceed max';
  return null;
}
