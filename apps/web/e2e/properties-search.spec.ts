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

test('the shell fits the screen, with the nav in a drawer on phones', async ({ page, isMobile }) => {
  await page.goto('/properties/search');
  await expect(page.getByRole('heading', { name: 'Properties search' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (isMobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('link', { name: 'Search' })).toBeVisible();
  } else {
    await expect(page.getByRole('link', { name: 'Search' }).first()).toHaveAttribute('aria-current', 'page');
  }
});

test('/ and /properties open Properties search', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/properties\/search$/);
  await page.goto('/properties');
  await expect(page).toHaveURL(/\/properties\/search$/);
});
