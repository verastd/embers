/** Auth responses: always `no-store`, so no redirect or error outlives the cookie it was about. */

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Reasons the /auth/login page explains. */
export type SignInError = 'unavailable' | 'expired' | 'state' | 'denied' | 'github';
export const SIGN_IN_ERRORS: readonly SignInError[] = ['unavailable', 'expired', 'state', 'denied', 'github'];

/** A redirect; same-origin paths stay relative so the Host header never decides where it points. */
export function redirectTo(location: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { Location: location, ...NO_STORE } });
}

export function signInFailed(error: SignInError, next?: string): Response {
  const q = new URLSearchParams({ error });
  if (next && next !== '/') q.set('next', next);
  return redirectTo(`/auth/login?${q.toString()}`);
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message, retryable: false } }, { status, headers: NO_STORE });
}
