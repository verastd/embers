/**
 * GET /auth/callback — GitHub sends the browser back here. The attempt must
 * match the sealed transaction cookie (constant-time state check), and the
 * code is only good with that cookie's PKCE verifier. The GitHub token is
 * used once, for `GET /user`, then revoked: Embers never stores it.
 */
import {
  AuthError,
  COOKIE,
  constantTimeEqual,
  cookieOptions,
  exchangeCode,
  fetchGitHubUser,
  openTransaction,
  revokeGitHubToken,
  safeNext,
} from '@embers/auth';
import { cookies } from 'next/headers';
import { after } from 'next/server';
import type { NextRequest } from 'next/server';

import { githubConfig, isProduction, sessionKeys, signInAvailable } from '@/server/auth/config';
import { redirectTo, signInFailed } from '@/server/auth/http';
import { setSessionCookie } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const store = await cookies();
  const prod = isProduction();
  const tx = await openTransaction(store.get(COOKIE.transaction(prod))?.value, sessionKeys()?.open ?? []);
  // One attempt, one use: every outcome below spends it.
  store.set(COOKIE.transaction(prod), '', { ...cookieOptions('transaction', prod), maxAge: 0 });
  if (tx === null) return signInFailed('expired');
  // Only a sign-in attempt (no purpose) may finish here.
  if (tx.purpose !== undefined) return signInFailed('state');

  const params = request.nextUrl.searchParams;
  if (!constantTimeEqual(params.get('state') ?? '', tx.state)) return signInFailed('state');
  if (params.has('error')) return signInFailed('denied', tx.next);
  const config = githubConfig();
  if (!signInAvailable() || config === null) return signInFailed('unavailable', tx.next);
  const code = params.get('code');
  if (!code) return signInFailed('github', tx.next);

  try {
    const { accessToken } = await exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: `${config.origin}/auth/callback`,
      codeVerifier: tx.verifier,
    });
    const user = await fetchGitHubUser(accessToken);
    await setSessionCookie({ sub: String(user.id), login: user.login, name: user.name, avatarUrl: user.avatarUrl, demo: false });
    // Identity only: the token has no further use, so it is revoked after the redirect.
    after(async () => {
      await revokeGitHubToken({ clientId: config.clientId, clientSecret: config.clientSecret, accessToken }).catch((e: unknown) => {
        console.warn(`token revoke failed: ${e instanceof AuthError ? e.code : 'unexpected'}`);
      });
    });
  } catch (error) {
    // The code only: messages could carry the code or a token.
    console.warn(`sign-in callback failed: ${error instanceof AuthError ? error.code : 'unexpected'}`);
    return signInFailed('github', tx.next);
  }
  return redirectTo(new URL(safeNext(tx.next), config.origin).toString());
}
