import type { Meta, StoryObj } from '@storybook/react-vite';

import { DataState } from '../core/DataState';
import type { DataStateState } from '../core/DataState';
import { DataTable } from '../feedback/DataTable';
import type { Column } from '../feedback/DataTable';
import { State, States, wait } from './_helpers';

const meta: Meta<typeof DataState> = { title: 'Primitives/DataState (PRD 5.3)', component: DataState };
export default meta;

interface Row {
  address: string;
  city: string;
  price: number;
}
const COLS: Column<Row>[] = [
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City', muted: true },
  { key: 'price', label: 'Price', num: true, render: (r) => `${r.price.toLocaleString('en-US')} UPX` },
];
const ROWS: Row[] = [
  { address: '2506 SEARSDALE AVE', city: 'Cleveland', price: 29999 },
  { address: '2312 SEARSDALE AVE', city: 'Cleveland', price: 20000 },
  { address: '11439 210TH ST', city: 'Queens', price: 7030 },
];
const table = <DataTable<Row> columns={COLS} rows={ROWS} rowKey={(r) => r.address} />;
const skeleton = <DataTable<Row> columns={COLS} rows={[]} loading skeletonRows={10} />;

const ALL: DataStateState[] = ['loading', 'refreshing', 'loading-more', 'empty', 'empty-initial', 'error', 'partial', 'stale', 'capped', 'ready'];

export const AllStates: StoryObj = {
  render: () => (
    <States>
      {ALL.map((s) => (
        <State key={s} name={s}>
          <DataState
            state={s}
            skeleton={skeleton}
            emptyMessage="No properties match these filters"
            emptyAction="Reset filters"
            onEmptyAction={() => undefined}
            error={{ message: 'Upland returned 502. Nothing is shown rather than stale numbers.', code: '502 ledger_unavailable' }}
            requestId="3aa4bf93-ae58-4fdd-b6e6-c69f086f5053"
            onRetry={() => wait(1200)}
            onReport={() => undefined}
            partialMessage="Could not fetch outgoing offices for residents. Bond data may be incomplete."
            onRetryPartial={() => wait(1200)}
            staleMinutes={42}
            onRefresh={() => wait(1200)}
            cappedCount={500}
          >
            {table}
          </DataState>
        </State>
      ))}
    </States>
  ),
};
