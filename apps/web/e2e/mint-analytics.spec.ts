import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { EMPTY_QUERY, fail500, horizontalOverflow, json, slow3g } from './support';

/**
 * F-408 Mint analytics, PRD 5.9 + 12: KPIs and top minters from the stub
 * ledger's `POST /analytics/query`, the mints table from `/properties`
 * (stopping at the start of the timeframe), a loading indicator within
 * 100 ms of Analyze under Slow 3G, the error state for a 500 and the empty
 * state for an empty payload.
 */

const COLD = { timeout: 30_000 };
// First visits compile the route and the BFF in the dev server.
test.describe.configure({ timeout: 90_000 });
const summary = (page: Page) => page.getByRole('region', { name: 'Summary', exact: true });
const minters = (page: Page) => page.getByRole('region', { name: 'Top minters', exact: true });
const mints = (page: Page) => page.getByRole('region', { name: 'Mints', exact: true });

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const mint = (id: string, address: string, mintedAt: string | null, kind = 'fsa_upx') => ({
  property_id: id,
  address,
  city: 'Las Vegas',
  region: 'NV',
  neighborhood: 'PARADISE',
  neighborhood_id: 1,
  mint_price_upx: 12_500,
  mint_price_source: 'chain',
  mint_kind: kind,
  api_status: '',
  minted_at: mintedAt,
  sales: 0,
  last_sale_upx: 0,
  last_sale_at: null,
  observations: 1,
  mint_band: 13,
});

test('summarizes mints, ranks minters and lists the newest mints', async ({ page }) => {
  await page.route('**/bff/ledger/properties?*', (route) =>
    json(route, {
      data: [mint('1', '100 MAIN ST', iso(3_600_000)), mint('2', '200 MAIN ST', iso(86_400_000), 'i44'), mint('3', '300 OLD RD', iso(400 * 86_400_000))],
      count: 3,
      limit: 50,
      offset: 0,
      has_more: true,
    }),
  );
  await page.goto('/properties/mint-analytics');
  const s = summary(page);
  await expect(s.getByText('93', { exact: true })).toBeVisible(COLD);
  await expect(s.getByText('78', { exact: true })).toBeVisible();
  await expect(s.getByText('15', { exact: true })).toBeVisible();
  await expect(s.getByText('Las Vegas')).toBeVisible();
  await expect(s.getByText('PARADISE')).toBeVisible();
  await expect(s.getByText('6 of these mints have no neighborhood')).toBeVisible();
  await expect(minters(page).getByText('mequ13noaq12')).toBeVisible(COLD);
  await expect(mints(page).getByText('100 MAIN ST')).toBeVisible(COLD);
  await expect(mints(page).getByText('Settled off chain')).toBeVisible();
  // Older than the timeframe: not shown, and no Load more past the start.
  await expect(mints(page).getByText('300 OLD RD')).toHaveCount(0);
  await expect(mints(page).getByText('Start of the timeframe')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('Slow 3G: Analyze shows a loading indicator within 100 ms', async ({ page }) => {
  await page.goto('/properties/mint-analytics');
  await expect(minters(page).getByText('mequ13noaq12')).toBeVisible(COLD);
  await page.getByRole('radio', { name: '7 days' }).click();
  await slow3g(page);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(page).toHaveURL(/days=7/);
});

test('a 500 shows the error with code, request id and Retry', async ({ page }) => {
  const failing = await fail500(page, '**/bff/ledger/analytics/query', 'req-e2e-mints');
  await page.goto('/properties/mint-analytics');
  const alert = minters(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error', COLD);
  await expect(alert).toContainText('req-e2e-mints');
  await expect(summary(page).getByText('Failed to load').first()).toBeVisible();
  const before = failing.calls();
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => failing.calls()).toBeGreaterThan(before);
});

test('empty payloads show empty states with a way out', async ({ page }) => {
  await page.route('**/bff/ledger/analytics/query', (route) => json(route, EMPTY_QUERY));
  await page.route('**/bff/ledger/properties?*', (route) => json(route, { data: [], count: 0, limit: 50, offset: 0, has_more: false }));
  await page.goto('/properties/mint-analytics?city=Atlantis');
  await expect(summary(page).getByText('No mints recorded in Atlantis in the last 30 days')).toBeVisible(COLD);
  await expect(minters(page).getByText('No mints recorded in the last 30 days')).toBeVisible();
  await expect(mints(page).getByText('No mints recorded in Atlantis')).toBeVisible();
  await summary(page).getByRole('button', { name: 'Reset filters' }).click();
  await expect(page).not.toHaveURL(/city=/);
});
