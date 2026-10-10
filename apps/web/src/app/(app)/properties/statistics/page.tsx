'use client';

/**
 * Properties statistics (F-407): daily charts over a date range, for every
 * city or one.
 *
 * - Transactions made: sales, new listings, removed listings and mints per
 *   day, stacked (`/market/cities`).
 * - Price statistics: for one city, the daily median sale and median ask in
 *   UPX, the median USD ask and the median sale ÷ mint markup
 *   (`/market/cities?city=`); for all cities, the chain-wide daily median
 *   sale (`/analytics/sales`), because per-city medians cannot be combined.
 *
 * Every chart zooms and pans, resets, and downloads as PNG (ExploreChart).
 *
 * Not shown, because no ledger route has them: neighborhood and collection
 * filters (the daily market layer is per city), the owned / unminted / for
 * sale counts over time, and floor price / floor markup series.
 */
import { useSearchParams } from 'next/navigation';
import { Block, Check, DataState, FilterBar, FilterField, PageHeader, Skeleton, TextField } from '@embers/ui';
import { ExploreChart } from '@embers/ui/charts';
import type { ExploreSeries } from '@embers/ui/charts';
import type { CityDay, CitiesParams, SalesAnalytics } from '@embers/ledger';
import { Suspense, useMemo, useState } from 'react';

import { ChipsField } from '@/components/data/ChipsField';
import { SearchFilterField } from '@/components/data/fields';
import { filterBarState } from '@/components/data/filterbar';
import { Region } from '@/components/data/Region';
import { countApplied, readText } from '@/lib/filters';
import { formatInt, formatMultiple, formatShortDay, formatUpx, formatUsd } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import { appliedRange, dailyActivity, dailyPrices, daysBetween, instantRange, lastDays, latestDay, MAX_DAYS_ALL_CITIES, rangeProblem, rangeStaleMinutes, salesSeriesByDay } from '@/lib/properties-analytics';
import type { DayRange } from '@/lib/properties-analytics';
import { queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';

const KEYS = ['city', 'from', 'to'] as const;
const DEFAULT_DAYS = 30;
const ROW_CAP = 5000;
const PRESETS = ['30', '90', '180', '365'] as const;
type Preset = (typeof PRESETS)[number];

const CHART_SKELETON = <Skeleton height={300} />;

export default function PropertiesStatisticsPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <PropertiesStatistics />
    </Suspense>
  );
}

function PropertiesStatistics() {
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(KEYS);
  const city = readText(params, 'city', 64);
  const urlRange = appliedRange(readText(params, 'from', 10), readText(params, 'to', 10), city, DEFAULT_DAYS);
  // A refused URL range reads nothing; the axis below is built only from a validated range.
  const range: DayRange = urlRange.range ?? lastDays(DEFAULT_DAYS);
  const { after, before } = range;
  const days = useMemo(() => daysBetween({ after, before }), [after, before]);

  const cityParams: CitiesParams = { city, after: range.after, before: range.before, limit: ROW_CAP };
  const market = useLedgerQuery<CityDay[]>(
    urlRange.range ? queryKey('/market/cities', cityParams) : null,
    (c, signal) => c.market.cities(cityParams, { signal }),
    { heavy: true, keepPrevious: true },
  );
  const chainSales = useLedgerQuery<SalesAnalytics>(
    city || !urlRange.range ? null : queryKey('/analytics/sales', { ...range, bucket: 'day' }),
    (c, signal) => c.analytics.sales({ ...instantRange(range), bucket: 'day', bins: 4 }, { signal }),
    { heavy: true, keepPrevious: true, isEmpty: (s) => s.series.rows.length === 0 },
  );

  const d = filters.draft;
  const problem = rangeProblem(d.from, d.to, d.city);
  const applied = countApplied({ city, from: params.get('from') ?? undefined, to: params.get('to') ?? undefined }, ['city', 'from', 'to']);
  const latest = latestDay(market.data ?? []);
  const capped = (market.data?.length ?? 0) >= ROW_CAP ? ROW_CAP : null;
  const stale = rangeStaleMinutes(range, latest);
  const draftPreset = PRESETS.find((p) => {
    const r = lastDays(Number(p));
    return d.from === r.after && d.to === r.before;
  });

  const activity = useMemo(() => dailyActivity(market.data ?? [], days), [market.data, days]);
  const prices = useMemo(() => (city ? dailyPrices(market.data ?? [], city, days) : []), [market.data, city, days]);
  const chainSeries = useMemo(() => (chainSales.data ? salesSeriesByDay(chainSales.data.series, days) : []), [chainSales.data, days]);

  const [showSale, setShowSale] = useState(true);
  const [showAsk, setShowAsk] = useState(true);
  const upxSeries: ExploreSeries[] = [
    ...(showSale ? [{ name: 'Median sale', values: prices.map((p) => p.medianSaleUpx), tone: 1 }] : []),
    ...(showAsk ? [{ name: 'Median ask', values: prices.map((p) => p.medianAskUpx), tone: 2 }] : []),
  ];
  const hasAny = (values: ReadonlyArray<number | null>) => values.some((v) => v !== null);
  const scope = city ?? 'all cities';
  const resetAction = applied > 0 ? { label: 'Reset filters', onClick: filters.reset } : undefined;

  return (
    <>
      <PageHeader title="Properties statistics" lede="Daily sales, listings, mints and prices from the Upland ledger, for every city or one." />

      <FilterBar
        state={filterBarState(filters.dirty, market.fetching || chainSales.fetching, applied)}
        appliedCount={applied}
        onApply={async () => {
          if (problem) throw new Error(problem);
          filters.apply();
        }}
        onReset={filters.reset}
      >
        <FilterField label="City">
          <SearchFilterField kind="city" label="City" value={d.city} onChange={(v) => filters.set('city', v)} width={200} />
        </FilterField>
        <ChipsField<Preset>
          label="Range"
          value={draftPreset}
          onChange={(p) => {
            // A preset applies at once (both dates in one step), keeping any unapplied city.
            const r = lastDays(Number(p));
            filters.applyNow({ from: r.after, to: r.before });
          }}
          options={PRESETS.map((p) => ({
            value: p,
            label: p === '365' ? '1 year' : `${p} days`,
            disabledReason: !city && Number(p) > MAX_DAYS_ALL_CITIES ? 'Pick a city for ranges over 60 days' : undefined,
          }))}
        />
        <TextField label="From" placeholder={range.after} value={d.from} onChange={(v) => filters.set('from', v)} onEnter={() => !problem && filters.apply()} width={130} mono maxLength={10} />
        <TextField label="To" placeholder={range.before} value={d.to} onChange={(v) => filters.set('to', v)} onEnter={() => !problem && filters.apply()} width={130} mono maxLength={10} error={problem} />
      </FilterBar>

      {urlRange.problem !== null ? (
        <Block id="range-problem" title="This range can't be shown">
          <DataState state="empty" emptyMessage={`The dates in this link were refused: ${urlRange.problem}`} emptyAction="Reset filters" onEmptyAction={filters.reset} />
        </Block>
      ) : (
        <>
          <Block id="transactions" title="Transactions made" note={`Per day, ${scope}, ${range.after} to ${range.before} (UTC).`}>
            <Region
              query={market}
              skeleton={CHART_SKELETON}
              emptyMessage="No data for this range"
              emptyAction={resetAction}
              staleMinutes={stale}
              cappedCount={capped}
            >
              {() => (
                <ExploreChart
                  kind="stacked-bar"
                  label={`Transactions made, ${scope}`}
                  categories={days}
                  formatAxis={formatShortDay}
                  formatValue={(v) => formatInt(v)}
                  series={[
                    { name: 'Sales', values: activity.map((a) => a.sales), tone: 1 },
                    { name: 'New listings', values: activity.map((a) => a.listingsNew), tone: 2 },
                    { name: 'Listings removed', values: activity.map((a) => a.listingsRemoved), tone: 3 },
                    { name: 'Mints', values: activity.map((a) => a.mints), tone: 4 },
                  ]}
                />
              )}
            </Region>
          </Block>

          {city ? (
            <>
              <Block
                id="prices-upx"
                title="Price statistics (UPX)"
                note="Daily medians: sale prices, and asks of listings created that day."
                aside={
                  <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
                    <Check checked={showSale} onChange={setShowSale} label="Median sale" />
                    <Check checked={showAsk} onChange={setShowAsk} label="Median ask" />
                  </span>
                }
              >
                <Region query={market} skeleton={CHART_SKELETON} emptyMessage="No data for this range" emptyAction={resetAction}>
                  {() =>
                    upxSeries.length === 0 ? (
                      <DataState state="empty" emptyMessage="Every series is switched off" emptyAction="Show all" onEmptyAction={() => (setShowSale(true), setShowAsk(true))} />
                    ) : !upxSeries.some((s) => hasAny(s.values)) ? (
                      <DataState state="empty" emptyMessage={`No UPX prices recorded for ${city} in this range`} emptyAction={resetAction?.label} onEmptyAction={resetAction?.onClick} />
                    ) : (
                      <ExploreChart kind="line" label={`Price statistics in UPX, ${city}`} categories={days} formatAxis={formatShortDay} formatValue={(v) => formatUpx(v)} series={upxSeries} />
                    )
                  }
                </Region>
              </Block>

              <Block id="prices-usd" title="Price statistics (USD)" note="Daily median USD ask of listings created that day.">
                <Region query={market} skeleton={CHART_SKELETON} emptyMessage="No data for this range" emptyAction={resetAction}>
                  {() =>
                    hasAny(prices.map((p) => p.medianAskUsd)) ? (
                      <ExploreChart kind="line" label={`Price statistics in USD, ${city}`} categories={days} formatAxis={formatShortDay} formatValue={formatUsd} series={[{ name: 'Median ask (USD)', values: prices.map((p) => p.medianAskUsd), tone: 3 }]} />
                    ) : (
                      <DataState state="empty" emptyMessage={`No USD asks recorded for ${city} in this range`} emptyAction={resetAction?.label} onEmptyAction={resetAction?.onClick} />
                    )
                  }
                </Region>
              </Block>

              <Block id="markup" title="Markup" note="Daily median of sale price ÷ mint price (1.5× = 50 % over mint).">
                <Region query={market} skeleton={CHART_SKELETON} emptyMessage="No data for this range" emptyAction={resetAction}>
                  {() =>
                    hasAny(prices.map((p) => p.medianSaleToMint)) ? (
                      <ExploreChart kind="line" label={`Median markup, ${city}`} categories={days} formatAxis={formatShortDay} formatValue={formatMultiple} series={[{ name: 'Median sale ÷ mint', values: prices.map((p) => p.medianSaleToMint), tone: 4 }]} />
                    ) : (
                      <DataState state="empty" emptyMessage={`No markups recorded for ${city} in this range`} emptyAction={resetAction?.label} onEmptyAction={resetAction?.onClick} />
                    )
                  }
                </Region>
              </Block>
            </>
          ) : (
            <Block id="prices-upx" title="Price statistics (UPX)" note="Chain-wide daily median sale price. Asks, USD and markup are kept per city: pick a city to chart them.">
              <Region query={chainSales} skeleton={CHART_SKELETON} emptyMessage="No sales recorded in this range" emptyAction={resetAction}>
                {() => (
                  <ExploreChart
                    kind="line"
                    label="Median sale price, all cities"
                    categories={days}
                    formatAxis={formatShortDay}
                    formatValue={(v) => formatUpx(v)}
                    series={[{ name: 'Median sale, all cities', values: chainSeries.map((s) => s.median), tone: 1 }]}
                  />
                )}
              </Region>
            </Block>
          )}
        </>
      )}
    </>
  );
}
