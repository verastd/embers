/**
 * GET /auth/signin?next= — starts one GitHub sign-in attempt: a fresh state
 * and PKCE pair sealed into the short-lived transaction cookie, then off to
 * GitHub. Without the whole configuration it goes back to /auth/login with
 * "unavailable", never to GitHub half-configured.
 */
import { authorizeUrl, COOKIE, cookieOptions, createPkcePair, randomToken, safeNext, sealTransaction } from '@embers/auth';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

import { githubConfig, isProduction, sessionKeys, signInAvailable } from '@/server/auth/config';
import { redirectTo, signInFailed } from '@/server/auth/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const config = githubConfig();
  const keys = sessionKeys();
  if (!signInAvailable() || config === null || keys === null) return signInFailed('unavailable', next);

  const state = randomToken();
  const { verifier, challenge } = await createPkcePair();
  const prod = isProduction();
  (await cookies()).set(COOKIE.transaction(prod), await sealTransaction({ state, verifier, next }, keys.seal), cookieOptions('transaction', prod));
  return redirectTo(authorizeUrl({ clientId: config.clientId, redirectUri: `${config.origin}/auth/callback`, state, codeChallenge: challenge }), 302);
}
