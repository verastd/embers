'use client';

/**
 * Every fetched region goes through DataState (PRD 5.3). This maps a ledger
 * query onto it: a layout-matching skeleton while loading, the data dimmed
 * under "Updating" while refreshing, empty with a way out, one-line error
 * with code, request id and Retry, and the stale / capped banners.
 *
 * Public analytics need no sign-in (PRD 4.2), so a 401 here means Embers'
 * own server was refused by the ledger; it is shown as an error, never as a
 * sign-in prompt.
 */
import { DataState } from '@embers/ui';
import type { ReactNode } from 'react';

import type { QueryResult } from '@/lib/hooks';
import { describeError } from '@/lib/query-core';

export interface RegionProps<T> {
  query: QueryResult<T>;
  children: (data: T) => ReactNode;
  /** Layout-matching placeholder (a DataTable in `loading`, a chart frame…). */
  skeleton?: ReactNode;
  emptyMessage: string;
  /** "Reset filters" and similar ways out of an empty result. */
  emptyAction?: { label: string; onClick: () => void };
  notFoundMessage?: string;
  /** Minutes the data is behind its freshness budget (stale banner with Refresh). */
  staleMinutes?: number | null;
  /** The result hit its cap at this many rows (capped banner). */
  cappedCount?: number | null;
}

export function Region<T>({ query, children, skeleton, emptyMessage, emptyAction, notFoundMessage, staleMinutes, cappedCount }: RegionProps<T>) {
  switch (query.view) {
    case 'idle':
    case 'loading':
      return <DataState state="loading" skeleton={skeleton} />;
    case 'not-found':
      return <DataState state="empty" emptyMessage={notFoundMessage ?? 'Not found.'} />;
    case 'unauthenticated':
    case 'error': {
      const copy = query.error ? describeError(query.error) : null;
      return (
        <DataState
          state="error"
          error={{ message: copy ? `${copy.title}. ${copy.detail}` : 'The data service could not answer. Try again.', code: copy?.code }}
          requestId={query.error?.requestId}
          onRetry={copy?.retryable === false ? undefined : query.refetch}
        />
      );
    }
    case 'empty':
      return <DataState state="empty" emptyMessage={emptyMessage} emptyAction={emptyAction?.label} onEmptyAction={emptyAction?.onClick} />;
    case 'refreshing':
    case 'ready': {
      const state = query.view === 'refreshing' ? 'refreshing' : staleMinutes ? 'stale' : cappedCount ? 'capped' : 'ready';
      return (
        <DataState state={state} staleMinutes={staleMinutes ?? undefined} onRefresh={query.refetch} cappedCount={cappedCount ?? undefined}>
          {query.data !== undefined && children(query.data)}
        </DataState>
      );
    }
  }
}
