/**
 * A captioned chip set for a FilterBar or a toolbar. FilterField wraps its
 * control in a <label>, which would hand a click on the caption to the
 * first chip; a chip set is a radiogroup that names itself, so the caption
 * here is plain text beside it.
 */
import { Chips } from '@embers/ui';
import type { ChipOption } from '@embers/ui';

export function ChipsField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | undefined;
  onChange: (v: T) => void;
  options: ReadonlyArray<ChipOption<T>>;
}) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span aria-hidden="true" style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <Chips<T> size="dense" label={label} value={value} onChange={onChange} options={options} />
    </div>
  );
}
