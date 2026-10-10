import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Community & System pages (F-1904, F-1906 to F-1911): every built page
 * renders and fits a phone; the feedback form validates and runs pending,
 * error and success; troubleshoot checks show "checking" then a result; the
 * reset reports each step; the new player guide walks all four steps.
 */

// Playwright runs from apps/web (its config's directory).
const example = (name: string): string => readFileSync(path.resolve(process.cwd(), '../../packages/ledger/examples', `${name}.json`), 'utf8');

const PAGES: ReadonlyArray<[string, string]> = [
  ['/new-player', 'New player guide'],
  ['/changelog', 'Changelog'],
  ['/feedback', 'Feedback'],
  ['/about', 'About Embers'],
  ['/troubleshoot', 'Troubleshoot'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms of use'],
  ['/maintenance', 'Maintenance'],
];

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return Math.max(doc, main ? main.scrollWidth - main.clientWidth : 0);
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const [route, heading] of PAGES) {
  test(`${route} renders and fits the screen`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await noHorizontalScroll(page);
  });
}

test('the sidebar lists the Community and System pages in PRD order', async ({ page, isMobile }) => {
  await page.goto('/about');
  let nav = page.locator('nav').first();
  if (isMobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    nav = page.getByRole('dialog');
  }
  for (const name of ['New Player Guide', 'Changelog', 'Feedback', 'About', 'Troubleshoot', 'Privacy']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  if (!isMobile) await expect(nav.getByRole('link', { name: 'About', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('changelog: grouped by year with a count, entries link their routes', async ({ page }) => {
  await page.goto('/changelog');
  const y2026 = page.getByRole('region', { name: '2026' });
  await expect(y2026.getByText(/\d+ changes/)).toBeVisible();
  await expect(y2026.getByText('Sign in with GitHub')).toBeVisible();
  await y2026.getByRole('link', { name: 'Properties search' }).first().click();
  await expect(page).toHaveURL(/\/properties\/search/, { timeout: 30_000 });
});

/**
 * A stand-in for Cloudflare's Turnstile script: renders an "I am human"
 * button that hands the widget's callback a token. `fail` makes the script
 * request fail; `delayMs` holds it so the loading state can be seen.
 */
async function fakeTurnstile(page: Page, opts: { fail?: () => boolean; delayMs?: number } = {}): Promise<void> {
  await page.route('https://challenges.cloudflare.com/**', async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.fail?.()) return route.abort();
    return route.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile = {
        render(el, o) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'I am human';
          b.onclick = () => o.callback('human-token'); el.appendChild(b); return 'w1'; },
        reset() {}, remove() {},
      };`,
    });
  });
}

const passHumanCheck = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'I am human' }).click();
  await expect(page.getByText('Verified')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

const sendButton = (page: Page) => page.getByRole('button', { name: /Send feedback|Sending|Sent/ });

test('feedback: validation on Send, then per field as it is fixed', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/v1/feedback', (route) => {
    posts += 1;
    return route.fallback();
  });
  await page.goto('/feedback');
  await sendButton(page).click();
  await expect(page.getByText('Choose Bug, Improvement or Praise')).toBeVisible();
  await expect(page.getByText('Write your comment')).toBeVisible();
  await expect(page.getByText('Fix the highlighted fields first')).toBeVisible();
  expect(posts).toBe(0);

  await page.getByRole('radio', { name: 'Bug' }).click();
  await expect(page.getByText('Choose Bug, Improvement or Praise')).toHaveCount(0);
  await page.getByLabel('Comment *').fill('too short');
  await expect(page.getByText('At least 10 characters (9 so far)')).toBeVisible();
  await expect(page.getByLabel('Comment *')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Comment *').fill('Long enough now');
  await expect(page.getByText(/At least 10 characters/)).toHaveCount(0);
  await expect(page.getByText('15 / 4000 characters')).toBeVisible();
});

async function fillValid(page: Page): Promise<void> {
  await page.goto('/feedback');
  await page.getByLabel('Nickname (optional)').fill('tester');
  await page.getByRole('radio', { name: 'Improvement' }).click();
  await page.getByLabel('Comment *').fill('Please add a city filter to the guide.');
  await passHumanCheck(page);
}

test('feedback: pending, then success with the reference', async ({ page }) => {
  let body: unknown = null;
  await page.route('**/api/v1/feedback', async (route) => {
    body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 600));
    return route.fulfill({ status: 201, contentType: 'application/json', headers: { 'x-request-id': 'req-fb-1' }, body: JSON.stringify({ data: { reference: '#314' }, generated_at: new Date().toISOString() }) });
  });
  await fillValid(page);
  await sendButton(page).click();
  await expect(page.getByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-busy', 'true', { timeout: 100 });
  await expect(page.getByText('Thanks, your feedback was filed')).toBeVisible();
  await expect(page.getByText('#314')).toBeVisible();
  await expect(page.getByText('req-fb-1')).toBeVisible();
  expect(body).toEqual({ nickname: 'tester', type: 'Improvement', comment: 'Please add a city filter to the guide.', turnstile_token: 'human-token' });
  await page.getByRole('button', { name: 'Send more feedback' }).click();
  await expect(page.getByLabel('Comment *')).toHaveValue('');
});

test('feedback: a server error shows the reason and request id, and Retry sends again', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/v1/feedback', (route) => {
    calls += 1;
    return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'feedback_unavailable', message: 'The feedback inbox is unreachable.', request_id: 'req-fb-2', retryable: true } }) });
  });
  await fillValid(page);
  await sendButton(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The feedback inbox is unreachable. (request req-fb-2)' })).toBeVisible();
  await expect(page.getByText('Thanks, your feedback was filed')).toHaveCount(0);
  // The token was spent on the first send; the check asks again before Retry can send.
  await passHumanCheck(page);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => calls).toBe(2);
});

test('feedback: Send waits for the human check, and sends nothing until it passes', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/v1/feedback', (route) => {
    posts += 1;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { reference: '#1' } }) });
  });
  await page.goto('/feedback');
  await page.getByRole('radio', { name: 'Bug' }).click();
  await page.getByLabel('Comment *').fill('Long enough comment');
  await expect(page.getByText('Complete the check above to send.')).toBeVisible();
  await sendButton(page).click();
  await expect(page.getByText('Complete the human check first')).toBeVisible();
  expect(posts).toBe(0);
});

test('feedback: the human check shows loading, then a failure with Retry that loads it again', async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  let failing = true;
  await fakeTurnstile(page, { fail: () => failing, delayMs: 400 });
  await page.goto('/feedback');
  await expect(page.getByText('Loading the human check…')).toBeVisible();
  const alert = page.getByRole('alert').filter({ hasText: 'The human check is unavailable' });
  await expect(alert).toBeVisible();
  failing = false;
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Loading the human check…')).toBeVisible();
  await passHumanCheck(page);
});

test('feedback: the real server without an inbox says nothing was sent', async ({ page }) => {
  await fillValid(page);
  await sendButton(page).click();
  // The real route: on a cold dev server its first request also compiles it.
  await expect(page.getByRole('alert').filter({ hasText: 'nothing was sent' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Thanks, your feedback was filed')).toHaveCount(0);
});

test('feedback: a Report link prefills the type and names the page', async ({ page }) => {
  await page.goto('/feedback?type=Bug&page=%2Fproperties%2Fsearch');
  await expect(page.getByRole('radio', { name: 'Bug' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Reporting a problem on /properties/search')).toBeVisible();
});

const check = (page: Page, id: string) => page.locator(`[data-check="${id}"]`);

test('troubleshoot: the ledger check shows checking, then passed', async ({ page }) => {
  await page.route('**/bff/ledger/status*', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    return route.fallback();
  });
  await page.goto('/troubleshoot');
  await expect(check(page, 'ledger')).toHaveAttribute('data-status', 'running');
  await expect(check(page, 'ledger')).toContainText('Checking…');
  await expect(check(page, 'ledger')).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  await expect(check(page, 'ledger')).toContainText('The ledger answered');
  await expect(check(page, 'cookies')).toHaveAttribute('data-status', 'done');
  await expect(check(page, 'storage')).toHaveAttribute('data-status', 'done');
});

test('troubleshoot: a failing ledger shows failed with the reason; Run checks again re-reads', async ({ page }) => {
  let calls = 0;
  await page.route('**/bff/ledger/status*', (route) => {
    calls += 1;
    return route.fulfill({ status: 502, contentType: 'application/json', headers: { 'x-request-id': 'req-ts-1' }, body: JSON.stringify({ error: { code: 'ledger_unavailable', message: 'The ledger is unreachable.', request_id: 'req-ts-1', retryable: true } }) });
  });
  await page.goto('/troubleshoot');
  await expect(check(page, 'ledger')).toHaveAttribute('data-status', 'failed');
  await expect(check(page, 'ledger')).toContainText('req-ts-1');
  await page.getByRole('button', { name: 'Run checks again' }).click();
  await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
  await expect(check(page, 'ledger')).toHaveAttribute('data-status', 'failed');
});

test('troubleshoot: Clear local data asks first, reports each step, then offers a reload', async ({ page }) => {
  await page.goto('/troubleshoot');
  await page.evaluate(() => window.localStorage.setItem('embers:favorites', '[]'));
  await page.getByRole('button', { name: 'Clear local data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear local data?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear local data' }).click();
  await expect(page.getByText(/Removed \d+ items?\./)).toBeVisible();
  await expect(page.getByText('No caches.').or(page.getByText(/Deleted \d+ cache/))).toBeVisible();
  await expect(page.getByText('None registered.').or(page.getByText(/Removed \d+ service worker/))).toBeVisible();
  await expect(page.getByText('Done. Reload the page to start fresh.')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('embers:favorites'))).toBeNull();
  await page.getByRole('button', { name: 'Reload page' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Troubleshoot' })).toBeVisible();
});

test('new player guide: four steps, city list from the ledger, five cheapest listings', async ({ page }) => {
  await page.route('**/bff/ledger/market/cities*', async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    return route.fulfill({ status: 200, contentType: 'application/json', body: example('GET_market_cities') });
  });
  let listingsUrl = '';
  await page.route('**/bff/ledger/listings*', (route) => {
    listingsUrl = route.request().url();
    // The captured page's three listings, as the UPX book returns them.
    const body = JSON.parse(example('GET_listings')) as { data: Array<Record<string, unknown>> };
    const data = body.data.map((l, i) => ({ ...l, ask_upx: 1000 * (i + 1), ask_fiat: 0 }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, data }) });
  });
  await page.goto('/new-player');
  await expect(page.getByRole('region', { name: '1. Welcome' })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  const step2 = page.getByRole('region', { name: '2. Pick a city' });
  await expect(step2.locator('[aria-busy="true"]').first()).toBeVisible();
  await expect(step2.getByText('Choose a city first')).toBeVisible();
  await expect(step2.getByRole('cell', { name: 'Las Vegas' })).toBeVisible();
  await step2.getByLabel('Find a city').fill('zzz');
  await expect(step2.getByText('No city matches “zzz”.')).toBeVisible();
  await step2.getByRole('button', { name: 'Clear search' }).click();
  await step2.getByRole('row', { name: /Rome/ }).getByRole('button', { name: 'Choose' }).click();
  await expect(step2.getByRole('button', { name: 'Chosen' })).toBeVisible();
  await step2.getByRole('button', { name: 'Next', exact: true }).click();

  const step3 = page.getByRole('region', { name: '3. Cheapest properties' });
  await expect(step3.getByText('of the cheapest properties listed for UPX in Rome')).toBeVisible();
  await expect(step3.getByRole('button', { name: 'Copy address' })).toHaveCount(3);
  await expect(step3.getByRole('cell', { name: '150 SW 21ST RD' })).toBeVisible();
  expect(listingsUrl).toContain('limit=5');
  expect(listingsUrl).toContain('city=Rome');
  expect(listingsUrl).toContain('book=upx');
  expect(listingsUrl).toContain('sort=ask_upx');
  await step3.getByRole('button', { name: 'Next', exact: true }).click();

  const step4 = page.getByRole('region', { name: '4. Where next' });
  await expect(step4.getByRole('link', { name: 'play.upland.me' })).toBeVisible();
  await expect(step4.getByRole('link', { name: 'Properties search' })).toHaveAttribute('href', /city=Rome/);
});

test('new player guide: a failing city read shows the error with Retry', async ({ page }) => {
  await page.route('**/bff/ledger/market/cities*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', headers: { 'x-request-id': 'req-np-1' }, body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }) }),
  );
  await page.goto('/new-player');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('req-np-1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('maintenance: with the flag off, it says nothing is under maintenance', async ({ page }) => {
  await page.goto('/maintenance?from=%2Fproperties%2Fsearch');
  await expect(page.getByText('Nothing is under maintenance. Every page is available.')).toBeVisible();
});
