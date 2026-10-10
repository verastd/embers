/**
 * Property appraiser (F-410), from what the ledger has. The PRD's model is
 * "median price-per-UP2 of comparable sales in the same neighborhood within
 * 90 days, fallback city level". The ledger has no UP2, so the same idea
 * runs on the price each sale got over its own mint price (`price_to_mint`,
 * the "mint-price model" basis the PRD names):
 *
 *   estimate = this property's mint price × median(price ÷ mint) of the
 *              comparables
 *
 * Comparables: sales in the last 90 days with a known mint price, other
 * properties only, one (the newest) per property, closest in mint price
 * first, at most 10. Neighborhood first; city when the neighborhood has
 * fewer than 3. Without a mint price, the basis is the property's own last
 * sale; without either, there is nothing honest to say.
 *
 * Confidence by comparable count: High = 8+ in the neighborhood; Medium =
 * 5+ (or 8+ city-wide); Low otherwise.
 */
import type { Sale } from '@embers/ledger';

export const COMPARABLE_DAYS = 90;
export const MAX_COMPARABLES = 10;
export const MIN_NEIGHBORHOOD_COMPARABLES = 3;

export interface Comparable {
  property_id: string;
  address: string;
  city: string;
  neighborhood: string;
  mint_price_upx: number;
  price_upx: number;
  price_to_mint: number;
  timestamp: string | null;
}

export type Basis = 'mint-model' | 'last-sale' | 'none';
export type Confidence = 'High' | 'Medium' | 'Low';

export interface Appraisal {
  basis: Basis;
  /** Where the comparables came from (mint-model only). */
  level: 'neighborhood' | 'city' | null;
  estimateUpx: number | null;
  /** Median price ÷ mint of the comparables (mint-model only). */
  ratio: number | null;
  comparables: Comparable[];
  confidence: Confidence | null;
}

export interface AppraiseInput {
  propertyId: string;
  mintPriceUpx: number;
  lastSaleUpx: number;
  neighborhoodSales: readonly Sale[];
  citySales: readonly Sale[];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The comparables for a property with mint price `mint`, closest in mint price first. */
export function pickComparables(sales: readonly Sale[], propertyId: string, mint: number, max = MAX_COMPARABLES): Comparable[] {
  const newest = new Map<string, Sale>();
  for (const s of sales) {
    if (s.property_id === propertyId || s.mint_price_upx <= 0 || s.price_upx <= 0 || s.price_to_mint <= 0) continue;
    const prev = newest.get(s.property_id);
    if (prev === undefined || (s.timestamp ?? '') > (prev.timestamp ?? '')) newest.set(s.property_id, s);
  }
  const distance = (s: Sale): number => Math.abs(Math.log(s.mint_price_upx / mint));
  return [...newest.values()]
    .sort((a, b) => distance(a) - distance(b) || (b.timestamp ?? '').localeCompare(a.timestamp ?? '') || a.property_id.localeCompare(b.property_id))
    .slice(0, max)
    .map((s) => ({
      property_id: s.property_id,
      address: s.address,
      city: s.city,
      neighborhood: s.neighborhood,
      mint_price_upx: s.mint_price_upx,
      price_upx: s.price_upx,
      price_to_mint: s.price_to_mint,
      timestamp: s.timestamp,
    }));
}

/** True when the neighborhood alone cannot carry the estimate (the page then reads the city's sales). */
export function needsCityComparables(input: Pick<AppraiseInput, 'propertyId' | 'mintPriceUpx' | 'neighborhoodSales'>): boolean {
  if (input.mintPriceUpx <= 0) return false;
  return pickComparables(input.neighborhoodSales, input.propertyId, input.mintPriceUpx).length < MIN_NEIGHBORHOOD_COMPARABLES;
}

export function confidenceFor(count: number, level: 'neighborhood' | 'city'): Confidence {
  if (level === 'neighborhood') return count >= 8 ? 'High' : count >= 5 ? 'Medium' : 'Low';
  return count >= 8 ? 'Medium' : 'Low';
}

export function appraise(input: AppraiseInput): Appraisal {
  const { propertyId, mintPriceUpx: mint, lastSaleUpx } = input;
  if (mint > 0) {
    const local = pickComparables(input.neighborhoodSales, propertyId, mint);
    const useLocal = local.length >= MIN_NEIGHBORHOOD_COMPARABLES;
    const comps = useLocal ? local : pickComparables(input.citySales, propertyId, mint);
    const ratio = median(comps.map((c) => c.price_to_mint));
    if (ratio !== null) {
      const level = useLocal ? 'neighborhood' : 'city';
      return { basis: 'mint-model', level, estimateUpx: mint * ratio, ratio, comparables: comps, confidence: confidenceFor(comps.length, level) };
    }
  }
  if (lastSaleUpx > 0) {
    return { basis: 'last-sale', level: null, estimateUpx: lastSaleUpx, ratio: null, comparables: [], confidence: 'Low' };
  }
  return { basis: 'none', level: null, estimateUpx: null, ratio: null, comparables: [], confidence: null };
}

/** The estimate plus an extra percentage (the PRD's "extra percentage stepper"). */
export function withExtra(upx: number, extraPercent: number): number {
  return upx * (1 + extraPercent / 100);
}

/** Below the lowest open UPX ask, when there is one. */
export function belowFloor(estimateUpx: number | null, floorUpx: number | null): boolean {
  return estimateUpx !== null && floorUpx !== null && floorUpx > 0 && estimateUpx < floorUpx;
}

/* --- reading the comparable window ------------------------------------------------ */

/** The ledger's largest entity page. */
export const SALES_PAGE = 1000;
/** At most this many sales are read for one appraisal (newest first). */
export const SALES_CAP = 10_000;

export interface SalesWindow {
  sales: Sale[];
  /** The window held more sales than the cap; the oldest were not read. */
  capped: boolean;
}

/**
 * Every sale of the comparable window, page by page (newest first), up to
 * `cap`. A single newest page would pick "closest in mint price" from an
 * arbitrary newest subset in a busy city. `onProgress` gets the running
 * count after each page.
 */
export async function readSalesWindow(
  fetchPage: (page: { limit: number; offset: number }) => Promise<{ data: Sale[]; has_more: boolean }>,
  onProgress?: (read: number) => void,
  cap = SALES_CAP,
  pageSize = SALES_PAGE,
): Promise<SalesWindow> {
  const sales: Sale[] = [];
  let offset = 0;
  while (sales.length < cap) {
    const page = await fetchPage({ limit: Math.min(pageSize, cap - sales.length), offset });
    sales.push(...page.data);
    onProgress?.(sales.length);
    if (!page.has_more || page.data.length === 0) return { sales, capped: false };
    offset += page.data.length;
  }
  return { sales, capped: true };
}
