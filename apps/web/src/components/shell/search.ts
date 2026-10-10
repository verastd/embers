/**
 * Global search rows (PRD F-101) from the ledger's `/search`. Only kinds whose
 * destination route exists are offered (PRD §0 rule 7): properties and
 * cities open Properties search pre-filtered; accounts open the user
 * profile (F-202).
 */
import type { TopBarSearchRow } from '@embers/ui';
import type { SearchResult } from '@embers/ledger';

import { hrefWith } from '@/lib/filters';
import { formatUpx } from '@/lib/format';

import { userHref } from '@/lib/users';

import { ROUTES } from './nav';

export const MIN_QUERY = 3;
export const PER_KIND = 5;
export const RECENT_MAX = 10;

export function searchRows(r: SearchResult): TopBarSearchRow[] {
  return [
    ...(r.accounts ?? []).map((a) => ({
      label: a.username ? `${a.username} · ${a.account}` : a.account,
      kind: 'User',
      icon: 'user' as const,
      href: userHref(a.username || a.account),
    })),
    ...(r.properties ?? []).map((p) => ({
      label: [p.address || `#${p.property_id}`, p.city].filter(Boolean).join(', ') + (p.mint_price_upx > 0 ? ` · mint ${formatUpx(p.mint_price_upx, { compact: true })}` : ''),
      kind: 'Property',
      icon: 'building-2' as const,
      href: hrefWith(ROUTES.propertiesSearch, { address: p.address || undefined, city: p.city || undefined }),
    })),
    ...(r.cities ?? []).map((c) => ({
      label: [c.name, c.state_name, c.country_name].filter(Boolean).join(', '),
      kind: 'City',
      icon: 'map-pin' as const,
      href: hrefWith(ROUTES.propertiesSearch, { city: c.name }),
    })),
  ];
}

export const isRows = (v: unknown): v is TopBarSearchRow[] =>
  Array.isArray(v) &&
  v.every((r) => typeof r === 'object' && r !== null && typeof (r as TopBarSearchRow).label === 'string' && typeof (r as TopBarSearchRow).href === 'string' && (r as TopBarSearchRow).href!.startsWith('/'));

/** Puts `row` first, de-duplicated by href, capped at RECENT_MAX (F-101: recent 10). */
export function pushRecent(recent: TopBarSearchRow[], row: TopBarSearchRow): TopBarSearchRow[] {
  return [{ label: row.label, href: row.href, kind: row.kind, icon: row.icon }, ...recent.filter((r) => r.href !== row.href)].slice(0, RECENT_MAX);
}
