/**
 * CSV for table exports (PRD F-105: "exports current filtered set"). RFC
 * 4180 quoting; a cell that a spreadsheet would run as a formula is
 * prefixed with an apostrophe.
 */

export type CsvCell = string | number | boolean | null | undefined;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** A file name safe on every OS: `embers-users-leaderboard-2026-10-10.csv`. */
export function csvFileName(stem: string, now: number = Date.now()): string {
  const day = new Date(now).toISOString().slice(0, 10);
  return `embers-${stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${day}.csv`;
}
