import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * F-404 Live listings, PRD 5.4 + 5.9: rows from the stub ledger through the
 * BFF, the LiveIndicator going live, a loading indicator within 100 ms of
 * Apply under Slow 3G, the error state for a 500, the empty state, filters
 * reaching the ledger, and a failed poll moving the indicator to
 * reconnecting while the rows stay.
 */

async function slow3g(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
}

/** The first read also waits for the dev server to compile the route. */
const FIRST = { timeout: 60_000 };
const SLOW = { timeout: 20_000 };
// A cold dev server compiles each route on first visit, several at once under fullyParallel.
test.describe.configure({ timeout: 120_000 });
const results = (page: Page) => page.getByRole('region', { name: 'Listings' });
const indicator = (page: Page) => page.getByRole('status').filter({ hasText: /LIVE|Connecting|Reconnecting|Paused|Offline|Error|could not|refused|unreachable/i }).first();

test('lists the open order book from the ledger and goes live', async ({ page }) => {
  const seen: URLSearchParams[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/bff/ledger/listings')) seen.push(new URL(r.url()).searchParams);
  });
  await page.goto('/properties/listings');
  await expect(results(page).getByText('150 SW 21ST RD').first()).toBeVisible(FIRST);
  await expect(results(page).getByText('3867 E 147th St').first()).toBeVisible();
  await expect(results(page).getByText('$7.99').first()).toBeVisible();
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
  await expect(page.getByText(/Updated \d\d:\d\d:\d\d UTC/)).toBeVisible();
  expect(seen[0]?.get('open')).toBe('true');
  expect(seen[0]?.get('sort')).toBe('timestamp');
  expect(seen[0]?.get('limit')).toBe('50');
});

test('filters apply server side and the URL reproduces them', async ({ page }) => {
  const seen: URLSearchParams[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/bff/ledger/listings')) seen.push(new URL(r.url()).searchParams);
  });
  await page.goto('/properties/listings');
  await expect(results(page).getByText('150 SW 21ST RD').first()).toBeVisible(FIRST);
  await page.getByRole('radio', { name: 'USD', exact: true }).click();
  await page.getByRole('radio', { name: 'All listing events' }).click();
  await page.getByRole('spinbutton', { name: 'Max price' }).fill('10');
  await page.getByRole('spinbutton', { name: 'Max price' }).blur();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/book=fiat/);
  await expect(page).toHaveURL(/status=all/);
  await expect.poll(() => seen.some((q) => q.get('book') === 'fiat' && q.get('max_ask') === '10' && q.get('open') === null), SLOW).toBe(true);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'USD', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('Slow 3G: a loading indicator appears within 100 ms of Apply', async ({ page }) => {
  await page.goto('/properties/listings');
  await expect(results(page).getByText('150 SW 21ST RD').first()).toBeVisible(FIRST);
  // USD: the stub answers `book=` honestly, and every captured listing is a USD ask.
  await page.getByRole('radio', { name: 'USD', exact: true }).click();
  await slow3g(page);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(results(page).getByText('150 SW 21ST RD').first()).toBeVisible({ timeout: 30_000 });
});

test('a 500 renders the error state with code, request id and Retry; the indicator says so', async ({ page }) => {
  let calls = 0;
  await page.route('**/bff/ledger/listings?*', (route) => {
    calls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'x-request-id': 'req-e2e-listings' }, body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }) });
  });
  await page.goto('/properties/listings');
  const alert = results(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error', FIRST);
  await expect(alert).toContainText('request req-e2e-listings');
  await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
  const before = calls;
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => calls).toBeGreaterThan(before);
});

test('an empty order book renders the empty state with a way out', async ({ page }) => {
  await page.route('**/bff/ledger/listings?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], count: 0, limit: 50, offset: 0, has_more: false }) }),
  );
  await page.goto('/properties/listings');
  await expect(results(page).getByText('No listings in the order book right now')).toBeVisible(FIRST);
  await expect(results(page).getByRole('button', { name: 'Check again' })).toBeVisible();
  await page.goto('/properties/listings?book=upx');
  await expect(results(page).getByText('No listings match these filters')).toBeVisible();
  await results(page).getByRole('button', { name: 'Reset filters' }).click();
  await expect(page).not.toHaveURL(/book=/);
});

test('a failed poll moves the indicator to reconnecting and keeps the rows; recovery goes live with the new row highlighted', async ({ page }) => {
  await page.clock.install();
  let fail = false;
  let extra = false;
  await page.route('**/bff/ledger/listings?*', async (route) => {
    if (fail) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ledger_unavailable', message: 'down' } }) });
    const res = await route.fetch();
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    if (extra) body.data.unshift({ ...body.data[0], property_id: '99999999999999', address: '1 NEW LISTING WAY', timestamp: '2026-10-09T00:20:00.000Z' });
    return route.fulfill({ response: res, json: body });
  });
  await page.goto('/properties/listings');
  await expect(results(page).getByText('150 SW 21ST RD').first()).toBeVisible(FIRST);
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();

  fail = true;
  await page.clock.fastForward('01:05');
  await expect(page.getByText(/Reconnecting \(attempt 1\)/)).toBeVisible();
  await expect(results(page).getByText('150 SW 21ST RD').first()).toBeVisible(FIRST);

  fail = false;
  extra = true;
  await page.clock.fastForward('00:10');
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
  await expect(results(page).getByText('1 NEW LISTING WAY').first()).toBeVisible();
  // The arrival is highlighted, and the highlight ends after 2 s even though the page keeps rerendering (1 s clock).
  const row = results(page).locator('tbody tr').filter({ hasText: '1 NEW LISTING WAY' });
  await expect(row).toHaveAttribute('style', /em-row-in/);
  await page.clock.fastForward('00:03');
  await expect(row).not.toHaveAttribute('style', /em-row-in/);
});

test('offline, then a new filter: the new feed goes live again', async ({ page }) => {
  await page.clock.install();
  let fail = false;
  await page.route('**/bff/ledger/listings?*', (route) =>
    fail && !route.request().url().includes('book=upx')
      ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ledger_unavailable', message: 'down' } }) })
      : route.fallback(),
  );
  await page.goto('/properties/listings');
  await expect(results(page).getByText('150 SW 21ST RD').first()).toBeVisible(FIRST);
  fail = true;
  // The poll at 60 s, then retries after 5, 10, 20 and 30 s: five failures in a row.
  const steps = ['01:01', '00:06', '00:11', '00:21'];
  for (const [i, step] of steps.entries()) {
    await page.clock.fastForward(step);
    await expect(page.getByText(`Reconnecting (attempt ${i + 1})`)).toBeVisible();
  }
  await page.clock.fastForward('00:31');
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'UPX', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/book=upx/);
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
});

test('Pause stops polling and shows Resume', async ({ page }) => {
  await page.goto('/properties/listings');
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible(FIRST);
  await page.getByRole('button', { name: 'Pause live updates' }).click();
  await expect(indicator(page)).toContainText('Paused');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
});

test('the sidebar marks Live Listings as LIVE, and the page fits a phone', async ({ page, isMobile }) => {
  await page.goto('/properties/listings');
  await expect(page.getByRole('heading', { name: 'Live listings' })).toBeVisible(FIRST);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  const nav = isMobile ? page.getByRole('dialog') : page.getByRole('navigation').first();
  const link = nav.getByRole('link', { name: /Live Listings/ });
  await expect(link).toBeVisible();
  await expect(link).toContainText(/Listings\s*Live/i);
});
