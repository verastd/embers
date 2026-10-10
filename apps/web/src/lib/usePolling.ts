'use client';

/**
 * Polling for live pages (PRD 5.4): calls `refresh` every `intervalMs`
 * while the tab is visible, pauses while it is hidden, and reports the
 * seconds to the next poll for LiveIndicator's countdown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Polling {
  /** The tab is hidden: no polls until it is visible again (or Resume). */
  paused: boolean;
  /** Seconds until the next poll. */
  nextPollIn: number;
  /** Poll now and restart the countdown. */
  pollNow: () => void;
}

const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function usePolling(refresh: () => Promise<void>, intervalMs: number): Polling {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const nextRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState(false);

  const pollNow = useCallback(() => {
    nextRef.current = Date.now() + intervalMs;
    setNow(Date.now());
    void refreshRef.current();
  }, [intervalMs]);

  useEffect(() => {
    nextRef.current = Date.now() + intervalMs;
    setHidden(isHidden());
    const onVisibility = (): void => {
      const h = isHidden();
      setHidden(h);
      // Back on the tab after a while: catch up right away.
      if (!h && Date.now() >= nextRef.current) pollNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (isHidden()) return;
      if (t >= nextRef.current) {
        nextRef.current = t + intervalMs;
        void refreshRef.current();
      }
    }, 1000);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, pollNow]);

  return { paused: hidden, nextPollIn: Math.max(0, Math.ceil((nextRef.current - now) / 1000)), pollNow };
}
