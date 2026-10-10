'use client';

/**
 * Live property listings (F-404) over the ledger's `/listings` (the order
 * book: decoded `listing_created` events joined to the property, refreshed
 * every 15 min). Polled every 60 s (PRD 6.3 listings-poll) with the
 * LiveIndicator; new listings arrive at the top with the 2 s highlight and
 * an "N new" pill when the table's top is scrolled away.
 *
 * Filters run server side and live in the URL: status (still open / every
 * listing event), city, neighborhood, currency book, ask range and markup
 * (ask ÷ mint, UPX book only). Filters the ledger has no data for
 * (collection tier, buildings, map assets, residents, "Sold") are not shown.
 */
import { useSearchParams } from 'next/navigation';
import { AsyncButton, Block, DataTable, FilterBar, FilterField, NumberField, PageHeader, Segment, Select, Skeleton } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { Listing, ListingParams } from '@embers/ledger';
import { Suspense, useCallback, useMemo, useRef } from 'react';

import { SearchFilterField } from '@/components/data/fields';
import { draftNumber, filterBarState, numberDraft } from '@/components/data/filterbar';
import { LiveControls } from '@/components/data/LiveControls';
import { Region } from '@/components/data/Region';
import { countApplied, numberDraftError, readEnum, readNumber, readText } from '@/lib/filters';
import { formatInstant, formatInt, formatMultiple, formatRelative, formatUpx, formatUsd, NONE } from '@/lib/format';
import { describeError, queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';
import { useLiveOffsetFeed, useLivePoll, useNewRows } from '@/lib/useLive';

const KEYS = ['status', 'city', 'neighborhood', 'book', 'min_ask', 'max_ask', 'min_markup', 'max_markup', 'sort', 'order'] as const;
const PAGE = 50;
const POLL_MS = 60_000;
const SORTS = ['timestamp', 'ask_upx', 'ask_fiat', 'ask_to_mint'] as const;
type Sort = (typeof SORTS)[number];
type Book = 'any' | 'upx' | 'fiat';
const SORT_LABELS: Record<Sort, string> = { timestamp: 'Listed', ask_upx: 'Ask (UPX)', ask_fiat: 'Ask (USD)', ask_to_mint: 'Markup' };

const listingKey = (l: Listing): string => `${l.property_id}|${l.timestamp ?? ''}`;

function formatAsk(l: Listing): string {
  if (l.ask_upx > 0) return formatUpx(l.ask_upx);
  if (l.ask_fiat > 0) return formatUsd(l.ask_fiat);
  return NONE;
}

const linkStyle = { color: 'var(--text-link)', textDecoration: 'none' } as const;

function columns(now: number): Column<Listing>[] {
  return [
    {
      key: 'address',
      label: 'Address',
      render: (l) => (
        <a href={`https://play.upland.me/?prop_id=${l.property_id}`} target="_blank" rel="noreferrer" style={linkStyle} title="Open in Upland">
          {l.address || `#${l.property_id}`}
        </a>
      ),
    },
    { key: 'city', label: 'City', muted: true, render: (l) => l.city || NONE },
    { key: 'neighborhood', label: 'Neighborhood', muted: true, render: (l) => l.neighborhood || NONE },
    { key: 'seller', label: 'Seller', mono: true, render: (l) => l.seller || NONE },
    {
      key: 'timestamp',
      label: 'Listed',
      sortable: true,
      muted: true,
      render: (l) => <time dateTime={l.timestamp ?? undefined} title={formatInstant(l.timestamp)}>{formatRelative(l.timestamp, now)}</time>,
    },
    { key: 'mint_price_upx', label: 'Mint', num: true, render: (l) => (l.mint_price_upx > 0 ? formatUpx(l.mint_price_upx) : NONE) },
    { key: 'ask', label: 'Price', num: true, render: formatAsk },
    { key: 'ask_to_mint', label: 'Markup', num: true, sortable: true, hint: 'UPX ask ÷ mint price. Blank for USD asks or an unknown mint.', render: (l) => formatMultiple(l.ask_to_mint) },
    {
      key: 'actions',
      label: 'Actions',
      render: (l) => (
        <a href={`/tools/appraiser?id=${l.property_id}`} style={linkStyle}>
          Appraise
        </a>
      ),
    },
  ];
}

export default function LiveListingsPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <LiveListings />
    </Suspense>
  );
}

function LiveListings() {
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(KEYS);
  const request = useMemo<ListingParams>(() => {
    const book = readEnum(params, 'book', ['upx', 'fiat'] as const);
    return {
      open: params.get('status') === 'all' ? undefined : true,
      city: readText(params, 'city', 64),
      neighborhood: readText(params, 'neighborhood'),
      book,
      min_ask: readNumber(params, 'min_ask', { min: 0 }),
      max_ask: readNumber(params, 'max_ask', { min: 0 }),
      min_ask_to_mint: book === 'fiat' ? undefined : readNumber(params, 'min_markup', { min: 0 }),
      max_ask_to_mint: book === 'fiat' ? undefined : readNumber(params, 'max_markup', { min: 0 }),
      sort: readEnum(params, 'sort', SORTS) ?? 'timestamp',
      order: readEnum(params, 'order', ['asc', 'desc'] as const) ?? 'desc',
    };
  }, [params]);
  const key = queryKey('/listings', request);
  const feed = useLiveOffsetFeed<Listing>(key, (page, c, signal) => c.listings.list({ ...request, ...page }, { signal }), PAGE);
  const live = useLivePoll({ feedKey: key, intervalMs: POLL_MS, poll: feed.poll, hasData: feed.data !== undefined, firstError: feed.error, retryFirst: feed.refetch });

  const anchor = useRef<HTMLDivElement>(null);
  const rowKey = useCallback(listingKey, []);
  const fresh = useNewRows(feed.items, rowKey, key, anchor, feed.pageCount);

  const d = filters.draft;
  const book: Book = d.book === 'upx' || d.book === 'fiat' ? d.book : 'any';
  const askRange = rangeError(d.min_ask, d.max_ask, 'price');
  const markupRange = book === 'fiat' ? null : rangeError(d.min_markup, d.max_markup, 'markup');
  const applied = countApplied({ ...request, open: request.open ? undefined : 'all' } as Record<string, unknown>, ['open', 'city', 'neighborhood', 'book', 'min_ask', 'max_ask', 'min_ask_to_mint', 'max_ask_to_mint']);
  const unit = book === 'fiat' ? 'USD' : book === 'upx' ? 'UPX' : undefined;

  return (
    <>
      <PageHeader
        title="Live listings"
        lede="Properties put up for sale on Upland, newest first. Polled every minute; the ledger decodes new listings every 15 minutes."
        aside={<LiveControls live={live} newCount={fresh.newCount} onJumpToNew={fresh.jumpToNew} />}
      />

      <FilterBar
        state={filterBarState(filters.dirty, feed.view === 'loading', applied)}
        appliedCount={applied}
        onApply={async () => {
          const err = askRange ?? markupRange;
          if (err) throw new Error(err);
          filters.apply();
        }}
        onReset={filters.reset}
      >
        <FilterField label="Status">
          <Segment
            size="dense"
            label="Status"
            value={d.status === 'all' ? 'all' : 'open'}
            onChange={(v) => filters.set('status', v === 'all' ? 'all' : '')}
            options={[
              { value: 'open', label: 'Active' },
              { value: 'all', label: 'All listing events' },
            ]}
          />
        </FilterField>
        <FilterField label="City">
          <SearchFilterField kind="city" label="City" value={d.city} onChange={(v) => filters.set('city', v)} width={200} />
        </FilterField>
        <FilterField label="Neighborhood">
          <SearchFilterField kind="neighborhood" label="Neighborhood" value={d.neighborhood} onChange={(v) => filters.set('neighborhood', v)} width={220} />
        </FilterField>
        <FilterField label="Currency">
          <Segment<Book>
            size="dense"
            label="Currency"
            value={book}
            onChange={(v) => filters.set('book', v === 'any' ? '' : v)}
            options={[
              { value: 'any', label: 'UPX + USD' },
              { value: 'upx', label: 'UPX' },
              { value: 'fiat', label: 'USD' },
            ]}
          />
        </FilterField>
        <FilterField label="Sort by">
          <Select<Sort>
            size="dense"
            width={140}
            label="Sort by"
            value={SORTS.find((s) => s === d.sort) ?? 'timestamp'}
            onChange={(v) => filters.set('sort', v)}
            options={SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
          />
        </FilterField>
        <FilterField label="Direction">
          <Segment
            size="dense"
            label="Direction"
            value={d.order === 'asc' ? 'asc' : 'desc'}
            onChange={(v) => filters.set('order', v)}
            options={[
              { value: 'desc', label: 'Descending' },
              { value: 'asc', label: 'Ascending' },
            ]}
          />
        </FilterField>
      </FilterBar>

      <Block id="ranges" title="Price and markup" note="Empty means no bound. Values apply with Apply.">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
          <NumberField label="Min price" prefix={unit} min={0} step={book === 'fiat' ? 10 : 1000} width={170} value={draftNumber(d.min_ask)} onCommit={(v) => filters.set('min_ask', numberDraft(v))} error={numberDraftError(d.min_ask, { min: 0 }) ?? undefined} />
          <NumberField label="Max price" prefix={unit} min={0} step={book === 'fiat' ? 10 : 1000} width={170} value={draftNumber(d.max_ask)} onCommit={(v) => filters.set('max_ask', numberDraft(v))} error={numberDraftError(d.max_ask, { min: 0 }) ?? undefined} />
          {book !== 'fiat' && (
            <>
              <NumberField label="Min markup" suffix="× mint" min={0} step={0.1} width={150} value={draftNumber(d.min_markup)} onCommit={(v) => filters.set('min_markup', numberDraft(v))} error={numberDraftError(d.min_markup, { min: 0 }) ?? undefined} />
              <NumberField label="Max markup" suffix="× mint" min={0} step={0.1} width={150} value={draftNumber(d.max_markup)} onCommit={(v) => filters.set('max_markup', numberDraft(v))} error={numberDraftError(d.max_markup, { min: 0 }) ?? undefined} />
            </>
          )}
          {(askRange ?? markupRange) && (
            <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-error)', alignSelf: 'center' }}>
              {askRange ?? markupRange}
            </span>
          )}
        </div>
        <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          With both currencies selected the price bounds apply to each listing in its own currency. Markup is the UPX ask over the mint price, so it covers UPX listings with a known mint price.
        </p>
      </Block>

      <Block id="results" title="Listings" note="Order book from decoded chain events. Active = the property's newest listing, removal or sale in the last 180 days is still this listing.">
        <div ref={anchor} style={{ scrollMarginTop: 80, minWidth: 0 }}>
          <Region
            query={feed}
            skeleton={<DataTable<Listing> columns={columns(live.now)} rows={[]} loading skeletonRows={10} />}
            emptyMessage={applied > 0 ? 'No listings match these filters' : 'No listings in the order book right now'}
            emptyAction={applied > 0 ? { label: 'Reset filters', onClick: filters.reset } : { label: 'Check again', onClick: () => void feed.refetch() }}
            staleMinutes={live.staleMinutes}
          >
            {() => (
              <DataTable<Listing & { __new?: boolean }>
                columns={columns(live.now)}
                rows={fresh.rows}
                rowKey={listingKey}
                sort={{ key: request.sort ?? 'timestamp', dir: request.order ?? 'desc' }}
                onSort={(s) => filters.applyNow({ sort: s.key, order: s.dir })}
                footer={
                  <>
                    <span>{formatInt(feed.items.length)} shown</span>
                    {feed.hasMore ? (
                      <AsyncButton label={`Load ${PAGE} more`} pendingLabel="Loading…" variant="secondary" size="dense" onAction={() => feed.loadMore()} />
                    ) : (
                      <span>End of listings</span>
                    )}
                    {feed.loadMoreError && (
                      <span role="alert" style={{ flexBasis: '100%', color: 'var(--state-error)', font: 'var(--type-body-sm)' }}>
                        {describeError(feed.loadMoreError).title}. The rows above are still current.
                      </span>
                    )}
                  </>
                }
              />
            )}
          </Region>
        </div>
      </Block>
    </>
  );
}

function rangeError(min: string, max: string, what: string): string | null {
  const minErr = numberDraftError(min, { min: 0 });
  const maxErr = numberDraftError(max, { min: 0 });
  if (minErr || maxErr) return `Fix the ${what} range first`;
  if (min && max && Number(min) > Number(max)) return `Min ${what} must not exceed max`;
  return null;
}
