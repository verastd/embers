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

export const INITIAL_LIVE: LiveState = { phase: 'connecting', attempt: 0, nextAt: null, lastOkAt: null, userPaused: false };

export function backoffMs(attempt: number): number {
  const i = Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i] ?? 30_000;
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

/**
 * Keys of rows that arrived since `seen`, counting only rows ABOVE the
 * first row already seen: a feed sorted newest first gets its new events
 * at the top, while "Load more" appends older ones at the bottom, which are
 * not new arrivals. With nothing seen yet (first load), nothing is new.
 */
export function arrivedKeys(seen: ReadonlySet<string>, keys: readonly string[]): string[] {
  if (seen.size === 0) return [];
  const firstSeen = keys.findIndex((k) => seen.has(k));
  const head = firstSeen === -1 ? keys : keys.slice(0, firstSeen);
  return head.filter((k) => !seen.has(k));
}
