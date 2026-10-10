'use client';

/**
 * A ranked leaderboard (F-1606) from an analytics read: rank (top 3
 * styled), who, and up to three figures. Boards that rank chain accounts
 * look their usernames up in one more read; if that read fails the board
 * still shows, with a partial banner naming what is missing and a Retry
 * for that part only (PRD 5.3 "partial").
 */
import { DataTable, StatusBanner } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { AnalyticsResult } from '@embers/ledger';
import { useMemo } from 'react';

import { ExportButton } from '@/components/data/ExportButton';
import { Region } from '@/components/data/Region';
import { RankCell, UserLink } from '@/components/users/parts';
import { usernameMap, usernamesSpec } from '@/lib/analytics';
import type { BoardRow } from '@/lib/analytics';
import { useLedgerQuery } from '@/lib/hooks';
import type { QueryResult } from '@/lib/hooks';
import { queryKey } from '@/lib/query-core';

export interface BoardFigure {
  key: 'value' | 'extra' | 'extra2';
  label: string;
  format: (n: number | null) => string;
  hint?: string;
}

export interface BoardTableProps {
  query: QueryResult<BoardRow[]>;
  /** `account`: rows name chain accounts (usernames are looked up); `username`: rows already are usernames. */
  who: 'account' | 'username';
  whoLabel: string;
  figures: BoardFigure[];
  emptyMessage: string;
  emptyAction?: { label: string; onClick: () => void };
  exportName: string;
}

type Shown = BoardRow & { name: string | null };

export function BoardTable({ query, who, whoLabel, figures, emptyMessage, emptyAction, exportName }: BoardTableProps) {
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const accounts = useMemo(() => (who === 'account' ? rows.map((r) => r.who) : []), [rows, who]);
  const names = useLedgerQuery<AnalyticsResult>(
    accounts.length > 0 ? queryKey('/analytics/query#usernames', { accounts: accounts.join(',') }) : null,
    (c, signal) => c.analytics.query(usernamesSpec(accounts), { signal }),
    { heavy: true },
  );
  const map = useMemo(() => (names.data ? usernameMap(names.data) : new Map<string, string>()), [names.data]);
  const shown: Shown[] = rows.map((r) => ({ ...r, name: who === 'username' ? r.who : (map.get(r.who) ?? null) }));
  const namesFailed = who === 'account' && (names.view === 'error' || names.view === 'unauthenticated');

  const columns: Column<Shown>[] = [
    { key: 'rank', label: 'Rank', width: 72, render: (r) => <RankCell rank={r.rank} /> },
    {
      key: 'who',
      label: whoLabel,
      render: (r) => (
        <span style={{ display: 'inline-grid', gap: 2 }}>
          <UserLink to={r.name ?? r.who}>{r.name ?? r.who}</UserLink>
          {who === 'account' && r.name && <span className="em-num" style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{r.who}</span>}
        </span>
      ),
    },
    ...figures.map<Column<Shown>>((f) => ({ key: f.key, label: f.label, num: true, align: 'right', hint: f.hint, render: (r) => f.format(r[f.key]) })),
  ];

  return (
    <Region query={query} skeleton={<DataTable<Shown> columns={columns} rows={[]} loading skeletonRows={10} />} emptyMessage={emptyMessage} emptyAction={emptyAction}>
      {() => (
        <div style={{ display: 'grid', gap: 10 }}>
          {namesFailed && (
            <StatusBanner kind="partial" actionLabel="Retry" onAction={names.refetch}>
              Could not look up usernames. Accounts are shown instead.
            </StatusBanner>
          )}
          <DataTable<Shown>
            columns={columns}
            rows={shown}
            rowKey={(r) => r.who}
            footer={
              <>
                <span>
                  Top {shown.length}
                  {who === 'account' && names.fetching ? ' · looking up usernames…' : ''}
                </span>
                <ExportButton
                  name={exportName}
                  count={shown.length}
                  headers={['Rank', whoLabel, ...(who === 'account' ? ['Account'] : []), ...figures.map((f) => f.label)]}
                  rows={() => shown.map((r) => [r.rank, r.name ?? r.who, ...(who === 'account' ? [r.who] : []), ...figures.map((f) => r[f.key])])}
                />
              </>
            }
          />
        </div>
      )}
    </Region>
  );
}
