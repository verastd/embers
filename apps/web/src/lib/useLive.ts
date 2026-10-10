'use client';

/**
 * Live pages (PRD 5.4): queries that keep their rows through a failed poll,
 * a poller that drives the LiveIndicator, and the "new rows" highlight with
 * its "N new" jump pill.
 *
 * A live query differs from `useLedgerQuery` in one rule: once rows are on
 * screen, a failed poll does NOT replace them with an error. The poll
 * reports the failure to the LiveIndicator (reconnecting, attempt n) and the
 * rows stay, with a stale banner once they are older than their budget. A
 * failed FIRST load is still an error state with Retry.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { LedgerClient, LedgerError } from '@embers/ledger';
import type { LiveIndicatorProps } from '@embers/ui';

import { runRead } from './hooks';
import type { Fetcher, OffsetPage, OffsetFeedResult, QueryResult } from './hooks';
import { INITIAL_LIVE, arrivalsAbove, expireFresh, forFeed, liveStatus, newTracker, nextExpiry, observeRows, pollDue, pollFailed, pollSucceeded, retryNow, secondsUntil, setPaused, staleMinutes } from './live';
import { describeError, viewState } from './query-core';
import type { QuerySnapshot } from './query-core';

export interface LiveQueryResult<T> extends QueryResult<T> {
  /** Re-reads once; true when it succeeded. */
  poll: () => Promise<boolean>;
}

export function useLiveLedgerQuery<T>(key: string | null, fetcher: Fetcher<T>, options: { heavy?: boolean; isEmpty?: (data: T) => boolean } = {}): LiveQueryResult<T> {
  const { heavy = false, isEmpty } = options;
  const q = useQuery<T, LedgerError>({
    queryKey: ['ledger', 'live', key],
    queryFn: ({ signal }) => runRead(fetcher, heavy, signal),
    enabled: key !== null,
  });
  const { refetch: queryRefetch } = q;
  const poll = useCallback(async (): Promise<boolean> => !(await queryRefetch()).isError, [queryRefetch]);
  const refetch = useCallback(async (): Promise<void> => {
    await queryRefetch();
  }, [queryRefetch]);
  const firstFailed = q.isError && q.data === undefined;
  const snap: QuerySnapshot<T> = {
    status: firstFailed ? 'error' : q.data !== undefined ? 'success' : key !== null ? 'loading' : 'idle',
    data: q.data,
    error: firstFailed ? q.error : undefined,
    fetching: q.isFetching,
    updatedAt: q.dataUpdatedAt > 0 ? q.dataUpdatedAt : undefined,
  };
  return { ...snap, view: viewState(snap, isEmpty), refetch, poll };
}

export interface LiveOffsetFeedResult<T> extends OffsetFeedResult<T> {
  poll: () => Promise<boolean>;
  /** Pages loaded (Load more raises it; a poll does not). */
  pageCount: number;
}

/** An offset route as a live feed: Load more appends; a poll re-reads every loaded page. */
export function useLiveOffsetFeed<T>(
  key: string | null,
  fetchPage: (page: { limit: number; offset: number }, client: LedgerClient, signal: AbortSignal) => Promise<OffsetPage<T>>,
  pageSize: number,
): LiveOffsetFeedResult<T> {
  const q = useInfiniteQuery<OffsetPage<T>, LedgerError>({
    queryKey: ['ledger', 'live-feed', key, pageSize],
    queryFn: ({ pageParam, signal }) => runRead((client, s) => fetchPage({ limit: pageSize, offset: pageParam as number }, client, s), false, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.has_more ? last.offset + last.data.length : undefined),
    enabled: key !== null,
  });
  const { refetch: queryRefetch, fetchNextPage } = q;
  const poll = useCallback(async (): Promise<boolean> => !(await queryRefetch()).isError, [queryRefetch]);
  const refetch = useCallback(async (): Promise<void> => {
    await queryRefetch();
  }, [queryRefetch]);
  const loadMore = useCallback(async (): Promise<void> => {
    await fetchNextPage();
  }, [fetchNextPage]);
  const first = q.data?.pages[0];
  const firstFailed = q.isError && q.data === undefined;
  const snap: QuerySnapshot<OffsetPage<T>> = {
    status: firstFailed ? 'error' : first !== undefined ? 'success' : key !== null ? 'loading' : 'idle',
    data: first,
    error: firstFailed ? q.error : undefined,
    fetching: q.isFetching && !q.isFetchingNextPage,
    updatedAt: q.dataUpdatedAt > 0 ? q.dataUpdatedAt : undefined,
  };
  // One array per answer, not per render: consumers key effects on it.
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  return {
    ...snap,
    view: viewState(snap),
    refetch,
    poll,
    pageCount: q.data?.pages.length ?? 0,
    items,
    hasMore: q.hasNextPage,
    loadingMore: q.isFetchingNextPage,
    loadMoreError: q.isFetchNextPageError ? q.error : undefined,
    loadMore,
  };
}

/* --- the poller -------------------------------------------------------------- */

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = (): void => setHidden(document.visibilityState === 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

export interface LivePoller {
  /** Spread onto <LiveIndicator>. */
  indicator: LiveIndicatorProps;
  /** For DataState's stale banner, null while fresh. */
  staleMinutes: number | null;
  paused: boolean;
  pause: () => void;
  resume: () => void;
  /** Ticks every second: for relative times on screen. */
  now: number;
}

export interface LivePollOptions {
  /** The feed's identity (its query key): a new one restarts the poller from connecting. */
  feedKey: string;
  intervalMs: number;
  /** Re-read every live region; true when all succeeded. */
  poll: () => Promise<boolean>;
  /** Rows (or numbers) are on screen. */
  hasData: boolean;
  /** The first load failed (no data at all): the indicator says so, with Retry. */
  firstError?: LedgerError;
  /** Retry after a failed first load. */
  retryFirst?: () => unknown;
  /** How old the data may get before the stale banner shows (default 3 intervals). */
  staleBudgetMs?: number;
}

export function useLivePoll({ feedKey, intervalMs, poll, hasData, firstError, retryFirst, staleBudgetMs = intervalMs * 3 }: LivePollOptions): LivePoller {
  const [stored, setState] = useState(() => forFeed(INITIAL_LIVE, feedKey));
  // A new filter is a new feed: whatever the old one did (offline, backoff) does not carry over.
  const state = forFeed(stored, feedKey);
  if (state !== stored) setState(state);
  const [now, setNow] = useState(() => Date.now());
  const hidden = usePageHidden();
  const inFlight = useRef(false);
  const pollRef = useRef(poll);
  pollRef.current = poll;

  // The first answer (and each new filter's first answer) counts as a successful poll.
  if (hasData && state.lastOkAt === null) setState(pollSucceeded(state, Date.now(), intervalMs));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!pollDue(state, now, hidden, inFlight.current)) return;
    inFlight.current = true;
    const feed = state.feed;
    void pollRef.current().then((ok) => {
      inFlight.current = false;
      const at = Date.now();
      // A poll of a feed the user has since filtered away says nothing about the new one.
      setState((s) => (s.feed !== feed ? s : ok ? pollSucceeded(s, at, intervalMs) : pollFailed(s, at)));
      setNow(at);
    });
  }, [state, now, hidden, intervalMs]);

  const retry = useCallback(() => {
    if (state.lastOkAt === null) {
      void retryFirst?.();
      return;
    }
    const at = Date.now();
    setState((s) => retryNow(s, at));
    setNow(at);
  }, [retryFirst, state.lastOkAt]);
  const pause = useCallback(() => setState((s) => setPaused(s, true, Date.now())), []);
  const resume = useCallback(() => {
    const at = Date.now();
    setState((s) => setPaused(s, false, at));
    setNow(at);
  }, []);

  const status = liveStatus(state, hidden, firstError !== undefined);
  const indicator: LiveIndicatorProps = {
    status,
    attempt: state.attempt || undefined,
    updatedAt: state.lastOkAt === null ? undefined : formatHms(state.lastOkAt),
    // PRD 5.4: a countdown when the interval is 30 s or more.
    nextPollIn: intervalMs >= 30_000 && status === 'live' ? secondsUntil(state.nextAt, now) : undefined,
    onResume: resume,
    onRetry: retry,
    reason: firstError ? describeError(firstError).title : undefined,
  };
  return {
    indicator,
    staleMinutes: staleMinutes(state.lastOkAt, now, staleBudgetMs),
    paused: state.userPaused,
    pause,
    resume,
    now,
  };
}

function formatHms(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/* --- new rows ---------------------------------------------------------------- */

export interface NewRows<T extends object> {
  /** The rows, with `__new` on the ones that just arrived (DataTable's 2 s highlight). */
  rows: Array<T & { __new?: boolean }>;
  /** Arrivals that landed above the viewport ("N new" pill). */
  newCount: number;
  /** Scrolls the table into view and clears the count. */
  jumpToNew: () => void;
}

/**
 * Marks rows that arrived with the latest poll (see `observeRows`): any key
 * new to this feed, wherever the sort puts it, except rows Load more
 * appended. `feedKey` is the filter key: a new filter's rows are a new list,
 * not arrivals. `pages` is the loaded page count (1 for a single read).
 *
 * The answer is identified by the joined keys, not the array, so a
 * rerender with the same rows never re-observes them; the highlight timer
 * hangs off the earliest end time, so it is never dropped by a rerender.
 */
export function useNewRows<T extends object>(rows: readonly T[], rowKey: (row: T) => string, feedKey: string, anchor: RefObject<HTMLElement | null>, pages = 1): NewRows<T> {
  const [tracker, setTracker] = useState(() => newTracker(feedKey));
  const [newCount, setNewCount] = useState(0);
  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const signature = keys.join('\u0001');
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    const current = keysRef.current;
    const { tracker: next, arrived } = observeRows(tracker, feedKey, current, pages, Date.now());
    setTracker(next);
    if (feedKey !== tracker.feed) setNewCount(0);
    if (arrived.length === 0) return;
    const rowsEl = anchor.current?.querySelectorAll('tbody tr');
    const above = arrivalsAbove(
      arrived.map((k) => current.indexOf(k)),
      (i) => rowsEl?.[i]?.getBoundingClientRect().top ?? null,
    );
    if (above > 0) setNewCount((n) => n + above);
    // Only a new answer (signature, pages, feed) re-runs this; the tracker is read as of that answer.
  }, [signature, pages, feedKey, anchor]);

  const expiry = nextExpiry(tracker.fresh);
  useEffect(() => {
    if (expiry === null) return undefined;
    const t = setTimeout(() => setTracker((tr) => ({ ...tr, fresh: expireFresh(tr.fresh, Date.now()) })), Math.max(0, expiry - Date.now()));
    return () => clearTimeout(t);
  }, [expiry]);

  useEffect(() => {
    if (newCount === 0 || typeof window === 'undefined') return undefined;
    const onScroll = (): void => {
      if ((anchor.current?.getBoundingClientRect().top ?? 0) >= 0) setNewCount(0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [newCount, anchor]);

  const jumpToNew = useCallback(() => {
    anchor.current?.scrollIntoView({ block: 'start' });
    setNewCount(0);
  }, [anchor]);

  const fresh = tracker.fresh;
  const marked = useMemo(() => rows.map((r, i): T & { __new?: boolean } => (fresh.has(keys[i] ?? '') ? { ...r, __new: true } : (r as T & { __new?: boolean }))), [rows, keys, fresh]);
  return { rows: marked, newCount, jumpToNew };
}
