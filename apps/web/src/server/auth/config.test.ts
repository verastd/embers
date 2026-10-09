import { afterEach, describe, expect, it, vi } from 'vitest';

import { githubConfig, isTrustedOrigin, publicOrigin, sessionKeys, signInAvailable } from './config';

const SECRET = 'e2e-session-secret-0123456789abcdef0123';

afterEach(() => vi.unstubAllEnvs());

describe('publicOrigin', () => {
  it('accepts bare http(s) origins only', () => {
    expect(publicOrigin('https://embers.example')).toBe('https://embers.example');
    expect(publicOrigin('https://embers.example/')).toBe('https://embers.example');
    for (const bad of [undefined, '', 'nope', 'ftp://x', 'https://x/path', 'https://x?q=1', 'https://x#h', 'https://u:p@x']) expect(publicOrigin(bad)).toBeNull();
  });
});

describe('isTrustedOrigin', () => {
  it('matches the configured origin exactly', () => {
    vi.stubEnv('EMBERS_PUBLIC_ORIGIN', 'https://embers.example');
    vi.stubEnv('NODE_ENV', 'production');
    expect(isTrustedOrigin('https://embers.example', 'http://internal:3000')).toBe(true);
    expect(isTrustedOrigin('https://evil.example', 'http://internal:3000')).toBe(false);
    expect(isTrustedOrigin(null, 'http://internal:3000')).toBe(false);
  });
  it('falls back to the request origin only in development with no origin set', () => {
    vi.stubEnv('EMBERS_PUBLIC_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(isTrustedOrigin('http://localhost:3000', 'http://localhost:3000')).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isTrustedOrigin('http://localhost:3000', 'http://localhost:3000')).toBe(false);
  });
});

describe('sign-in availability', () => {
  it('needs real keys and the whole GitHub config', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMBERS_SESSION_SECRET', SECRET);
    vi.stubEnv('EMBERS_PUBLIC_ORIGIN', 'https://embers.example');
    vi.stubEnv('GITHUB_CLIENT_ID', 'Iv1.x');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 's');
    expect(githubConfig()).toEqual({ clientId: 'Iv1.x', clientSecret: 's', origin: 'https://embers.example' });
    expect(signInAvailable()).toBe(true);
    vi.stubEnv('GITHUB_CLIENT_SECRET', '');
    expect(githubConfig()).toBeNull();
    expect(signInAvailable()).toBe(false);
  });

  it('has no keys without a secret in production, and warns once about a short one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMBERS_SESSION_SECRET', '');
    expect(sessionKeys()).toBeNull();
    vi.stubEnv('EMBERS_SESSION_SECRET', 'short');
    expect(sessionKeys()).toBeNull();
    expect(sessionKeys()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(signInAvailable()).toBe(false);
  });

  it('gives practice-only keys in development without a secret, which cannot sign anyone in', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMBERS_SESSION_SECRET', '');
    vi.stubEnv('EMBERS_PUBLIC_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('GITHUB_CLIENT_ID', 'Iv1.x');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 's');
    expect(sessionKeys()?.practiceOnly).toBe(true);
    expect(signInAvailable()).toBe(false);
  });
});
