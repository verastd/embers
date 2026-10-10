import { expect as baseExpect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { emptyPage, emptyResult, expectErrorWithRetry, expectNoHorizontalScroll, fail500, json, slow3g } from './helpers';

// The dev server compiles each route on first visit; on a busy machine that
// takes a while. The 100 ms loading checks pass their own timeout.
const expect = baseExpect.configure({ timeout: 20_000 });
test.setTimeout(120_000);

/**
 * F-190 Home, PRD 5.9 + 8.1 AC: every tile renders a skeleton then data or
 * its own error, and one failed tile does not block the others; the chart
 * and latest sales have their error and empty states.
 */

const live = (page: Page) => page.locator('section[aria-labelledby="live-title"]');
const activity = (page: Page) => page.locator('section[aria-labelledby="activity-title"]');
const sales = (page: Page) => page.locator('section[aria-labelledby="sales-title"]');

test('renders the live strip, chain activity, latest sales and the tools from the ledger', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Embers' })).toBeVisible();
  // The stub answers each figure with 1,234 (first measure).
  await expect(live(page).getByText('1,234')).toHaveCount(3);
  // UPX moved over 24 h, from /analytics/overview (144,653,377.72 UPX).
  await expect(live(page).getByText('144.7M')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'LIVE' }).first()).toBeVisible();
  await expect(activity(page).getByRole('img', { name: /Transactions per day/ })).toBeVisible();
  await expect(activity(page).getByText(/3,387,506 transactions over 7 days/)).toBeVisible();
  await expect(sales(page).getByRole('cell', { name: '2506 SEARSDALE AVE' })).toBeVisible();
  await expect(sales(page).getByRole('button', { name: 'Pause ticker' })).toBeVisible();
  const explore = page.locator('section[aria-labelledby="explore-title"]');
  await expect(explore.getByRole('link', { name: /Leaderboards · Upland/ })).toBeVisible();
  await expect(explore.getByRole('link', { name: /Users · User Search/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('Slow 3G: tiles, chart and table show their loading state as soon as the page shows', async ({ page }) => {
  await slow3g(page);
  await page.goto('/', { waitUntil: 'commit', timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Embers' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(sales(page).getByRole('cell', { name: '2506 SEARSDALE AVE' })).toBeVisible({ timeout: 60_000 });
});

test('one failed tile shows its own error and Retry; the others still render', async ({ page }) => {
  let calls = 0;
  await page.route('**/bff/ledger/analytics/query', async (route) => {
    const spec = route.request().postDataJSON() as { source: string };
    if (spec.source !== 'listings') return route.fallback();
    calls += 1;
    return fail500('req-tile')(route);
  });
  await page.goto('/');
  const failed = live(page).getByRole('alert');
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText('Failed to load');
  await expect(live(page).getByText('1,234')).toHaveCount(2);
  const before = calls;
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => calls).toBeGreaterThan(before);
});

test('a 500 renders the chart and table error states with request id and Retry', async ({ page }) => {
  let chartCalls = 0;
  let salesCalls = 0;
  await page.route('**/bff/ledger/analytics/timeseries?*', (route) => {
    chartCalls += 1;
    return fail500('req-chart')(route);
  });
  await page.route('**/bff/ledger/sales?*', (route) => {
    salesCalls += 1;
    return fail500('req-sales')(route);
  });
  await page.goto('/');
  await expectErrorWithRetry(page, activity(page), 'req-chart', () => chartCalls);
  await expectErrorWithRetry(page, sales(page), 'req-sales', () => salesCalls);
});

test('every live read failing turns the indicator to an error with Retry', async ({ page }) => {
  await page.route('**/bff/ledger/analytics/**', fail500('req-all'));
  await page.goto('/');
  await expect(live(page).getByRole('alert')).toHaveCount(5);
  await expect(page.getByRole('status').filter({ hasText: 'Ledger unreachable' })).toBeVisible();
});

test('empty payloads render the empty states', async ({ page }) => {
  await page.route('**/bff/ledger/analytics/timeseries?*', json(emptyResult(['day', 'transactions'])));
  await page.route('**/bff/ledger/sales?*', json(emptyPage));
  await page.goto('/');
  await expect(activity(page).getByText('No chain activity in this range')).toBeVisible();
  await expect(sales(page).getByText('No property sales recorded yet')).toBeVisible();
});

test('Home is the first sidebar entry', async ({ page, isMobile }) => {
  await page.goto('/leaderboards/users');
  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  const nav = isMobile ? page.getByRole('dialog') : page;
  await nav.getByRole('link', { name: 'Home', exact: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Embers' })).toBeVisible();
});
