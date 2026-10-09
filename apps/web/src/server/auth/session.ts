/**
 * The signed-in visitor, from the sealed session cookie. Server-only (reads
 * request cookies); never import from a client component. Embers has no
 * practice account, so only real GitHub sessions are ever accepted.
 */
import { acceptSession, AuthError, COOKIE, cookieOptions, sealSession, sessionAllowed } from '@embers/auth';
import type { SessionClaims, SessionInput } from '@embers/auth';
import { cookies } from 'next/headers';

import { isProduction, sessionKeys } from './config';

/** What pages may know about the visitor: never sub, iat or exp. */
export interface PublicSession {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export async function getSession(): Promise<SessionClaims | null> {
  // Read the cookie first, always: it is what makes every page that shows
  // the visitor dynamic, even on a build with no session secret.
  const token = (await cookies()).get(COOKIE.session(isProduction()))?.value;
  const keys = sessionKeys();
  if (keys === null) return null;
  return acceptSession(token, keys, { demoBuild: false });
}

export async function getPublicSession(): Promise<PublicSession | null> {
  const s = await getSession();
  return s === null ? null : { login: s.login, name: s.name, avatarUrl: s.avatarUrl };
}

/** Seals and sets the session cookie. Route Handlers only. */
export async function setSessionCookie(claims: SessionInput): Promise<void> {
  const keys = sessionKeys();
  if (keys === null || !sessionAllowed(claims, keys, { demoBuild: false })) {
    throw new AuthError('not_configured', 'no session secret this server may seal that session with');
  }
  const prod = isProduction();
  (await cookies()).set(COOKIE.session(prod), await sealSession(claims, keys.seal), cookieOptions('session', prod));
}

/** Expires the cookie with the attributes it was set with (a bare delete drops Secure, and __Host- needs it). */
export async function clearSessionCookie(): Promise<void> {
  const prod = isProduction();
  (await cookies()).set(COOKIE.session(prod), '', { ...cookieOptions('session', prod), maxAge: 0 });
}
