import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InlineField } from '../kit/InlineField';
import { ConfirmDialog } from './ConfirmDialog';
import { JobProgress } from './JobProgress';

afterEach(() => vi.useRealTimers());

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('InlineField (PRD 5.7)', () => {
  it('shows a specific sync error and blocks saving while invalid', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<InlineField label="Days" value="abc" onChange={() => undefined} validate={(v) => (/^\d+$/.test(v) ? null : 'Use whole days')} onSave={onSave} />);
    expect(screen.getByRole('alert').textContent).toBe('Use whole days');
    fireEvent.blur(screen.getByLabelText('Days'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('validates asynchronously after a pause with an in-field spinner, then a check', async () => {
    vi.useFakeTimers();
    let resolve: (v: string | null) => void = () => undefined;
    const validateAsync = vi.fn(() => new Promise<string | null>((r) => (resolve = r)));
    render(<InlineField label="Account" value="kingbo" onChange={() => undefined} validateAsync={validateAsync} validMessage="Account found" />);
    expect(screen.getByText('Checking…')).toBeTruthy();
    expect(validateAsync).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(validateAsync).toHaveBeenCalledWith('kingbo', expect.any(AbortSignal));
    await act(async () => resolve(null));
    expect(screen.getByText('Account found')).toBeTruthy();
  });

  it('reports a failed async check and an async invalid result', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<InlineField label="A" value="x" onChange={() => undefined} validateAsync={async () => Promise.reject(new Error('502'))} />);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flush();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't check: 502");
    rerender(<InlineField label="A" value="y" onChange={() => undefined} validateAsync={async () => 'No such account'} />);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('No such account');
    rerender(<InlineField label="A" value="" onChange={() => undefined} validateAsync={async () => 'never'} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not save a value that has not changed', () => {
    const onSave = vi.fn(async () => undefined);
    render(<InlineField label="Name" value="Flips" onChange={() => undefined} onSave={onSave} />);
    const input = screen.getByLabelText('Name');
    // Unchanged from the initial value: nothing to save.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('commits a changed value and walks saving → saved → idle', async () => {
    vi.useFakeTimers();
    let fail = true;
    const onSave = vi.fn(async () => {
      if (fail) throw new Error('Upland returned 502');
    });
    const { rerender } = render(<InlineField label="Name" value="Flips" onChange={() => undefined} onSave={onSave} />);
    rerender(<InlineField label="Name" value="Flips 2" onChange={() => undefined} onSave={onSave} />);
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });
    expect(screen.getByText('Saving…')).toBeTruthy();
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('Not saved: Upland returned 502');
    fail = false;
    fireEvent.blur(screen.getByLabelText('Name'));
    await flush();
    expect(screen.getByText('Saved')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('Saved')).toBeNull();
    fireEvent.blur(screen.getByLabelText('Name'));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('shows a controlled status and message', () => {
    const { rerender } = render(<InlineField label="C" value="x" onChange={() => undefined} status="saving" />);
    expect(screen.getByText('Saving…')).toBeTruthy();
    rerender(<InlineField label="C" value="x" onChange={() => undefined} status="save-error" message="Not saved: 502" />);
    expect(screen.getByRole('alert').textContent).toBe('Not saved: 502');
    rerender(<InlineField label="C" value="x" onChange={() => undefined} status="saved" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never saves while disabled, and says why on screen', () => {
    const onSave = vi.fn(async () => undefined);
    const { rerender } = render(<InlineField label="N" value="a" onChange={() => undefined} onSave={onSave} disabledReason="Link an Upland account first" />);
    rerender(<InlineField label="N" value="b" onChange={() => undefined} onSave={onSave} disabledReason="Link an Upland account first" />);
    fireEvent.blur(screen.getByLabelText('N'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Link an Upland account first')).toBeTruthy();
  });
});

describe('JobProgress (PRD 5.8)', () => {
  it('shows a measured percent and count when the total is known', () => {
    render(<JobProgress title="Export" status="running" processed={250} total={1000} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('250 of 1,000 rows')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
  });

  it('stays indeterminate with an unknown total and ticks the elapsed clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T00:00:10Z'));
    render(<JobProgress title="Sync" status="running" processed={42} unit="properties" startedAt="2026-10-09T00:00:00Z" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.getAttribute('aria-valuetext')).toBe('42 properties');
    expect(screen.getByText('0:10 elapsed')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('0:15 elapsed')).toBeTruthy();
  });

  it('offers the download when complete, Retry with the reason when failed, Cancel while queued', async () => {
    const onRetry = vi.fn(async () => undefined);
    const onCancel = vi.fn(async () => undefined);
    const { rerender } = render(<JobProgress title="Export" status="complete" processed={10} total={10} downloadHref="/x.csv" downloadLabel="Download CSV" />);
    expect(screen.getByRole('link', { name: 'Download CSV' }).getAttribute('href')).toBe('/x.csv');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    rerender(<JobProgress title="Export" status="failed" processed={3} total={10} error="Upland returned 502. Nothing was exported." onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toBe('Upland returned 502. Nothing was exported.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(onRetry).toHaveBeenCalled();
    rerender(<JobProgress title="Export" status="queued" onCancel={onCancel} phases={[{ id: 'a', label: 'Fetch', status: 'pending' }]} />);
    expect(screen.getByText('Waiting for a worker…')).toBeTruthy();
    expect(screen.getByText('Fetch')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Queued');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(onCancel).toHaveBeenCalled();
    rerender(<JobProgress title="Export" status="cancelled" startedAt="bad" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });
});

describe('ConfirmDialog (PRD 5.8)', () => {
  it('requires the typed text, runs the action, and closes only after it resolves', async () => {
    let resolve: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const onClose = vi.fn();
    render(
      <ConfirmDialog open title="Delete account" description="This deletes your account after 7 days." confirmLabel="Delete" pendingLabel="Deleting…" typedConfirmation="td@example.com" onConfirm={onConfirm} onClose={onClose} />,
    );
    const confirm = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Type td@example.com to confirm'), { target: { value: 'td@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(screen.getByText('Deleting…')).toBeTruthy();
    // Can't be dismissed mid-flight.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open with the error on failure, and resets when closed', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open title="Delete watchlist" description="x" confirmLabel="Delete" pendingLabel="Deleting…" onConfirm={async () => Promise.reject(new Error('Upland returned 502'))} onClose={onClose} danger={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await flush();
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Upland returned 502/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<ConfirmDialog open={false} title="Delete watchlist" description="x" confirmLabel="Delete" pendingLabel="Deleting…" onConfirm={async () => undefined} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
