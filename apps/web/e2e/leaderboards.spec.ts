import { expect as baseExpect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { emptyPage, emptyResult, expectErrorWithRetry, expectNoHorizontalScroll, fail500, json, slow3g } from './helpers';

// The dev server compiles each route on first visit; on a busy machine that
// takes a while. The 100 ms loading checks pass their own timeout.
const expect = baseExpect.configure({ timeout: 20_000 });
test.setTimeout(120_000);

/**
 * F-1606 leaderboards (Users, Properties, Upland), PRD 5.9 + 12: rows from
 * the stub ledger, top 3 styled, a loading indicator within 100 ms of a
 * change under Slow 3G, the error state for a 500, the empty state for an
 * empty payload, and the partial state when only the username lookup fails.
 */

const board = (page: Page) => page.locator('section[aria-labelledby="leaderboard-title"]');
const QUERY = '**/bff/ledger/analytics/query';

test.describe('Users leaderboard', () => {
  test('ranks players from the ledger, top 3 styled; Rank by applies at once', async ({ page }) => {
    const seen: URLSearchParams[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/bff/ledger/accounts?')) seen.push(new URL(r.url()).searchParams);
    });
    await page.goto('/leaderboards/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users leaderboard' })).toBeVisible();
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await expect(board(page).getByLabel('Rank 1')).toBeVisible();
    expect(seen.at(-1)?.get('sort')).toBe('upx_spent');
    expect(seen.at(-1)?.get('likely_bot')).toBe('false');
    expect(seen.at(-1)?.get('limit')).toBe('100');
    await page.getByRole('radio', { name: 'Include likely bots' }).click();
    await expect(page).toHaveURL(/players=everyone/);
    await expect.poll(() => seen.at(-1)?.get('likely_bot') ?? null).toBeNull();
  });

  test('Export CSV downloads the ranking', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Downloads are the same on every viewport.');
    await page.goto('/leaderboards/users');
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    const download = page.waitForEvent('download');
    await board(page).getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^embers-users-leaderboard-upx-spent-\d{4}-\d{2}-\d{2}\.csv$/);
    await expect(board(page).getByRole('button', { name: /Exported/ })).toBeVisible();
  });

  test('Slow 3G: a loading indicator appears within 100 ms of a change', async ({ page }) => {
    await page.goto('/leaderboards/users');
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await slow3g(page);
    await page.getByRole('radio', { name: 'Include likely bots' }).click();
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  });

  test('a 500 renders the error state with Retry', async ({ page }) => {
    let calls = 0;
    await page.route('**/bff/ledger/accounts?*', (route) => {
      calls += 1;
      return fail500('req-lb-users')(route);
    });
    await page.goto('/leaderboards/users');
    await expectErrorWithRetry(page, board(page), 'req-lb-users', () => calls);
  });

  test('an empty payload renders the empty state with a way out', async ({ page }) => {
    await page.route('**/bff/ledger/accounts?*', json(emptyPage));
    await page.goto('/leaderboards/users');
    await expect(board(page).getByText('No players to rank yet')).toBeVisible();
    await board(page).getByRole('button', { name: 'Include likely bots' }).click();
    await expect(page).toHaveURL(/players=everyone/);
  });
});

test.describe('Properties leaderboard', () => {
  test('ranks buyers from sale events, with their usernames', async ({ page }) => {
    const specs: Array<Record<string, unknown>> = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/bff/ledger/analytics/query')) specs.push(r.postDataJSON() as Record<string, unknown>);
    });
    await page.goto('/leaderboards/properties');
    await expect(page.getByRole('heading', { level: 1, name: 'Properties leaderboard' })).toBeVisible();
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await expect(board(page).getByText('b5yv5uxdn1zc')).toBeVisible();
    expect(specs.some((s) => s.source === 'sales')).toBe(true);
    expect(specs.some((s) => s.source === 'accounts')).toBe(true);
    await page.getByRole('radio', { name: 'Purchase volume' }).click();
    await expect(page).toHaveURL(/by=volume_upx/);
    await page.getByRole('radio', { name: 'Today' }).click();
    await expect(page).toHaveURL(/scope=today/);
    await expect(board(page).getByRole('heading', { name: /Purchase volume · today/ })).toBeVisible();
  });

  test('Slow 3G: a loading indicator appears within 100 ms of a change', async ({ page }) => {
    await page.goto('/leaderboards/properties');
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await slow3g(page);
    await page.getByRole('radio', { name: 'Last month' }).click();
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  });

  test('a 500 renders the error state with Retry', async ({ page }) => {
    let calls = 0;
    await page.route(QUERY, (route) => {
      calls += 1;
      return fail500('req-lb-props')(route);
    });
    await page.goto('/leaderboards/properties');
    await expectErrorWithRetry(page, board(page), 'req-lb-props', () => calls);
  });

  test('an empty payload renders the empty state with a way out', async ({ page }) => {
    await page.route(QUERY, json(emptyResult(['buyer', 'bought', 'volume_upx', 'median_upx'])));
    await page.goto('/leaderboards/properties');
    await expect(board(page).getByText('No property sales last week')).toBeVisible();
    await board(page).getByRole('button', { name: 'Show last month' }).click();
    await expect(page).toHaveURL(/scope=month/);
  });

  test('when only the username lookup fails, the board shows with a partial banner', async ({ page }) => {
    await page.route(QUERY, async (route) => {
      const spec = route.request().postDataJSON() as { source: string };
      if (spec.source === 'accounts') return fail500('req-names')(route);
      return route.fallback();
    });
    await page.goto('/leaderboards/properties');
    await expect(board(page).getByText('Could not look up usernames. Accounts are shown instead.')).toBeVisible();
    await expect(board(page).getByRole('link', { name: 'b5yv5uxdn1zc' })).toBeVisible();
  });
});

test.describe('Upland leaderboard', () => {
  test('shows treasure finds, and trades merged from both sides', async ({ page }) => {
    await page.goto('/leaderboards/upland');
    await expect(page.getByRole('heading', { level: 1, name: 'Upland leaderboard' })).toBeVisible();
    await expect(board(page).getByRole('columnheader', { name: 'Treasures claimed' })).toBeVisible();
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await expect(board(page).getByLabel('Rank 1')).toBeVisible();
    await page.getByRole('radio', { name: 'Trades' }).click();
    await expect(page).toHaveURL(/board=trades/);
    await expect(board(page).getByRole('columnheader', { name: 'Bought' })).toBeVisible();
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await page.getByRole('radio', { name: 'Total UPX proceeds' }).click();
    await expect(board(page).getByRole('columnheader', { name: 'UPX proceeds' })).toBeVisible();
  });

  test('Slow 3G: a loading indicator appears within 100 ms of a change', async ({ page }) => {
    await page.goto('/leaderboards/upland');
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await slow3g(page);
    await page.getByRole('radio', { name: 'Trades' }).click();
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  });

  test('a 500 renders the error state with Retry', async ({ page }) => {
    let calls = 0;
    await page.route(QUERY, (route) => {
      calls += 1;
      return fail500('req-lb-upland')(route);
    });
    await page.goto('/leaderboards/upland?board=proceeds');
    await expectErrorWithRetry(page, board(page), 'req-lb-upland', () => calls);
  });

  test('an empty payload renders the empty state with a way out', async ({ page }) => {
    await page.route(QUERY, json(emptyResult(['user_name', 'claimed', 'reward_upx'])));
    await page.goto('/leaderboards/upland?scope=today');
    await expect(board(page).getByText('Nobody on the treasures claimed board today')).toBeVisible();
    await board(page).getByRole('button', { name: 'Show last month' }).click();
    await expect(page).toHaveURL(/scope=month/);
  });

  test('fits a phone screen', async ({ page }) => {
    await page.goto('/leaderboards/upland');
    await expect(board(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
