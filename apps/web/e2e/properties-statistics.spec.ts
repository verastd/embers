import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { fail500, horizontalOverflow, json, slow3g } from './support';

/**
 * F-407 Properties statistics, PRD 5.9 + 12: the charts draw from the stub
 * ledger (`/market/cities`, `/analytics/sales`), a loading indicator shows
 * within 100 ms of Apply under Slow 3G, a 500 renders the error state with
 * Retry, an empty payload renders the empty state; the range is validated
 * before it is applied; charts offer zoom reset and PNG download.
 */

const COLD = { timeout: 30_000 };
// First visits compile the route and the BFF in the dev server.
test.describe.configure({ timeout: 90_000 });
const transactions = (page: Page) => page.getByRole('region', { name: 'Transactions made', exact: true });
const upx = (page: Page) => page.getByRole('region', { name: 'Price statistics (UPX)', exact: true });

test('all cities: transactions per day and the chain-wide median sale', async ({ page }) => {
  await page.goto('/properties/statistics');
  await expect(transactions(page).getByRole('img', { name: 'Transactions made, all cities' })).toBeVisible(COLD);
  await expect(transactions(page).getByText('Listings removed')).toBeVisible();
  await expect(upx(page).getByRole('img', { name: 'Median sale price, all cities' })).toBeVisible(COLD);
  // Per-city charts need a city.
  await expect(page.getByRole('region', { name: 'Price statistics (USD)' })).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('one city: UPX, USD and markup charts with series toggles', async ({ page }) => {
  await page.goto('/properties/statistics?city=Rome');
  await expect(upx(page).getByRole('img', { name: 'Price statistics in UPX, Rome' })).toBeVisible(COLD);
  await expect(page.getByRole('img', { name: 'Price statistics in USD, Rome' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Median markup, Rome' })).toBeVisible();
  await upx(page).getByRole('checkbox', { name: 'Median sale' }).click();
  await upx(page).getByRole('checkbox', { name: 'Median ask' }).click();
  await expect(upx(page).getByText('Every series is switched off')).toBeVisible();
  await upx(page).getByRole('button', { name: 'Show all' }).click();
  await expect(upx(page).getByRole('img', { name: 'Price statistics in UPX, Rome' })).toBeVisible();
});

test('Download PNG saves the chart; Reset zoom explains itself until you zoom', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Downloads are checked once, on desktop.');
  await page.goto('/properties/statistics');
  const chart = transactions(page);
  await expect(chart.getByRole('img', { name: 'Transactions made, all cities' })).toBeVisible(COLD);
  await expect(chart.getByRole('button', { name: 'Reset zoom' })).toHaveAttribute('aria-disabled', 'true');
  const download = page.waitForEvent('download');
  await chart.getByRole('button', { name: 'Download PNG' }).click();
  expect((await download).suggestedFilename()).toBe('transactions-made-all-cities.png');
});

test('a bad range is refused before anything is read', async ({ page }) => {
  await page.goto('/properties/statistics');
  await expect(transactions(page).getByRole('img', { name: 'Transactions made, all cities' })).toBeVisible(COLD);
  await page.getByRole('textbox', { name: 'From' }).fill('2026-09-01');
  await page.getByRole('textbox', { name: 'To' }).fill('2026-08-01');
  await expect(page.getByText('From must not be after To').first()).toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).not.toHaveURL(/from=/);
});

test('Slow 3G: Apply shows a loading indicator within 100 ms', async ({ page }) => {
  await page.goto('/properties/statistics');
  await expect(transactions(page).getByRole('img', { name: 'Transactions made, all cities' })).toBeVisible(COLD);
  await page.getByRole('textbox', { name: 'From' }).fill('2026-10-01');
  await page.getByRole('textbox', { name: 'To' }).fill('2026-10-08');
  await slow3g(page);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(page).toHaveURL(/from=2026-10-01/);
});

test('a 500 shows the error with code, request id and Retry', async ({ page }) => {
  const failing = await fail500(page, '**/bff/ledger/market/cities?*', 'req-e2e-stats');
  await page.goto('/properties/statistics');
  const alert = transactions(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error', COLD);
  await expect(alert).toContainText('req-e2e-stats');
  const before = failing.calls();
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => failing.calls()).toBeGreaterThan(before);
});

test('an empty payload shows "No data for this range" with Reset filters', async ({ page }) => {
  await page.route('**/bff/ledger/market/cities?*', (route) => json(route, []));
  await page.goto('/properties/statistics?city=Rome&from=2026-09-01&to=2026-09-30');
  await expect(transactions(page).getByText('No data for this range')).toBeVisible(COLD);
  await transactions(page).getByRole('button', { name: 'Reset filters' }).click();
  await expect(page).not.toHaveURL(/city=/);
});

test('a hand-edited unbounded range in the URL is refused with Reset, and nothing is read', async ({ page }) => {
  let reads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/bff/ledger/market/cities') || r.url().includes('/bff/ledger/analytics/sales')) reads += 1;
  });
  await page.goto('/properties/statistics?from=0000-01-01&to=9999-12-31');
  const refused = page.getByRole('region', { name: "This range can't be shown" });
  await expect(refused.getByText('Up to 365 days at a time')).toBeVisible(COLD);
  expect(reads).toBe(0);
  await refused.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page).not.toHaveURL(/from=/);
  await expect(transactions(page).getByRole('img', { name: 'Transactions made, all cities' })).toBeVisible(COLD);
});

test('a historical range is complete, not stale', async ({ page }) => {
  await page.goto('/properties/statistics?city=Rome&from=2026-09-01&to=2026-09-30');
  await expect(transactions(page).getByRole('img', { name: 'Transactions made, Rome' })).toBeVisible(COLD);
  await expect(transactions(page).getByText(/Data is .* old/)).toHaveCount(0);
});

test('a range reaching today, with old data, is stale in human units', async ({ page }) => {
  await page.goto('/properties/statistics');
  await expect(transactions(page).getByText(/Data is \d+ (h|d) old/)).toBeVisible(COLD);
});
