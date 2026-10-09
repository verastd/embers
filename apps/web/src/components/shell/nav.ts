/**
 * The sidebar (PRD 7.2), in its order. PRD §0 rule 7: a route and its menu
 * entry exist only once the feature ships, so this lists shipped routes only;
 * sections appear as their first route lands.
 */
import type { NavGroup, NavItem } from '@embers/ui';

export const ROUTES = {
  home: '/',
  propertiesSearch: '/properties/search',
} as const;

export const NAV: NavGroup[] = [
  {
    id: 'properties',
    label: 'Properties',
    icon: 'building-2',
    items: [{ label: 'Search', href: ROUTES.propertiesSearch, icon: 'search' }],
  },
];

export const ALL_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/** The nav item a path belongs to: exact match, else the longest prefix. */
export function activeHref(pathname: string): string | undefined {
  const exact = ALL_ITEMS.find((i) => i.href === pathname);
  if (exact) return exact.href;
  return ALL_ITEMS.filter((i) => i.href !== '/' && pathname.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export const isNavItems = (v: unknown): v is NavItem[] =>
  Array.isArray(v) &&
  v.every((r) => typeof r === 'object' && r !== null && typeof (r as NavItem).label === 'string' && typeof (r as NavItem).href === 'string' && (r as NavItem).href.startsWith('/'));
