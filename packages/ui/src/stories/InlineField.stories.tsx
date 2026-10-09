import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { InlineField } from '../kit/InlineField';
import { State, States, wait } from './_helpers';

const meta: Meta<typeof InlineField> = { title: 'Primitives/InlineField (PRD 5.7)', component: InlineField };
export default meta;

function Field(props: Partial<Parameters<typeof InlineField>[0]> & { initial: string }) {
  const { initial, ...rest } = props;
  const [v, setV] = useState(initial);
  return <InlineField label="Field" {...rest} value={v} onChange={setV} />;
}

export const AllStates: StoryObj = {
  render: () => (
    <States>
      <State name="default">
        <Field initial="" placeholder="e.g. kingbo" />
      </State>
      <State name="invalid (sync)">
        <Field initial="ab" validate={(v) => (v.length < 3 ? 'Minimum 3 characters' : null)} />
      </State>
      <State name="validating → valid (async, type to re-check)">
        <Field
          initial="kingbo"
          validMessage="Account found"
          validateAsync={async (v, signal) => {
            await wait(1200);
            if (signal.aborted) return null;
            return v === 'nobody' ? 'No Upland account with that name' : null;
          }}
        />
      </State>
      <State name="saving → saved (edit, then Enter or blur)">
        <Field initial="Flips" onSave={() => wait(1000)} />
      </State>
      <State name="save error (edit, then Enter)">
        <Field initial="Flips" onSave={() => wait(1000, 'Upland returned 502')} />
      </State>
      <State name="saving (controlled)">
        <Field initial="Flips" status="saving" />
      </State>
      <State name="saved (controlled)">
        <Field initial="Flips" status="saved" message="Saved" />
      </State>
      <State name="save error (controlled)">
        <Field initial="Flips" status="save-error" message="Not saved: Upland returned 502. Press Enter to retry." />
      </State>
      <State name="disabled with reason">
        <Field initial="" disabledReason="Link an Upland account first" />
      </State>
    </States>
  ),
};
