'use client';

/**
 * The top bar's account control (PRD F-101 avatar menu / Log in), for GitHub
 * sign-in. Signed out: "Sign in with GitHub", which returns to this page.
 * Signed in: avatar + login opening a menu with "Sign out" (a POST form; the
 * button shows its pending state until the browser leaves). Escape and a
 * click outside close the menu; focus returns to the trigger.
 */
import { usePathname } from 'next/navigation';
import { Button, Icon, Spinner } from '@embers/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/** Where "Sign in with GitHub" goes: back to `returnTo` (path + query) afterwards. */
export const signInHref = (returnTo: string): string => `/auth/signin?next=${encodeURIComponent(returnTo)}`;

export interface AccountUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export function AccountControl({ user, signInAvailable }: { user: AccountUser | null; signInAvailable: boolean }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (!user) {
    if (!signInAvailable) {
      return (
        <span title="Sign-in is not configured on this server" style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
          Sign-in unavailable
        </span>
      );
    }
    return (
      <Button
        as="a"
        href={signInHref(pathname)}
        // Filters live in the query string and change without a re-render
        // (history.replaceState), so the return URL is read at click time.
        onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
          e.currentTarget.href = signInHref(window.location.pathname + window.location.search);
        }}
        variant="secondary"
        size="dense"
        icon="log-in"
      >
        Sign in with GitHub
      </Button>
    );
  }

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 6px',
          borderRadius: 'var(--radius-md)',
          font: 'var(--type-label)',
          color: 'var(--text-primary)',
        }}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%', display: 'block' }} />
        ) : (
          <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
            {user.login.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span>{user.login}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            minWidth: 220,
            background: 'var(--surface-popover)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--elevation-3)',
            padding: 6,
            display: 'grid',
            gap: 2,
            zIndex: 'var(--z-popover)' as unknown as number,
          }}
        >
          <div style={{ padding: '6px 8px', display: 'grid', gap: 2 }}>
            <strong style={{ font: 'var(--type-label)' }}>{user.name || user.login}</strong>
            <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Signed in with GitHub as {user.login}</span>
          </div>
          <form action="/auth/signout" method="post" onSubmit={() => setLeaving(true)}>
            <button
              type="submit"
              role="menuitem"
              aria-busy={leaving ? 'true' : undefined}
              disabled={leaving}
              style={{
                all: 'unset',
                boxSizing: 'border-box',
                width: '100%',
                cursor: leaving ? 'progress' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px',
                borderRadius: 'var(--radius-sm)',
                font: 'var(--type-body-sm)',
              }}
            >
              {leaving ? <Spinner size={14} label="" /> : <Icon name="log-out" size={14} />}
              {leaving ? 'Signing out…' : 'Sign out'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
