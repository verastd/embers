'use client';

/**
 * User profile (F-202). The `[username]` segment is resolved to a chain
 * account (lib/users.ts: current username, then a previous one, then the
 * segment as an account name) and the profile reads `/accounts/{account}`.
 *
 * Header: username, EOS account (copy), earlier usernames, first and last
 * seen on chain, the ledger's bot inference. Tiles: trading totals and
 * yield / visit income. Tabs, each lazy with its own DataState and kept in
 * the query cache for 5 min (PRD AC):
 * - Properties: what the chain shows the account holding (`/properties?owner=`);
 * - Transactions: its property purchases and sales (`/sales?buyer=|seller=`);
 *   the PRD gates this tab Premium, the private beta does not gate;
 * - Activity: its raw chain actions (`/accounts/{account}/actions`);
 * - Market: its open listings (`/properties?owner=&listed=true`).
 *
 * An unknown user renders a not-found state with a way back to search.
 */
import { AsyncButton, Block, DataState, DataTable, FactList, PageHeader, Segment, Skeleton, StatTile, StatusBanner, TileRow } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { AccountActionPage, AccountDetail, AccountPage, Action, Property, PropertyListParams, Sale, SaleParams } from '@embers/ledger';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import type { ReactNode } from 'react';

import { Region } from '@/components/data/Region';
import { BotBadge, UserLink } from '@/components/users/parts';
import { hrefWith, readEnum } from '@/lib/filters';
import { formatDay, formatInstant, formatInt, formatMultiple, formatUpx, formatUsd, NONE, shortHash } from '@/lib/format';
import { useCursorFeed, useLedgerQuery, useOffsetFeed } from '@/lib/hooks';
import type { OffsetFeedResult, QueryResult } from '@/lib/hooks';
import { describeError, queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';
import { USER_ROUTES, displayName, previousUsernames, readUserParam, resolveUser } from '@/lib/users';

const TABS = ['properties', 'transactions', 'activity', 'market'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { properties: 'Properties', transactions: 'Transactions', activity: 'Activity', market: 'Market' };
const SIDES = ['bought', 'sold'] as const;
type Side = (typeof SIDES)[number];
const ROLES = ['actor', 'receiver', 'notified'] as const;
type Role = (typeof ROLES)[number];
const PAGE = 50;

export default function UserProfilePage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <Profile />
    </Suspense>
  );
}

function Profile() {
  const params = useParams<{ username: string }>();
  const name = readUserParam(params?.username);
  const lookup = useLedgerQuery<AccountPage>(name ? queryKey('/accounts', { username: name, limit: 100 }) : null, (c, signal) =>
    c.accounts.list({ username: name ?? '', named: true, sort: 'events', order: 'desc', limit: 100 }, { signal }),
  );
  const resolution = name && lookup.data ? resolveUser(name, lookup.data.data) : null;
  const account = resolution?.kind === 'account' ? resolution.account : null;
  const detail = useLedgerQuery<AccountDetail>(account ? queryKey(`/accounts/${account}`) : null, (c, signal) => c.accounts.get(account ?? '', undefined, { signal }));

  if (name === null || resolution?.kind === 'none' || detail.view === 'not-found') return <UserNotFound name={name ?? ''} />;

  // Until the name resolves, the lookup is what the page is waiting on (or failed on).
  const head: QueryResult<unknown> = account === null ? lookup : detail;
  const d = detail.data;
  const title = d ? displayName(d) : name;

  return (
    <>
      <PageHeader eyebrow="User" title={title} lede={d ? <ProfileLede d={d} /> : 'Upland player profile from the chain ledger.'} aside={d && <CopyAccount account={d.account} />} />

      <Block id="profile" title="Profile" note="Market layer, rebuilt every 6 h. Income comes from yield and visit payouts on chain.">
        <Region query={head} skeleton={<Skeleton height={96} />} emptyMessage="This account has no profile data yet">
          {() => (d ? <ProfileFacts d={d} /> : null)}
        </Region>
        <TileRow min={170}>
          <Tile q={head} label="UPX spent" value={d && formatUpx(d.upx_spent)} />
          <Tile q={head} label="UPX received" value={d && formatUpx(d.upx_received)} />
          <Tile q={head} label="Net UPX" value={d && formatUpx(d.upx_net)} hint="Received minus spent on property trades" />
          <Tile q={head} label="Properties bought" value={d && formatInt(d.buys)} />
          <Tile q={head} label="Properties sold" value={d && formatInt(d.sells)} />
          <Tile q={head} label="Yield income" value={d && formatUpx(d.income.yield_upx)} />
          <Tile q={head} label="Yield claims" value={d && formatInt(d.income.yield_collections)} />
          <Tile q={head} label="Visit income" value={d && formatUpx(d.income.visit_upx)} />
        </TileRow>
      </Block>

      {account !== null && d !== undefined ? <ProfileTabs account={d.account} name={displayName(d)} /> : <Skeleton height={320} />}
    </>
  );
}

function Tile({ q, label, value, hint }: { q: QueryResult<unknown>; label: string; value: string | undefined; hint?: string }) {
  const state = q.view === 'error' || q.view === 'unauthenticated' ? 'error' : value === undefined ? 'loading' : 'ready';
  return <StatTile label={label} value={value} state={state} hint={hint} onRetry={q.refetch} />;
}

function ProfileLede({ d }: { d: AccountDetail }) {
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="em-num">{d.account}</span>
      {d.likely_bot && <BotBadge />}
    </span>
  );
}

function ProfileFacts({ d }: { d: AccountDetail }) {
  const earlier = previousUsernames(d);
  const items: Array<{ term: ReactNode; value: ReactNode; mono?: boolean }> = [
    { term: 'EOS account', value: d.account, mono: true },
    { term: 'First seen on chain', value: formatDay(d.first_seen) },
    { term: 'Last seen', value: formatInstant(d.last_seen) },
    { term: 'Active days', value: formatInt(d.active_days), mono: true },
    { term: 'Chain events', value: formatInt(d.events), mono: true },
  ];
  if (earlier.length > 0) items.splice(1, 0, { term: 'Earlier usernames', value: earlier.join(', ') });
  if (d.likely_bot) {
    items.push({ term: 'Bot inference', value: `Likely automated: ${formatInt(d.sub_5s_buys)} buys under 5 s, median buy latency ${formatInt(d.median_buy_latency_s)} s` });
  }
  return <FactList items={items} />;
}

function CopyAccount({ account }: { account: string }) {
  return (
    <AsyncButton
      label="Copy account"
      pendingLabel="Copying…"
      successLabel="Copied"
      variant="secondary"
      size="dense"
      icon="copy"
      onAction={async () => {
        if (!navigator.clipboard) throw new Error('This browser does not allow copying here');
        await navigator.clipboard.writeText(account);
      }}
    />
  );
}

function UserNotFound({ name }: { name: string }) {
  const router = useRouter();
  return (
    <>
      <PageHeader eyebrow="User" title="User not found" />
      <DataState
        state="empty"
        emptyMessage={name ? `No Upland user named “${name}” is in the ledger.` : 'That is not a username or EOS account.'}
        emptyAction="Search users"
        onEmptyAction={() => router.push(hrefWith(USER_ROUTES.search, { search: true, q: name || undefined }))}
      />
    </>
  );
}

/* --- tabs ------------------------------------------------------------------------ */

function ProfileTabs({ account, name }: { account: string; name: string }) {
  const params = useSearchParams() ?? new URLSearchParams();
  const view = useFilters(['tab', 'side', 'role'] as const);
  const tab: Tab = readEnum(params, 'tab', TABS) ?? 'properties';
  const side: Side = readEnum(params, 'side', SIDES) ?? 'bought';
  const role: Role = readEnum(params, 'role', ROLES) ?? 'actor';

  return (
    <Block id="sections" title={TAB_LABELS[tab]}>
      <Segment<Tab> label="Profile section" value={tab} onChange={(v) => view.applyNow({ tab: v === 'properties' ? '' : v })} options={TABS.map((t) => ({ value: t, label: TAB_LABELS[t] }))} />
      {tab === 'properties' && <Holdings account={account} name={name} listed={false} />}
      {tab === 'market' && <Holdings account={account} name={name} listed />}
      {tab === 'transactions' && <Transactions account={account} name={name} side={side} onSide={(v) => view.applyNow({ side: v === 'bought' ? '' : v })} />}
      {tab === 'activity' && <Activity account={account} name={name} role={role} onRole={(v) => view.applyNow({ role: v === 'actor' ? '' : v })} />}
    </Block>
  );
}

/* Properties and Market: the account's holdings (0013 owner/listing fields). */

const HOLDING_COLUMNS: Column<Property>[] = [
  { key: 'address', label: 'Address', render: (p) => p.address || `#${p.property_id}` },
  { key: 'city', label: 'City', muted: true, render: (p) => p.city || NONE },
  { key: 'neighborhood', label: 'Neighborhood', muted: true, render: (p) => p.neighborhood || NONE },
  { key: 'mint_price_upx', label: 'Mint price', num: true, render: (p) => (p.mint_price_upx > 0 ? formatUpx(p.mint_price_upx) : NONE) },
  { key: 'last_sale_upx', label: 'Last price', num: true, render: (p) => (p.last_sale_upx > 0 ? formatUpx(p.last_sale_upx) : NONE) },
  { key: 'owner_since', label: 'Owned since', muted: true, render: (p) => formatDay(p.owner_since) },
];

function askLabel(p: Property): string {
  if (p.ask_currency === 'upx') return formatUpx(p.ask_upx);
  if (p.ask_currency === 'fiat') return formatUsd(p.ask_fiat);
  return NONE;
}

const LISTING_COLUMNS: Column<Property>[] = [
  { key: 'address', label: 'Address', render: (p) => p.address || `#${p.property_id}` },
  { key: 'city', label: 'City', muted: true, render: (p) => p.city || NONE },
  { key: 'ask', label: 'Ask', num: true, render: askLabel },
  { key: 'ask_to_mint', label: 'Markup', num: true, hint: 'UPX ask over the mint price', render: (p) => formatMultiple(p.ask_to_mint) },
  { key: 'mint_price_upx', label: 'Mint price', num: true, render: (p) => (p.mint_price_upx > 0 ? formatUpx(p.mint_price_upx) : NONE) },
  { key: 'listed_at', label: 'Listed', muted: true, render: (p) => formatInstant(p.listed_at) },
];

function Holdings({ account, name, listed }: { account: string; name: string; listed: boolean }) {
  const request = useMemo<PropertyListParams>(
    () => (listed ? { owner: account, listed: true, sort: 'listed_at', order: 'desc' } : { owner: account, sort: 'mint_price_upx', order: 'desc' }),
    [account, listed],
  );
  const feed = useOffsetFeed<Property>(queryKey('/properties', request), (page, c, signal) => c.properties.list({ ...request, ...page }, { signal }), PAGE);
  const columns = listed ? LISTING_COLUMNS : HOLDING_COLUMNS;
  // A ledger without migration 0013 ignores `owner`: its rows are not this user's.
  const unsupported = feed.items.length > 0 && feed.items[0]?.listed === undefined;
  if (unsupported) {
    return (
      <StatusBanner kind="partial" actionLabel="Check again" onAction={feed.refetch}>
        The ledger has not been updated to look up properties by owner yet, so {name}’s {listed ? 'listings' : 'properties'} cannot be shown.
      </StatusBanner>
    );
  }
  return (
    <>
      <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
        {listed ? 'Open listings on properties the chain shows this account holding.' : 'Properties the chain last saw this account acquire. Swaps are not visible.'}
      </p>
      <FeedTable
        feed={feed}
        columns={columns}
        rowKey={(p) => p.property_id}
        emptyMessage={listed ? `${name} has no open listings` : `The chain shows no properties held by ${name}`}
      />
    </>
  );
}

/* Transactions: property purchases and sales. */

const saleColumns = (side: Side): Column<Sale>[] => [
  { key: 'timestamp', label: 'Time (UTC)', muted: true, render: (s) => formatInstant(s.timestamp) },
  { key: 'address', label: 'Property', render: (s) => [s.address || `#${s.property_id}`, s.city].filter(Boolean).join(', ') },
  { key: 'price_upx', label: 'Price', num: true, render: (s) => formatUpx(s.price_upx) },
  { key: 'price_to_mint', label: 'Price / mint', num: true, render: (s) => formatMultiple(s.price_to_mint) },
  {
    key: 'counterparty',
    label: side === 'bought' ? 'Seller' : 'Buyer',
    render: (s) => {
      const other = side === 'bought' ? s.seller : s.buyer;
      return other ? <UserLink to={other} /> : NONE;
    },
  },
  { key: 'trx_id', label: 'Transaction', mono: true, muted: true, render: (s) => shortHash(s.trx_id) },
];

function Transactions({ account, name, side, onSide }: { account: string; name: string; side: Side; onSide: (s: Side) => void }) {
  const request = useMemo<SaleParams>(() => ({ ...(side === 'bought' ? { buyer: account } : { seller: account }), sort: 'timestamp', order: 'desc' }), [account, side]);
  const feed = useOffsetFeed<Sale>(queryKey('/sales', request), (page, c, signal) => c.sales.list({ ...request, ...page }, { signal }), PAGE);
  return (
    <>
      <Segment<Side>
        size="dense"
        label="Direction"
        value={side}
        onChange={onSide}
        options={[
          { value: 'bought', label: 'Bought' },
          { value: 'sold', label: 'Sold' },
        ]}
      />
      <FeedTable feed={feed} columns={saleColumns(side)} rowKey={(s) => `${s.trx_id}:${s.property_id}`} emptyMessage={`${name} has no property ${side === 'bought' ? 'purchases' : 'sales'} on record`} />
    </>
  );
}

/* Activity: raw chain actions (F-203 scoped to the user). */

function actionDetail(a: Action): string {
  const memo = a.data.memo;
  if (typeof memo === 'string' && memo.trim() !== '') return memo;
  const json = JSON.stringify(a.data);
  return json === '{}' ? NONE : json.length > 140 ? `${json.slice(0, 139)}…` : json;
}

const ACTION_COLUMNS: Column<Action>[] = [
  { key: 'timestamp', label: 'Time (UTC)', muted: true, render: (a) => formatInstant(a.timestamp) },
  { key: 'action', label: 'Action', render: (a) => `${a.contract} · ${a.action}` },
  {
    key: 'details',
    label: 'Details',
    render: (a) => {
      const text = actionDetail(a);
      return (
        <span title={text} style={{ display: 'inline-block', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom', color: 'var(--text-secondary)' }}>
          {text}
        </span>
      );
    },
  },
  { key: 'trx_id', label: 'Transaction', mono: true, muted: true, render: (a) => shortHash(a.trx_id) },
  { key: 'block_num', label: 'Block', num: true, muted: true, render: (a) => formatInt(a.block_num) },
];

const ROLE_LABELS: Record<Role, string> = { actor: 'Signed', receiver: 'Received', notified: 'Notified' };

function Activity({ account, name, role, onRole }: { account: string; name: string; role: Role; onRole: (r: Role) => void }) {
  const feed = useCursorFeed<Action>(queryKey(`/accounts/${account}/actions`, { role }), async (cursor, c, signal) => {
    const page: AccountActionPage = await c.accounts.actions(account, { role, cursor, limit: PAGE }, { signal });
    return { data: page.data, next_cursor: page.next_cursor };
  });
  return (
    <>
      <Segment<Role> size="dense" label="Involvement" value={role} onChange={onRole} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
      <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
        Every chain action {role === 'actor' ? 'this account signed' : role === 'receiver' ? 'this account received' : 'that notified this account'}, newest first, live from the chain. Actions show their raw contract and name.
      </p>
      <Region
        query={feed}
        skeleton={<DataTable<Action> columns={ACTION_COLUMNS} rows={[]} loading skeletonRows={10} />}
        emptyMessage={`No ${ROLE_LABELS[role].toLowerCase()} actions for ${name}`}
        emptyAction={role !== 'actor' ? { label: 'Show signed actions', onClick: () => onRole('actor') } : undefined}
      >
        {() => (
          <DataTable<Action>
            columns={ACTION_COLUMNS}
            rows={feed.items}
            rowKey={(a) => String(a.global_sequence)}
            footer={<MoreFooter count={feed.items.length} hasMore={feed.hasMore} loadMore={feed.loadMore} error={feed.loadMoreError} />}
          />
        )}
      </Region>
    </>
  );
}

/* --- shared table plumbing ------------------------------------------------------- */

function FeedTable<T extends object>({ feed, columns, rowKey, emptyMessage }: { feed: OffsetFeedResult<T>; columns: Column<T>[]; rowKey: (row: T) => string; emptyMessage: string }) {
  return (
    <Region query={feed} skeleton={<DataTable<T> columns={columns} rows={[]} loading skeletonRows={10} />} emptyMessage={emptyMessage}>
      {() => (
        <DataTable<T>
          columns={columns}
          rows={feed.items}
          rowKey={rowKey}
          footer={<MoreFooter count={feed.items.length} hasMore={feed.hasMore} loadMore={feed.loadMore} error={feed.loadMoreError} />}
        />
      )}
    </Region>
  );
}

function MoreFooter({ count, hasMore, loadMore, error }: { count: number; hasMore: boolean; loadMore: () => Promise<void>; error: Parameters<typeof describeError>[0] | undefined }) {
  return (
    <>
      <span>{formatInt(count)} shown</span>
      {hasMore ? <AsyncButton label={`Load ${PAGE} more`} pendingLabel="Loading…" variant="secondary" size="dense" onAction={loadMore} /> : <span>End of results</span>}
      {error && (
        <span role="alert" style={{ flexBasis: '100%', color: 'var(--state-error)', font: 'var(--type-body-sm)' }}>
          {describeError(error).title}. The rows above are still current.
        </span>
      )}
    </>
  );
}
