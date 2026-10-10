/**
 * POST /api/v1/feedback (F-1907). Same-origin only (NFR-4), JSON up to 16 KB,
 * the same validation as the form, then one GitHub issue in the configured
 * feedback repository (`server/feedback.ts`). Answers use the PRD §10
 * envelopes: `{ data: { reference }, generated_at }` or
 * `{ error: { code, message, request_id, retryable, fields? } }`.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

import { parseFeedback } from '@/lib/feedback';
import type { FeedbackErrors } from '@/lib/feedback';
import { isTrustedOrigin } from '@/server/auth/config';
import { feedbackConfig, submitFeedback } from '@/server/feedback';

export const dynamic = 'force-dynamic';

const MAX_BODY = 16 * 1024;

function reply(status: number, body: unknown, requestId: string): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
}

function fail(status: number, code: string, message: string, requestId: string, retryable = false, fields?: FeedbackErrors): Response {
  return reply(status, { error: { code, message, request_id: requestId, retryable, ...(fields ? { fields } : {}) } }, requestId);
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!isTrustedOrigin(req.headers.get('origin'), req.nextUrl.origin)) return fail(403, 'forbidden_origin', 'Cross-site requests are refused.', requestId);
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail(415, 'unsupported_media_type', 'Send JSON.', requestId);
  const text = await req.text();
  if (text.length > MAX_BODY) return fail(413, 'too_large', 'The feedback is too long.', requestId);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'validation_error', 'The form could not be read.', requestId);
  }
  const parsed = parseFeedback(body);
  if (!parsed.ok) return fail(400, 'validation_error', 'Some fields need fixing.', requestId, false, parsed.errors);

  const config = feedbackConfig();
  if (config === null) return fail(503, 'feedback_not_configured', 'Feedback is not connected to an inbox on this server yet, so nothing was sent.', requestId);

  const result = await submitFeedback(parsed.value, requestId, config);
  if (!result.ok) return fail(result.status, result.code, result.message, requestId, result.retryable);
  return reply(201, { data: { reference: `#${result.number}` }, generated_at: new Date().toISOString() }, requestId);
}
