'use client';

/**
 * Troubleshoot (F-1909). Checks first, each with checking / pass / fail:
 * Embers reaching the Upland Ledger (GET /bff/ledger/status), cookies, and
 * local storage. Then the reset the PRD asks for: clear local storage,
 * caches and service workers, reporting each step, then a prompt to reload.
 * The reset asks for confirmation first because it forgets favorites,
 * recent searches and the theme.
 */
import { AsyncButton, Block, Button, Card, ConfirmDialog, JobPhaseList, PageHeader, StatusBanner, StatusGlyph } from '@embers/ui';
import type { GlyphStatus, JobStep } from '@embers/ui';
import type { Status } from '@embers/ledger';
import { useCallback, useEffect, useState } from 'react';

import { formatDuration } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import type { QueryResult } from '@/lib/hooks';
import { describeError } from '@/lib/query-core';
import { checkCookies, checkStorage, clearCaches, clearLocalStorage, unregisterServiceWorkers } from '@/lib/troubleshoot';
import type { CheckOutcome, StepResult } from '@/lib/troubleshoot';

interface CheckRow {
  id: string;
  label: string;
  status: GlyphStatus;
  detail: string;
}

function CheckList({ rows }: { rows: CheckRow[] }) {
  return (
    <ul aria-label="Checks" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
      {rows.map((r) => (
        <li key={r.id} data-check={r.id} data-status={r.status} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '2px 10px', alignItems: 'start' }}>
          <StatusGlyph status={r.status} size={18} style={{ marginTop: 2 }} />
          <strong style={{ font: 'var(--type-body)', color: 'var(--text-primary)' }}>
            {r.label}
            <span className="em-sr">: {r.status === 'running' ? 'checking' : r.status === 'done' ? 'passed' : 'failed'}</span>
          </strong>
          <span style={{ gridColumn: 2, font: 'var(--type-body-sm)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}

const fromOutcome = (id: string, label: string, o: CheckOutcome | null): CheckRow =>
  o === null ? { id, label, status: 'running', detail: 'Checking…' } : { id, label, status: o.ok ? 'done' : 'failed', detail: o.detail };

function ledgerRow(q: QueryResult<Status>): CheckRow {
  const label = 'Embers can reach the Upland Ledger';
  if (q.fetching || q.status === 'loading' || q.status === 'idle') return { id: 'ledger', label, status: 'running', detail: 'Checking…' };
  if (q.error) {
    const copy = describeError(q.error);
    return { id: 'ledger', label, status: 'failed', detail: `${copy.title}. ${copy.detail}${q.error.requestId ? ` Request ID ${q.error.requestId}.` : ''}` };
  }
  const s = q.data;
  if (!s) return { id: 'ledger', label, status: 'failed', detail: 'No answer.' };
  if (!s.upstream.connected) return { id: 'ledger', label, status: 'failed', detail: 'The ledger answered, but it has lost its connection to the Upland chain, so new data is delayed.' };
  const lag = s.ingestion.lagSeconds;
  return {
    id: 'ledger',
    label,
    status: 'done',
    detail: `The ledger answered. ${typeof lag === 'number' ? `Its newest chain data is ${formatDuration(lag)} behind the chain.` : ''}`.trim(),
  };
}

const STEP_LABELS = { storage: 'Clear local storage', caches: 'Delete caches', workers: 'Remove service workers' } as const;
type StepId = keyof typeof STEP_LABELS;
const IDLE_STEPS: JobStep[] = (Object.keys(STEP_LABELS) as StepId[]).map((id) => ({ id, label: STEP_LABELS[id], status: 'pending' }));

export default function TroubleshootPage() {
  const ledger = useLedgerQuery<Status>('/status', (c, signal) => c.status(undefined, { signal }));
  const [local, setLocal] = useState<{ cookies: CheckOutcome; storage: CheckOutcome } | null>(null);
  const runLocal = useCallback(() => {
    setLocal({
      cookies: checkCookies(typeof navigator === 'undefined' ? undefined : navigator),
      storage: checkStorage(() => (typeof window === 'undefined' ? undefined : window.localStorage)),
    });
  }, []);
  useEffect(runLocal, [runLocal]);

  const [confirming, setConfirming] = useState(false);
  const [steps, setSteps] = useState<JobStep[] | null>(null);
  const finished = steps !== null && steps.every((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'error');
  const failed = steps?.some((s) => s.status === 'error') ?? false;

  const reset = async (): Promise<void> => {
    let current = IDLE_STEPS.map((s) => ({ ...s }));
    const mark = (id: StepId, r: StepResult | 'active'): void => {
      current = current.map((s) => (s.id !== id ? s : r === 'active' ? { ...s, status: 'active' } : { ...s, status: r.status, detail: r.detail }));
      setSteps(current);
    };
    setConfirming(false);
    mark('storage', 'active');
    mark('storage', clearLocalStorage(() => window.localStorage));
    mark('caches', 'active');
    mark('caches', await clearCaches('caches' in window ? window.caches : undefined));
    mark('workers', 'active');
    mark('workers', await unregisterServiceWorkers('serviceWorker' in navigator ? navigator.serviceWorker : undefined));
  };

  const rows: CheckRow[] = [
    ledgerRow(ledger),
    fromOutcome('cookies', 'Cookies are enabled', local?.cookies ?? null),
    fromOutcome('storage', 'Local storage works', local?.storage ?? null),
  ];

  return (
    <>
      <PageHeader title="Troubleshoot" lede="Check what Embers needs from your browser, and reset what this browser has stored for Embers if pages misbehave." />

      <Block
        id="checks"
        title="Checks"
        note="Run when the page opens."
        aside={
          <AsyncButton
            size="dense"
            variant="secondary"
            icon="refresh-cw"
            label="Run checks again"
            pendingLabel="Checking…"
            successLabel="Checked"
            onAction={async () => {
              runLocal();
              await ledger.refetch();
            }}
          />
        }
      >
        <Card>
          <CheckList rows={rows} />
        </Card>
      </Block>

      <Block id="reset" title="Reset this browser" note="You stay signed in: the sign-in cookie is not touched.">
        <Card>
          <p style={{ margin: 0, font: 'var(--type-body-sm)', color: 'var(--text-secondary)', maxWidth: '72ch' }}>
            Clears Embers&apos; local storage (favorites, recent searches, open sidebar sections, theme), deletes this site&apos;s caches and removes any service worker, then asks you to reload.
          </p>
          <div>
            <Button variant="danger" icon="trash-2" onClick={() => setConfirming(true)} aria-busy={steps !== null && !finished ? 'true' : undefined}>
              Clear local data
            </Button>
          </div>
          {steps && <JobPhaseList steps={steps} />}
          {finished && (
            <StatusBanner kind={failed ? 'partial' : 'info'} actionLabel="Reload page" onAction={() => window.location.reload()}>
              {failed ? 'Some steps failed (see above). Reload the page; if problems continue, clear site data in your browser settings.' : 'Done. Reload the page to start fresh.'}
            </StatusBanner>
          )}
        </Card>
      </Block>

      <ConfirmDialog
        open={confirming}
        title="Clear local data?"
        description="This forgets your favorites, recent searches, open sidebar sections and theme in this browser. It cannot be undone."
        confirmLabel="Clear local data"
        pendingLabel="Clearing…"
        onConfirm={reset}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
