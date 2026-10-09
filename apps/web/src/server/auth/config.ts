/**
 * Sign-in settings (PRD F-301, GitHub sign-in per TD's decision), read from
 * the environment at call time so one build serves whatever each server is
 * configured with. Server-only.
 *
 *   EMBERS_SESSION_SECRET            seals sessions (≥ 32 chars)
 *   EMBERS_SESSION_SECRET_PREVIOUS   still opens them while rotating
 *   EMBERS_PUBLIC_ORIGIN             https://embers.example — the OAuth redirect base
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET   Embers' own GitHub OAuth app
 */
import { MIN_SECRET_LENGTH, resolveSessionKeys } from '@embers/auth';
import type { SessionKeys } from '@embers/auth';

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

const WARNED = Symbol.for('embers.auth.warnedShortSessionSecret');

/** Keys to seal and open sessions with, or null when nobody can sign in. */
export function sessionKeys(): SessionKeys | null {
  const keys = resolveSessionKeys({
    secret: process.env.EMBERS_SESSION_SECRET,
    previous: process.env.EMBERS_SESSION_SECRET_PREVIOUS,
    development: process.env.NODE_ENV === 'development',
  });
  if (typeof keys !== 'string') return keys;
  const state = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (keys === 'too_short' && !state[WARNED]) {
    state[WARNED] = true;
    console.warn(`EMBERS_SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; sign-in is disabled`);
  }
  return null;
}

/** EMBERS_PUBLIC_ORIGIN in canonical form, or null unless it is a bare http(s) origin. */
export function publicOrigin(env: string | undefined = process.env.EMBERS_PUBLIC_ORIGIN): string | null {
  if (!env) return null;
  try {
    const url = new URL(env);
    const http = url.protocol === 'https:' || url.protocol === 'http:';
    const bare = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
    return http && bare ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Whether a state-changing request's Origin is our own. Only a development
 * server with EMBERS_PUBLIC_ORIGIN unset falls back to the request's origin.
 */
export function isTrustedOrigin(origin: string | null, requestOrigin: string): boolean {
  const unset = !process.env.EMBERS_PUBLIC_ORIGIN;
  const expected = unset && process.env.NODE_ENV === 'development' ? requestOrigin : publicOrigin();
  return origin !== null && expected !== null && origin === expected;
}

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  origin: string;
}

/** Everything the GitHub round trip needs, or null if any piece is missing. */
export function githubConfig(): GitHubConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const origin = publicOrigin();
  if (!clientId || !clientSecret || origin === null) return null;
  return { clientId, clientSecret, origin };
}

/** Sign-in works only with real (not practice-only) keys and the whole GitHub config. */
export function signInAvailable(): boolean {
  const keys = sessionKeys();
  return keys !== null && !keys.practiceOnly && githubConfig() !== null;
}
