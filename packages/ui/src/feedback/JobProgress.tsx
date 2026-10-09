/**
 * JobProgress (PRD 5.1, 5.8): a long-running background job (optimizer,
 * portfolio sync, an export over 2 s). Status words are fixed: Queued,
 * Running, Complete, Failed, Cancelled. Shows rows processed of total with
 * a percent bar; with no known total the bar is indeterminate and the count
 * stands alone (never a guessed percent). Optional phases render as a
 * JobPhaseList (only confirmed phases get a check). Complete shows the
 * download link; Failed shows the reason and Retry; a running job can be
 * cancelled (the Cancel button shows its own pending state).
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import { AsyncButton } from '../core/AsyncButton';
import { Button } from '../core/Button';
import { StatusGlyph } from '../core/StatusGlyph';
import { JobPhaseList } from './JobPhaseList';
import type { JobStep } from './JobPhaseList';

export type JobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface JobProgressProps {
  title: string;
  status: JobStatus;
  /** Units done so far (rows, properties…). */
  processed?: number;
  /** Total units, when the job knows it. Undefined keeps the bar indeterminate. */
  total?: number;
  unit?: string;
  /** ISO time the job started; drives the elapsed clock while running. */
  startedAt?: string;
  phases?: JobStep[];
  /** Why it failed, in one line ("Upland returned 502. Nothing was exported."). */
  error?: string;
  downloadHref?: string;
  downloadLabel?: string;
  onCancel?: () => Promise<unknown>;
  onRetry?: () => Promise<unknown>;
  style?: CSSProperties;
}

const WORDS: Record<JobStatus, string> = { queued: 'Queued', running: 'Running', complete: 'Complete', failed: 'Failed', cancelled: 'Cancelled' };
const GLYPH = { queued: 'pending', running: 'running', complete: 'done', failed: 'failed', cancelled: 'cancelled' } as const;

const fmt = (n: number): string => n.toLocaleString('en-US');

function elapsed(fromIso: string | undefined, now: number): string | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return null;
  const s = Math.max(0, Math.floor((now - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function JobProgress({
  title,
  status,
  processed,
  total,
  unit = 'rows',
  startedAt,
  phases,
  error,
  downloadHref,
  downloadLabel = 'Download',
  onCancel,
  onRetry,
  style,
}: JobProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'running' || !startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status, startedAt]);

  const known = total !== undefined && total > 0 && processed !== undefined;
  const pct = known ? Math.min(100, Math.round(((processed ?? 0) / (total ?? 1)) * 100)) : null;
  const indeterminate = status === 'running' && pct === null;
  const fill = status === 'complete' ? 100 : (pct ?? 0);
  const count = processed !== undefined ? `${fmt(processed)}${total !== undefined ? ` of ${fmt(total)}` : ''} ${unit}` : null;
  const clock = status === 'running' ? elapsed(startedAt, now) : null;

  return (
    <div
      role="group"
      aria-label={title}
      style={{
        display: 'grid',
        gap: 10,
        padding: 16,
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-card)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ font: 'var(--type-title)' }}>{title}</strong>
        <StatusGlyph status={GLYPH[status]} label={WORDS[status]} />
        {clock && (
          <span className="em-num" style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
            {clock} elapsed
          </span>
        )}
      </div>

      {status !== 'cancelled' && (
        <div
          role="progressbar"
          aria-label={`${title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate || status === 'queued' ? undefined : fill}
          aria-valuetext={status === 'queued' ? 'Queued' : indeterminate ? (count ?? 'Working') : `${fill}%`}
          style={{ position: 'relative', height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--surface-sunken)', overflow: 'hidden' }}
        >
          {indeterminate ? (
            <div
              className="em-motion"
              style={{ position: 'absolute', top: 0, height: '100%', width: '40%', background: 'var(--accent)', animation: 'em-progress-indeterminate 1.2s var(--ease-in-out) infinite' }}
            />
          ) : (
            <div
              style={{
                width: `${fill}%`,
                height: '100%',
                background: status === 'failed' ? 'var(--state-error)' : 'var(--accent)',
                transition: 'width var(--dur-base) var(--ease-out)',
              }}
            />
          )}
        </div>
      )}

      <div aria-live="polite" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', font: 'var(--type-body-sm)', color: 'var(--text-secondary)' }}>
        {status === 'queued' && <span>Waiting for a worker…</span>}
        {count && <span className="em-num">{count}</span>}
        {pct !== null && status === 'running' && <span className="em-num">{pct}%</span>}
      </div>

      {phases && phases.length > 0 && <JobPhaseList steps={phases} />}

      {status === 'failed' && error && (
        <p role="alert" style={{ margin: 0, font: 'var(--type-body-sm)', color: 'var(--state-error)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'complete' && downloadHref && (
          <Button as="a" href={downloadHref} icon="download" variant="primary" size="dense" download>
            {downloadLabel}
          </Button>
        )}
        {status === 'failed' && onRetry && <AsyncButton label="Retry" pendingLabel="Retrying…" size="dense" onAction={() => onRetry()} />}
        {(status === 'running' || status === 'queued') && onCancel && (
          <AsyncButton label="Cancel" pendingLabel="Cancelling…" variant="secondary" size="dense" onAction={() => onCancel()} />
        )}
      </div>
    </div>
  );
}
