'use client';

/**
 * Property appraiser (F-410, BETA). Pick a property (address search, or a
 * bare property id), press Appraise: the estimate comes from comparable
 * sales in the last 90 days, neighborhood first, city when the neighborhood
 * has fewer than 3 (model and confidence rules in `lib/appraise.ts`).
 *
 * Reads: `/properties/{id}` (the property), `/sales` (comparables),
 * `/market/upx-usd` (USD value at the ledger's preferred rate) and
 * `/listings?open=true&book=upx` (the current floor, for the below-floor
 * flag). A failed rate or floor read leaves the UPX estimate in place under
 * a partial banner with Retry.
 *
 * Not built, because the ledger has no data for it: price per UP2 (the
 * PRD's model; this uses price over mint instead), the markup-trend
 * adjustment, and the city picker (the address search is not city-scoped).
 */
import { useSearchParams } from 'next/navigation';
import { Badge, Block, Button, Card, DataTable, FactList, FilterBar, FilterField, NumberField, PageHeader, SearchableSelect, Skeleton, StatusBanner, ToastStack } from '@embers/ui';
import type { Column, SSOption, SearchableSelectStatus, ToastStackItem } from '@embers/ui';
import type { Listing, PropertyDetail, SearchResult, UpxUsd } from '@embers/ledger';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { filterBarState } from '@/components/data/filterbar';
import { Region } from '@/components/data/Region';
import { appraise, belowFloor, COMPARABLE_DAYS, needsCityComparables, readSalesWindow, SALES_CAP, withExtra } from '@/lib/appraise';
import type { Appraisal, Comparable, SalesWindow } from '@/lib/appraise';
import { isPropertyId } from '@/lib/filters';
import { formatDay, formatInt, formatMultiple, formatUpx, formatUsd, NONE, placeLabel, utcDayOffset } from '@/lib/format';
import { useDebouncedValue, useLedgerQuery } from '@/lib/hooks';
import type { OffsetPage } from '@/lib/hooks';
import { rateSeries, rateSummary } from '@/lib/market';
import { queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';

const KEYS = ['id'] as const;

export default function AppraiserPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <Appraiser />
    </Suspense>
  );
}

/* --- property picker ------------------------------------------------------------- */

function PropertyPicker({ value, label, onChange }: { value: string; label: string; onChange: (opt: SSOption | null) => void }) {
  const [query, setQuery] = useState('');
  const settled = useDebouncedValue(query.trim(), 250);
  const ready = settled.length >= 3;
  const search = useLedgerQuery<SearchResult>(ready ? queryKey('/search', { q: settled, kind: 'property', limit: 20 }) : null, (c, signal) =>
    c.search({ q: settled, kind: 'property', limit: 20 }, { signal }),
  );
  const options: SSOption[] = (search.data?.properties ?? []).map((p) => ({ value: p.property_id, label: p.address || `#${p.property_id}`, meta: [p.neighborhood, p.city].filter(Boolean).join(', ') }));
  const typing = query.trim() !== settled;
  const status: SearchableSelectStatus = !ready
    ? 'idle'
    : typing || search.view === 'loading' || search.fetching
      ? 'loading'
      : search.view === 'error' || search.view === 'unauthenticated'
        ? 'error'
        : options.length === 0
          ? 'empty'
          : 'results';
  return (
    <SearchableSelect
      label="Property"
      placeholder="Address or property id"
      size="dense"
      width={320}
      minChars={3}
      query={query}
      onQueryChange={setQuery}
      status={status}
      options={options}
      error={search.view === 'error' ? 'Search failed' : undefined}
      onRetry={() => void search.refetch()}
      value={value ? { value, label: label || `#${value}` } : null}
      onChange={(opt) => {
        onChange(opt);
        setQuery('');
      }}
    />
  );
}

/* --- copy ------------------------------------------------------------------------- */

function CopyButton({ text, what, onCopied }: { text: string; what: string; onCopied: (ok: boolean) => void }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Button
      size="dense"
      variant="ghost"
      icon={done ? 'check' : 'copy'}
      aria-label={`Copy ${what}`}
      onClick={() => {
        const write = typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
        write.then(
          () => {
            setDone(true);
            onCopied(true);
          },
          () => onCopied(false),
        );
      }}
      style={{ height: 28, width: 28, padding: 0 }}
    />
  );
}

/* --- the page ---------------------------------------------------------------------- */

const COMP_COLUMNS: Column<Comparable>[] = [
  { key: 'address', label: 'Address', render: (c) => placeLabel(c.address || `#${c.property_id}`, c.neighborhood || undefined) },
  { key: 'mint_price_upx', label: 'Mint', num: true, render: (c) => formatUpx(c.mint_price_upx) },
  { key: 'price_upx', label: 'Sale price', num: true, render: (c) => formatUpx(c.price_upx) },
  { key: 'price_to_mint', label: 'Price ÷ mint', num: true, render: (c) => formatMultiple(c.price_to_mint) },
  { key: 'timestamp', label: 'Date', muted: true, render: (c) => formatDay(c.timestamp) },
];

function Appraiser() {
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(KEYS);
  const raw = params.get('id')?.trim() ?? '';
  const id = isPropertyId(raw) ? raw : '';
  const [picked, setPicked] = useState<{ id: string; label: string }>({ id: '', label: '' });

  const prop = useLedgerQuery<PropertyDetail>(id ? `/properties/${id}` : null, (c, signal) => c.properties.get(id, undefined, { signal }));
  const p = prop.data;
  const mint = p ? p.mint_price_upx || p.upland_api?.mint_price_upx || 0 : 0;
  const city = p ? p.city || p.upland_api?.city || '' : '';
  const neighborhood = p ? p.neighborhood || p.upland_api?.neighborhood || '' : '';
  // 90 UTC calendar days including today: `after` is inclusive, so start COMPARABLE_DAYS - 1 days back.
  const after = `${utcDayOffset(COMPARABLE_DAYS - 1)}T00:00:00Z`;

  // Sales read so far per level, while the window is paged in (progress on the button and in the estimate).
  const [reading, setReading] = useState<{ key: string; read: number } | null>(null);
  const nReq = { city: city || undefined, neighborhood, after, sort: 'timestamp' as const, order: 'desc' as const };
  const nKey = queryKey('/sales#window', nReq);
  const nSales = useLedgerQuery<SalesWindow>(p && mint > 0 && neighborhood ? nKey : null, (c, signal) =>
    readSalesWindow((page) => c.sales.list({ ...nReq, ...page }, { signal }), (read) => setReading({ key: nKey, read })),
  );
  const wantCity = !!p && mint > 0 && !!city && (!neighborhood || (nSales.data !== undefined && needsCityComparables({ propertyId: id, mintPriceUpx: mint, neighborhoodSales: nSales.data.sales })));
  const cReq = { city, after, sort: 'timestamp' as const, order: 'desc' as const };
  const cKey = queryKey('/sales#window', cReq);
  const cSales = useLedgerQuery<SalesWindow>(wantCity ? cKey : null, (c, signal) =>
    readSalesWindow((page) => c.sales.list({ ...cReq, ...page }, { signal }), (read) => setReading({ key: cKey, read })),
  );
  const rate = useLedgerQuery<UpxUsd>(p ? queryKey('/market/upx-usd', { limit: 7 }) : null, (c, signal) => c.market.upxUsd({ limit: 7 }, { signal }), { heavy: true });
  const floorReq = { open: true, city: city || undefined, neighborhood: neighborhood || undefined, book: 'upx' as const, sort: 'ask_upx' as const, order: 'asc' as const, limit: 1 };
  const floor = useLedgerQuery<OffsetPage<Listing>>(p && city ? queryKey('/listings', floorReq) : null, (c, signal) => c.listings.list(floorReq, { signal }));

  const compsPending = (mint > 0 && neighborhood !== '' && nSales.data === undefined) || (wantCity && cSales.data === undefined);
  const compsQuery = nSales.view === 'error' ? nSales : cSales.view === 'error' ? cSales : null;
  const readingKey = wantCity ? cKey : nKey;
  const readSoFar = compsPending && reading?.key === readingKey ? reading.read : null;
  const readingLabel = readSoFar === null ? 'Reading sales…' : `Reading sales… ${formatInt(readSoFar)}`;

  const appraisal = useMemo<Appraisal | null>(() => {
    if (!p || compsPending) return null;
    return appraise({ propertyId: id, mintPriceUpx: mint, lastSaleUpx: p.last_sale_upx, neighborhoodSales: nSales.data?.sales ?? [], citySales: cSales.data?.sales ?? [] });
  }, [p, compsPending, id, mint, nSales.data, cSales.data]);

  // The window the estimate used was cut at the cap: say so.
  const capped = appraisal?.basis === 'mint-model' && (appraisal.level === 'neighborhood' ? nSales.data?.capped : cSales.data?.capped) === true;
  const usdPerUpx = useMemo(() => (rate.data ? (rateSummary(rateSeries(rate.data))?.usdPerUpx ?? null) : null), [rate.data]);
  const floorUpx = floor.data?.data[0]?.ask_upx ?? null;
  const [extra, setExtra] = useState<number | null>(0);
  const [toasts, setToasts] = useState<ToastStackItem[]>([]);
  const toastId = useRef(0);
  const onCopied = useCallback((ok: boolean) => {
    toastId.current += 1;
    const t: ToastStackItem = ok ? { id: String(toastId.current), variant: 'success', title: 'Copied' } : { id: String(toastId.current), variant: 'error', title: 'Could not copy', description: 'The browser blocked clipboard access.' };
    setToasts((ts) => [...ts, t]);
  }, []);

  const selectedId = filters.draft.id;
  const selectedLabel = picked.id === selectedId ? picked.label : selectedId === id && p ? p.address : '';

  const estimate = appraisal?.estimateUpx ?? null;
  const adjusted = estimate === null ? null : withExtra(estimate, extra ?? 0);
  const partial = [rate.view === 'error' ? 'the UPX/USD rate (USD values are missing)' : null, floor.view === 'error' ? 'the current floor (no below-floor check)' : null].filter(Boolean);

  return (
    <>
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            Property appraiser <Badge tone="info">BETA</Badge>
          </span>
        }
        lede="An estimate from comparable sales: what similar properties nearby sold for over their mint price in the last 90 days."
      />

      <FilterBar
        state={filterBarState(filters.dirty || !id, prop.view === 'loading' || compsPending, id ? 1 : 0)}
        appliedCount={id ? 1 : 0}
        applyLabel="Appraise"
        applyPendingLabel={compsPending ? readingLabel : 'Appraising…'}
        onApply={async () => {
          if (!isPropertyId(filters.draft.id)) throw new Error('Pick a property first');
          filters.apply();
        }}
        onReset={() => {
          setPicked({ id: '', label: '' });
          setExtra(0);
          filters.reset();
        }}
      >
        <FilterField label="Property">
          <PropertyPicker
            value={selectedId}
            label={selectedLabel}
            onChange={(opt) => {
              setPicked({ id: opt?.value ?? '', label: opt?.label ?? '' });
              filters.set('id', opt?.value ?? '');
            }}
          />
        </FilterField>
      </FilterBar>

      <Block id="result" title="Estimate" note="Excludes Upland fees. Estimates only: not financial advice, and only as good as the recorded sales.">
        {!id ? (
          <Card>
            <p style={{ margin: 0, textAlign: 'center', font: 'var(--type-body)', color: 'var(--text-secondary)', padding: '24px 0' }}>Pick a property and press Appraise.</p>
          </Card>
        ) : (
          <Region query={prop} skeleton={<ResultSkeleton />} emptyMessage="No such property" notFoundMessage="The ledger has no property with that id.">
            {(property) => (
              <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
                <Card>
                  <FactList
                    items={[
                      { term: 'Property', value: placeLabel(property.address || `#${property.property_id}`, city) },
                      { term: 'Neighborhood', value: neighborhood || NONE },
                      { term: 'Property id', value: property.property_id, mono: true },
                      { term: 'Mint price', value: mint > 0 ? formatUpx(mint) : NONE },
                      { term: 'Last sale', value: property.last_sale_upx > 0 ? `${formatUpx(property.last_sale_upx)} on ${formatDay(property.last_sale_at)}` : NONE },
                    ]}
                  />
                </Card>

                {partial.length > 0 && (
                  <StatusBanner
                    kind="partial"
                    actionLabel="Retry"
                    onAction={() => Promise.all([rate.view === 'error' ? rate.refetch() : null, floor.view === 'error' ? floor.refetch() : null])}
                  >
                    Could not load {partial.join(' or ')}.
                  </StatusBanner>
                )}

                {compsQuery ? (
                  <Region query={compsQuery} emptyMessage="No sales" skeleton={<ResultSkeleton />}>
                    {() => null}
                  </Region>
                ) : appraisal === null ? (
                  <div aria-busy="true">
                    <p role="status" style={{ margin: '0 0 12px', font: 'var(--type-body-sm)', color: 'var(--text-secondary)' }}>
                      {readingLabel}
                    </p>
                    <ResultSkeleton />
                  </div>
                ) : appraisal.basis === 'none' ? (
                  <Card>
                    <div style={{ display: 'grid', gap: 10, justifyItems: 'center', padding: '16px 0', textAlign: 'center' }}>
                      <span style={{ font: 'var(--type-body)', color: 'var(--text-secondary)' }}>
                        No estimate: the ledger has no mint price for this property, no comparable sales in its {neighborhood ? 'neighborhood or ' : ''}city in the last 90 days, and no sale of its own.
                      </span>
                      <Button
                        variant="secondary"
                        size="dense"
                        onClick={() => {
                          setPicked({ id: '', label: '' });
                          filters.reset();
                        }}
                      >
                        Appraise another property
                      </Button>
                    </div>
                  </Card>
                ) : (
                  <Card>
                    <div style={{ display: 'grid', gap: 14 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <Badge tone={appraisal.confidence === 'High' ? 'success' : appraisal.confidence === 'Medium' ? 'info' : 'warning'}>{appraisal.confidence} confidence</Badge>
                        <Badge tone="neutral">
                          {appraisal.basis === 'mint-model'
                            ? `Mint-price model, ${formatInt(appraisal.comparables.length)} ${appraisal.level} comparable${appraisal.comparables.length === 1 ? '' : 's'}`
                            : 'Basis: last sale price'}
                        </Badge>
                        {belowFloor(adjusted, floorUpx) && (
                          <Badge tone="warning" icon="triangle-alert">
                            Below the {neighborhood ? 'neighborhood' : 'city'} floor ({formatUpx(floorUpx)})
                          </Badge>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'end' }}>
                        <Value label="Estimated value" upx={estimate} usdPerUpx={usdPerUpx} onCopied={onCopied} />
                        <NumberField label="Extra" suffix="%" step={1} min={-90} max={500} width={130} value={extra} onCommit={setExtra} />
                        <Value label={`With ${extra ?? 0}% extra`} upx={adjusted} usdPerUpx={usdPerUpx} onCopied={onCopied} />
                      </div>
                      <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
                        {appraisal.basis === 'mint-model'
                          ? `Mint price ${formatUpx(mint)} × ${formatMultiple(appraisal.ratio)}, the median price over mint of the comparables below. Excludes Upland fees.`
                          : 'No mint price or no comparable sales, so this is the property’s own last sale price. Excludes Upland fees.'}
                        {usdPerUpx !== null && ` USD at the ledger’s preferred UPX/USD rate.`}
                        {capped && ` The ${appraisal.level} had more than ${formatInt(SALES_CAP)} sales in the last ${COMPARABLE_DAYS} days; comparables come from the newest ${formatInt(SALES_CAP)}.`}
                      </p>
                    </div>
                  </Card>
                )}

                {appraisal && appraisal.comparables.length > 0 && (
                  <Block id="comparables" title="Comparables" note={`Sales in the ${appraisal.level} in the last ${COMPARABLE_DAYS} days, closest in mint price first.`}>
                    <DataTable<Comparable> columns={COMP_COLUMNS} rows={appraisal.comparables} rowKey={(c) => c.property_id} />
                  </Block>
                )}
              </div>
            )}
          </Region>
        )}
      </Block>
      <ToastStack toasts={toasts} onClose={(tid) => setToasts((ts) => ts.filter((t) => t.id !== tid))} />
    </>
  );
}

function Value({ label, upx, usdPerUpx, onCopied }: { label: string; upx: number | null; usdPerUpx: number | null; onCopied: (ok: boolean) => void }) {
  const upxText = formatUpx(upx === null ? null : Math.round(upx));
  const usdText = upx === null || usdPerUpx === null ? NONE : formatUsd(upx * usdPerUpx);
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="em-num" style={{ font: 'var(--type-num-lg)', color: 'var(--text-primary)' }}>
          {upxText}
        </span>
        {upx !== null && <CopyButton text={String(Math.round(upx))} what={`${label} in UPX`} onCopied={onCopied} />}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="em-num" style={{ font: 'var(--type-num)', color: 'var(--text-secondary)' }}>
          {usdText}
        </span>
        {usdText !== NONE && upx !== null && usdPerUpx !== null && <CopyButton text={(upx * usdPerUpx).toFixed(2)} what={`${label} in USD`} onCopied={onCopied} />}
      </span>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Skeleton height={20} width="40%" />
      <Skeleton height={32} width="30%" />
      <Skeleton height={14} width="70%" />
      <Skeleton height={14} width="55%" />
    </div>
  );
}
