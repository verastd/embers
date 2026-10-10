'use client';

/**
 * Users leaderboard (F-1606), top 100 from the ledger's account dimension
 * (`/accounts`). The PRD ranks by holdings (property count, mint and
 * property networth, UP2, Sparklet), which the ledger does not carry; this
 * board ranks by what it does: market trading, UPX flows and activity.
 * People only by default (the ledger's bot inference), switchable.
 *
 * A change applies at once: the table stays, dimmed under "Updating", until
 * the new ranking arrives (PRD 5.3 refreshing). Export writes the 100 rows.
 */
import { Block, DataTable, FilterField, PageHeader, Segment, Select, Skeleton } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { Account, AccountListParams, AccountPage } from '@embers/ledger';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';

import { ExportButton } from '@/components/data/ExportButton';
import { Region } from '@/components/data/Region';
import { BotBadge, GroupField, RankCell, UserLink } from '@/components/users/parts';
import { LEADERBOARD_SIZE } from '@/lib/analytics';
import { readEnum } from '@/lib/filters';
import { formatInt, formatUpx } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import { queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';
import { displayName } from '@/lib/users';

const RANKS = ['buys', 'sells', 'upx_spent', 'upx_received', 'active_days', 'events'] as const;
type Rank = (typeof RANKS)[number];
const RANK_LABELS: Record<Rank, string> = {
  buys: 'Properties bought',
  sells: 'Properties sold',
  upx_spent: 'UPX spent',
  upx_received: 'UPX received',
  active_days: 'Active days',
  events: 'Chain events',
};
type Players = 'people' | 'everyone';

type Ranked = Account & { rank: number };

const COLUMNS: Column<Ranked>[] = [
  { key: 'rank', label: 'Rank', width: 72, render: (a) => <RankCell rank={a.rank} /> },
  {
    key: 'username',
    label: 'Username',
    render: (a) => (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <UserLink to={a.username.trim() || a.account}>{displayName(a)}</UserLink>
        {a.likely_bot && <BotBadge />}
      </span>
    ),
  },
  { key: 'buys', label: 'Bought', num: true, sortable: true, render: (a) => formatInt(a.buys) },
  { key: 'sells', label: 'Sold', num: true, sortable: true, render: (a) => formatInt(a.sells) },
  { key: 'upx_spent', label: 'UPX spent', num: true, sortable: true, render: (a) => formatUpx(a.upx_spent, { compact: true }) },
  { key: 'upx_received', label: 'UPX received', num: true, sortable: true, render: (a) => formatUpx(a.upx_received, { compact: true }) },
  { key: 'upx_net', label: 'Net UPX', num: true, render: (a) => formatUpx(a.upx_net, { compact: true }) },
  { key: 'active_days', label: 'Active days', num: true, sortable: true, render: (a) => formatInt(a.active_days) },
  { key: 'events', label: 'Chain events', num: true, sortable: true, render: (a) => formatInt(a.events) },
];

export default function UsersLeaderboardPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <UsersLeaderboard />
    </Suspense>
  );
}

function UsersLeaderboard() {
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(['by', 'players'] as const);
  const by: Rank = readEnum(params, 'by', RANKS) ?? 'upx_spent';
  const players: Players = readEnum(params, 'players', ['everyone'] as const) ?? 'people';
  const request = useMemo<AccountListParams>(
    () => ({ sort: by, order: 'desc', named: true, likely_bot: players === 'people' ? false : undefined, limit: LEADERBOARD_SIZE }),
    [by, players],
  );
  const query = useLedgerQuery<AccountPage>(queryKey('/accounts#leaderboard', request), (c, signal) => c.accounts.list(request, { signal }), { keepPrevious: true });
  const rows: Ranked[] = useMemo(() => (query.data?.data ?? []).map((a, i) => ({ ...a, rank: i + 1 })), [query.data]);

  return (
    <>
      <PageHeader title="Users leaderboard" lede="The top 100 Upland players by market trading, UPX flows and activity on chain." />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <FilterField label="Rank by">
          <Select<Rank> size="dense" width={180} label="Rank by" value={by} onChange={(v) => filters.applyNow({ by: v })} options={RANKS.map((r) => ({ value: r, label: RANK_LABELS[r] }))} />
        </FilterField>
        <GroupField label="Players">
          <Segment<Players>
            size="dense"
            label="Players"
            value={players}
            onChange={(v) => filters.applyNow({ players: v === 'people' ? '' : v })}
            options={[
              { value: 'people', label: 'People' },
              { value: 'everyone', label: 'Include likely bots' },
            ]}
          />
        </GroupField>
      </div>

      <Block id="leaderboard" title={`Top ${LEADERBOARD_SIZE} by ${RANK_LABELS[by].toLowerCase()}`} note="Accounts with a username. Market layer, rebuilt every 6 h; totals cover the ledger's whole chain history.">
        <Region
          query={query}
          skeleton={<DataTable<Ranked> columns={COLUMNS} rows={[]} loading skeletonRows={10} />}
          emptyMessage="No players to rank yet"
          emptyAction={players === 'people' ? { label: 'Include likely bots', onClick: () => filters.applyNow({ players: 'everyone' }) } : undefined}
        >
          {() => (
            <DataTable<Ranked>
              columns={COLUMNS}
              rows={rows}
              rowKey={(a) => a.account}
              sort={{ key: by, dir: 'desc' }}
              onSort={(s) => {
                if ((RANKS as readonly string[]).includes(s.key)) filters.applyNow({ by: s.key });
              }}
              footer={
                <>
                  <span>Top {rows.length}</span>
                  <ExportButton
                    name={`users leaderboard ${by}`}
                    count={rows.length}
                    headers={['Rank', 'Username', 'Account', 'Bought', 'Sold', 'UPX spent', 'UPX received', 'Net UPX', 'Active days', 'Chain events', 'Likely bot']}
                    rows={() => rows.map((a) => [a.rank, a.username, a.account, a.buys, a.sells, a.upx_spent, a.upx_received, a.upx_net, a.active_days, a.events, a.likely_bot])}
                  />
                </>
              }
            />
          )}
        </Region>
      </Block>
    </>
  );
}
