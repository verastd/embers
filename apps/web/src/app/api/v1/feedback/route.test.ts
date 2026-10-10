import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

import { POST } from './route';

/** POST /api/v1/feedback: origin, media type, size, validation, not-configured, Turnstile, filed. */
const ORIGIN = 'https://embers.example';

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const r = new Request(`${ORIGIN}/api/v1/feedback`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return Object.assign(r, { nextUrl: new URL(r.url) }) as unknown as NextRequest;
}

const good = { nickname: 'ann', type: 'Bug', comment: 'Search breaks on Enter', turnstile_token: 'human' };

/** Cloudflare's siteverify (passes only the token `human`) and GitHub's issues API (answers `github`). */
function upstreams(github: () => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('challenges.cloudflare.com')) {
      const token = (init?.body as URLSearchParams).get('response');
      return new Response(JSON.stringify({ success: token === 'human' }), { status: 200 });
    }
    return github();
  });
}

function configure(): void {
  vi.stubEnv('EMBERS_FEEDBACK_GITHUB_TOKEN', 'tok');
  vi.stubEnv('EMBERS_FEEDBACK_REPO', 'verastd/embers-feedback');
  vi.stubEnv('EMBERS_TURNSTILE_SECRET', 'ts');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site');
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EMBERS_PUBLIC_ORIGIN', ORIGIN);
  vi.stubEnv('EMBERS_FEEDBACK_GITHUB_TOKEN', '');
  vi.stubEnv('EMBERS_FEEDBACK_REPO', '');
  vi.stubEnv('EMBERS_TURNSTILE_SECRET', '');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = async (r: Response) => (await r.json()) as { data?: { reference: string }; error?: { code: string; request_id: string; fields?: Record<string, string> } };

describe('POST /api/v1/feedback', () => {
  it('refuses other origins and non-JSON', async () => {
    expect((await POST(req(good, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(req(good, { 'content-type': 'text/plain' }))).status).toBe(415);
  });
  it('refuses oversized and unreadable bodies', async () => {
    expect((await POST(req({ ...good, comment: 'x'.repeat(20_000) }))).status).toBe(413);
    expect((await POST(req('{nope'))).status).toBe(400);
  });
  it('answers 400 with field errors', async () => {
    const r = await POST(req({ type: 'Rant', comment: 'short' }));
    expect(r.status).toBe(400);
    const b = await json(r);
    expect(b.error?.fields).toMatchObject({ type: expect.any(String), comment: expect.any(String) });
    expect(r.headers.get('x-request-id')).toBe(b.error?.request_id);
  });
  it('says feedback_not_configured (503) when no inbox is set, and sends nothing', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const r = await POST(req(good));
    expect(r.status).toBe(503);
    expect((await json(r)).error?.code).toBe('feedback_not_configured');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('files the issue and returns its reference once Turnstile passes', async () => {
    configure();
    const fetcher = upstreams(() => new Response(JSON.stringify({ number: 7 }), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const r = await POST(req(good));
    expect(r.status).toBe(201);
    expect((await json(r)).data).toEqual({ reference: '#7' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('files nothing for a script that sets the Origin header but has no Turnstile token', async () => {
    configure();
    const fetcher = upstreams(() => new Response(JSON.stringify({ number: 7 }), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const r = await POST(req({ nickname: good.nickname, type: good.type, comment: good.comment }));
    expect(r.status).toBe(400);
    expect((await json(r)).error?.code).toBe('turnstile_required');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('files nothing when Cloudflare rejects the token', async () => {
    configure();
    const fetcher = upstreams(() => new Response(JSON.stringify({ number: 7 }), { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const r = await POST(req({ ...good, turnstile_token: 'bot' }));
    expect(r.status).toBe(400);
    expect((await json(r)).error?.code).toBe('turnstile_failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('answers a retryable 503 when Cloudflare cannot be reached, and files nothing', async () => {
    configure();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('challenges.cloudflare.com')) throw new Error('down');
      return new Response(JSON.stringify({ number: 7 }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetcher);
    const r = await POST(req(good));
    expect(r.status).toBe(503);
    expect((await json(r)).error).toMatchObject({ code: 'turnstile_unavailable', retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('passes on an inbox failure', async () => {
    configure();
    vi.stubGlobal('fetch', upstreams(() => new Response('{}', { status: 401 })));
    const r = await POST(req(good));
    expect(r.status).toBe(502);
    expect((await json(r)).error?.code).toBe('feedback_rejected');
  });
});
