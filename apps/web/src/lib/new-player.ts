/**
 * New player guide (F-1904), step 2: one row per city from the ledger's
 * per-city daily market (`/market/cities`), the latest day each city has,
 * cheapest median UPX ask first. Cities with no UPX asks that day go last.
 */
import type { CityDay } from '@embers/ledger';

export function latestPerCity(rows: readonly CityDay[]): CityDay[] {
  const latest = new Map<string, CityDay>();
  for (const r of rows) {
    if (!r.city) continue;
    const seen = latest.get(r.city);
    if (!seen || r.day > seen.day) latest.set(r.city, r);
  }
  return [...latest.values()].sort((a, b) => {
    const x = a.median_ask_upx;
    const y = b.median_ask_upx;
    if (x === null && y === null) return a.city.localeCompare(b.city);
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y || a.city.localeCompare(b.city);
  });
}

/** Case- and accent-insensitive city filter. */
export function matchesCity(city: string, query: string): boolean {
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  return q.length === 0 || fold(city).includes(q);
}

/** The Properties search URL that finds one property by its address in its city. */
export function propertySearchHref(address: string, city: string): string {
  const q = new URLSearchParams({ search: '1', city, address });
  return `/properties/search?${q.toString()}`;
}
