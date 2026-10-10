import { describe, expect, it, vi } from 'vitest';

import { feedbackConfig, issueBody, issueTitle, plainNickname, submitFeedback } from './feedback';

const f = { nickname: '@octocat', type: 'Bug' as const, comment: 'The search ```breaks``` when\nI press Enter', page: '/properties/search' };
const config = { token: 't0k', owner: 'verastd', repo: 'embers-feedback', turnstileSecret: 'ts' };

describe('feedbackConfig', () => {
  it('needs a token, an owner/name repo and both Turnstile keys', () => {
    const ok = { EMBERS_FEEDBACK_GITHUB_TOKEN: ' x ', EMBERS_FEEDBACK_REPO: 'verastd/embers-feedback', EMBERS_TURNSTILE_SECRET: ' s ', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' };
    expect(feedbackConfig({})).toBeNull();
    expect(feedbackConfig({ EMBERS_FEEDBACK_GITHUB_TOKEN: 'x' })).toBeNull();
    expect(feedbackConfig({ ...ok, EMBERS_FEEDBACK_REPO: 'not a repo' })).toBeNull();
    // No Turnstile, no inbox: the endpoint must never file unchecked requests.
    expect(feedbackConfig({ ...ok, EMBERS_TURNSTILE_SECRET: undefined })).toBeNull();
    // No site key, no widget on the form: every send would fail a check nobody can see.
    expect(feedbackConfig({ ...ok, NEXT_PUBLIC_TURNSTILE_SITE_KEY: ' ' })).toBeNull();
    expect(feedbackConfig(ok)).toEqual({ token: 'x', owner: 'verastd', repo: 'embers-feedback', turnstileSecret: 's' });
  });
});

describe('the issue', () => {
  it('has a typed title from the first line', () => {
    expect(issueTitle(f)).toBe('[Bug] The search ```breaks``` when');
    expect(issueTitle({ ...f, comment: 'y'.repeat(100) })).toHaveLength('[Bug] '.length + 60);
  });
  it('fences the comment so it cannot break out, and neutralises mentions in the nickname', () => {
    const body = issueBody(f, 'req-1');
    expect(body).toContain('````text\nThe search ```breaks``` when\nI press Enter\n````');
    expect(body).toContain('**Nickname:** octocat');
    expect(body).toContain('**Page:** `/properties/search`');
    expect(body).toContain('`req-1`');
    expect(issueBody({ ...f, page: undefined }, 'r')).not.toContain('**Page:**');
    expect(plainNickname('  ')).toBe('Anonymous');
  });
});

describe('submitFeedback', () => {
  it('posts the issue and returns its number', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ number: 42 }), { status: 201 }));
    await expect(submitFeedback(f, 'r', config, fetcher as unknown as typeof fetch)).resolves.toEqual({ ok: true, number: 42 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/verastd/embers-feedback/issues');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
  });
  it('reports refusals, odd answers, outages and timeouts', async () => {
    const answer = (status: number, body = '{}') => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await submitFeedback(f, 'r', config, answer(201))).toMatchObject({ ok: false, code: 'feedback_bad_response' });
    expect(await submitFeedback(f, 'r', config, answer(404))).toMatchObject({ ok: false, code: 'feedback_rejected', retryable: false });
    expect(await submitFeedback(f, 'r', config, answer(503))).toMatchObject({ ok: false, retryable: true });
    const down = vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    expect(await submitFeedback(f, 'r', config, down)).toMatchObject({ ok: false, status: 502, code: 'feedback_unavailable' });
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    expect(await submitFeedback(f, 'r', config, hang, 5)).toMatchObject({ ok: false, status: 504, code: 'feedback_timeout' });
  });
});
