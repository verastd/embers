/**
 * `/bff/ledger/*`: the browser's only way to the Upland Ledger. Validation,
 * limits and forwarding live in `server/ledger-gateway.ts`; this handler
 * adds the request id, the same-origin check for POST (NFR-4 CSRF), the
 * upstream assertion (`server/ledger-auth.ts`) and no-store caching. Public
 * ledger reads need no sign-in (PRD 4.2: public analytics are anonymous).
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

import { getSession } from '@/server/auth/session';
import { ledgerAuthorization } from '@/server/ledger-auth';
import { errorBody, forward, gatewayError, isGatewayError, ledgerBaseUrl } from '@/server/ledger-gateway';
import type { Method } from '@/server/ledger-gateway';

export const dynamic = 'force-dynamic';

const NO_STORE = 'private, no-store';

function respond(status: number, body: string, requestId: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': NO_STORE, 'x-request-id': requestId },
  });
}

async function handle(req: NextRequest, method: Method, params: Promise<{ path: string[] }>): Promise<Response> {
  const requestId = randomUUID();
  const { path } = await params;
  if (method === 'POST') {
    const origin = req.headers.get('origin');
    if (origin !== null && origin !== req.nextUrl.origin) {
      return respond(403, JSON.stringify({ error: { code: 'forbidden_origin', message: 'Cross-site requests are refused.', request_id: requestId, retryable: false } }), requestId);
    }
  }
  const session = await getSession();
  const auth = await ledgerAuthorization(session ? { sub: session.sub, login: session.login } : null);
  if (!auth.ok) {
    const err = gatewayError('ledger_not_configured');
    return respond(err.status, errorBody(err, requestId), requestId);
  }
  const result = await forward(
    {
      method,
      segments: path,
      query: req.nextUrl.search.replace(/^\?/, ''),
      body: method === 'POST' ? await req.text() : undefined,
      contentType: req.headers.get('content-type'),
    },
    { baseUrl: ledgerBaseUrl(process.env.LEDGER_URL), authorization: auth.authorization, fetch },
  );
  if (isGatewayError(result)) return respond(result.status, errorBody(result, requestId), requestId);
  return respond(result.status, result.body, requestId);
}

export function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return handle(req, 'GET', ctx.params);
}

export function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return handle(req, 'POST', ctx.params);
}

// Anything else is not a ledger route.
export function PUT(): Response {
  const id = randomUUID();
  return respond(405, errorBody({ ...gatewayError('not_found'), status: 405 }, id), id);
}
