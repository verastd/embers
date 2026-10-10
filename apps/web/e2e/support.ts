import type { Page, Route } from '@playwright/test';

/** Chrome DevTools' "Slow 3G" preset on this page. */
export async function slow3g(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
}

/** Answer a ledger route with a 500 carrying a request id; returns a counter of calls. */
export async function fail500(page: Page, pattern: string, requestId: string): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route(pattern, (route: Route) => {
    calls += 1;
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: { 'x-request-id': requestId },
      body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }),
    });
  });
  return { calls: () => calls };
}

export function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** An empty `POST /analytics/query` answer. */
export const EMPTY_QUERY = {
  columns: [],
  rows: [],
  stats: { rows: 0, elapsed_ms: 1, rows_read: 0, bytes_read: 0, truncated: false, table: 'properties', dedup: 'exact' },
  sql: '',
  chain: 'upland',
};

/** No horizontal page scroll (phone layout rule). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
