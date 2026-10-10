/** Text-page layout for About, Privacy and Terms: token type, readable measure. */
import type { CSSProperties, ReactNode } from 'react';

export const PROSE: CSSProperties = { margin: 0, font: 'var(--type-body)', color: 'var(--text-secondary)', maxWidth: '72ch', overflowWrap: 'anywhere' };
export const LIST: CSSProperties = { ...PROSE, paddingLeft: 20, display: 'grid', gap: 6 };

export function Prose({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>{children}</div>;
}

export function Updated({ day }: { day: string }) {
  return (
    <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
      Last updated <time dateTime={day}>{day}</time>
    </p>
  );
}
