import { describe, expect, it, vi } from 'vitest';

import { LIMITS, errorBody, forward, gatewayError, isAllowed, isGatewayError, ledgerBaseUrl } from './ledger-gateway';

const ok = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

describe('allowlist', () => {
  it('matches literal and parameter segments exactly', () => {
    expect(isAllowed('GET', ['status'])).toBe(true);
    expect(isAllowed('GET', ['properties', '81826746578110', 'history'])).toBe(true);
    expect(isAllowed('GET', ['accounts', 'ymc55j4fboxi'])).toBe(true);
    expect(isAllowed('GET', ['transactions', 'a'.repeat(64)])).toBe(true);
    expect(isAllowed('POST', ['analytics', 'query'])).toBe(true);
  });

  it('refuses unknown routes, wrong methods, bad parameters and extra segments', () => {
    expect(isAllowed('GET', ['health'])).toBe(false);
    expect(isAllowed('POST', ['status'])).toBe(false);
    expect(isAllowed('GET', ['analytics', 'query'])).toBe(false);
    expect(isAllowed('GET', ['properties', 'abc'])).toBe(false);
    expect(isAllowed('GET', ['properties', '1'.repeat(21)])).toBe(false);
    expect(isAllowed('GET', ['accounts', 'UPPER'])).toBe(false);
    expect(isAllowed('GET', ['accounts', 'a'.repeat(12) + 'z'])).toBe(false);
    expect(isAllowed('GET', ['status', 'extra'])).toBe(false);
  });
});

describe('ledgerBaseUrl', () => {
  it('accepts plain http(s) URLs and trims trailing slashes', () => {
    expect(ledgerBaseUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(ledgerBaseUrl('https://ledger.example/api//')).toBe('https://ledger.example/api');
  });
  it('rejects missing, non-http, credentialed or query-bearing URLs', () => {
    for (const bad of [undefined, '', 'ftp://x', 'not a url', 'http://u:p@host', 'http://host?a=1', 'http://host#x']) expect(ledgerBaseUrl(bad)).toBeNull();
  });
});

describe('forward', () => {
  const base = { baseUrl: 'http://ledger:3000' };

  it('forwards an allowlisted GET with only Accept (plus the bearer key when set)', async () => {
    const fetch = vi.fn(async () => ok({ data: [] }));
    const res = await forward({ method: 'GET', segments: ['sales'], query: 'limit=2' }, { ...base, apiKey: 'k', fetch });
    expect(res).toEqual({ status: 200, body: '{"data":[]}' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ledger:3000/v1/sales?limit=2');
    expect(init.headers).toEqual({ accept: 'application/json', authorization: 'Bearer k' });
    expect(init.redirect).toBe('manual');
  });

  it('passes the ledger status and JSON body through, errors included', async () => {
    const fetch = vi.fn(async () => ok({ error: { code: 'not_found', message: 'x' } }, { status: 404 }));
    expect(await forward({ method: 'GET', segments: ['properties', '1'], query: '' }, { ...base, fetch })).toEqual({ status: 404, body: '{"error":{"code":"not_found","message":"x"}}' });
  });

  it('sends POST bodies as JSON and refuses other media types and oversize bodies', async () => {
    const fetch = vi.fn(async () => ok({ data: [] }));
    await forward({ method: 'POST', segments: ['analytics', 'query'], query: '', body: '{}', contentType: 'application/json; charset=utf-8' }, { ...base, fetch });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' });
    expect(await forward({ method: 'POST', segments: ['analytics', 'query'], query: '', body: '{}', contentType: 'text/plain' }, { ...base, fetch })).toMatchObject({ code: 'unsupported_media_type', status: 415 });
    expect(await forward({ method: 'POST', segments: ['analytics', 'query'], query: '', body: 'x'.repeat(LIMITS.maxBodyBytes + 1), contentType: 'application/json' }, { ...base, fetch })).toMatchObject({ code: 'too_large', status: 413 });
  });

  it('refuses before contacting the ledger', async () => {
    const fetch = vi.fn();
    expect(await forward({ method: 'GET', segments: ['health'], query: '' }, { ...base, fetch })).toMatchObject({ code: 'not_found', status: 404 });
    expect(await forward({ method: 'GET', segments: ['sales'], query: 'q='.padEnd(LIMITS.maxQueryBytes + 1, 'x') }, { ...base, fetch })).toMatchObject({ code: 'query_too_long', status: 414 });
    expect(await forward({ method: 'GET', segments: ['sales'], query: '' }, { baseUrl: null, fetch })).toMatchObject({ code: 'ledger_not_configured', status: 503, retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps unreachable, timeout, non-JSON and oversize answers to retry-aware errors', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await forward({ method: 'GET', segments: ['status'], query: '' }, { ...base, fetch: down })).toMatchObject({ code: 'ledger_unavailable', status: 502, retryable: true });

    const html = vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(await forward({ method: 'GET', segments: ['status'], query: '' }, { ...base, fetch: html })).toMatchObject({ code: 'ledger_bad_response' });

    const broken = vi.fn(async () => new Response('{nope', { headers: { 'content-type': 'application/json' } }));
    expect(await forward({ method: 'GET', segments: ['status'], query: '' }, { ...base, fetch: broken })).toMatchObject({ code: 'ledger_bad_response' });

    const declared = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(LIMITS.maxResponseBytes + 1) } }));
    expect(await forward({ method: 'GET', segments: ['status'], query: '' }, { ...base, fetch: declared })).toMatchObject({ code: 'ledger_response_too_large' });

    const big = vi.fn(async () => new Response(`"${'x'.repeat(LIMITS.maxResponseBytes)}"`, { headers: { 'content-type': 'application/json' } }));
    expect(await forward({ method: 'GET', segments: ['status'], query: '' }, { ...base, fetch: big })).toMatchObject({ code: 'ledger_response_too_large' });
  });

  it('times out after the total deadline', async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    const pending = forward({ method: 'GET', segments: ['status'], query: '' }, { ...base, fetch: hang as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(LIMITS.totalTimeoutMs);
    expect(await pending).toMatchObject({ code: 'ledger_timeout', status: 504, retryable: true });
    vi.useRealTimers();
  });
});

describe('error envelope', () => {
  it('renders the PRD §10 shape', () => {
    const err = gatewayError('ledger_unavailable');
    expect(isGatewayError(err)).toBe(true);
    expect(JSON.parse(errorBody(err, 'req-9'))).toEqual({ error: { code: 'ledger_unavailable', message: 'The ledger is unreachable.', request_id: 'req-9', retryable: true } });
  });
});
