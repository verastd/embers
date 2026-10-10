import type { CityDay } from '@embers/ledger';
import { describe, expect, it, vi } from 'vitest';

import { CHANGELOG, groupByYear } from './changelog';
import { parseFeedback, safePagePath, validateFeedback } from './feedback';
import { FeedbackSendError, sendFeedback } from './feedback-client';
import { isMaintenanceActive, isUnderMaintenance, readMaintenance } from './maintenance';
import { latestPerCity, matchesCity, propertySearchHref } from './new-player';
import { checkCookies, checkStorage, clearCaches, clearLocalStorage, unregisterServiceWorkers } from './troubleshoot';

describe('feedback validation (F-1907)', () => {
  it('needs a type and a comment of at least 10 characters', () => {
    expect(validateFeedback({ nickname: '', type: '', comment: '' })).toEqual({ type: 'Choose Bug, Improvement or Praise', comment: 'Write your comment' });
    expect(validateFeedback({ type: 'Bug', comment: '  short  ' }).comment).toBe('At least 10 characters (5 so far)');
    expect(validateFeedback({ type: 'Praise', comment: 'Ten chars!' })).toEqual({});
    expect(validateFeedback({ type: 'Bug', comment: 'x'.repeat(4001) }).comment).toMatch(/At most 4000/);
  });
  it('limits the nickname', () => {
    expect(validateFeedback({ nickname: 'n'.repeat(41), type: 'Bug', comment: 'long enough text' }).nickname).toMatch(/at most 40/);
    expect(validateFeedback({ nickname: 3, type: 'Bug', comment: 'long enough text' }).nickname).toBe('Nickname must be text');
  });
  it('parses and trims a good body, keeps only same-origin page paths', () => {
    expect(parseFeedback({ nickname: ' ann ', type: 'Bug', comment: ' it broke on load ', page: '/properties/search?x=1' })).toEqual({
      ok: true,
      value: { nickname: 'ann', type: 'Bug', comment: 'it broke on load', page: '/properties/search?x=1' },
    });
    expect(parseFeedback({ type: 'Bug', comment: 'it broke on load', page: 'https://evil.example' })).toMatchObject({ ok: false, errors: { page: expect.any(String) } });
    expect(parseFeedback(null)).toMatchObject({ ok: false });
    expect(parseFeedback([])).toMatchObject({ ok: false });
    expect(parseFeedback({ type: 'Bug', comment: 'it broke on load' })).toEqual({ ok: true, value: { nickname: '', type: 'Bug', comment: 'it broke on load' } });
  });
  it('safePagePath refuses protocol-relative, long and odd paths', () => {
    expect(safePagePath('//evil.example')).toBeUndefined();
    expect(safePagePath('/a b')).toBeUndefined();
    expect(safePagePath(`/${'a'.repeat(300)}`)).toBeUndefined();
    expect(safePagePath(5)).toBeUndefined();
    expect(safePagePath('/ok')).toBe('/ok');
  });
});

describe('sendFeedback', () => {
  const input = { nickname: '', type: 'Bug' as const, comment: 'it broke on load' };
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }));

  it('resolves with the reference on 201', async () => {
    vi.stubGlobal('fetch', respond(201, { data: { reference: '#12' } }, { 'x-request-id': 'r1' }));
    await expect(sendFeedback(input)).resolves.toEqual({ reference: '#12', requestId: 'r1' });
  });
  it('rejects with the server reason, code, request id and field errors', async () => {
    vi.stubGlobal('fetch', respond(503, { error: { code: 'feedback_not_configured', message: 'Not connected', request_id: 'r2' } }));
    await expect(sendFeedback(input)).rejects.toMatchObject({ code: 'feedback_not_configured', message: 'Not connected', requestId: 'r2' });
    vi.stubGlobal('fetch', respond(400, { error: { code: 'validation_error', message: 'Fix', fields: { comment: 'bad' } } }));
    await expect(sendFeedback(input)).rejects.toMatchObject({ fields: { comment: 'bad' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(sendFeedback(input)).rejects.toMatchObject({ code: 'http_502', message: 'Embers answered HTTP 502' });
  });
  it('maps network failures and aborts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(sendFeedback(input)).rejects.toBeInstanceOf(FeedbackSendError);
    const ctrl = new AbortController();
    ctrl.abort();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('aborted'))));
    await expect(sendFeedback(input, ctrl.signal)).rejects.toMatchObject({ code: 'timeout', message: 'Timed out' });
    vi.unstubAllGlobals();
  });
});

describe('maintenance flag (F-1911)', () => {
  it('is off unless routes are named', () => {
    const flag = readMaintenance({});
    expect(isMaintenanceActive(flag)).toBe(false);
    expect(isUnderMaintenance('/properties/search', flag)).toBe(false);
  });
  it('matches a prefix and the pages under it, not lookalikes', () => {
    const flag = readMaintenance({ EMBERS_MAINTENANCE_ROUTES: ' /properties/ , bad, //x, /users', EMBERS_MAINTENANCE_MESSAGE: '  Back at 18:00 UTC ' });
    expect(flag).toEqual({ all: false, prefixes: ['/properties', '/users'], message: 'Back at 18:00 UTC' });
    expect(isUnderMaintenance('/properties', flag)).toBe(true);
    expect(isUnderMaintenance('/properties/search', flag)).toBe(true);
    expect(isUnderMaintenance('/propertiesx', flag)).toBe(false);
    expect(isUnderMaintenance('/about', flag)).toBe(false);
  });
  it('* covers every page but never the maintenance page, auth, BFF or API', () => {
    const flag = readMaintenance({ EMBERS_MAINTENANCE_ROUTES: '*' });
    expect(isMaintenanceActive(flag)).toBe(true);
    expect(isUnderMaintenance('/', flag)).toBe(true);
    for (const p of ['/maintenance', '/auth/login', '/bff/ledger/status', '/api/v1/feedback']) expect(isUnderMaintenance(p, flag)).toBe(false);
    expect(isUnderMaintenance('/anything', readMaintenance({ EMBERS_MAINTENANCE_ROUTES: '/' }))).toBe(true);
  });
  it('caps the message', () => {
    expect(readMaintenance({ EMBERS_MAINTENANCE_ROUTES: '*', EMBERS_MAINTENANCE_MESSAGE: 'x'.repeat(400) }).message).toHaveLength(280);
  });
});

describe('changelog (F-1906)', () => {
  it('groups newest year first and keeps same-day order', () => {
    const e = (date: string, title: string) => ({ date, title, detail: '', features: [], routes: [] });
    const years = groupByYear([e('2025-01-02', 'a'), e('2026-03-01', 'b'), e('2026-03-01', 'c'), e('2026-05-01', 'd')]);
    expect(years.map((y) => [y.year, y.entries.map((x) => x.title)])).toEqual([
      ['2026', ['d', 'b', 'c']],
      ['2025', ['a']],
    ]);
  });
  it('every entry has a valid day and only in-app routes', () => {
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const r of e.routes) expect(r.href.startsWith('/')).toBe(true);
    }
  });
});

describe('new player guide (F-1904)', () => {
  const day = (city: string, d: string, ask: number | null): CityDay =>
    ({ day: d, city, sales: 1, volume_upx: 0, median_sale_upx: null, median_ask_upx: ask, median_ask_usd: null, listings_new: 0, listings_removed: 0, mints: 0, median_mint_upx: null, median_sale_to_mint: null, yield_payout_upx: 0, distinct_buyers: 0, distinct_sellers: 0 }) as CityDay;
  it('keeps each city’s latest day, cheapest median ask first, no-ask cities last', () => {
    const rows = latestPerCity([day('Rome', '2026-10-07', 10), day('Rome', '2026-10-08', 50), day('Fresno', '2026-10-08', 20), day('Detroit', '2026-10-08', null), day('Bronx', '2026-10-08', null), day('', '2026-10-08', 1)]);
    expect(rows.map((r) => [r.city, r.median_ask_upx])).toEqual([
      ['Fresno', 20],
      ['Rome', 50],
      ['Bronx', null],
      ['Detroit', null],
    ]);
  });
  it('filters cities ignoring case and accents', () => {
    expect(matchesCity('São Paulo', 'sao')).toBe(true);
    expect(matchesCity('Rome', '')).toBe(true);
    expect(matchesCity('Rome', 'xyz')).toBe(false);
  });
  it('links an address to Properties search', () => {
    expect(propertySearchHref('1 Main St', 'Fresno')).toBe('/properties/search?search=1&city=Fresno&address=1+Main+St');
  });
});

describe('troubleshoot (F-1909)', () => {
  const memory = (): Storage => {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k) => m.get(k) ?? null,
      key: (i) => [...m.keys()][i] ?? null,
      removeItem: (k) => void m.delete(k),
      setItem: (k, v) => void m.set(k, v),
    };
  };
  it('checks cookies', () => {
    expect(checkCookies({ cookieEnabled: true }).ok).toBe(true);
    expect(checkCookies({ cookieEnabled: false }).ok).toBe(false);
    expect(checkCookies(undefined).ok).toBe(false);
  });
  it('checks storage, including blocked and missing storage', () => {
    expect(checkStorage(() => memory()).ok).toBe(true);
    expect(checkStorage(() => undefined).ok).toBe(false);
    expect(
      checkStorage(() => {
        throw new Error('SecurityError');
      }).ok,
    ).toBe(false);
    const forgetful = { ...memory(), getItem: () => null } as Storage;
    expect(checkStorage(() => forgetful).ok).toBe(false);
  });
  it('clears local storage and reports the count', () => {
    const s = memory();
    s.setItem('a', '1');
    s.setItem('b', '2');
    expect(clearLocalStorage(() => s)).toEqual({ status: 'done', detail: 'Removed 2 items.' });
    expect(clearLocalStorage(() => s)).toEqual({ status: 'skipped', detail: 'Nothing stored.' });
    expect(clearLocalStorage(() => undefined).status).toBe('skipped');
    expect(
      clearLocalStorage(() => {
        throw new Error('x');
      }).status,
    ).toBe('error');
  });
  it('deletes caches', async () => {
    const caches = (keys: string[], ok = true) => ({ keys: async () => keys, delete: async () => ok }) as unknown as CacheStorage;
    expect(await clearCaches(caches(['a']))).toEqual({ status: 'done', detail: 'Deleted 1 cache.' });
    expect(await clearCaches(caches([]))).toEqual({ status: 'skipped', detail: 'No caches.' });
    expect((await clearCaches(caches(['a', 'b'], false))).status).toBe('error');
    expect((await clearCaches(undefined)).status).toBe('skipped');
    expect((await clearCaches({ keys: async () => Promise.reject(new Error('x')) } as unknown as CacheStorage)).status).toBe('error');
  });
  it('removes service workers', async () => {
    const reg = (ok: boolean) => ({ unregister: async () => ok }) as unknown as ServiceWorkerRegistration;
    expect(await unregisterServiceWorkers({ getRegistrations: async () => [reg(true), reg(true)] })).toEqual({ status: 'done', detail: 'Removed 2 service workers.' });
    expect((await unregisterServiceWorkers({ getRegistrations: async () => [] })).status).toBe('skipped');
    expect((await unregisterServiceWorkers({ getRegistrations: async () => [reg(false)] })).status).toBe('error');
    expect((await unregisterServiceWorkers({ getRegistrations: async () => Promise.reject(new Error('x')) })).status).toBe('error');
    expect((await unregisterServiceWorkers(undefined)).status).toBe('skipped');
  });
});
