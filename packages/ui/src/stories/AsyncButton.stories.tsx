import type { Meta, StoryObj } from '@storybook/react-vite';

import { AsyncButton } from '../core/AsyncButton';
import type { AsyncButtonState } from '../core/AsyncButton';
import { State, States, wait } from './_helpers';

const meta: Meta<typeof AsyncButton> = { title: 'Primitives/AsyncButton (PRD 5.2)', component: AsyncButton };
export default meta;

const ALL: AsyncButtonState[] = ['idle', 'pending', 'slow', 'success', 'error', 'disabled', 'locked'];

export const AllStates: StoryObj = {
  render: () => (
    <States>
      {ALL.map((s) => (
        <State key={s} name={s}>
          <AsyncButton
            label="Search"
            pendingLabel="Searching…"
            successLabel="Found 42"
            state={s}
            errorMessage={s === 'error' ? 'Upland returned 502. Nothing was changed.' : undefined}
            disabledReason={s === 'disabled' ? 'Select a neighborhood first' : undefined}
            locked={s === 'locked'}
            lockedTier="Basic"
          />
        </State>
      ))}
    </States>
  ),
};

export const Live: StoryObj = {
  name: 'Live: succeeds after 1 s, fails, slow at 8 s, times out at 20 s',
  render: () => (
    <States>
      <State name="succeeds">
        <AsyncButton label="Save" pendingLabel="Saving…" onAction={() => wait(1000)} />
      </State>
      <State name="fails">
        <AsyncButton label="Deposit" pendingLabel="Depositing…" onAction={() => wait(1000, 'Upland returned 502. Your balance was not changed.')} />
      </State>
      <State name="slow then times out">
        <AsyncButton label="Sync" pendingLabel="Syncing…" onAction={({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Timed out'))))} />
      </State>
    </States>
  ),
};
