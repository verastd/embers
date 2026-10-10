import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * F-403 Properties search, PRD 5.9 + 12: the empty-initial state, a real
 * search through the BFF to the stub ledger, a loading indicator within
 * 100 ms of each action under Slow 3G, the error state for a 500 (with code
 * and request id) and the empty state for an empty payload. Plus the shell
 * at phone width: no horizontal overflow, nav in the drawer.
 */

async function slow3g(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  // Chrome DevTools' "Slow 3G" preset.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
}

const results = (page: Page) => page.getByRole('region', { name: 'Results' });
const searchButton = (page: Page) => page.getByRole('button', { name: 'Search', exact: true });

test('before the first search: "Set filters and press Search", and no ledger read', async ({ page }) => {
  let reads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/bff/ledger/properties')) reads += 1;
  });
  await page.goto('/properties/search');
  await expect(results(page).getByText('Set filters and press Search')).toBeVisible();
  expect(reads).toBe(0);
});

test('Search reads the ledger through the BFF and lists the rows; the URL reproduces it', async ({ page }) => {
  await page.goto('/properties/search');
  await searchButton(page).click();
  await expect(page).toHaveURL(/[?&]search=1/);
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible();
  await expect(results(page).getByText('11439 210TH ST').first()).toBeVisible();
  await page.reload();
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible();
});

test('Slow 3G: a loading indicator appears within 100 ms of Search', async ({ page }) => {
  await page.goto('/properties/search');
  await expect(searchButton(page)).toBeVisible();
  await slow3g(page);
  await searchButton(page).click();
  // Either the button's own pending state or the results skeleton, inside 100 ms.
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(results(page).getByText('2506 SEARSDALE AVE').first()).toBeVisible({ timeout: 30_000 });
});

test('a 500 renders the error state with the reason, request id and Retry; Retry reads again', async ({ page }) => {
  let calls = 0;
  await page.route('**/bff/ledger/properties?*', (route) => {
    calls += 1;
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: { 'x-request-id': 'req-e2e-1' },
      body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }),
    });
  });
  await page.goto('/properties/search?search=1');
  const alert = results(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error');
  await expect(alert).toContainText('request req-e2e-1');
  const before = calls;
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => calls).toBeGreaterThan(before);
});

test('an empty payload renders the empty state with Reset filters', async ({ page }) => {
  await page.route('**/bff/ledger/properties?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], count: 0, limit: 100, offset: 0, has_more: false }) }),
  );
  await page.goto('/properties/search?search=1&address=nowhere');
  await expect(results(page).getByText('No properties match these filters')).toBeVisible();
  await results(page).getByRole('button', { name: 'Reset filters' }).click();
  await expect(page).not.toHaveURL(/address=/);
});

const ROW = {
  property_id: '81826746578110',
  address: '2506 SEARSDALE AVE',
  city: 'Cleveland',
  region: 'OH',
  neighborhood: '',
  neighborhood_id: 0,
  mint_price_upx: 10000,
  mint_price_source: 'api',
  mint_kind: '',
  api_status: 'For sale',
  minted_at: null,
  sales: 1,
  last_sale_upx: 29999,
  last_sale_at: '2026-10-09T00:12:28.000Z',
  observations: 1,
  mint_band: 13,
};
const MARKET = {
  owner_account: 'mequ13noaq12',
  owner_username: 'genndus',
  owner_since: '2026-09-01T10:00:00.000Z',
  owner_seen_at: '2026-10-01T08:00:00.000Z',
  owner_source: 'listing_created',
  listed: true,
  ask_upx: 15000,
  ask_fiat: null,
  ask_currency: 'upx',
  ask_to_mint: 1.5,
  listed_at: '2026-10-01T08:00:00.000Z',
};
const pageOf = (rows: unknown[]) => JSON.stringify({ data: rows, count: rows.length, limit: 100, offset: 0, has_more: false });

test('listing filters reach the ledger, and owner, ask and markup show from an updated ledger', async ({ page }) => {
  const seen: URLSearchParams[] = [];
  await page.route('**/bff/ledger/properties?*', (route) => {
    seen.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ status: 200, contentType: 'application/json', body: pageOf([{ ...ROW, ...MARKET }]) });
  });
  await page.goto('/properties/search');
  await page.getByRole('radio', { name: 'Listed', exact: true }).click();
  await page.getByRole('radio', { name: 'UPX', exact: true }).click();
  await page.getByRole('textbox', { name: 'Owner' }).fill('Genndus');
  await page.getByRole('spinbutton', { name: 'Min markup' }).fill('1.2');
  await page.getByRole('spinbutton', { name: 'Min markup' }).blur();
  await searchButton(page).click();
  await expect(page).toHaveURL(/listing=listed/);
  await expect(results(page).getByText('genndus')).toBeVisible();
  await expect(results(page).getByText('15,000 UPX')).toBeVisible();
  await expect(results(page).getByText('1.50×')).toBeVisible();
  const q = seen[seen.length - 1];
  expect(q?.get('listed')).toBe('true');
  expect(q?.get('currency')).toBe('upx');
  expect(q?.get('owner')).toBe('Genndus');
  expect(q?.get('min_markup')).toBe('1.2');
});

test('a ledger that ignores the owner filter never shows its rows as filtered', async ({ page }) => {
  // The pre-0013 shape: no `listed`, so the owner filter was dropped server side.
  await page.route('**/bff/ledger/properties?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: pageOf([ROW]) }));
  await page.goto('/properties/search?search=1&owner=genndus');
  const banner = results(page).getByRole('status').filter({ hasText: 'not been updated' });
  await expect(banner).toBeVisible();
  await expect(results(page).getByText('2506 SEARSDALE AVE')).toHaveCount(0);
  await banner.getByRole('button', { name: 'Search without them' }).click();
  await expect(page).not.toHaveURL(/owner=/);
  await expect(results(page).getByText('2506 SEARSDALE AVE')).toBeVisible();
  await expect(results(page).getByRole('columnheader', { name: 'Owner' })).toHaveCount(0);
});

test('the shell fits the screen, with the nav in a drawer on phones', async ({ page, isMobile }) => {
  await page.goto('/properties/search');
  await expect(page.getByRole('heading', { name: 'Properties search' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (isMobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('link', { name: 'Search', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('link', { name: 'Search', exact: true }).first()).toHaveAttribute('aria-current', 'page');
  }
});

test('/ opens Home and /properties opens Properties search', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Embers' })).toBeVisible();
  await page.goto('/properties');
  await expect(page).toHaveURL(/\/properties\/search$/);
});
