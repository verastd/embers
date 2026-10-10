import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * F-410 Property appraiser, PRD 5.9: the empty-initial state, picking a
 * property through the address search, the last-sale and mint-price bases
 * from the stub ledger, a loading indicator within 100 ms of Appraise under
 * Slow 3G, the error state for a 500, the "no estimate" state, a failed
 * rate read as a partial banner, and click-to-copy.
 */

const FIRST = { timeout: 60_000 };
// A cold dev server compiles each route on first visit, several at once under fullyParallel.
test.describe.configure({ timeout: 120_000 });
const ID = '81826746578110';

async function slow3g(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
}

const result = (page: Page) => page.getByRole('region', { name: 'Estimate' });

const PROPERTY = {
  property_id: ID,
  address: '2506 SEARSDALE AVE',
  city: 'Cleveland',
  region: 'OH',
  neighborhood: 'BUCKEYE',
  neighborhood_id: 7,
  mint_price_upx: 10_000,
  mint_price_source: 'chain',
  mint_kind: 'a44',
  api_status: 'Owned',
  minted_at: '2025-01-01T00:00:00.000Z',
  sales: 1,
  last_sale_upx: 29_999,
  last_sale_at: '2026-10-09T00:12:28.000Z',
  observations: 1,
  mint_band: 13,
  chain_known: true,
  upland_api: null,
};
function sale(id: string, mint: number, price: number) {
  return {
    timestamp: '2026-10-01T10:00:00.000Z',
    property_id: id,
    buyer: 'ymc55j4fboxi',
    seller: 'tlifor1bq435',
    trx_id: `${id}`.padEnd(64, 'a'),
    address: `${id.slice(-3)} TEST AVE`,
    city: 'Cleveland',
    neighborhood: 'BUCKEYE',
    mint_price_upx: mint,
    price_upx: price,
    buyer_paid_upx: price * 1.05,
    seller_proceeds_upx: price * 0.95,
    community_fee_upx: price * 0.1,
    price_to_mint: price / mint,
  };
}
const page_ = (rows: unknown[]) => JSON.stringify({ data: rows, count: rows.length, limit: 500, offset: 0, has_more: false });

test('before a pick: asks for a property, and reads nothing', async ({ page }) => {
  let reads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/bff/ledger/properties/')) reads += 1;
  });
  await page.goto('/tools/appraiser');
  await expect(result(page).getByText('Pick a property and press Appraise.')).toBeVisible(FIRST);
  await expect(page.getByText('BETA')).toBeVisible();
  expect(reads).toBe(0);
});

test('pick through the address search, Appraise, and the URL reproduces it', async ({ page }) => {
  await page.goto('/tools/appraiser');
  const box = page.getByRole('combobox', { name: 'Property' });
  await box.click();
  await box.fill('main');
  await page.getByRole('option', { name: /910 MAINLAND ST/ }).click();
  await page.getByRole('button', { name: 'Appraise', exact: true }).click();
  await expect(page).toHaveURL(/id=86707019253261/);
  // The stub answers every id with the captured property: no mint price, one sale.
  await expect(result(page).getByText('Basis: last sale price')).toBeVisible(FIRST);
  await page.reload();
  await expect(result(page).getByText('Basis: last sale price')).toBeVisible(FIRST);
});

test('without a mint price the basis is the last sale, in UPX and USD', async ({ page }) => {
  await page.goto(`/tools/appraiser?id=${ID}`);
  await expect(result(page).getByText('Basis: last sale price')).toBeVisible(FIRST);
  await expect(result(page).getByText('Low confidence')).toBeVisible();
  await expect(result(page).getByText('29,999 UPX').first()).toBeVisible();
  await expect(result(page).getByText(/^\$\d+\.\d\d$/).first()).toBeVisible();
  await expect(result(page).getByText('Excludes Upland fees').first()).toBeVisible();
});

test('with a mint price: the mint-price model from neighborhood comparables, the extra percentage and the floor', async ({ page }) => {
  await page.route(`**/bff/ledger/properties/${ID}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROPERTY) }));
  await page.route('**/bff/ledger/sales?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: page_([sale('100000000000001', 10_000, 15_000), sale('100000000000002', 12_000, 24_000), sale('100000000000003', 9_000, 27_000)]) }),
  );
  await page.route('**/bff/ledger/listings?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ timestamp: '2026-10-09T00:00:00.000Z', property_id: '5', seller: 'abc', address: 'x', city: 'Cleveland', neighborhood: 'BUCKEYE', mint_price_upx: 10_000, ask_upx: 25_000, ask_fiat: 0, ask_to_mint: 2.5 }], count: 1, limit: 1, offset: 0, has_more: false }) }),
  );
  await page.goto(`/tools/appraiser?id=${ID}`);
  await expect(result(page).getByText('Mint-price model, 3 neighborhood comparables')).toBeVisible(FIRST);
  // Median of 1.5×, 2× and 3× is 2× the 10,000 UPX mint.
  await expect(result(page).getByText('20,000 UPX').first()).toBeVisible();
  await expect(result(page).getByText(/Below the neighborhood floor \(25,000 UPX\)/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Comparables' }).locator('tbody tr')).toHaveCount(3);
  await page.getByRole('spinbutton', { name: 'Extra' }).fill('10');
  await page.getByRole('spinbutton', { name: 'Extra' }).blur();
  await expect(result(page).getByText('22,000 UPX')).toBeVisible();
});

test('reads every page of the comparable window, with progress, and finds a close match on page 2', async ({ page }) => {
  // Page 1: 1,000 sales with no known mint price (no use as comparables). Page 2: three real comparables.
  const far = Array.from({ length: 1000 }, (_, i) => ({ ...sale(String(200000000000000 + i), 10_000, 90_000), mint_price_upx: 0, price_to_mint: 0 }));
  const near = [sale('100000000000001', 10_000, 15_000), sale('100000000000002', 10_000, 20_000), sale('100000000000003', 10_000, 25_000)];
  const offsets: string[] = [];
  let release: () => void = () => undefined;
  const secondPage = new Promise<void>((r) => (release = r));
  await page.route(`**/bff/ledger/properties/${ID}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROPERTY) }));
  await page.route('**/bff/ledger/sales?*', async (route) => {
    const q = new URL(route.request().url()).searchParams;
    offsets.push(q.get('offset') ?? '0');
    expect(q.get('limit')).toBe('1000');
    if ((q.get('offset') ?? '0') === '0') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: far, count: 1000, limit: 1000, offset: 0, has_more: true }) });
    await secondPage;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: near, count: 3, limit: 1000, offset: 1000, has_more: false }) });
  });
  await page.goto(`/tools/appraiser?id=${ID}`);
  await expect(result(page).getByText('Reading sales… 1,000')).toBeVisible(FIRST);
  release();
  await expect(result(page).getByText('Mint-price model, 3 neighborhood comparables')).toBeVisible();
  await expect(result(page).getByText('20,000 UPX').first()).toBeVisible();
  expect(offsets).toEqual(['0', '1000']);
});

test('Slow 3G: a loading indicator appears within 100 ms of Appraise', async ({ page }) => {
  await page.goto('/tools/appraiser');
  const box = page.getByRole('combobox', { name: 'Property' });
  await box.click();
  await box.fill('main');
  await page.getByRole('option', { name: /910 MAINLAND ST/ }).click();
  await slow3g(page);
  await page.getByRole('button', { name: 'Appraise', exact: true }).click();
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 100 });
  await expect(result(page).getByText('Basis: last sale price')).toBeVisible({ timeout: 30_000 });
});

test('a 500 renders the error state with code, request id and Retry', async ({ page }) => {
  let calls = 0;
  await page.route(`**/bff/ledger/properties/${ID}`, (route) => {
    calls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'x-request-id': 'req-e2e-appraise' }, body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }) });
  });
  await page.goto(`/tools/appraiser?id=${ID}`);
  const alert = result(page).getByRole('alert');
  await expect(alert).toContainText('500 internal_error', FIRST);
  await expect(alert).toContainText('request req-e2e-appraise');
  const before = calls;
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => calls).toBeGreaterThan(before);
});

test('nothing to go on renders the empty state with a way out', async ({ page }) => {
  await page.route(`**/bff/ledger/properties/${ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...PROPERTY, mint_price_upx: 0, last_sale_upx: 0, last_sale_at: null, sales: 0 }) }),
  );
  await page.goto(`/tools/appraiser?id=${ID}`);
  await expect(result(page).getByText(/^No estimate:/)).toBeVisible(FIRST);
  await result(page).getByRole('button', { name: 'Appraise another property' }).click();
  await expect(page).not.toHaveURL(/id=/);
  await expect(result(page).getByText('Pick a property and press Appraise.')).toBeVisible();
});

test('an unknown property id says so', async ({ page }) => {
  await page.route(`**/bff/ledger/properties/1`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'no property' } }) }));
  await page.goto('/tools/appraiser?id=1');
  await expect(result(page).getByText('The ledger has no property with that id.')).toBeVisible(FIRST);
});

test('a failed rate read keeps the UPX estimate under a partial banner with Retry', async ({ page }) => {
  let fail = true;
  await page.route('**/bff/ledger/market/upx-usd?*', (route) =>
    fail ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ledger_unavailable', message: 'down' } }) }) : route.fallback(),
  );
  await page.goto(`/tools/appraiser?id=${ID}`);
  const banner = result(page).getByRole('status').filter({ hasText: 'UPX/USD rate' });
  await expect(banner).toBeVisible(FIRST);
  await expect(result(page).getByText('29,999 UPX').first()).toBeVisible();
  fail = false;
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect(banner).toHaveCount(0);
  await expect(result(page).getByText(/^\$\d+\.\d\d$/).first()).toBeVisible();
});

test('click-to-copy puts the price on the clipboard and says Copied', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'Clipboard permissions are granted on desktop Chrome only');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/tools/appraiser?id=${ID}`);
  await expect(result(page).getByText('29,999 UPX').first()).toBeVisible(FIRST);
  await page.getByRole('button', { name: 'Copy Estimated value in UPX' }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('29999');
});

test('the page fits a phone', async ({ page }) => {
  await page.goto(`/tools/appraiser?id=${ID}`);
  await expect(result(page).getByText('Basis: last sale price')).toBeVisible(FIRST);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
