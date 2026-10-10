import { describe, expect, it, vi } from 'vitest';

import { SITEVERIFY_URL, verifyTurnstile } from './turnstile';

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('verifyTurnstile', () => {
  it('asks Cloudflare with the secret, token and visitor IP, and passes a genuine token', async () => {
    const fetcher = answer(200, { success: true });
    expect(await verifyTurnstile('tok', { secret: 'sec', remoteIp: '203.0.113.9', fetcher })).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ secret: 'sec', response: 'tok', remoteip: '203.0.113.9' });
  });

  it('refuses a missing or oversized token without asking', async () => {
    const fetcher = answer(200, { success: true });
    for (const t of [undefined, '', 42, 'x'.repeat(2049)]) expect(await verifyTurnstile(t, { secret: 's', fetcher })).toEqual({ ok: false, reason: 'missing' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a token Cloudflare rejects', async () => {
    expect(await verifyTurnstile('tok', { secret: 's', fetcher: answer(200, { success: false, 'error-codes': ['invalid-input-response'] }) })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports Cloudflare being unreachable or broken as unavailable, not as the visitor failing', async () => {
    expect(await verifyTurnstile('tok', { secret: 's', fetcher: answer(500, {}) })).toEqual({ ok: false, reason: 'unavailable' });
    const throws = vi.fn(async () => {
      throw new Error('down');
    });
    expect(await verifyTurnstile('tok', { secret: 's', fetcher: throws })).toEqual({ ok: false, reason: 'unavailable' });
    const notJson = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await verifyTurnstile('tok', { secret: 's', fetcher: notJson })).toEqual({ ok: false, reason: 'unavailable' });
  });
});
