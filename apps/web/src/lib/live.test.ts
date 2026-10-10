import { describe, expect, it } from 'vitest';

import { BACKOFF_MS, INITIAL_LIVE, MAX_ATTEMPTS, arrivedKeys, backoffMs, liveStatus, pollDue, pollFailed, pollSucceeded, retryNow, secondsUntil, setPaused, staleMinutes } from './live';

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

describe('arrivedKeys', () => {
  it('flags nothing on the first load', () => {
    expect(arrivedKeys(new Set(), ['a', 'b'])).toEqual([]);
  });

  it('flags unseen rows above the first seen one', () => {
    expect(arrivedKeys(new Set(['a', 'b']), ['x', 'y', 'a', 'b'])).toEqual(['x', 'y']);
  });

  it('does not flag rows appended below (Load more)', () => {
    expect(arrivedKeys(new Set(['a', 'b']), ['a', 'b', 'c', 'd'])).toEqual([]);
    expect(arrivedKeys(new Set(['a', 'b']), ['x', 'a', 'b', 'c'])).toEqual(['x']);
  });

  it('flags everything unseen when no seen row remains', () => {
    expect(arrivedKeys(new Set(['a']), ['x', 'y'])).toEqual(['x', 'y']);
  });
});
