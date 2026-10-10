'use client';

/**
 * The Cloudflare Turnstile human check (PRD NFR-4: Turnstile on public
 * forms). Loads Cloudflare's script once, renders the widget explicitly and
 * reports its token; the server verifies it (server/turnstile.ts).
 *
 * Every state is on screen: loading (spinner), waiting for the visitor,
 * verified, expired (asks again) and failed (reason plus Retry). A token is
 * single-use, so the form calls `reset()` after each send.
 */
import { Button, Icon, Spinner } from '@embers/ui';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const LOAD_TIMEOUT_MS = 15_000;

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    const t = setTimeout(() => reject(new Error('timed out')), LOAD_TIMEOUT_MS);
    s.onload = () => {
      clearTimeout(t);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('script loaded without the widget'));
    };
    s.onerror = () => {
      clearTimeout(t);
      reject(new Error('could not be loaded'));
    };
    document.head.appendChild(s);
  }).catch((e: unknown) => {
    loading = null; // let Retry try again
    throw e;
  });
  return loading;
}

export type TurnstileState = 'loading' | 'waiting' | 'verified' | 'expired' | 'error';

export interface TurnstileHandle {
  reset: () => void;
}

export interface TurnstileFieldProps {
  siteKey: string;
  onToken: (token: string | null) => void;
}

export const TurnstileField = forwardRef<TurnstileHandle, TurnstileFieldProps>(function TurnstileField({ siteKey, onToken }, ref) {
  const box = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const [state, setState] = useState<TurnstileState>('loading');
  const [reason, setReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const tokenCb = useRef(onToken);
  tokenCb.current = onToken;

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setReason(null);
    tokenCb.current(null);
    loadTurnstile()
      .then((api) => {
        if (cancelled || !box.current) return;
        widget.current = api.render(box.current, {
          sitekey: siteKey,
          theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
          callback: (token: string) => {
            setState('verified');
            tokenCb.current(token);
          },
          'expired-callback': () => {
            setState('expired');
            tokenCb.current(null);
          },
          'error-callback': (code: string) => {
            setState('error');
            setReason(`the check failed (${code})`);
            tokenCb.current(null);
          },
        });
        setState('waiting');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState('error');
        setReason(`the check ${e instanceof Error ? e.message : 'could not be loaded'}`);
      });
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, attempt]);

  const reset = useCallback(() => {
    tokenCb.current(null);
    if (widget.current && window.turnstile) {
      window.turnstile.reset(widget.current);
      setState('waiting');
    } else {
      setAttempt((n) => n + 1);
    }
  }, []);
  useImperativeHandle(ref, () => ({ reset }), [reset]);

  const caption = { font: 'var(--type-caption)', display: 'inline-flex', alignItems: 'center', gap: 6 } as const;
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }} aria-busy={state === 'loading' ? true : undefined}>
      <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Human check *</span>
      <div ref={box} style={{ minHeight: state === 'error' ? 0 : 65, maxWidth: '100%', overflow: 'hidden' }} />
      {state === 'loading' && (
        <span style={{ ...caption, color: 'var(--text-muted)' }}>
          <Spinner size={14} label="Loading the human check" /> Loading the human check…
        </span>
      )}
      {state === 'waiting' && <span style={{ ...caption, color: 'var(--text-muted)' }}>Complete the check above to send.</span>}
      {state === 'verified' && (
        <span role="status" style={{ ...caption, color: 'var(--state-success)' }}>
          <Icon name="circle-check" size={14} /> Verified
        </span>
      )}
      {state === 'expired' && (
        <span role="alert" style={{ ...caption, color: 'var(--state-warning)' }}>
          <Icon name="clock" size={14} /> The check expired. Complete it again.
        </span>
      )}
      {state === 'error' && (
        <span role="alert" style={{ ...caption, color: 'var(--state-error)', flexWrap: 'wrap' }}>
          <Icon name="circle-alert" size={14} /> The human check is unavailable: {reason ?? 'unknown error'}.
          <Button size="dense" variant="secondary" icon="refresh-cw" onClick={reset}>
            Retry
          </Button>
        </span>
      )}
    </div>
  );
});
