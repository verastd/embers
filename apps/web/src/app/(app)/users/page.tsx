'use client';

/**
 * User search (F-201) over the ledger's account dimension (`/accounts`):
 * a username substring, a sort and a bot filter, each result linking to its
 * profile (F-202). The PRD's avatar, level, networth and property-count
 * columns need data the ledger does not carry, so they are not shown.
 *
 * States (PRD 5.3/5.7): empty-initial until the first Search; the FilterBar
 * runs clean/dirty/applying/applied; results use DataState; Load more
 * appends 50 rows (capped banner at 1,000); the URL reproduces the search.
 */
import { AsyncButton, DataState, DataTable, FilterBar, FilterField, PageHeader, Block, Segment, Select, Skeleton, TextField } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { Account, AccountListParams } from '@embers/ledger';
import { ACCOUNT_SORTS } from '@embers/ledger';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';

import { filterBarState } from '@/components/data/filterbar';
import { Region } from '@/components/data/Region';
import { BotBadge, GroupField, UserLink } from '@/components/users/parts';
import { countApplied, readEnum, readText } from '@/lib/filters';
import { formatDay, formatInt, formatUpx, NONE } from '@/lib/format';
import { useOffsetFeed } from '@/lib/hooks';
import { describeError, queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';
import { displayName } from '@/lib/users';

const KEYS = ['q', 'bots', 'sort', 'order'] as const;
const PAGE = 50;
const CAP = 1_000;
type Sort = (typeof ACCOUNT_SORTS)[number];
type Bots = 'any' | 'humans' | 'bots';

/** The sorts a person searching for users cares about; latency is a bot metric. */
const SORTS: ReadonlyArray<{ value: Sort; label: string }> = [
  { value: 'events', label: 'Chain events' },
  { value: 'buys', label: 'Properties bought' },
  { value: 'sells', label: 'Properties sold' },
  { value: 'upx_spent', label: 'UPX spent' },
  { value: 'upx_received', label: 'UPX received' },
  { value: 'active_days', label: 'Active days' },
  { value: 'last_seen', label: 'Last seen' },
  { value: 'first_seen', label: 'First seen' },
];

const COLUMNS: Column<Account>[] = [
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
  { key: 'account', label: 'EOS account', mono: true, muted: true, render: (a) => a.account },
  { key: 'buys', label: 'Bought', num: true, sortable: true, hint: 'Properties bought on the market', render: (a) => formatInt(a.buys) },
  { key: 'sells', label: 'Sold', num: true, sortable: true, hint: 'Properties sold on the market', render: (a) => formatInt(a.sells) },
  { key: 'upx_spent', label: 'UPX spent', num: true, sortable: true, render: (a) => formatUpx(a.upx_spent, { compact: true }) },
  { key: 'upx_received', label: 'UPX received', num: true, sortable: true, render: (a) => formatUpx(a.upx_received, { compact: true }) },
  { key: 'active_days', label: 'Active days', num: true, sortable: true, render: (a) => formatInt(a.active_days) },
  { key: 'last_seen', label: 'Last seen', muted: true, sortable: true, render: (a) => (a.last_seen ? formatDay(a.last_seen) : NONE) },
];

export default function UsersPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <UserSearch />
    </Suspense>
  );
}

function UserSearch() {
  const params = useSearchParams() ?? new URLSearchParams();
  const searched = params.get('search') === '1';
  const filters = useFilters(KEYS, { search: '1' });

  const bots: Bots = readEnum(params, 'bots', ['humans', 'bots'] as const) ?? 'any';
  const request = useMemo<AccountListParams>(
    () => ({
      username: readText(params, 'q', 120),
      named: true,
      likely_bot: bots === 'humans' ? false : bots === 'bots' ? true : undefined,
      sort: readEnum(params, 'sort', ACCOUNT_SORTS) ?? 'events',
      order: readEnum(params, 'order', ['asc', 'desc'] as const) ?? 'desc',
    }),
    [params, bots],
  );
  const feed = useOffsetFeed<Account>(searched ? queryKey('/accounts', request) : null, (page, c, signal) => c.accounts.list({ ...request, ...page }, { signal }), PAGE);

  const d = filters.draft;
  const applied = countApplied({ q: request.username, bots: bots === 'any' ? undefined : bots }, ['q', 'bots']);
  const capped = feed.items.length >= CAP;

  return (
    <>
      <PageHeader title="User search" lede="Find Upland players by username and open their profile: trading, income, holdings and chain activity." />

      <FilterBar
        state={filterBarState(filters.dirty || !searched, feed.fetching && !feed.loadingMore, applied)}
        appliedCount={applied}
        applyLabel="Search"
        applyPendingLabel="Searching…"
        onApply={async () => {
          filters.apply();
        }}
        onReset={filters.reset}
      >
        <TextField label="Username" placeholder="Part of a username" value={d.q} onChange={(v) => filters.set('q', v)} onEnter={() => filters.apply()} width={220} maxLength={120} icon="search" />
        <GroupField label="Players">
          <Segment<Bots>
            size="dense"
            label="Players"
            value={d.bots === 'humans' || d.bots === 'bots' ? d.bots : 'any'}
            onChange={(v) => filters.set('bots', v === 'any' ? '' : v)}
            options={[
              { value: 'any', label: 'Everyone' },
              { value: 'humans', label: 'People' },
              { value: 'bots', label: 'Likely bots' },
            ]}
          />
        </GroupField>
        <FilterField label="Sort by">
          <Select<Sort> size="dense" width={170} label="Sort by" value={SORTS.find((s) => s.value === d.sort)?.value ?? 'events'} onChange={(v) => filters.set('sort', v)} options={SORTS} />
        </FilterField>
      </FilterBar>

      <Block id="results" title="Results" note="Accounts with a username, from the market layer (rebuilt every 6 h). Bot labels are the ledger's inference from buy timing, not a fact.">
        {!searched ? (
          <DataState state="empty-initial" />
        ) : (
          <Region
            query={feed}
            skeleton={<DataTable<Account> columns={COLUMNS} rows={[]} loading skeletonRows={10} />}
            emptyMessage={request.username ? `No users match “${request.username}”` : 'No users match these filters'}
            emptyAction={applied > 0 ? { label: 'Reset filters', onClick: filters.reset } : undefined}
            cappedCount={capped ? CAP : null}
          >
            {() => (
              <DataTable<Account>
                columns={COLUMNS}
                rows={feed.items}
                rowKey={(a) => a.account}
                sort={{ key: request.sort ?? 'events', dir: request.order ?? 'desc' }}
                onSort={(s) => filters.applyNow({ sort: s.key, order: s.dir })}
                footer={
                  <>
                    <span>{formatInt(feed.items.length)} shown</span>
                    {feed.hasMore && !capped ? (
                      <AsyncButton label={`Load ${PAGE} more`} pendingLabel="Loading…" variant="secondary" size="dense" onAction={() => feed.loadMore()} />
                    ) : (
                      <span>{capped ? `Capped at ${formatInt(CAP)}. Narrow the search.` : 'End of results'}</span>
                    )}
                    {feed.loadMoreError && (
                      <span role="alert" style={{ flexBasis: '100%', color: 'var(--state-error)', font: 'var(--type-body-sm)' }}>
                        {describeError(feed.loadMoreError).title}. The rows above are still current.
                      </span>
                    )}
                  </>
                }
              />
            )}
          </Region>
        )}
      </Block>
    </>
  );
}
