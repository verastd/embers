import { expect as baseExpect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

/** Chrome DevTools' "Slow 3G" preset (PRD 5.9). */
export async function slow3g(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
}

/** A 500 with a request id, as the BFF would pass a ledger failure through. */
export function fail500(requestId: string) {
  return (route: Route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: { 'x-request-id': requestId },
      body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }),
    });
}

export function json(body: unknown) {
  return (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

export const emptyPage = { data: [], count: 0, limit: 100, offset: 0, has_more: false };
export const emptyCursor = { data: [], next_cursor: null, count: 0 };

/** An analytics result with no rows, shaped like the ledger's. */
export function emptyResult(columns: string[]) {
  return {
    columns: columns.map((name) => ({ name, type: 'string' })),
    rows: [],
    stats: { rows: 0, elapsed_ms: 1, rows_read: 0, bytes_read: 0, truncated: false, table: 'events', dedup: 'exact' },
    sql: '',
    chain: 'upland',
  };
}

/** The error state: reason with status and code, the request id, and a Retry that reads again. */
export async function expectErrorWithRetry(page: Page, scope: ReturnType<Page['locator']> | Page, requestId: string, calls: () => number): Promise<void> {
  const alert = scope.getByRole('alert').filter({ hasText: requestId }).first();
  await expect(alert).toContainText('500 internal_error');
  await expect(alert).toContainText(`request ${requestId}`);
  const before = calls();
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(calls).toBeGreaterThan(before);
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
