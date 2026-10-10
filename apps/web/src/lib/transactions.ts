/**
 * Property transactions (F-406): order-book sales (`/sales`) and accepted
 * offers (`/offers`, invisible in `/sales`) as one list, newest first.
 *
 * The two are separate offset feeds. Merged, a row may only be shown once
 * every feed that still has more pages has loaded past it; otherwise an
 * older row of one feed would sit above a newer, not-yet-loaded row of the
 * other. `mergeFeeds` cuts the list there; Load more moves the cut down.
 *
 * Polarity: in `/sales` the buyer is the event account; in `/offers` the
 * acceptor is the SELLER. Both are normalised to buyer/seller here.
 */
import type { Offer, Sale } from '@embers/ledger';

export type TxType = 'sale' | 'offer';

export interface TxRow {
  key: string;
  type: TxType;
  timestamp: string | null;
  property_id: string;
  address: string;
  city: string;
  /** Sales carry the neighborhood; offers only the region. */
  neighborhood: string;
  buyer: string;
  /** Offers name the buyer's username; sales only the account. */
  buyer_username: string;
  seller: string;
  price_upx: number;
  mint_price_upx: number;
  /** price ÷ mint; 0 when the mint price is unknown. */
  price_to_mint: number;
  trx_id: string;
}

export function fromSale(s: Sale): TxRow {
  return {
    key: `sale|${s.trx_id}|${s.property_id}`,
    type: 'sale',
    timestamp: s.timestamp,
    property_id: s.property_id,
    address: s.address,
    city: s.city,
    neighborhood: s.neighborhood,
    buyer: s.buyer,
    buyer_username: '',
    seller: s.seller,
    price_upx: s.price_upx,
    mint_price_upx: s.mint_price_upx,
    price_to_mint: s.price_to_mint,
    trx_id: s.trx_id,
  };
}

export function fromOffer(o: Offer): TxRow {
  return {
    key: `offer|${o.trx_id}|${o.offer_id}|${o.property_id}`,
    type: 'offer',
    timestamp: o.timestamp,
    property_id: o.property_id,
    address: o.address,
    city: o.city,
    neighborhood: '',
    buyer: o.buyer,
    buyer_username: o.buyer_username,
    seller: o.seller,
    price_upx: o.price_upx,
    mint_price_upx: o.mint_price_upx,
    price_to_mint: o.price_to_mint,
    trx_id: o.trx_id,
  };
}

export interface FeedSlice {
  rows: readonly TxRow[];
  /** More pages exist beyond `rows`. */
  hasMore: boolean;
}

const newestFirst = (a: TxRow, b: TxRow): number => {
  const ta = a.timestamp ?? '';
  const tb = b.timestamp ?? '';
  return ta < tb ? 1 : ta > tb ? -1 : a.key.localeCompare(b.key);
};

/**
 * The merged list, newest first, cut where it stops being complete: at the
 * newest "oldest loaded row" among the feeds that still have more. `hidden`
 * counts rows held back until the next Load more.
 */
export function mergeFeeds(feeds: readonly FeedSlice[]): { rows: TxRow[]; hidden: number } {
  const all = feeds.flatMap((f) => f.rows).sort(newestFirst);
  let cut: string | null = null;
  for (const f of feeds) {
    if (!f.hasMore || f.rows.length === 0) continue;
    const oldest = f.rows.reduce<string>((min, r) => ((r.timestamp ?? '') < min ? (r.timestamp ?? '') : min), f.rows[0]?.timestamp ?? '');
    if (cut === null || oldest > cut) cut = oldest;
  }
  if (cut === null) return { rows: all, hidden: 0 };
  const boundary = cut;
  const rows = all.filter((r) => (r.timestamp ?? '') >= boundary);
  return { rows, hidden: all.length - rows.length };
}

/* --- CSV export ---------------------------------------------------------------- */

const CSV_HEADER = ['timestamp', 'type', 'property_id', 'address', 'city', 'neighborhood', 'buyer', 'buyer_username', 'seller', 'price_upx', 'mint_price_upx', 'price_to_mint', 'trx_id'] as const;

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  // Quote anything with a delimiter, quote or newline; neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly TxRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [r.timestamp, r.type === 'sale' ? 'Sale' : 'Accepted offer', r.property_id, r.address, r.city, r.neighborhood, r.buyer, r.buyer_username, r.seller, r.price_upx, r.mint_price_upx, r.price_to_mint, r.trx_id]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Days back for each period choice; null = all time. */
export const PERIODS = { all: null, '7d': 7, '30d': 30, '90d': 90 } as const;
export type Period = keyof typeof PERIODS;

/** The `after` instant for a period: the start of the UTC day `days` back, so the cache key is stable all day. */
export function periodStart(period: Period, now: number = Date.now()): string | undefined {
  const days = PERIODS[period];
  if (days === null) return undefined;
  const d = new Date(now - days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T00:00:00Z`;
}
