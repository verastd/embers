import type { Meta, StoryObj } from '@storybook/react-vite';

import { LiveIndicator } from '../core/LiveIndicator';
import type { LiveStatus } from '../core/LiveIndicator';
import { State, States } from './_helpers';

const meta: Meta<typeof LiveIndicator> = { title: 'Primitives/LiveIndicator (PRD 5.4)', component: LiveIndicator };
export default meta;

const ALL: LiveStatus[] = ['connecting', 'live', 'reconnecting', 'paused', 'offline', 'error'];

export const AllStates: StoryObj = {
  render: () => (
    <States>
      {ALL.map((s) => (
        <State key={s} name={s}>
          <LiveIndicator status={s} updatedAt="14:02:11" attempt={3} nextPollIn={s === 'live' ? 27 : undefined} reason="Upland returned 502" onResume={() => undefined} onRetry={() => undefined} />
        </State>
      ))}
      <State name="live, scrolled down with new rows">
        <LiveIndicator status="live" updatedAt="14:02:11" newCount={4} onJumpToNew={() => undefined} />
      </State>
    </States>
  ),
};
