import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmbersAuth from '@embers/auth';

/**
 * The callback's token hygiene (Codex review on verastd/embers#3): once the
 * code exchange returns a token, its revocation is scheduled before anything
 * that can fail, so a failed profile read or session write still revokes it.
 */
const jar = new Map<string, string>();
const afterTasks: Array<() => Promise<void>> = [];
const auth = {
  exchangeCode: vi.fn(),
  fetchGitHubUser: vi.fn(),
  revokeGitHubToken: vi.fn(),
  openTransaction: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => void afterTasks.push(fn) }));
vi.mock('@embers/auth', async (importOriginal) => {
  const real = await importOriginal<typeof EmbersAuth>();
  return { ...real, ...auth };
});
vi.mock('@/server/auth/session', () => ({ setSessionCookie: vi.fn(async () => undefined) }));

const ENV = {
  NODE_ENV: 'production',
  EMBERS_SESSION_SECRET: 'callback-test-secret-0123456789abcdef012',
  EMBERS_PUBLIC_ORIGIN: 'https://embers.example',
  GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'secret',
};

async function callback(query: string): Promise<Response> {
  const { GET } = await import('./route');
  const url = new URL(`https://embers.example/auth/callback?${query}`);
  return GET({ nextUrl: url } as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
  jar.clear();
  afterTasks.length = 0;
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  auth.openTransaction.mockResolvedValue({ state: 'st', verifier: 'v', next: '/properties/search?search=1&city=Rome' });
  auth.exchangeCode.mockResolvedValue({ accessToken: 'gho_test' });
  auth.revokeGitHubToken.mockResolvedValue(true);
});

describe('/auth/callback token revocation', () => {
  it('revokes the token when reading the profile fails, and says GitHub failed', async () => {
    auth.fetchGitHubUser.mockRejectedValue(new Error('timeout'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await callback('code=c&state=st');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/auth/login?error=github&next=%2Fproperties%2Fsearch%3Fsearch%3D1%26city%3DRome');
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]?.();
    expect(auth.revokeGitHubToken).toHaveBeenCalledWith({ clientId: 'Iv1.test', clientSecret: 'secret', accessToken: 'gho_test' });
  });

  it('revokes after a successful sign-in too, and lands on next with its query', async () => {
    auth.fetchGitHubUser.mockResolvedValue({ id: 4242, login: 'td', name: null, avatarUrl: null });
    const res = await callback('code=c&state=st');
    expect(res.headers.get('location')).toBe('https://embers.example/properties/search?search=1&city=Rome');
    await afterTasks[0]?.();
    expect(auth.revokeGitHubToken).toHaveBeenCalledTimes(1);
  });

  it('never exchanges (so never has a token) on a state mismatch', async () => {
    const res = await callback('code=c&state=other');
    expect(res.headers.get('location')).toBe('/auth/login?error=state');
    expect(auth.exchangeCode).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(0);
  });
});
