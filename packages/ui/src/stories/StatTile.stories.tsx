import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatTile } from '../core/StatTile';
import { TileRow } from '../kit/Page';
import { State, States, wait } from './_helpers';

const meta: Meta<typeof StatTile> = { title: 'Primitives/StatTile', component: StatTile };
export default meta;

export const AllStates: StoryObj = {
  render: () => (
    <States>
      <State name="loading">
        <TileRow>
          <StatTile label="Listings, last hour" state="loading" />
        </TileRow>
      </State>
      <State name="ready (with delta, unit, hint, live)">
        <TileRow>
          <StatTile label="UPX per $1" value="5,516.71" delta={-1.2} deltaLabel="since Oct 6" hint="Weighted comparable sales" />
          <StatTile label="Seed price" value={1240} unit="SPK" live="live" />
          <StatTile label="DAU" value={18234} format={{ notation: 'compact', maximumFractionDigits: 1 }} animate />
        </TileRow>
      </State>
      <State name="error (Retry re-reads; one failed tile never blocks others)">
        <TileRow>
          <StatTile label="Treasure next spawn" state="error" onRetry={() => wait(1000)} />
          <StatTile label="Listings, last hour" value={312} />
        </TileRow>
      </State>
    </States>
  ),
};
