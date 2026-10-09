import type { ReactNode } from 'react';

/** A labelled cell per state, so one story shows the whole state machine. */
export function States({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gap: 20 }}>{children}</div>;
}

export function State({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <code style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{name}</code>
      <div>{children}</div>
    </section>
  );
}

/** A promise that settles after `ms`, rejecting with `fail`. */
export const wait = (ms: number, fail?: string): Promise<void> =>
  new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error(fail)) : resolve()), ms));
