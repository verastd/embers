/**
 * The polling state machine behind every live page's LiveIndicator (PRD
 * 5.4): connecting until the first answer, live while polls succeed,
 * reconnecting (attempt n, with backoff) after a failed poll, offline after
 * too many in a row (Retry is then a visible word), paused while the tab is
 * hidden or the user paused it. Plus the two pieces of "new rows arriving":
 * which rows are new in this answer, and how old the data on screen is.
 *
 * Pure functions, so the timing rules are tested without a DOM or a clock.
 */
import type { LiveStatus } from '@embers/ui';

export type LivePhase = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface LiveState {
  /** Which feed (query key) this state belongs to; a new filter is a new feed. */
  feed: string;
  phase: LivePhase;
  /** Failed polls in a row (0 while live). */
  attempt: number;
  /** When the next poll is due (ms since epoch), null when none is scheduled. */
  nextAt: number | null;
  /** When the data on screen last arrived. */
  lastOkAt: number | null;
  userPaused: boolean;
}

/** Waits after the 1st, 2nd, … failed poll. The last value repeats. */
export const BACKOFF_MS = [5_000, 10_000, 20_000, 30_000] as const;
/** Failed polls in a row before the feed calls itself offline and stops trying on its own. */
export const MAX_ATTEMPTS = 5;

export const INITIAL_LIVE: LiveState = { feed: '', phase: 'connecting', attempt: 0, nextAt: null, lastOkAt: null, userPaused: false };

export function backoffMs(attempt: number): number {
  const i = Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i] ?? 30_000;
}

/**
 * The state for `feed`: unchanged for the same feed; a fresh start
 * (connecting, no attempts, nothing on screen yet) for a new one, so a feed
 * that went offline does not keep a newly applied filter offline. The
 * user's pause carries over.
 */
export function forFeed(s: LiveState, feed: string): LiveState {
  return s.feed === feed ? s : { ...INITIAL_LIVE, feed, userPaused: s.userPaused };
}

/** An answer arrived (the first load or a poll): live, next poll one interval from now. */
export function pollSucceeded(s: LiveState, now: number, intervalMs: number): LiveState {
  return { ...s, phase: 'live', attempt: 0, nextAt: now + intervalMs, lastOkAt: now };
}

/** A poll failed: reconnecting with backoff, or offline once MAX_ATTEMPTS polls failed in a row. */
export function pollFailed(s: LiveState, now: number): LiveState {
  const attempt = s.attempt + 1;
  if (attempt >= MAX_ATTEMPTS) return { ...s, phase: 'offline', attempt, nextAt: null };
  return { ...s, phase: 'reconnecting', attempt, nextAt: now + backoffMs(attempt) };
}

/** Retry from offline (or "poll now"): due immediately, attempts keep counting. */
export function retryNow(s: LiveState, now: number): LiveState {
  return { ...s, phase: s.phase === 'offline' ? 'reconnecting' : s.phase, nextAt: now };
}

export function setPaused(s: LiveState, paused: boolean, now: number): LiveState {
  // Resuming polls right away: whatever was on screen may be minutes old.
  return paused ? { ...s, userPaused: true } : { ...s, userPaused: false, nextAt: s.nextAt === null ? null : Math.min(s.nextAt, now) };
}

/** Whether a poll should start now. */
export function pollDue(s: LiveState, now: number, hidden: boolean, inFlight: boolean): boolean {
  if (inFlight || hidden || s.userPaused || s.nextAt === null) return false;
  if (s.phase !== 'live' && s.phase !== 'reconnecting') return false;
  return now >= s.nextAt;
}

/** What the LiveIndicator shows. `firstError` is a failed first load (no data at all yet). */
export function liveStatus(s: LiveState, hidden: boolean, firstError: boolean): LiveStatus {
  if (firstError && s.lastOkAt === null) return 'error';
  if (s.userPaused || (hidden && s.phase !== 'connecting')) return 'paused';
  return s.phase;
}

/** Whole seconds until the next poll, for the countdown (PRD 5.4: shown when the interval is ≥ 30 s). */
export function secondsUntil(nextAt: number | null, now: number): number | undefined {
  if (nextAt === null) return undefined;
  return Math.max(0, Math.ceil((nextAt - now) / 1000));
}

/**
 * Minutes the data on screen is past its budget, for DataState's stale
 * banner ("Data is N min old"), or null while it is fresh enough.
 */
export function staleMinutes(lastOkAt: number | null, now: number, budgetMs: number): number | null {
  if (lastOkAt === null) return null;
  const age = now - lastOkAt;
  return age > budgetMs ? Math.max(1, Math.floor(age / 60_000)) : null;
}

/* --- arrivals ------------------------------------------------------------------ */

/** How long an arrived row stays highlighted (PRD 5.4). */
export const HIGHLIGHT_MS = 2_000;

export interface ArrivalTracker {
  /** The feed (filter key) the keys belong to. */
  feed: string;
  /** Every key seen on any loaded page of this feed. */
  seen: ReadonlySet<string>;
  /** Pages loaded at the last answer (Load more raises it). */
  pages: number;
  /** Rows at the last answer. */
  count: number;
  /** Highlighted keys and when each highlight ends (ms since epoch). */
  fresh: ReadonlyMap<string, number>;
}

export function newTracker(feed: string): ArrivalTracker {
  return { feed, seen: new Set(), pages: 0, count: 0, fresh: new Map() };
}

/** Drops highlights that have ended by `now`. */
export function expireFresh(fresh: ReadonlyMap<string, number>, now: number): Map<string, number> {
  return new Map([...fresh].filter(([, until]) => until > now));
}

/** When the next highlight ends, or null with none showing. */
export function nextExpiry(fresh: ReadonlyMap<string, number>): number | null {
  let min: number | null = null;
  for (const until of fresh.values()) if (min === null || until < min) min = until;
  return min;
}

/**
 * Feeds one answer of a live list. Any key never seen on any loaded page of
 * this feed is an arrival, wherever the sort puts it (top, middle or end),
 * EXCEPT rows that Load more appended: when `pages` grew, only the rows the
 * refresh covered before (the first `count` of the last answer) can hold
 * arrivals. The first answer of a feed (or of a new filter) has none.
 */
export function observeRows(t: ArrivalTracker, feed: string, keys: readonly string[], pages: number, now: number, highlightMs = HIGHLIGHT_MS): { tracker: ArrivalTracker; arrived: string[] } {
  if (t.feed !== feed || (t.pages === 0 && t.count === 0 && t.seen.size === 0)) {
    return { tracker: { feed, seen: new Set(keys), pages, count: keys.length, fresh: new Map() }, arrived: [] };
  }
  const covered = pages > t.pages ? keys.slice(0, t.count) : keys;
  const arrived = [...new Set(covered.filter((k) => !t.seen.has(k)))];
  const fresh = expireFresh(t.fresh, now);
  for (const k of arrived) fresh.set(k, now + highlightMs);
  const seen = new Set(t.seen);
  for (const k of keys) seen.add(k);
  return { tracker: { feed, seen, pages, count: keys.length, fresh }, arrived };
}

/** How many arrived rows sit above the viewport (`topOf` = a row's top edge, null when not rendered). */
export function arrivalsAbove(arrivedIndexes: readonly number[], topOf: (index: number) => number | null): number {
  return arrivedIndexes.filter((i) => {
    const top = topOf(i);
    return top !== null && top < 0;
  }).length;
}
