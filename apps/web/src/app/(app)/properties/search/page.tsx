'use client';

/**
 * Properties search (F-403) over the ledger's `/properties`: place, address,
 * mint price and Upland status, plus the current owner and open listing
 * (ask, currency, markup) that upland-ledger migration 0013 adds. Filters
 * that need data no source has (UP2, FSA, structures, collections) are not
 * shown, rather than shown disabled.
 *
 * A ledger without 0013 ignores the owner/listing parameters (entity routes
 * drop unknown params), so its rows would look filtered when they are not.
 * When those filters are applied and the rows carry no `listed` field, the
 * results are withheld behind a banner that says so and offers to drop them;
 * the owner/ask columns are hidden whenever the ledger lacks them.
 *
 * States (PRD 5.3/5.7): empty-initial until the first Search; the FilterBar
 * runs clean/dirty/applying/applied; results use DataState; Load more
 * appends 100 rows per load (capped banner at 10,000); the URL reproduces
 * the search.
 */
import { useSearchParams } from 'next/navigation';
import { AsyncButton, Block, DataState, DataTable, FilterBar, FilterField, NumberField, PageHeader, Segment, Select, Skeleton, StatusBanner, TextField } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { Property, PropertyListParams } from '@embers/ledger';
import { PROPERTY_SORTS } from '@embers/ledger';
import { Suspense, useMemo } from 'react';

import { SearchFilterField } from '@/components/data/fields';
import { draftNumber, filterBarState, numberDraft } from '@/components/data/filterbar';
import { Region } from '@/components/data/Region';
import { countApplied, numberDraftError, readEnum, readNumber, readText } from '@/lib/filters';
import { formatInstant, formatInt, formatMultiple, formatUpx, formatUsd, NONE } from '@/lib/format';
import { useOffsetFeed } from '@/lib/hooks';
import { describeError, queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';

const KEYS = ['city', 'neighborhood', 'address', 'status', 'owner', 'listing', 'currency', 'min_ask', 'max_ask', 'min_markup', 'max_markup', 'min_mint', 'max_mint', 'sort', 'order'] as const;
/** Applied-filter keys that need upland-ledger migration 0013. */
const MARKET_KEYS = ['owner', 'listed', 'currency', 'min_ask', 'max_ask', 'min_markup', 'max_markup'] as const;
const PAGE = 100;
const CAP = 10_000;
type Sort = (typeof PROPERTY_SORTS)[number];
type Listing = 'any' | 'listed' | 'unlisted';
type Currency = 'any' | 'upx' | 'fiat';

const SORT_LABELS: Record<Sort, string> = {
  mint_price_upx: 'Mint price',
  last_sale_upx: 'Last price',
  last_sale_at: 'Last sale',
  minted_at: 'Minted',
  sales: 'Sales',
  address: 'Address',
  ask_upx: 'Ask (UPX)',
  ask_fiat: 'Ask (USD)',
  ask_to_mint: 'Markup',
  listed_at: 'Listed',
  owner_since: 'Owned since',
};
/** Sorts a pre-0013 ledger rejects with a 400. */
const MARKET_SORTS: ReadonlySet<Sort> = new Set(['ask_upx', 'ask_fiat', 'ask_to_mint', 'listed_at', 'owner_since']);

/** Upland's own status values (Developers API); "On Review" is live but undocumented. */
const STATUSES = ['Owned', 'For sale', 'Unlocked', 'Locked', 'On Review'] as const;

/** The open ask in its own book: "15,000 UPX" or "$120.00". */
function formatAsk(p: Property): string {
  if (!p.listed) return NONE;
  if (p.ask_currency === 'upx') return formatUpx(p.ask_upx);
  if (p.ask_currency === 'fiat') return formatUsd(p.ask_fiat);
  return NONE;
}

function ownerLabel(p: Property): string {
  return p.owner_username ?? p.owner_account ?? NONE;
}

const BASE_COLUMNS: Column<Property>[] = [
  { key: 'address', label: 'Address', sortable: true, render: (p) => p.address || `#${p.property_id}` },
  { key: 'city', label: 'City', muted: true, render: (p) => p.city || NONE },
  { key: 'neighborhood', label: 'Neighborhood', muted: true, render: (p) => p.neighborhood || NONE },
  { key: 'api_status', label: 'Status', muted: true, render: (p) => p.api_status || NONE },
  { key: 'mint_price_upx', label: 'Mint price', num: true, sortable: true, render: (p) => (p.mint_price_upx > 0 ? formatUpx(p.mint_price_upx) : NONE) },
];
const MARKET_COLUMNS: Column<Property>[] = [
  { key: 'owner', label: 'Owner', render: (p) => ownerLabel(p) },
  { key: 'ask', label: 'Ask', num: true, render: formatAsk },
  { key: 'ask_to_mint', label: 'Markup', num: true, sortable: true, render: (p) => formatMultiple(p.ask_to_mint) },
];
const SALE_COLUMNS: Column<Property>[] = [
  { key: 'last_sale_upx', label: 'Last price', num: true, sortable: true, render: (p) => (p.last_sale_upx > 0 ? formatUpx(p.last_sale_upx) : NONE) },
  { key: 'last_sale_at', label: 'Last sale', muted: true, sortable: true, render: (p) => formatInstant(p.last_sale_at) },
  { key: 'sales', label: 'Sales', num: true, sortable: true, render: (p) => formatInt(p.sales) },
];

/** True when the ledger answered with the 0013 owner/listing fields. */
function hasMarketFields(rows: readonly Property[]): boolean {
  return rows.length > 0 && rows[0]?.listed !== undefined;
}

export default function PropertiesSearchPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <PropertiesSearch />
    </Suspense>
  );
}

function PropertiesSearch() {
  const params = useSearchParams() ?? new URLSearchParams();
  const searched = params.get('search') === '1';
  const filters = useFilters(KEYS, { search: '1' });
  const request = useMemo<PropertyListParams>(() => {
    const sort = readEnum(params, 'sort', PROPERTY_SORTS) ?? 'mint_price_upx';
    const listing = readEnum(params, 'listing', ['listed', 'unlisted'] as const);
    const currency = listing === 'unlisted' ? undefined : readEnum(params, 'currency', ['upx', 'fiat'] as const);
    return {
      city: readText(params, 'city', 64),
      neighborhood: readText(params, 'neighborhood'),
      address: readText(params, 'address'),
      status: readEnum(params, 'status', STATUSES),
      owner: readText(params, 'owner', 64),
      listed: listing === 'listed' ? true : listing === 'unlisted' ? false : undefined,
      currency,
      // Ask and markup only mean something for an open listing.
      min_ask: listing === 'unlisted' ? undefined : readNumber(params, 'min_ask', { min: 0 }),
      max_ask: listing === 'unlisted' ? undefined : readNumber(params, 'max_ask', { min: 0 }),
      min_markup: listing === 'unlisted' || currency === 'fiat' ? undefined : readNumber(params, 'min_markup', { min: 0 }),
      max_markup: listing === 'unlisted' || currency === 'fiat' ? undefined : readNumber(params, 'max_markup', { min: 0 }),
      min_mint: readNumber(params, 'min_mint', { min: 0 }),
      max_mint: readNumber(params, 'max_mint', { min: 0 }),
      sort,
      order: readEnum(params, 'order', ['asc', 'desc'] as const) ?? 'asc',
    };
  }, [params]);

  const feed = useOffsetFeed<Property>(searched ? queryKey('/properties', request) : null, (page, c, signal) => c.properties.list({ ...request, ...page }, { signal }), PAGE);

  const d = filters.draft;
  const listing: Listing = d.listing === 'listed' || d.listing === 'unlisted' ? d.listing : 'any';
  const currency: Currency = d.currency === 'upx' || d.currency === 'fiat' ? d.currency : 'any';
  const mintRange = rangeError(d.min_mint, d.max_mint, 'mint price');
  const askRange = listing === 'unlisted' ? null : rangeError(d.min_ask, d.max_ask, 'ask');
  const markupRange = listing === 'unlisted' || currency === 'fiat' ? null : rangeError(d.min_markup, d.max_markup, 'markup');
  const firstError = mintRange ?? askRange ?? markupRange;
  const applied = countApplied(request as Record<string, unknown>, ['city', 'neighborhood', 'address', 'status', ...MARKET_KEYS, 'min_mint', 'max_mint']);
  const capped = feed.items.length >= CAP;

  const marketFields = hasMarketFields(feed.items);
  const marketApplied = MARKET_KEYS.some((k) => request[k] !== undefined) || MARKET_SORTS.has(request.sort ?? 'mint_price_upx');
  // Rows from a ledger that ignored the owner/listing filters: never show them as if filtered.
  const unsupported = feed.items.length > 0 && !marketFields && marketApplied;
  const columns = marketFields ? [...BASE_COLUMNS, ...MARKET_COLUMNS, ...SALE_COLUMNS] : [...BASE_COLUMNS, ...SALE_COLUMNS];
  const dropMarketFilters = () =>
    filters.applyNow({ owner: '', listing: '', currency: '', min_ask: '', max_ask: '', min_markup: '', max_markup: '', ...(MARKET_SORTS.has(request.sort ?? 'mint_price_upx') ? { sort: '' } : {}) });

  return (
    <>
      <PageHeader title="Properties search" lede="Search Upland properties by place, status, owner, asking price and markup over mint." />

      <FilterBar
        state={filterBarState(filters.dirty || !searched, feed.fetching && !feed.loadingMore, applied)}
        appliedCount={applied}
        applyLabel="Search"
        applyPendingLabel="Searching…"
        onApply={async () => {
          if (firstError) throw new Error(firstError);
          filters.apply();
        }}
        onReset={filters.reset}
      >
        <FilterField label="City">
          <SearchFilterField kind="city" label="City" value={d.city} onChange={(v) => filters.set('city', v)} width={200} />
        </FilterField>
        <FilterField label="Neighborhood">
          <SearchFilterField kind="neighborhood" label="Neighborhood" value={d.neighborhood} onChange={(v) => filters.set('neighborhood', v)} width={220} />
        </FilterField>
        <TextField label="Address contains" value={d.address} onChange={(v) => filters.set('address', v)} onEnter={() => filters.apply()} width={200} icon="search" />
        <FilterField label="Status">
          <Select<'' | (typeof STATUSES)[number]>
            size="dense"
            width={140}
            label="Status"
            value={STATUSES.find((s) => s === d.status) ?? ''}
            onChange={(v) => filters.set('status', v)}
            options={[{ value: '', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        </FilterField>
        <TextField label="Owner" placeholder="Username or account" value={d.owner} onChange={(v) => filters.set('owner', v)} onEnter={() => filters.apply()} width={200} maxLength={64} icon="user" />
        <FilterField label="Sort by">
          <Select<Sort>
            size="dense"
            width={150}
            label="Sort by"
            value={PROPERTY_SORTS.find((s) => s === d.sort) ?? 'mint_price_upx'}
            onChange={(v) => filters.set('sort', v)}
            options={PROPERTY_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
          />
        </FilterField>
        <FilterField label="Direction">
          <Segment
            size="dense"
            label="Direction"
            value={d.order === 'desc' ? 'desc' : 'asc'}
            onChange={(v) => filters.set('order', v)}
            options={[
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
          />
        </FilterField>
      </FilterBar>

      <Block id="listing" title="Listing" note="From the chain's order book: the newest listing, removal, sale or accepted offer decides. Values apply with Search.">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
          <FilterField label="For sale">
            <Segment<Listing>
              size="dense"
              label="For sale"
              value={listing}
              onChange={(v) => filters.set('listing', v === 'any' ? '' : v)}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'listed', label: 'Listed' },
                { value: 'unlisted', label: 'Not listed' },
              ]}
            />
          </FilterField>
          {listing !== 'unlisted' && (
            <>
              <FilterField label="Currency">
                <Segment<Currency>
                  size="dense"
                  label="Currency"
                  value={currency}
                  onChange={(v) => filters.set('currency', v === 'any' ? '' : v)}
                  options={[
                    { value: 'any', label: 'Any' },
                    { value: 'upx', label: 'UPX' },
                    { value: 'fiat', label: 'USD' },
                  ]}
                />
              </FilterField>
              <NumberField
                label="Min ask"
                prefix={currency === 'fiat' ? 'USD' : currency === 'upx' ? 'UPX' : undefined}
                min={0}
                step={currency === 'fiat' ? 10 : 1000}
                width={170}
                value={draftNumber(d.min_ask)}
                onCommit={(v) => filters.set('min_ask', numberDraft(v))}
                error={numberDraftError(d.min_ask, { min: 0 }) ?? undefined}
              />
              <NumberField
                label="Max ask"
                prefix={currency === 'fiat' ? 'USD' : currency === 'upx' ? 'UPX' : undefined}
                min={0}
                step={currency === 'fiat' ? 10 : 1000}
                width={170}
                value={draftNumber(d.max_ask)}
                onCommit={(v) => filters.set('max_ask', numberDraft(v))}
                error={numberDraftError(d.max_ask, { min: 0 }) ?? undefined}
              />
              {currency !== 'fiat' && (
                <>
                  <NumberField label="Min markup" suffix="× mint" min={0} step={0.1} width={150} value={draftNumber(d.min_markup)} onCommit={(v) => filters.set('min_markup', numberDraft(v))} error={numberDraftError(d.min_markup, { min: 0 }) ?? undefined} />
                  <NumberField label="Max markup" suffix="× mint" min={0} step={0.1} width={150} value={draftNumber(d.max_markup)} onCommit={(v) => filters.set('max_markup', numberDraft(v))} error={numberDraftError(d.max_markup, { min: 0 }) ?? undefined} />
                </>
              )}
            </>
          )}
          {(askRange ?? markupRange) && (
            <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-error)', alignSelf: 'center' }}>
              {askRange ?? markupRange}
            </span>
          )}
        </div>
        <p style={{ margin: '8px 0 0', font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          Ask bounds use the listing's own currency when Any is selected. Markup is the UPX ask over the mint price (1.5× = 50 % over mint), so it covers UPX listings only.
        </p>
      </Block>

      <Block id="bounds" title="Mint price" note="Empty means no bound. Values apply with Search.">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
          <NumberField label="Min mint price" prefix="UPX" min={0} step={1000} width={170} value={draftNumber(d.min_mint)} onCommit={(v) => filters.set('min_mint', numberDraft(v))} />
          <NumberField label="Max mint price" prefix="UPX" min={0} step={1000} width={170} value={draftNumber(d.max_mint)} onCommit={(v) => filters.set('max_mint', numberDraft(v))} />
          {mintRange && (
            <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-error)', alignSelf: 'center' }}>
              {mintRange}
            </span>
          )}
        </div>
      </Block>

      <Block id="results" title="Results" note="Market layer, rebuilt every 6 h. Owner is the last holder seen on chain; swaps are not visible.">
        {!searched ? (
          <DataState state="empty-initial" />
        ) : unsupported ? (
          <StatusBanner kind="partial" actionLabel="Search without them" onAction={dropMarketFilters}>
            The ledger has not been updated to filter by owner, listing, ask or markup yet, so these results would not be filtered. Remove those filters to search by the rest.
          </StatusBanner>
        ) : (
          <Region
            query={feed}
            skeleton={<DataTable<Property> columns={columns} rows={[]} loading skeletonRows={10} />}
            emptyMessage="No properties match these filters"
            emptyAction={applied > 0 ? { label: 'Reset filters', onClick: filters.reset } : undefined}
            cappedCount={capped ? CAP : null}
          >
            {() => (
              <DataTable<Property>
                columns={columns}
                rows={feed.items}
                rowKey={(p) => p.property_id}
                sort={{ key: request.sort ?? 'mint_price_upx', dir: request.order ?? 'asc' }}
                onSort={(s) => filters.applyNow({ sort: s.key, order: s.dir })}
                footer={
                  <>
                    <span>{formatInt(feed.items.length)} shown</span>
                    {feed.hasMore && !capped ? (
                      <AsyncButton label={`Load ${PAGE} more`} pendingLabel="Loading…" variant="secondary" size="dense" onAction={() => feed.loadMore()} />
                    ) : (
                      <span>{capped ? `Capped at ${formatInt(CAP)}. Narrow the filters.` : 'End of results'}</span>
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
        )}
      </Block>
    </>
  );
}

/** A bad bound, or min above max, as one message; null when the pair is fine. */
function rangeError(min: string, max: string, what: string): string | null {
  const minErr = numberDraftError(min, { min: 0 });
  const maxErr = numberDraftError(max, { min: 0 });
  if (minErr || maxErr) return `Fix the ${what} range first`;
  if (min && max && Number(min) > Number(max)) return `Min ${what} must not exceed max`;
  return null;
}
