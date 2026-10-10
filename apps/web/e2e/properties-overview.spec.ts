import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { fail500, horizontalOverflow, json, slow3g } from './support';

/**
 * F-401 Properties overview, PRD 5.9 + 12: city rows and KPI tiles from the
 * stub ledger's `/market/cities`, a loading indicator within 100 ms of a
 * window change under Slow 3G, the error state for a 500 and the empty
 * state for an empty payload; row click opens the city (F-402).
 */

const cities = (page: Page) => page.getByRole('region', { name: 'Cities', exact: true });
/** The dev server compiles a route on first visit; allow for it. */
const COLD = { timeout: 30_000 };
// First visits compile the route and the BFF in the dev server.
test.describe.configure({ timeout: 90_000 });
const kpis = (page: Page) => page.getByRole('region', { name: 'All cities', exact: true });

test('lists every city with its market activity and totals', async ({ page }) => {
  await page.goto('/properties/overview');
  await expect(page.getByRole('heading', { name: 'Properties overview' })).toBeVisible();
  const table = cities(page);
  await expect(table.getByRole('link', { name: 'Las Vegas' })).toBeVisible(COLD);
  await expect(table.getByRole('link', { name: 'Los Angeles' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Rome' })).toBeVisible();
  await expect(table.getByText('1.13×')).toBeVisible();
  await expect(kpis(page).getByText('59', { exact: true })).toBeVisible();
  await expect(page.getByText('Market data through')).toContainText('Oct 8, 2026');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('sorting by a column is kept in the URL', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phone rows are cards; sortable headers are a desktop affordance.');
  await page.goto('/properties/overview');
  await expect(cities(page).getByRole('link', { name: 'Rome' })).toBeVisible(COLD);
  const header = cities(page).getByRole('button', { name: 'Sales', exact: true });
  await header.click();
  await expect(page).toHaveURL(/sort=sales&order=asc|order=asc&sort=sales/);
  await expect(cities(page).locator('tbody tr').last()).toContainText('Los Angeles');
  await header.click();
  await expect(page).toHaveURL(/order=desc/);
  await expect(cities(page).locator('tbody tr').first()).toContainText('Los Angeles');
});

test('a city row opens its overview', async ({ page }) => {
  await page.goto('/properties/overview');
  await cities(page).getByRole('link', { name: 'Rome' }).click(COLD);
  await expect(page).toHaveURL(/\/properties\/overview\/Rome$/, COLD);
  await expect(page.getByRole('heading', { name: 'Rome', level: 1 })).toBeVisible(COLD);
});

test('Slow 3G: changing the window shows a loading indicator within 100 ms', async ({ page }) => {
  await page.goto('/properties/overview');
  await expect(cities(page).getByRole('link', { name: 'Rome' })).toBeVisible(COLD);
  await slow3g(page);
  await page.getByRole('radio', { name: '30 days' }).click();
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(page).toHaveURL(/window=30/);
  await expect(cities(page).getByRole('link', { name: 'Rome' })).toBeVisible({ timeout: 30_000 });
});

test('a 500 shows the error with code, request id and Retry; tiles fail on their own', async ({ page }) => {
  const failing = await fail500(page, '**/bff/ledger/market/cities?*', 'req-e2e-overview');
  await page.goto('/properties/overview');
  const alert = cities(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error', COLD);
  await expect(alert).toContainText('req-e2e-overview');
  await expect(kpis(page).getByText('Failed to load').first()).toBeVisible();
  const before = failing.calls();
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => failing.calls()).toBeGreaterThan(before);
});

test('an empty payload shows the empty state with a way out', async ({ page }) => {
  await page.route('**/bff/ledger/market/cities?*', (route) => json(route, []));
  await page.goto('/properties/overview');
  await expect(cities(page).getByText('No market activity recorded in the last 7 days')).toBeVisible(COLD);
  await cities(page).getByRole('button', { name: 'Show the last 30 days' }).click();
  await expect(page).toHaveURL(/window=30/);
});

test('the sidebar lists Overview, Statistics and Mint Analytics under Properties', async ({ page, isMobile }) => {
  await page.goto('/properties/overview');
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  const nav = isMobile ? page.getByRole('dialog') : page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'Overview' })).toBeVisible(COLD);
  await expect(nav.getByRole('link', { name: 'Statistics' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Mint Analytics' })).toBeVisible();
});

test('"Latest day" reads without a date cutoff: a long build outage shows its last day as stale', async ({ page }) => {
  const seen: URLSearchParams[] = [];
  const old = (city: string) => ({ day: '2026-08-01', city, sales: 4, volume_upx: 80_000, median_sale_upx: 20_000, median_ask_upx: 25_000, median_ask_usd: 4, listings_new: 3, listings_removed: 1, mints: 0, median_mint_upx: null, median_sale_to_mint: 1.2, yield_payout_upx: 0, distinct_buyers: 2, distinct_sellers: 2 });
  await page.route('**/bff/ledger/market/cities?*', (route) => {
    seen.push(new URL(route.request().url()).searchParams);
    return json(route, [old('Fresno'), old('Detroit'), { ...old('Detroit'), day: '2026-07-31' }]);
  });
  await page.goto('/properties/overview?window=latest');
  await expect(cities(page).getByRole('link', { name: 'Fresno' })).toBeVisible(COLD);
  await expect(page.getByText('Market data through')).toContainText('Aug 1, 2026');
  await expect(cities(page).getByText(/Data is \d+ d old/)).toBeVisible();
  const q = seen[seen.length - 1];
  expect(q?.get('after')).toBeNull();
  expect(q?.get('before')).toBeNull();
});
