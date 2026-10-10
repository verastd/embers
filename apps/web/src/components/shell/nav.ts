/**
 * The sidebar (PRD 7.2), in its order. PRD §0 rule 7: a route and its menu
 * entry exist only once the feature ships, so this lists shipped routes only;
 * a section with no shipped route is not shown.
 *
 * Each section is its own block so features built in parallel add their
 * entries without touching each other's lines.
 */
import type { NavGroup, NavItem } from '@embers/ui';

export const ROUTES = {
  home: '/',
  propertiesSearch: '/properties/search',
} as const;

const HOME: NavItem[] = [
  // F-190
];

const USERS: NavItem[] = [
  // F-201, F-202
];

const PROPERTIES: NavItem[] = [
  // F-401 Overview (first in the PRD order)
  { label: 'Overview', href: '/properties/overview', icon: 'layers' },

  { label: 'Search', href: ROUTES.propertiesSearch, icon: 'search' },

  // F-404, F-405, F-406

  // F-407, F-408, F-409
  { label: 'Statistics', href: '/properties/statistics', icon: 'chart-line' },
  { label: 'Mint Analytics', href: '/properties/mint-analytics', icon: 'hammer' },

  // F-410, F-412
];

const LEADERBOARDS: NavItem[] = [
  // F-1606
];

const COMMUNITY: NavItem[] = [
  // F-1901 to F-1905
];

const SYSTEM: NavItem[] = [
  // F-1906 to F-1911
];

const SECTIONS: NavGroup[] = [
  { id: 'home', label: 'Home', icon: 'house', items: HOME },
  { id: 'users', label: 'Users', icon: 'users', items: USERS },
  { id: 'properties', label: 'Properties', icon: 'building-2', items: PROPERTIES },
  { id: 'leaderboards', label: 'Leaderboards', icon: 'trophy', items: LEADERBOARDS },
  { id: 'community', label: 'Community', icon: 'messages-square', items: COMMUNITY },
  { id: 'system', label: 'System', icon: 'info', items: SYSTEM },
];

export const NAV: NavGroup[] = SECTIONS.filter((g) => g.items.length > 0);

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
