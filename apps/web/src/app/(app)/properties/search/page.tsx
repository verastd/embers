'use client';

/**
 * Properties search (F-403), on what the ledger's `/properties` holds today:
 * properties seen minting or trading on chain (~398 K of ~4.9 M), with
 * address, city, neighborhood, mint price, last sale and sale count.
 * Filters, columns and sorts that need data the ledger does not have yet
 * (status, sale price, UP2, markup, owner, FSA, structures, collections)
 * arrive with the props-snapshot ingestion job, not as disabled controls.
 *
 * States (PRD 5.3/5.7): empty-initial until the first Search; the FilterBar
 * runs clean/dirty/applying/applied; results use DataState; Load more
 * appends 100 rows per load (capped banner at 10,000); the URL reproduces
 * the search.
 */
import { useSearchParams } from 'next/navigation';
import { AsyncButton, Block, DataState, DataTable, FilterBar, FilterField, NumberField, PageHeader, Segment, Select, Skeleton, TextField } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { Property, PropertyListParams } from '@embers/ledger';
import { PROPERTY_SORTS } from '@embers/ledger';
import { Suspense, useMemo } from 'react';

import { SearchFilterField } from '@/components/data/fields';
import { draftNumber, filterBarState, numberDraft } from '@/components/data/filterbar';
import { Region } from '@/components/data/Region';
import { countApplied, numberDraftError, readEnum, readNumber, readText } from '@/lib/filters';
import { formatInstant, formatInt, formatUpx, NONE } from '@/lib/format';
import { useOffsetFeed } from '@/lib/hooks';
import { describeError, queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';

const KEYS = ['city', 'neighborhood', 'address', 'min_mint', 'max_mint', 'sort', 'order'] as const;
const PAGE = 100;
const CAP = 10_000;
type Sort = (typeof PROPERTY_SORTS)[number];

const SORT_LABELS: Record<Sort, string> = {
  mint_price_upx: 'Mint price',
  last_sale_upx: 'Last price',
  last_sale_at: 'Last sale',
  minted_at: 'Minted',
  sales: 'Sales',
  address: 'Address',
};

const COLUMNS: Column<Property>[] = [
  { key: 'address', label: 'Address', sortable: true, render: (p) => p.address || `#${p.property_id}` },
  { key: 'city', label: 'City', muted: true, render: (p) => p.city || NONE },
  { key: 'neighborhood', label: 'Neighborhood', muted: true, render: (p) => p.neighborhood || NONE },
  { key: 'mint_price_upx', label: 'Mint price', num: true, sortable: true, render: (p) => (p.mint_price_upx > 0 ? formatUpx(p.mint_price_upx) : NONE) },
  { key: 'last_sale_upx', label: 'Last price', num: true, sortable: true, render: (p) => (p.last_sale_upx > 0 ? formatUpx(p.last_sale_upx) : NONE) },
  { key: 'last_sale_at', label: 'Last sale', muted: true, sortable: true, render: (p) => formatInstant(p.last_sale_at) },
  { key: 'sales', label: 'Sales', num: true, sortable: true, render: (p) => formatInt(p.sales) },
];

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
    return {
      city: readText(params, 'city', 64),
      neighborhood: readText(params, 'neighborhood'),
      address: readText(params, 'address'),
      min_mint: readNumber(params, 'min_mint', { min: 0 }),
      max_mint: readNumber(params, 'max_mint', { min: 0 }),
      sort,
      order: readEnum(params, 'order', ['asc', 'desc'] as const) ?? 'asc',
    };
  }, [params]);

  const feed = useOffsetFeed<Property>(searched ? queryKey('/properties', request) : null, (page, c, signal) => c.properties.list({ ...request, ...page }, { signal }), PAGE);

  const d = filters.draft;
  const minError = numberDraftError(d.min_mint, { min: 0 });
  const maxError = numberDraftError(d.max_mint, { min: 0 });
  const rangeError = !minError && !maxError && d.min_mint && d.max_mint && Number(d.min_mint) > Number(d.max_mint) ? 'Min must not exceed max' : null;
  const applied = countApplied(request as Record<string, unknown>, ['city', 'neighborhood', 'address', 'min_mint', 'max_mint']);
  const capped = feed.items.length >= CAP;

  return (
    <>
      <PageHeader title="Properties search" lede="Search properties seen minting or trading on the Upland chain, by place, address and mint price." />

      <FilterBar
        state={filterBarState(filters.dirty || !searched, feed.fetching && !feed.loadingMore, applied)}
        appliedCount={applied}
        applyLabel="Search"
        applyPendingLabel="Searching…"
        onApply={async () => {
          if (minError || maxError || rangeError) throw new Error(rangeError ?? 'Fix the mint price range first');
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

      <Block id="bounds" title="Min / Max" note="Empty means no bound. Values apply with Search.">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
          <NumberField label="Min mint price" prefix="UPX" min={0} step={1000} width={170} value={draftNumber(d.min_mint)} onCommit={(v) => filters.set('min_mint', numberDraft(v))} />
          <NumberField label="Max mint price" prefix="UPX" min={0} step={1000} width={170} value={draftNumber(d.max_mint)} onCommit={(v) => filters.set('max_mint', numberDraft(v))} />
          {rangeError && (
            <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-error)', alignSelf: 'center' }}>
              {rangeError}
            </span>
          )}
        </div>
      </Block>

      <Block id="results" title="Results" note="Chain-derived properties · market layer, rebuilt every 6 h">
        {!searched ? (
          <DataState state="empty-initial" />
        ) : (
          <Region
            query={feed}
            skeleton={<DataTable<Property> columns={COLUMNS} rows={[]} loading skeletonRows={10} />}
            emptyMessage="No properties match these filters"
            emptyAction={applied > 0 ? { label: 'Reset filters', onClick: filters.reset } : undefined}
            cappedCount={capped ? CAP : null}
          >
            {() => (
              <DataTable<Property>
                columns={COLUMNS}
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
