'use client';

/**
 * The global shell (PRD F-101 to F-103): AppShell with the TopBar (search,
 * UTC/PT clocks, theme), the SidebarNav (7.2 sections, Favorites, persisted
 * open groups) and the same nav in the <dialog> drawer below 1024px.
 *
 * Search: 3-character minimum, 250 ms debounce, the last 10 picks in
 * localStorage with "Clear history", Esc closes, arrow keys move (TopBar).
 * Route changes show the top progress bar (PRD 5.8) from the click until
 * the new URL renders.
 *
 * Account: GitHub sign-in (TD's decision for F-301) in the trailing slot.
 * Not here yet, by design (PRD §0 rule 7, no placeholder UI): the
 * notifications bell (F-1701), which arrives with its feature.
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppShell, SidebarNav, TopBar, useEmbersTheme } from '@embers/ui';
import type { NavItem, NavLinkRenderProps, TopBarSearchRow, TopBarSearchStatus } from '@embers/ui';
import type { SearchResult } from '@embers/ledger';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { isPropertyId } from '@/lib/filters';
import { useDebouncedValue, useLedgerQuery } from '@/lib/hooks';
import { queryKey } from '@/lib/query-core';

import { NAV, ROUTES, activeHref, isNavItems } from './nav';
import { AccountControl } from './AccountControl';
import type { AccountUser } from './AccountControl';
import { MIN_QUERY, PER_KIND, isRows, pushRecent, searchRows } from './search';
import { isStrings, readStored, writeStored } from './storage';

const STORE = { recent: 'embers:recent-search', favorites: 'embers:favorites', groups: 'embers:open-groups' };
const DEFAULT_GROUPS = ['fav', ...NAV.map((g) => g.id)];
const ROUTING_GIVE_UP_MS = 15_000;

function renderLink({ href, className, style, children, ...rest }: NavLinkRenderProps) {
  return (
    <Link href={href} className={className} style={style} aria-current={(rest as { 'aria-current'?: 'page' })['aria-current']}>
      {children}
    </Link>
  );
}

/** True for a plain left click on a same-origin link to another URL. */
function isInternalNavigation(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.('a[href]');
  if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self') || a.hasAttribute('download')) return false;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  return url.pathname + url.search !== window.location.pathname + window.location.search;
}

/** Reports query-string changes (its own Suspense boundary, so the frame never waits on it). */
function SearchChange({ onChange }: { onChange: () => void }) {
  const search = useSearchParams();
  useEffect(onChange, [search, onChange]);
  return null;
}

/** The top progress bar: on from an internal link click (or a push), off when the URL changes. */
function useRouteProgress(): { routing: boolean; start: () => void; stop: () => void } {
  const pathname = usePathname();
  const [routing, setRouting] = useState(false);
  const stop = useCallback(() => setRouting(false), []);
  const start = useCallback(() => setRouting(true), []);
  useEffect(stop, [pathname, stop]);
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (isInternalNavigation(e)) setRouting(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  useEffect(() => {
    if (!routing) return undefined;
    const t = setTimeout(() => setRouting(false), ROUTING_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [routing]);
  return { routing, start, stop };
}

export function AppFrame({ children, user, signInAvailable }: { children: ReactNode; user: AccountUser | null; signInAvailable: boolean }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const { theme, setTheme } = useEmbersTheme();
  const { routing, start: startRouting, stop: stopRouting } = useRouteProgress();

  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<TopBarSearchRow[]>([]);
  const [favorites, setFavorites] = useState<NavItem[]>([]);
  const [openGroups, setOpenGroups] = useState<string[]>(DEFAULT_GROUPS);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setRecent(readStored(STORE.recent, [], isRows));
    setFavorites(readStored(STORE.favorites, [], isNavItems));
    setOpenGroups(readStored(STORE.groups, DEFAULT_GROUPS, isStrings));
  }, []);
  useEffect(() => setDrawerOpen(false), [pathname]);

  const settled = useDebouncedValue(query.trim(), 250);
  const ready = settled.length >= MIN_QUERY || (isPropertyId(settled) && settled.length > 0);
  const search = useLedgerQuery<SearchResult>(ready ? queryKey('/search', { q: settled, limit: PER_KIND }) : null, (c, signal) =>
    c.search({ q: settled, limit: PER_KIND }, { signal }),
  );
  const results = useMemo(() => (search.data ? searchRows(search.data) : []), [search.data]);
  const typing = query.trim() !== settled;
  const status: TopBarSearchStatus =
    query.trim().length === 0
      ? 'idle'
      : typing || search.view === 'loading' || search.fetching
        ? 'loading'
        : search.view === 'error' || search.view === 'unauthenticated'
          ? 'error'
          : results.length === 0
            ? 'empty'
            : 'results';

  const pick = useCallback(
    (row: TopBarSearchRow) => {
      if (!row.href) return;
      const next = pushRecent(recent, row);
      setRecent(next);
      writeStored(STORE.recent, next);
      setQuery('');
      startRouting();
      router.push(row.href);
    },
    [recent, router, startRouting],
  );
  const clearRecent = useCallback(() => {
    setRecent([]);
    writeStored(STORE.recent, []);
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      writeStored(STORE.groups, next);
      return next;
    });
  }, []);
  const toggleFavorite = useCallback((item: NavItem) => {
    setFavorites((list) => {
      const next = list.some((f) => f.href === item.href) ? list.filter((f) => f.href !== item.href) : [...list, { label: item.label, href: item.href, icon: item.icon }];
      writeStored(STORE.favorites, next);
      return next;
    });
  }, []);

  const nav = (
    <SidebarNav
      groups={NAV}
      activeHref={activeHref(pathname)}
      openGroups={openGroups}
      onToggleGroup={toggleGroup}
      favorites={favorites}
      onToggleFavorite={toggleFavorite}
      renderLink={renderLink}
    />
  );

  return (
    <AppShell
      style={{ minHeight: '100dvh' }}
      routing={routing}
      topBar={
        <TopBar
          query={query}
          onQueryChange={setQuery}
          searchStatus={status}
          results={results}
          recent={recent}
          searchPlaceholder="Search properties and cities…"
          onClearRecent={recent.length > 0 ? clearRecent : undefined}
          onPick={pick}
          onSearchRetry={() => void search.refetch()}
          theme={theme}
          onTheme={setTheme}
          onMenu={() => setDrawerOpen(true)}
          brand={
            <Link href={ROUTES.home} style={{ font: 'var(--type-title)', color: 'var(--text-primary)', textDecoration: 'none', marginRight: 8, whiteSpace: 'nowrap' }}>
              Embers
            </Link>
          }
          trailing={<AccountControl user={user} signInAvailable={signInAvailable} />}
        />
      }
      sidebar={nav}
      drawer={nav}
      drawerOpen={drawerOpen}
      onDrawerClose={() => setDrawerOpen(false)}
      drawerTitle="Embers"
      footer="Upland data from public sources and the chain. Not affiliated with Uplandme, Inc. Figures are estimates; do your own research."
    >
      <Suspense fallback={null}>
        <SearchChange onChange={stopRouting} />
      </Suspense>
      {children}
    </AppShell>
  );
}
