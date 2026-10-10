/**
 * The feedback form's one request (F-1907): POST /api/v1/feedback. Resolves
 * with the reference only when the server says the feedback was filed;
 * every other answer rejects with a FeedbackSendError the form shows.
 */
import type { FeedbackErrors, FeedbackInput } from './feedback';

export class FeedbackSendError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId: string | null,
    readonly fields: FeedbackErrors | null = null,
  ) {
    super(message);
    this.name = 'FeedbackSendError';
  }
}

export async function sendFeedback(input: FeedbackInput, signal?: AbortSignal): Promise<{ reference: string; requestId: string | null }> {
  let res: Response;
  try {
    res = await fetch('/api/v1/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal });
  } catch (e) {
    if (signal?.aborted) throw new FeedbackSendError('Timed out', 'timeout', null);
    throw new FeedbackSendError(e instanceof Error && e.message ? `Could not reach Embers: ${e.message}` : 'Could not reach Embers', 'network_error', null);
  }
  const headerId = res.headers.get('x-request-id');
  const body = (await res.json().catch(() => null)) as {
    data?: { reference?: unknown };
    error?: { code?: unknown; message?: unknown; request_id?: unknown; fields?: unknown };
  } | null;
  if (res.ok && body && typeof body.data?.reference === 'string') return { reference: body.data.reference, requestId: headerId };
  const err = body?.error;
  const requestId = typeof err?.request_id === 'string' ? err.request_id : headerId;
  const code = typeof err?.code === 'string' ? err.code : `http_${res.status}`;
  const message = typeof err?.message === 'string' && err.message ? err.message : `Embers answered HTTP ${res.status}`;
  const fields = err?.fields && typeof err.fields === 'object' ? (err.fields as FeedbackErrors) : null;
  throw new FeedbackSendError(message, code, requestId, fields);
}
