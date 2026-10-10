import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * F-406 Property transactions, PRD 5.9: sales and accepted offers from the
 * stub ledger merged newest first, a loading indicator within 100 ms of
 * Apply under Slow 3G, the error state for a 500, the empty state, filters
 * reaching both routes, and the CSV export.
 */

const FIRST = { timeout: 60_000 };
const SLOW = { timeout: 20_000 };
// A cold dev server compiles each route on first visit, several at once under fullyParallel.
test.describe.configure({ timeout: 120_000 });

async function slow3g(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
}

const results = (page: Page) => page.getByRole('region', { name: 'Transactions' });

/**
 * The stub serves the captured pages, which say `has_more: true`, so the
 * merged list would (correctly) hold back rows until both sources page on.
 * Most tests want complete sources.
 */
async function completeSources(page: Page): Promise<void> {
  await page.route(/\/bff\/ledger\/(sales|offers)\?/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    return route.fulfill({ response: res, json: { ...body, has_more: false } });
  });
}
const empty = (limit: number) => JSON.stringify({ data: [], count: 0, limit, offset: 0, has_more: false });

test('lists sales and accepted offers, newest first', async ({ page }) => {
  await completeSources(page);
  await page.goto('/properties/transactions');
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible(FIRST);
  await expect(results(page).getByText('6 JLN RABU').first()).toBeVisible();
  await expect(results(page).getByText('Accepted offer').first()).toBeVisible();
  await expect(results(page).getByText('29,999 UPX').first()).toBeVisible();
  await expect(results(page).getByText('milredi8041 (e4xryauqnpei)').first()).toBeVisible();
  // The sale (Oct 9) is newer than every offer (Oct 8), so it comes first.
  const first = results(page).locator('tbody tr').first();
  await expect(first).toContainText('2506 SEARSDALE AVE');
});

test('filters reach both routes and the URL reproduces them; sales-only filters show for Sales', async ({ page }) => {
  await completeSources(page);
  const seen: URL[] = [];
  page.on('request', (r) => {
    if (/\/bff\/ledger\/(sales|offers)/.test(r.url())) seen.push(new URL(r.url()));
  });
  await page.goto('/properties/transactions');
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible(FIRST);
  await page.getByRole('textbox', { name: 'Seller' }).fill('tlifor1bq435');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/seller=tlifor1bq435/);
  await expect.poll(() => [...new Set(seen.filter((u) => u.searchParams.get('seller') === 'tlifor1bq435').map((u) => u.pathname.split('/').pop()))].sort(), SLOW).toEqual(['offers', 'sales']);

  await expect(page.getByRole('spinbutton', { name: 'Min price' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Sales', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Min price' }).fill('20000');
  await page.getByRole('spinbutton', { name: 'Min price' }).blur();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/type=sales/);
  await expect.poll(() => seen.some((u) => u.pathname.endsWith('/sales') && u.searchParams.get('min_price') === '20000'), SLOW).toBe(true);
  await expect(results(page).getByRole('cell', { name: 'Accepted offer', exact: true })).toHaveCount(0);
});

test('an invalid account is refused before it reaches the ledger', async ({ page }) => {
  await completeSources(page);
  await page.goto('/properties/transactions');
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible(FIRST);
  await page.getByRole('textbox', { name: 'Buyer' }).fill('Not An Account!');
  await expect(page.getByText('Not a chain account').first()).toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).not.toHaveURL(/buyer=/);
});

test('Slow 3G: a loading indicator appears within 100 ms of Apply', async ({ page }) => {
  await completeSources(page);
  await page.goto('/properties/transactions');
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible(FIRST);
  await page.getByRole('textbox', { name: 'Seller' }).fill('hsbkyhq3ycen');
  await slow3g(page);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(results(page).getByText('6 JLN RABU').first()).toBeVisible({ timeout: 60_000 });
});

test('a 500 renders the error state with code, request id and Retry', async ({ page }) => {
  let calls = 0;
  await page.route('**/bff/ledger/sales?*', (route) => {
    calls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'x-request-id': 'req-e2e-tx' }, body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }) });
  });
  await page.goto('/properties/transactions');
  const alert = results(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error', FIRST);
  await expect(alert).toContainText('request req-e2e-tx');
  const before = calls;
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => calls).toBeGreaterThan(before);
});

test('an empty payload renders the empty state with Reset filters', async ({ page }) => {
  await page.route('**/bff/ledger/sales?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: empty(500) }));
  await page.route('**/bff/ledger/offers?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: empty(500) }));
  await page.goto('/properties/transactions?period=7d');
  await expect(results(page).getByText('No transactions match these filters')).toBeVisible(FIRST);
  await results(page).getByRole('button', { name: 'Reset filters' }).click();
  await expect(page).not.toHaveURL(/period=/);
  await expect(results(page).getByText('No transactions recorded yet')).toBeVisible();
});

test('Export CSV downloads the filtered set', async ({ page, isMobile }) => {
  await completeSources(page);
  test.skip(isMobile, 'Downloads are covered on desktop');
  await page.goto('/properties/transactions');
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible(FIRST);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^embers-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(path, 'utf8');
  expect(text.split('\r\n')[0]).toContain('timestamp,type,property_id');
  expect(text).toContain('2506 SEARSDALE AVE');
  expect(text).toContain('Accepted offer');
});

test('the page fits a phone', async ({ page }) => {
  await completeSources(page);
  await page.goto('/properties/transactions');
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible(FIRST);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
