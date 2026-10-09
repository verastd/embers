import type { Meta, StoryObj } from '@storybook/react-vite';

import { Receipt, StepFlow } from '../feedback/StepFlow';
import type { FlowStep } from '../feedback/StepFlow';
import { State, States } from './_helpers';

const meta: Meta<typeof StepFlow> = { title: 'Primitives/StepFlow (PRD 5.5)', component: StepFlow };
export default meta;

const steps = (active: number, status: FlowStep['status']): FlowStep[] =>
  ['Amount', 'Confirm', 'Accept in Upland', 'Receipt'].map((label, i) => ({
    id: label,
    label,
    status: i < active ? 'complete' : i === active ? status : 'pending',
  }));

export const AllStates: StoryObj = {
  render: () => (
    <States>
      <State name="active">
        <StepFlow title="Deposit" steps={steps(0, 'active')}>
          Amount step
        </StepFlow>
      </State>
      <State name="awaiting (acceptance in Upland)">
        <StepFlow title="Deposit" steps={steps(2, 'awaiting')}>
          Open Upland, accept the transaction at the devshop.
        </StepFlow>
      </State>
      <State name="failed">
        <StepFlow title="Deposit" steps={steps(2, 'failed')}>
          Timed out after 10 minutes. Retry or Cancel.
        </StepFlow>
      </State>
      <State name="complete + receipt">
        <StepFlow title="Deposit" steps={steps(4, 'complete')}>
          <Receipt
            rows={[
              { label: 'Amount', value: '10,000 UPX', mono: true },
              { label: 'Upland fee (10%)', value: '1,000 UPX', mono: true },
              { label: 'Credited', value: '9,000 UPX', mono: true, strong: true },
            ]}
            txId="3ff8415d0c2c4e8f9a1b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8dda65d"
            timestamp="Oct 9, 2026 00:12:28 UTC"
          />
        </StepFlow>
      </State>
    </States>
  ),
};
