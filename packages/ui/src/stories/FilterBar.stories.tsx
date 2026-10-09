import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Segment } from '../controls/Segment';
import { FilterBar, FilterField } from '../feedback/FilterBar';
import type { FilterBarState } from '../feedback/FilterBar';
import { TextField } from '../kit/TextField';
import { State, States, wait } from './_helpers';

const meta: Meta<typeof FilterBar> = { title: 'Primitives/FilterBar (PRD 5.7)', component: FilterBar };
export default meta;

function Fields() {
  const [city, setCity] = useState('San Francisco');
  const [fsa, setFsa] = useState('all');
  return (
    <>
      <TextField label="City" value={city} onChange={setCity} />
      <FilterField label="FSA">
        <Segment
          size="dense"
          label="FSA"
          value={fsa}
          onChange={setFsa}
          options={[
            { value: 'all', label: 'All' },
            { value: 'only', label: 'Only FSA' },
            { value: 'non', label: 'Non FSA' },
          ]}
        />
      </FilterField>
    </>
  );
}

const ALL: FilterBarState[] = ['clean', 'dirty', 'applying', 'applied'];

export const AllStates: StoryObj = {
  render: () => (
    <States>
      {ALL.map((s) => (
        <State key={s} name={s}>
          <FilterBar state={s} appliedCount={s === 'applied' ? 2 : 0} onApply={() => wait(1000)} onReset={() => undefined}>
            <Fields />
          </FilterBar>
        </State>
      ))}
    </States>
  ),
};
