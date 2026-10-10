import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { EMPTY_QUERY, fail500, horizontalOverflow, json, slow3g } from './support';

/**
 * F-402 City overview, PRD 5.9 + 12: market tiles, floor asks and the
 * neighborhood table from the stub ledger; a loading indicator within
 * 100 ms of a window change under Slow 3G; the error state for a 500; the
 * empty state for an empty payload; a partial banner when only the
 * neighborhood list fails.
 */

const COLD = { timeout: 30_000 };
// First visits compile the route and the BFF in the dev server.
test.describe.configure({ timeout: 90_000 });
const market = (page: Page) => page.getByRole('region', { name: 'Market', exact: true });
const floor = (page: Page) => page.getByRole('region', { name: 'Floor', exact: true });
const hoods = (page: Page) => page.getByRole('region', { name: 'Neighborhoods', exact: true });

test("renders one city's market, floor and neighborhoods", async ({ page }) => {
  await page.goto('/properties/overview/Las%20Vegas');
  await expect(page.getByRole('heading', { name: 'Las Vegas', level: 1 })).toBeVisible(COLD);
  await expect(market(page).getByText('1.13×')).toBeVisible(COLD);
  await expect(market(page).getByText('32,000 UPX')).toBeVisible();
  // The stub's order book is all USD asks: the UPX floor says so instead of inventing one.
  await expect(floor(page).getByText('None open')).toBeVisible(COLD);
  await expect(floor(page).getByText('$7.99')).toBeVisible();
  await expect(hoods(page).getByText('PARADISE')).toBeVisible(COLD);
  await expect(hoods(page).getByText('903')).toBeVisible();
  await expect(hoods(page).getByText('Not recorded')).toBeVisible();
  // Reference neighborhoods without trades still appear, with their area.
  await expect(hoods(page).getByText('ALAMO SQUARE')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('Slow 3G: changing the window shows a loading indicator within 100 ms', async ({ page }) => {
  await page.goto('/properties/overview/Rome');
  await expect(market(page).getByText('2.57×')).toBeVisible(COLD);
  await slow3g(page);
  await page.getByRole('radio', { name: '30 days' }).click();
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(page).toHaveURL(/window=30/);
});

test('a 500 shows the error with code, request id and Retry', async ({ page }) => {
  const failing = await fail500(page, '**/bff/ledger/analytics/query', 'req-e2e-city');
  await page.goto('/properties/overview/Rome');
  const alert = hoods(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error', COLD);
  await expect(alert).toContainText('req-e2e-city');
  const before = failing.calls();
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => failing.calls()).toBeGreaterThan(before);
});

test('empty payloads show empty states with a way out', async ({ page }) => {
  await page.route('**/bff/ledger/market/cities?*', (route) => json(route, []));
  await page.route('**/bff/ledger/analytics/query', (route) => json(route, EMPTY_QUERY));
  await page.goto('/properties/overview/Atlantis');
  await expect(market(page).getByText('No market activity recorded for Atlantis in the last 7 days')).toBeVisible(COLD);
  await expect(hoods(page).getByText('No traded properties recorded in Atlantis')).toBeVisible();
  await market(page).getByRole('button', { name: 'Show the last 30 days' }).click();
  await expect(page).toHaveURL(/window=30/);
});

test('when only the neighborhood list fails, the table stays with a partial banner', async ({ page }) => {
  await fail500(page, '**/bff/ledger/neighborhoods?*', 'req-e2e-hoods');
  await page.goto('/properties/overview/Las%20Vegas');
  await expect(hoods(page).getByText('PARADISE')).toBeVisible(COLD);
  const banner = hoods(page).getByRole('status').filter({ hasText: 'neighborhood list' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test("the city's Upland status counts", async ({ page }) => {
  await page.goto('/properties/overview/Las%20Vegas');
  const tiles = page.getByRole('region', { name: 'Property status', exact: true });
  await expect(tiles.getByText('97,252', { exact: true })).toBeVisible(COLD);
  await expect(tiles.getByText('52,000', { exact: true })).toBeVisible();
  await expect(tiles.getByText('3,100', { exact: true })).toBeVisible();
});
