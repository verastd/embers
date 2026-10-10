import { expect as baseExpect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { emptyCursor, emptyPage, expectErrorWithRetry, expectNoHorizontalScroll, fail500, json, slow3g } from './helpers';

// The dev server compiles each route on first visit; on a busy machine that
// takes a while. The 100 ms loading checks pass their own timeout.
const expect = baseExpect.configure({ timeout: 20_000 });
test.setTimeout(120_000);

/**
 * F-201 User search and F-202 User profile, PRD 5.9 + 12: data from the stub
 * ledger through the BFF, a loading indicator within 100 ms under Slow 3G,
 * the error state for a 500, the empty state for an empty payload, and
 * not-found for an unknown user.
 */

const results = (page: Page) => page.getByRole('region', { name: 'Results' });
const searchButton = (page: Page) => page.getByRole('button', { name: 'Search', exact: true });
const sections = (page: Page) => page.locator('section[aria-labelledby="sections-title"]');

test.describe('F-201 user search', () => {
  test('before the first search: "Set filters and press Search"', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { level: 1, name: 'User search' })).toBeVisible();
    await expect(results(page).getByText('Set filters and press Search')).toBeVisible();
  });

  test('Search lists accounts from the ledger, linking to their profiles; the URL reproduces it', async ({ page }) => {
    const seen: URLSearchParams[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/bff/ledger/accounts?')) seen.push(new URL(r.url()).searchParams);
    });
    await page.goto('/users');
    await page.getByRole('textbox', { name: 'Username' }).fill('freaky');
    await searchButton(page).click();
    await expect(page).toHaveURL(/q=freaky/);
    await expect(results(page).getByRole('link', { name: 'freakyman51' })).toBeVisible();
    await expect(results(page).getByText('Likely bot').first()).toBeVisible();
    expect(seen.at(-1)?.get('username')).toBe('freaky');
    expect(seen.at(-1)?.get('named')).toBe('true');
    const profile = results(page).getByRole('link', { name: 'krypticking' });
    await expect(profile).toHaveAttribute('href', '/users/krypticking');
    await profile.click();
    // The profile route compiles on first visit in dev.
    await expect(page).toHaveURL(/\/users\/krypticking$/, { timeout: 60_000 });
  });

  test('Slow 3G: a loading indicator appears within 100 ms of Search', async ({ page }) => {
    await page.goto('/users');
    await expect(searchButton(page)).toBeVisible();
    await slow3g(page);
    await searchButton(page).click();
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
    await expect(results(page).getByRole('link', { name: 'krypticking' })).toBeVisible({ timeout: 30_000 });
  });

  test('a 500 renders the error state with the reason, request id and Retry', async ({ page }) => {
    let calls = 0;
    await page.route('**/bff/ledger/accounts?*', (route) => {
      calls += 1;
      return fail500('req-users-1')(route);
    });
    await page.goto('/users?search=1');
    await expectErrorWithRetry(page, results(page), 'req-users-1', () => calls);
  });

  test('an empty payload renders the empty state with Reset filters', async ({ page }) => {
    await page.route('**/bff/ledger/accounts?*', json(emptyPage));
    await page.goto('/users?search=1&q=zzzz');
    await expect(results(page).getByText('No users match “zzzz”')).toBeVisible();
    await results(page).getByRole('button', { name: 'Reset filters' }).click();
    await expect(page).not.toHaveURL(/q=/);
  });

  test('the top bar search offers users and opens their profile', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The phone top bar opens search differently; the rows are unit-tested.');
    await page.goto('/users');
    await page.getByRole('combobox').first().fill('main');
    const row = page.getByRole('option', { name: /multimaine/ });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/users\/multimaine$/);
  });

  test('fits a phone screen', async ({ page }) => {
    await page.goto('/users?search=1');
    await expect(results(page).getByRole('link', { name: 'krypticking' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

const ACCOUNT_ROW = {
  account: 'ymc55j4fboxi',
  username: 'kingbo',
  usernames: ['kingbo'],
  username_changes: 1,
  first_seen: '2026-01-01T03:26:16.000Z',
  last_seen: '2026-10-09T00:12:28.000Z',
  active_days: 5,
  events: 40,
  buys: 0,
  sells: 1,
  upx_spent: 0,
  upx_received: 33250,
  median_buy_latency_s: 0,
  sub_5s_buys: 0,
  pct_buys_under_1m: 0,
  likely_bot: false,
  upx_net: 33250,
};

const HOLDING = {
  property_id: '81826746578110',
  address: '2506 SEARSDALE AVE',
  city: 'Cleveland',
  region: 'OH',
  neighborhood: 'Glenville',
  neighborhood_id: 1,
  mint_price_upx: 10000,
  mint_price_source: 'api',
  mint_kind: '',
  api_status: 'Owned',
  minted_at: null,
  sales: 1,
  last_sale_upx: 29999,
  last_sale_at: '2026-10-09T00:12:28.000Z',
  observations: 1,
  mint_band: 13,
  owner_account: 'ymc55j4fboxi',
  owner_username: 'kingbo',
  owner_since: '2026-10-09T00:12:28.000Z',
  owner_seen_at: '2026-10-09T00:12:28.000Z',
  owner_source: 'property_sale',
  listed: true,
  ask_upx: 45000,
  ask_fiat: null,
  ask_currency: 'upx',
  ask_to_mint: 4.5,
  listed_at: '2026-10-09T10:00:00.000Z',
};

test.describe('F-202 user profile', () => {
  test('resolves a username and shows the profile, tiles and tabs from the ledger', async ({ page }) => {
    const ownerQueries: URLSearchParams[] = [];
    await page.route('**/bff/ledger/properties?*', (route) => {
      ownerQueries.push(new URL(route.request().url()).searchParams);
      return json({ data: [HOLDING], count: 1, limit: 50, offset: 0, has_more: false })(route);
    });
    await page.goto('/users/kingbo');
    await expect(page.getByRole('heading', { level: 1, name: 'kingbo' })).toBeVisible();
    const profile = page.locator('section[aria-labelledby="profile-title"]');
    await expect(profile.getByText('ymc55j4fboxi').first()).toBeVisible();
    await expect(profile.getByText('Yield income')).toBeVisible();
    await expect(profile.getByText('1,501 UPX')).toBeVisible();
    await expect(profile.getByText('33,250 UPX').first()).toBeVisible();

    // Properties (default tab): holdings by owner.
    await expect(sections(page).getByText('2506 SEARSDALE AVE')).toBeVisible();
    expect(ownerQueries.at(-1)?.get('owner')).toBe('ymc55j4fboxi');

    // Transactions: the stub's sales.
    await sections(page).getByRole('radio', { name: 'Transactions' }).click();
    await expect(page).toHaveURL(/tab=transactions/);
    await expect(sections(page).getByText('2506 SEARSDALE AVE, Cleveland')).toBeVisible();
    await sections(page).getByRole('radio', { name: 'Sold' }).click();
    await expect(page).toHaveURL(/side=sold/);

    // Activity: raw chain actions, with the memo as the detail.
    await sections(page).getByRole('radio', { name: 'Activity' }).click();
    await expect(sections(page).getByText('playuplandme · n5').first()).toBeVisible();
    await expect(sections(page).getByText(/notarizes that Upland user kingbo/).first()).toBeVisible();

    // Market: open listings.
    await sections(page).getByRole('radio', { name: 'Market' }).click();
    await expect(sections(page).getByText('45,000 UPX')).toBeVisible();
    expect(ownerQueries.at(-1)?.get('listed')).toBe('true');
  });

  test('a ledger without owner lookups says so instead of listing other people’s properties', async ({ page }) => {
    await page.goto('/users/kingbo');
    await expect(sections(page).getByText(/not been updated to look up properties by owner/)).toBeVisible();
    await expect(sections(page).getByText('2506 SEARSDALE AVE')).toHaveCount(0);
  });

  test('Slow 3G: a loading indicator appears within 100 ms of switching tabs', async ({ page }) => {
    await page.goto('/users/kingbo');
    await expect(page.getByRole('heading', { level: 1, name: 'kingbo' })).toBeVisible();
    await expect(sections(page).getByRole('radio', { name: 'Transactions' })).toBeVisible();
    await slow3g(page);
    await sections(page).getByRole('radio', { name: 'Transactions' }).click();
    await expect(sections(page).locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
    await expect(sections(page).getByText('2506 SEARSDALE AVE, Cleveland')).toBeVisible({ timeout: 30_000 });
  });

  test('a 500 on the profile renders the error state with Retry', async ({ page }) => {
    let calls = 0;
    await page.route('**/bff/ledger/accounts/ymc55j4fboxi', (route) => {
      calls += 1;
      return fail500('req-profile-1')(route);
    });
    await page.route('**/bff/ledger/accounts?*', json({ ...emptyPage, data: [] }));
    await page.goto('/users/ymc55j4fboxi');
    await expectErrorWithRetry(page, page.locator('section[aria-labelledby="profile-title"]'), 'req-profile-1', () => calls);
    await expect(page.locator('section[aria-labelledby="profile-title"]').getByText('Failed to load').first()).toBeVisible();
  });

  test('a 500 in a tab renders that tab’s error state with Retry', async ({ page }) => {
    let calls = 0;
    await page.route('**/bff/ledger/sales?*', (route) => {
      calls += 1;
      return fail500('req-sales-1')(route);
    });
    await page.goto('/users/kingbo?tab=transactions');
    await expectErrorWithRetry(page, sections(page), 'req-sales-1', () => calls);
  });

  test('empty tabs say so, with a way out', async ({ page }) => {
    await page.route('**/bff/ledger/sales?*', json(emptyPage));
    await page.route('**/bff/ledger/accounts/*/actions?*', json({ ...emptyCursor, account: 'ymc55j4fboxi', role: 'receiver' }));
    await page.goto('/users/kingbo?tab=transactions');
    await expect(sections(page).getByText('kingbo has no property purchases on record')).toBeVisible();
    await page.goto('/users/kingbo?tab=activity&role=receiver');
    await expect(sections(page).getByText('No received actions for kingbo')).toBeVisible();
    await sections(page).getByRole('button', { name: 'Show signed actions' }).click();
    await expect(page).not.toHaveURL(/role=/);
  });

  test('an unknown username shows not-found with a way back to search', async ({ page }) => {
    await page.route('**/bff/ledger/accounts?*', json(emptyPage));
    await page.goto('/users/No_Such_User');
    await expect(page.getByRole('heading', { level: 1, name: 'User not found' })).toBeVisible();
    await expect(page.getByText(/No Upland player currently uses the username “No_Such_User”\. Earlier usernames can’t be searched yet/)).toBeVisible();
    await page.getByRole('button', { name: 'Search users' }).click();
    await expect(page).toHaveURL(/\/users\?search=1&q=No_Such_User$/);
  });

  test('a short name with more substring matches than the lookup reads says the search was cut short', async ({ page }) => {
    // The stub ignores offset and always has more: the lookup reads its 10-page cap.
    await page.goto('/users/zz_');
    await expect(page.getByText(/No exact match for “zz_” among the first 30 usernames that contain it\. Try a longer name\./)).toBeVisible();
  });

  test('finds an exact username past the first page of substring matches', async ({ page }) => {
    const offsets: string[] = [];
    const fillers = Array.from({ length: 100 }, (_, i) => ({ ...ACCOUNT_ROW, account: `filler${i}`.slice(0, 12), username: `kingbo${i}`, usernames: [`kingbo${i}`] }));
    await page.route('**/bff/ledger/accounts?*', (route) => {
      const offset = new URL(route.request().url()).searchParams.get('offset') ?? '0';
      offsets.push(offset);
      const data = offset === '0' ? fillers : [{ ...ACCOUNT_ROW, account: 'ymc55j4fboxi', username: 'KingBo', usernames: ['KingBo'] }];
      return json({ data, count: data.length, limit: 100, offset: Number(offset), has_more: offset === '0' })(route);
    });
    await page.goto('/users/kingbo');
    await expect(page.locator('section[aria-labelledby="profile-title"]').getByText('ymc55j4fboxi').first()).toBeVisible();
    expect(offsets).toEqual(['0', '100']);
  });

  test('an account-shaped name the ledger does not know shows not-found', async ({ page }) => {
    await page.route('**/bff/ledger/accounts?*', json(emptyPage));
    await page.route('**/bff/ledger/accounts/nosuchacct12', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'account not found' } }) }),
    );
    await page.goto('/users/nosuchacct12');
    await expect(page.getByRole('heading', { level: 1, name: 'User not found' })).toBeVisible();
  });

  test('fits a phone screen', async ({ page }) => {
    await page.goto('/users/kingbo?tab=activity');
    await expect(sections(page).getByText('playuplandme · n5').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
