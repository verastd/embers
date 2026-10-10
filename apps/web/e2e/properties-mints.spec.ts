import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

/**
 * F-405 Live minting, PRD 5.4 + 5.9: KPIs, top minters and the latest
 * mints from the stub ledger's analytics answers (e2e/fixtures), the
 * LiveIndicator, a loading indicator within 100 ms under Slow 3G, the error
 * state for a 500, the empty state, a failed address lookup as a partial
 * banner, and a failed poll moving the indicator to reconnecting.
 */

const FIRST = { timeout: 60_000 };
// A cold dev server compiles each route on first visit, several at once under fullyParallel.
test.describe.configure({ timeout: 120_000 });

async function slow3g(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
}

const latest = (page: Page) => page.getByRole('region', { name: 'Latest 50 mints' });
const minters = (page: Page) => page.getByRole('region', { name: 'Top 10 minters' });

/** The analytics spec a request carries. */
function specOf(route: Route): { source?: string; dimensions?: Array<{ field?: string }> } {
  return (route.request().postDataJSON() ?? {}) as { source?: string; dimensions?: Array<{ field?: string }> };
}
const isLatest = (route: Route): boolean => specOf(route).dimensions?.[0]?.field === 'timestamp';

test('shows the 24 h KPIs, the top minters and the latest mints, and goes live', async ({ page }) => {
  await page.goto('/properties/mints');
  await expect(latest(page).getByText('2506 SEARSDALE AVE')).toBeVisible(FIRST);
  await expect(latest(page).getByText('kingbo')).toBeVisible();
  await expect(latest(page).getByText('10,450 UPX')).toBeVisible();
  await expect(latest(page).getByText('FSA').first()).toBeVisible();
  await expect(minters(page).getByText('sirness4')).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Last 24 hours' });
  await expect(kpis.getByText('16', { exact: true })).toBeVisible();
  await expect(kpis.getByText('11', { exact: true })).toBeVisible();
  await expect(kpis.getByText('Las Vegas, NV')).toBeVisible();
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
});

test('Slow 3G: a loading indicator appears within 100 ms of Retry', async ({ page }) => {
  let fail = true;
  await page.route('**/bff/ledger/analytics/query', (route) =>
    fail && isLatest(route) ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }) }) : route.fallback(),
  );
  await page.goto('/properties/mints');
  const retry = latest(page).getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible(FIRST);
  fail = false;
  await slow3g(page);
  await retry.click();
  await expect(latest(page).locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(latest(page).getByText('2506 SEARSDALE AVE')).toBeVisible({ timeout: 30_000 });
});

test('a 500 renders the error state with code, request id and Retry, and the indicator shows the error', async ({ page }) => {
  await page.route('**/bff/ledger/analytics/query', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', headers: { 'x-request-id': 'req-e2e-mints' }, body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }) }),
  );
  await page.goto('/properties/mints');
  const alert = latest(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error', FIRST);
  await expect(alert).toContainText('request req-e2e-mints');
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Failed to load').first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'The ledger could not answer' })).toBeVisible();
});

test('no mints renders the empty states with a way out', async ({ page }) => {
  await page.route('**/bff/ledger/analytics/query', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { rows: unknown[] };
    return route.fulfill({ response: res, json: { ...body, rows: [] } });
  });
  await page.goto('/properties/mints');
  await expect(latest(page).getByText('No mints in the last 7 days')).toBeVisible(FIRST);
  await expect(latest(page).getByRole('button', { name: 'Check again' })).toBeVisible();
  await expect(minters(page).getByText('No mints in the last 24 hours')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Last 24 hours' }).getByText('No mints').first()).toBeVisible();
});

test('a failed address lookup keeps the mints, by id, under a partial banner with Retry', async ({ page }) => {
  let fail = true;
  await page.route('**/bff/ledger/analytics/query', (route) =>
    fail && specOf(route).source === 'properties' ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ledger_unavailable', message: 'down' } }) }) : route.fallback(),
  );
  await page.goto('/properties/mints');
  const banner = latest(page).getByRole('status').filter({ hasText: 'Could not look up addresses' });
  await expect(banner).toBeVisible(FIRST);
  await expect(latest(page).getByText('#81826746578110')).toBeVisible();
  fail = false;
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect(latest(page).getByText('2506 SEARSDALE AVE')).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test('a failed poll moves the indicator to reconnecting and keeps the mints', async ({ page }) => {
  await page.clock.install();
  let fail = false;
  await page.route('**/bff/ledger/analytics/query', (route) =>
    fail ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ledger_unavailable', message: 'down' } }) }) : route.fallback(),
  );
  await page.goto('/properties/mints');
  await expect(latest(page).getByText('2506 SEARSDALE AVE')).toBeVisible(FIRST);
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
  fail = true;
  await page.clock.fastForward('01:05');
  await expect(page.getByText(/Reconnecting \(attempt 1\)/)).toBeVisible();
  await expect(latest(page).getByText('2506 SEARSDALE AVE')).toBeVisible();
  // Three minutes on, the rows are past their budget: the stale banner offers Refresh.
  await page.clock.fastForward('03:00');
  await expect(latest(page).getByText(/Data is \d+ min old/)).toBeVisible();
});

test('the page fits a phone', async ({ page }) => {
  await page.goto('/properties/mints');
  await expect(latest(page).getByText('2506 SEARSDALE AVE')).toBeVisible(FIRST);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
