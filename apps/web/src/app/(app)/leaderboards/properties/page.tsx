'use client';

/**
 * Properties leaderboard (F-1606): the accounts that bought the most
 * properties (or spent the most on them) on the market, per timescope and
 * optionally per city, from the ledger's sale events (`POST
 * /analytics/query`, source `sales`). The PRD ranks by holdings (property
 * count, mint networth, UP2) and filters by neighborhood; the ledger has
 * neither an owner roll-up nor a neighborhood on sales, so those are not
 * offered.
 *
 * Changes apply at once and the board refreshes in place (PRD 5.3).
 */
import { Block, Chips, FilterField, PageHeader, Segment, Skeleton } from '@embers/ui';
import type { AnalyticsResult } from '@embers/ledger';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { SearchFilterField } from '@/components/data/fields';
import { GroupField } from '@/components/users/parts';
import { BoardTable } from '@/components/users/BoardTable';
import { PROPERTY_BOARD_SORTS, SCOPES, SCOPE_LABELS, propertyBoard, propertyBoardSpec, scopeRange } from '@/lib/analytics';
import type { BoardRow, PropertyBoardSort, Scope } from '@/lib/analytics';
import { readEnum, readText } from '@/lib/filters';
import { formatInt, formatUpx } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import { queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';

const SORT_LABELS: Record<PropertyBoardSort, string> = { bought: 'Properties bought', volume_upx: 'Purchase volume' };

export default function PropertiesLeaderboardPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <PropertiesLeaderboard />
    </Suspense>
  );
}

function PropertiesLeaderboard() {
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(['scope', 'by', 'city'] as const);
  const scope: Scope = readEnum(params, 'scope', SCOPES) ?? 'week';
  const by: PropertyBoardSort = readEnum(params, 'by', PROPERTY_BOARD_SORTS) ?? 'bought';
  const city = readText(params, 'city', 64);

  const query = useLedgerQuery<BoardRow[]>(
    queryKey('/analytics/query#property-board', { scope, by, city }),
    async (c, signal) => {
      const result: AnalyticsResult = await c.analytics.query(propertyBoardSpec(scopeRange(scope, Date.now()), by, city), { signal });
      return propertyBoard(result, by);
    },
    { heavy: true, keepPrevious: true },
  );
  const other: PropertyBoardSort = by === 'bought' ? 'volume_upx' : 'bought';
  const fmt = (k: PropertyBoardSort) => (k === 'bought' ? (n: number | null) => formatInt(n) : (n: number | null) => formatUpx(n, { compact: true }));

  return (
    <>
      <PageHeader title="Properties leaderboard" lede="Who bought the most Upland properties on the market, by count or by UPX spent." />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <GroupField label="Timescope">
          <Chips<Scope> size="dense" label="Timescope" value={scope} onChange={(v) => filters.applyNow({ scope: v === 'week' ? '' : v })} options={SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s] }))} />
        </GroupField>
        <FilterField label="City">
          <SearchFilterField kind="city" label="City" value={city ?? ''} onChange={(v) => filters.applyNow({ city: v })} width={220} />
        </FilterField>
        <GroupField label="Rank by">
          <Segment<PropertyBoardSort> size="dense" label="Rank by" value={by} onChange={(v) => filters.applyNow({ by: v === 'bought' ? '' : v })} options={PROPERTY_BOARD_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))} />
        </GroupField>
      </div>

      <Block
        id="leaderboard"
        title={`${SORT_LABELS[by]} · ${SCOPE_LABELS[scope].toLowerCase()}${city ? ` · ${city}` : ''}`}
        note="Market sales decoded from the chain every 15 min. Today is the UTC day so far. Mints and swaps are not purchases."
      >
        <BoardTable
          query={query}
          who="account"
          whoLabel="Buyer"
          figures={[
            { key: 'value', label: SORT_LABELS[by], format: fmt(by) },
            { key: 'extra', label: SORT_LABELS[other], format: fmt(other) },
            { key: 'extra2', label: 'Median price', format: (n) => formatUpx(n, { compact: true }) },
          ]}
          emptyMessage={city ? `No property sales in ${city} ${SCOPE_LABELS[scope].toLowerCase()}` : `No property sales ${SCOPE_LABELS[scope].toLowerCase()}`}
          emptyAction={
            city ? { label: 'All cities', onClick: () => filters.applyNow({ city: '' }) } : scope !== 'month' ? { label: 'Show last month', onClick: () => filters.applyNow({ scope: 'month' }) } : undefined
          }
          exportName={`properties leaderboard ${by} ${scope}${city ? ` ${city}` : ''}`}
        />
      </Block>
    </>
  );
}
