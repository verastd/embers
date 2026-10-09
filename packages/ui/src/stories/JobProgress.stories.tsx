import type { Meta, StoryObj } from '@storybook/react-vite';

import { JobProgress } from '../feedback/JobProgress';
import { State, States, wait } from './_helpers';

const meta: Meta<typeof JobProgress> = { title: 'Primitives/JobProgress (PRD 5.8)', component: JobProgress };
export default meta;

const started = new Date(Date.now() - 74_000).toISOString();

export const AllStates: StoryObj = {
  render: () => (
    <States>
      <State name="queued">
        <JobProgress title="Export properties" status="queued" onCancel={() => wait(800)} />
      </State>
      <State name="running, known total">
        <JobProgress title="Export properties" status="running" processed={4200} total={10000} startedAt={started} onCancel={() => wait(800)} />
      </State>
      <State name="running, unknown total (indeterminate)">
        <JobProgress
          title="Portfolio sync"
          status="running"
          processed={318}
          unit="properties"
          startedAt={started}
          phases={[
            { id: 'p', label: 'Properties', status: 'done' },
            { id: 'a', label: 'Assets', status: 'active' },
            { id: 's', label: 'Sparklet', status: 'pending' },
          ]}
        />
      </State>
      <State name="complete">
        <JobProgress title="Export properties" status="complete" processed={10000} total={10000} downloadHref="#" downloadLabel="Download xlsx" />
      </State>
      <State name="failed">
        <JobProgress title="Export properties" status="failed" processed={4200} total={10000} error="Upland returned 502. Nothing was exported." onRetry={() => wait(800)} />
      </State>
      <State name="cancelled">
        <JobProgress title="Export properties" status="cancelled" processed={4200} total={10000} />
      </State>
    </States>
  ),
};
