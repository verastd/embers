import { COOKIE, sealSession } from '@embers/auth';
import { expect, test } from '@playwright/test';

import { E2E_SESSION_SECRET } from '../playwright.config';

/**
 * GitHub sign-in (F-301 per TD): the start redirect, refused callbacks, the
 * signed-in account menu and sign-out. GitHub's token exchange is covered by
 * @embers/auth's unit tests; nothing here talks to github.com.
 */

test('signed out: the top bar offers Sign in with GitHub, returning to this page', async ({ page }) => {
  await page.goto('/properties/search');
  const link = page.getByRole('link', { name: 'Sign in with GitHub' });
  await expect(link).toHaveAttribute('href', '/auth/signin?next=%2Fproperties%2Fsearch');
});

test('the sign-in link itself carries the page’s filters, and follows them as they change (Codex review on #3, #4)', async ({ page }) => {
  await page.goto('/properties/search?search=1&address=SEARSDALE');
  const link = page.getByRole('link', { name: 'Sign in with GitHub' });
  // The href itself, so middle-click, new tab and copied links all keep the filters.
  await expect(link).toHaveAttribute('href', '/auth/signin?next=%2Fproperties%2Fsearch%3Fsearch%3D1%26address%3DSEARSDALE');
  // Filters change through history.replaceState; the href follows.
  await page.getByLabel('Address contains').fill('210TH');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(link).toHaveAttribute('href', /next=%2Fproperties%2Fsearch%3F.*address%3D210TH/);
});

test('/auth/signin redirects to GitHub with state, PKCE S256 and our callback, and sets the attempt cookie', async ({ request }) => {
  // Redirects off: the test checks where it would go, and never contacts github.com.
  const res = await request.get('/auth/signin?next=/properties/search', { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()['cache-control']).toBe('no-store');
  const url = new URL(res.headers().location ?? '');
  expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
  expect(url.searchParams.get('client_id')).toBe('Iv1.e2e0000000000000');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3410/auth/callback');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
  expect(url.searchParams.get('state')).toMatch(/.{20,}/);
  const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value).join('\n');
  expect(setCookie).toContain(`${COOKIE.transaction(false)}=`);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=lax/i);
});

test('a callback without its attempt cookie is refused, and the login page says why', async ({ page }) => {
  await page.goto('/auth/callback?code=abc&state=xyz');
  await expect(page).toHaveURL(/\/auth\/login\?error=expired/);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('That sign-in attempt expired after 10 minutes. Start again.');
  await expect(page.getByRole('link', { name: 'Try again with GitHub' })).toHaveAttribute('href', '/auth/signin?next=%2F');
});

test('a callback whose state does not match is refused', async ({ page, context, request }) => {
  // Start an attempt without following it to GitHub, then hand its cookie to the browser.
  const start = await request.get('/auth/signin', { maxRedirects: 0 });
  const raw = start.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? '';
  const value = raw.split(';')[0]?.split('=').slice(1).join('=') ?? '';
  await context.addCookies([{ name: COOKIE.transaction(false), value, url: 'http://localhost:3410', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('/auth/callback?code=abc&state=not-the-state');
  await expect(page).toHaveURL(/\/auth\/login\?error=state/);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('didn’t match this browser');
});

test('signed in: the account menu shows the login, and Sign out ends the session', async ({ page, context }) => {
  const token = await sealSession({ sub: '4242', login: 'td-e2e', name: 'TD', avatarUrl: null, demo: false }, E2E_SESSION_SECRET);
  await context.addCookies([{ name: COOKIE.session(false), value: token, url: 'http://localhost:3410', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('/properties/search');
  const trigger = page.getByRole('button', { name: /td-e2e/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu).toContainText('Signed in with GitHub as td-e2e');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  const cookies = await context.cookies('http://localhost:3410');
  expect(cookies.find((c) => c.name === COOKIE.session(false))?.value ?? '').toBe('');
});

test('sign-out from another site is refused', async ({ request }) => {
  const res = await request.post('/auth/signout', { headers: { origin: 'https://evil.example' }, maxRedirects: 0 });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe('bad_origin');
});
