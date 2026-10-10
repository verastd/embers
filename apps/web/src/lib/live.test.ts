import { describe, expect, it } from 'vitest';

import { BACKOFF_MS, HIGHLIGHT_MS, INITIAL_LIVE, MAX_ATTEMPTS, arrivalsAbove, backoffMs, expireFresh, forFeed, liveStatus, newTracker, nextExpiry, observeRows, pollDue, pollFailed, pollSucceeded, retryNow, secondsUntil, setPaused, staleMinutes } from './live';
import type { ArrivalTracker } from './live';

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);
const MIN = 60_000;

describe('the live poll state machine', () => {
  it('connects, then goes live with the next poll one interval away', () => {
    expect(liveStatus(INITIAL_LIVE, false, false)).toBe('connecting');
    const s = pollSucceeded(INITIAL_LIVE, T0, MIN);
    expect(s).toMatchObject({ phase: 'live', attempt: 0, nextAt: T0 + MIN, lastOkAt: T0 });
    expect(liveStatus(s, false, false)).toBe('live');
    expect(pollDue(s, T0 + MIN - 1, false, false)).toBe(false);
    expect(pollDue(s, T0 + MIN, false, false)).toBe(true);
  });

  it('a failed poll reconnects with backoff and counts attempts, then goes offline', () => {
    let s = pollSucceeded(INITIAL_LIVE, T0, MIN);
    s = pollFailed(s, T0 + MIN);
    expect(s).toMatchObject({ phase: 'reconnecting', attempt: 1, nextAt: T0 + MIN + BACKOFF_MS[0], lastOkAt: T0 });
    expect(liveStatus(s, false, false)).toBe('reconnecting');
    for (let i = 2; i < MAX_ATTEMPTS; i++) s = pollFailed(s, T0);
    expect(s.phase).toBe('reconnecting');
    s = pollFailed(s, T0);
    expect(s).toMatchObject({ phase: 'offline', attempt: MAX_ATTEMPTS, nextAt: null });
    expect(pollDue(s, T0 + 10 * MIN, false, false)).toBe(false);
    // Retry from offline: due right away, still reconnecting until a poll succeeds.
    const r = retryNow(s, T0 + 2 * MIN);
    expect(r).toMatchObject({ phase: 'reconnecting', nextAt: T0 + 2 * MIN });
    expect(pollDue(r, T0 + 2 * MIN, false, false)).toBe(true);
    expect(pollSucceeded(r, T0 + 2 * MIN, MIN)).toMatchObject({ phase: 'live', attempt: 0 });
  });

  it('backs off 5, 10, 20, then 30 s', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000, 30_000]);
    expect(backoffMs(0)).toBe(5_000);
  });

  it('pauses while hidden or paused by the user, and resumes with a poll due now', () => {
    const s = pollSucceeded(INITIAL_LIVE, T0, MIN);
    expect(liveStatus(s, true, false)).toBe('paused');
    expect(pollDue(s, T0 + 2 * MIN, true, false)).toBe(false);
    const p = setPaused(s, true, T0);
    expect(liveStatus(p, false, false)).toBe('paused');
    expect(pollDue(p, T0 + 2 * MIN, false, false)).toBe(false);
    const resumed = setPaused(p, false, T0 + 10_000);
    expect(resumed.userPaused).toBe(false);
    expect(resumed.nextAt).toBe(T0 + 10_000);
    // A hidden tab before the first answer still says connecting.
    expect(liveStatus(INITIAL_LIVE, true, false)).toBe('connecting');
  });

  it('never polls twice at once or before the first answer', () => {
    const s = pollSucceeded(INITIAL_LIVE, T0, MIN);
    expect(pollDue(s, T0 + MIN, false, true)).toBe(false);
    expect(pollDue(INITIAL_LIVE, T0, false, false)).toBe(false);
  });

  it('shows error for a failed first load, but not once data has arrived', () => {
    expect(liveStatus(INITIAL_LIVE, false, true)).toBe('error');
    expect(liveStatus(pollSucceeded(INITIAL_LIVE, T0, MIN), false, true)).toBe('live');
  });

  it('counts down whole seconds and never below zero', () => {
    expect(secondsUntil(null, T0)).toBeUndefined();
    expect(secondsUntil(T0 + 59_001, T0)).toBe(60);
    expect(secondsUntil(T0 - 5_000, T0)).toBe(0);
  });

  it('calls data stale only past its budget, in whole minutes', () => {
    expect(staleMinutes(null, T0, 3 * MIN)).toBeNull();
    expect(staleMinutes(T0, T0 + 3 * MIN, 3 * MIN)).toBeNull();
    expect(staleMinutes(T0, T0 + 3 * MIN + 1, 3 * MIN)).toBe(3);
    expect(staleMinutes(T0, T0 + 30_001, 30_000)).toBe(1);
  });
});

describe('a new feed restarts the poller (review: offline must not stick to a new filter)', () => {
  it('offline, then a filter change, then the new feed goes live again', () => {
    let s = forFeed(INITIAL_LIVE, 'listings?a');
    s = pollSucceeded(s, T0, MIN);
    for (let i = 0; i < MAX_ATTEMPTS; i++) s = pollFailed(s, T0);
    expect(s.phase).toBe('offline');
    expect(pollDue(s, T0 + 10 * MIN, false, false)).toBe(false);

    const next = forFeed(s, 'listings?b');
    expect(next).toMatchObject({ feed: 'listings?b', phase: 'connecting', attempt: 0, lastOkAt: null, nextAt: null });
    expect(liveStatus(next, false, false)).toBe('connecting');
    // The new feed's first answer counts as a successful poll: live, polling again.
    const live = pollSucceeded(next, T0 + MIN, MIN);
    expect(liveStatus(live, false, false)).toBe('live');
    expect(pollDue(live, T0 + 2 * MIN, false, false)).toBe(true);
  });

  it('keeps the same state for the same feed, and carries the user pause over', () => {
    const s = pollSucceeded(forFeed(INITIAL_LIVE, 'a'), T0, MIN);
    expect(forFeed(s, 'a')).toBe(s);
    const paused = setPaused(s, true, T0);
    expect(forFeed(paused, 'b').userPaused).toBe(true);
  });
});

describe('observeRows: arrivals', () => {
  const keysOf = (t: ArrivalTracker) => [...t.fresh.keys()];
  function first(keys: string[], feed = 'f'): ArrivalTracker {
    return observeRows(newTracker(feed), feed, keys, 1, T0).tracker;
  }

  it('flags nothing on the first answer, or on a new filter', () => {
    const r = observeRows(newTracker('f'), 'f', ['a', 'b'], 1, T0);
    expect(r.arrived).toEqual([]);
    const other = observeRows(r.tracker, 'g', ['x', 'y'], 1, T0);
    expect(other.arrived).toEqual([]);
    expect(other.tracker.feed).toBe('g');
  });

  it('flags new rows at the top (newest first)', () => {
    expect(observeRows(first(['a', 'b']), 'f', ['x', 'a', 'b'], 1, T0).arrived).toEqual(['x']);
  });

  it('flags a new row at the END under an ascending sort', () => {
    const t = first(['10', '20', '30']);
    const r = observeRows(t, 'f', ['10', '20', '30', '40'], 1, T0 + 1);
    expect(r.arrived).toEqual(['40']);
    expect(keysOf(r.tracker)).toEqual(['40']);
  });

  it('flags a new row in the MIDDLE (price or markup sort)', () => {
    const r = observeRows(first(['a', 'b', 'c']), 'f', ['a', 'mid', 'b', 'c'], 1, T0);
    expect(r.arrived).toEqual(['mid']);
  });

  it('does not flag rows Load more appended, but does flag arrivals in the refreshed part', () => {
    const t = first(['a', 'b']);
    expect(observeRows(t, 'f', ['a', 'b', 'c', 'd'], 2, T0).arrived).toEqual([]);
    expect(observeRows(t, 'f', ['x', 'a', 'c', 'd'], 2, T0).arrived).toEqual(['x']);
  });

  it('never re-flags a key seen on any loaded page', () => {
    let t = first(['a', 'b']);
    t = observeRows(t, 'f', ['a', 'b', 'c'], 2, T0).tracker; // Load more brought c
    expect(observeRows(t, 'f', ['c', 'a', 'b'], 2, T0).arrived).toEqual([]);
  });
});

describe('the 2 s highlight (review: it must clear even across rerenders)', () => {
  it('ends 2 s after arrival; re-observing the same answer neither extends nor drops it', () => {
    const t0 = first2(['a', 'b']);
    const arrived = observeRows(t0, 'f', ['x', 'a', 'b'], 1, T0);
    expect(nextExpiry(arrived.tracker.fresh)).toBe(T0 + HIGHLIGHT_MS);
    // A rerender re-observing the same rows 500 ms later: no new arrival, same end time.
    const again = observeRows(arrived.tracker, 'f', ['x', 'a', 'b'], 1, T0 + 500);
    expect(again.arrived).toEqual([]);
    expect(nextExpiry(again.tracker.fresh)).toBe(T0 + HIGHLIGHT_MS);
    expect(expireFresh(again.tracker.fresh, T0 + HIGHLIGHT_MS - 1).has('x')).toBe(true);
    expect(expireFresh(again.tracker.fresh, T0 + HIGHLIGHT_MS).size).toBe(0);
    expect(nextExpiry(new Map())).toBeNull();
  });

  it('keeps separate end times per arrival batch', () => {
    let t = first2(['a']);
    t = observeRows(t, 'f', ['x', 'a'], 1, T0).tracker;
    t = observeRows(t, 'f', ['y', 'x', 'a'], 1, T0 + 1500).tracker;
    expect(nextExpiry(t.fresh)).toBe(T0 + HIGHLIGHT_MS);
    const later = expireFresh(t.fresh, T0 + HIGHLIGHT_MS);
    expect([...later.keys()]).toEqual(['y']);
    expect(nextExpiry(later)).toBe(T0 + 1500 + HIGHLIGHT_MS);
  });

  function first2(keys: string[]): ArrivalTracker {
    return observeRows(newTracker('f'), 'f', keys, 1, T0 - 10_000).tracker;
  }
});

describe('arrivalsAbove ("N new" only for rows above the viewport)', () => {
  it('counts only rendered rows whose top is above 0', () => {
    const tops = [-300, -10, 0, 250];
    expect(arrivalsAbove([0, 1, 2, 3], (i) => tops[i] ?? null)).toBe(2);
    expect(arrivalsAbove([3], (i) => tops[i] ?? null)).toBe(0);
    expect(arrivalsAbove([9], () => null)).toBe(0);
  });
});
