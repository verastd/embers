'use client';

/**
 * Upland leaderboard (F-1606): pick a board and a timescope (Today, Last
 * week, Last month); top 3 styled. From the ledger (`POST /analytics/query`):
 * - Treasures claimed: treasure finds per player (source `treasures`);
 * - Total UPX proceeds: what sellers received from property sales (`sales`);
 * - Trades: property purchases plus sales per account (`sales`, both sides).
 * The PRD's Visitors, Completed Collections and Uplanders Referred boards
 * need data the ledger does not have, so they are not offered.
 */
import { Block, Chips, PageHeader, Segment, Skeleton } from '@embers/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { GroupField } from '@/components/users/parts';
import { BoardTable } from '@/components/users/BoardTable';
import type { BoardFigure } from '@/components/users/BoardTable';
import {
  SCOPES,
  SCOPE_LABELS,
  UPLAND_BOARDS,
  UPLAND_BOARD_LABELS,
  mergeTrades,
  proceedsBoardSpec,
  rankRecords,
  resultRecords,
  scopeRange,
  tradeSideSpec,
  treasureBoardSpec,
} from '@/lib/analytics';
import type { BoardRow, Scope, UplandBoard } from '@/lib/analytics';
import { readEnum } from '@/lib/filters';
import { formatInt, formatUpx } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import type { Fetcher } from '@/lib/hooks';
import { queryKey } from '@/lib/query-core';
import { useFilters } from '@/lib/useFilters';

const BOARDS: Record<UplandBoard, { who: 'account' | 'username'; whoLabel: string; figures: BoardFigure[]; note: string; read: (scope: Scope) => Fetcher<BoardRow[]> }> = {
  treasures: {
    who: 'username',
    whoLabel: 'Player',
    figures: [
      { key: 'value', label: 'Treasures claimed', format: formatInt },
      { key: 'extra', label: 'UPX rewards', format: (n) => formatUpx(n) },
    ],
    note: 'Treasure hunt finds from Upland’s public data, refreshed daily at 04:43 UTC.',
    read: (scope) => async (c, signal) => rankRecords(resultRecords(await c.analytics.query(treasureBoardSpec(scopeRange(scope, Date.now())), { signal })), 'user_name', 'claimed', 'reward_upx'),
  },
  proceeds: {
    who: 'account',
    whoLabel: 'Seller',
    figures: [
      { key: 'value', label: 'UPX proceeds', hint: 'Sale price less the 5 % fee the seller pays', format: (n) => formatUpx(n) },
      { key: 'extra', label: 'Properties sold', format: formatInt },
    ],
    note: 'Property sales decoded from the chain every 15 min.',
    read: (scope) => async (c, signal) => rankRecords(resultRecords(await c.analytics.query(proceedsBoardSpec(scopeRange(scope, Date.now())), { signal })), 'seller', 'proceeds_upx', 'sold'),
  },
  trades: {
    who: 'account',
    whoLabel: 'Trader',
    figures: [
      { key: 'value', label: 'Trades', format: formatInt },
      { key: 'extra', label: 'Bought', format: formatInt },
      { key: 'extra2', label: 'Sold', format: formatInt },
    ],
    note: 'Property purchases plus sales on the market, decoded from the chain every 15 min.',
    read: (scope) => async (c, signal) => {
      const range = scopeRange(scope, Date.now());
      // One after the other: both are heavy reads sharing the ledger's one slot.
      const buys = await c.analytics.query(tradeSideSpec(range, 'buyer'), { signal });
      const sells = await c.analytics.query(tradeSideSpec(range, 'seller'), { signal });
      return mergeTrades(buys, sells);
    },
  },
};

export default function UplandLeaderboardPage() {
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <UplandLeaderboard />
    </Suspense>
  );
}

function UplandLeaderboard() {
  const params = useSearchParams() ?? new URLSearchParams();
  const filters = useFilters(['board', 'scope'] as const);
  const board: UplandBoard = readEnum(params, 'board', UPLAND_BOARDS) ?? 'treasures';
  const scope: Scope = readEnum(params, 'scope', SCOPES) ?? 'week';
  const spec = BOARDS[board];
  const query = useLedgerQuery<BoardRow[]>(queryKey('/analytics/query#upland-board', { board, scope }), spec.read(scope), { heavy: true, keepPrevious: true });

  return (
    <>
      <PageHeader title="Upland leaderboard" lede="Top players by treasure finds, sale proceeds and trades." />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <GroupField label="Leaderboard">
          <Segment<UplandBoard> size="dense" label="Leaderboard" value={board} onChange={(v) => filters.applyNow({ board: v === 'treasures' ? '' : v })} options={UPLAND_BOARDS.map((b) => ({ value: b, label: UPLAND_BOARD_LABELS[b] }))} />
        </GroupField>
        <GroupField label="Timescope">
          <Chips<Scope> size="dense" label="Timescope" value={scope} onChange={(v) => filters.applyNow({ scope: v === 'week' ? '' : v })} options={SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s] }))} />
        </GroupField>
      </div>

      <Block id="leaderboard" title={`${UPLAND_BOARD_LABELS[board]} · ${SCOPE_LABELS[scope].toLowerCase()}`} note={`${spec.note} Today is the UTC day so far.`}>
        <BoardTable
          query={query}
          who={spec.who}
          whoLabel={spec.whoLabel}
          figures={spec.figures}
          emptyMessage={`Nobody on the ${UPLAND_BOARD_LABELS[board].toLowerCase()} board ${SCOPE_LABELS[scope].toLowerCase()}`}
          emptyAction={scope !== 'month' ? { label: 'Show last month', onClick: () => filters.applyNow({ scope: 'month' }) } : undefined}
          exportName={`upland leaderboard ${board} ${scope}`}
        />
      </Block>
    </>
  );
}
