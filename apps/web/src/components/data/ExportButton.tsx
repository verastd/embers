'use client';

/**
 * Export the rows on screen as CSV (PRD F-105, 5.8: under 2 s it runs inline
 * in an AsyncButton, which shows pending, then "Exported" or the error).
 */
import { AsyncButton } from '@embers/ui';

import { csvFileName, toCsv } from '@/lib/csv';
import type { CsvCell } from '@/lib/csv';

export interface ExportButtonProps {
  /** File name stem, e.g. "users leaderboard". */
  name: string;
  headers: readonly string[];
  /** Called on click so the export is always the current set. */
  rows: () => ReadonlyArray<readonly CsvCell[]>;
  /** Shown as the disabled reason when there is nothing to export. */
  emptyReason?: string;
  count: number;
}

export function ExportButton({ name, headers, rows, count, emptyReason = 'Nothing to export yet' }: ExportButtonProps) {
  return (
    <AsyncButton
      label="Export CSV"
      pendingLabel="Exporting…"
      successLabel="Exported"
      variant="secondary"
      size="dense"
      icon="download"
      disabledReason={count === 0 ? emptyReason : undefined}
      onAction={async () => {
        const blob = new Blob([toCsv(headers, rows())], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement('a');
          a.href = url;
          a.download = csvFileName(name);
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          // Let the download start before the URL goes away.
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }}
    />
  );
}
