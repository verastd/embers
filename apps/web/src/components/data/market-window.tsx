'use client';

/**
 * The market window shared by Properties overview (F-401) and the city
 * overview (F-402): "Latest day", "7 days" or "30 days" of `/market/cities`,
 * URL-backed (`?window=`), plus the "data through" line.
 *
 * `/market/cities` is one row per city per day; the market layer is rebuilt
 * every 6 h, so "Latest day" is the newest day the ledger has rows for
 * (no date bound: newest first), not necessarily today.
 */
import type { CityDay, CitiesParams } from '@embers/ledger';

import { ChipsField } from './ChipsField';
import { formatDay } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import type { QueryResult } from '@/lib/hooks';
import { cityDaysParams, onlyLatestDay } from '@/lib/properties-analytics';
import { queryKey } from '@/lib/query-core';

export type MarketWindow = 'latest' | '7' | '30';
export const MARKET_WINDOWS: ReadonlyArray<{ value: MarketWindow; label: string }> = [
  { value: 'latest', label: 'Latest day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
];

export function readWindow(raw: string | null | undefined): MarketWindow {
  return raw === 'latest' || raw === '30' ? raw : '7';
}

/** In words, for notes and empty states: "the latest day", "the last 7 days". */
export function windowPhrase(w: MarketWindow): string {
  return w === 'latest' ? 'the latest day' : `the last ${w} days`;
}

/** `/market/cities` for the window (all cities, or one), through the shared heavy-query slot. */
export function useCityDays(win: MarketWindow, city?: string): QueryResult<CityDay[]> {
  const params: CitiesParams = cityDaysParams(win, city);
  return useLedgerQuery<CityDay[]>(
    queryKey('/market/cities', { ...params, window: win }),
    async (c, signal) => {
      const rows = await c.market.cities(params, { signal });
      return win === 'latest' ? onlyLatestDay(rows) : rows;
    },
    { heavy: true, keepPrevious: true },
  );
}

export function WindowChips({ value, onChange }: { value: MarketWindow; onChange: (w: MarketWindow) => void }) {
  return <ChipsField<MarketWindow> label="Window" value={value} onChange={onChange} options={MARKET_WINDOWS} />;
}

/** "Market data through Oct 8, 2026 · rebuilt every 6 h" once known. */
export function DataThrough({ day }: { day: string | null }) {
  if (day === null) return null;
  return (
    <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
      Market data through <strong style={{ color: 'var(--text-secondary)' }}>{formatDay(day)}</strong> · rebuilt every 6 h
    </span>
  );
}
