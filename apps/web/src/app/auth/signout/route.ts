/** POST /auth/signout — the account menu's form. POST plus an Origin check, so no other site can sign people out. */
import type { NextRequest } from 'next/server';

import { isTrustedOrigin } from '@/server/auth/config';
import { jsonError, redirectTo } from '@/server/auth/http';
import { clearSessionCookie } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  if (!isTrustedOrigin(request.headers.get('origin'), request.nextUrl.origin)) {
    return jsonError(403, 'bad_origin', 'Cross-site sign-out refused.');
  }
  await clearSessionCookie();
  return redirectTo('/');
}
