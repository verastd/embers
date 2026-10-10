/**
 * Feedback (F-1907): the form's fields and the one validator both the page
 * and the `/api/v1/feedback` route use, so the browser and the server refuse
 * exactly the same input.
 */

export const FEEDBACK_TYPES = ['Bug', 'Improvement', 'Praise'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const NICKNAME_MAX = 40;
export const COMMENT_MIN = 10;
export const COMMENT_MAX = 4000;
/** The page a "Report" link came from; kept short. */
export const PAGE_MAX = 200;

export interface FeedbackInput {
  nickname: string;
  type: FeedbackType;
  comment: string;
  /** Same-origin path the visitor was on, when they came from a Report link. */
  page?: string;
}

export type FeedbackErrors = Partial<Record<'nickname' | 'type' | 'comment' | 'page', string>>;

export function isFeedbackType(v: unknown): v is FeedbackType {
  return typeof v === 'string' && (FEEDBACK_TYPES as readonly string[]).includes(v);
}

/** A same-origin path (`/x?y`), or undefined for anything else. */
export function safePagePath(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s.startsWith('/') || s.startsWith('//') || s.length > PAGE_MAX || /[\s\\]/.test(s)) return undefined;
  return s;
}

/** Field errors for a draft; an empty object means it can be sent. */
export function validateFeedback(draft: { nickname?: unknown; type?: unknown; comment?: unknown }): FeedbackErrors {
  const errors: FeedbackErrors = {};
  const nickname = typeof draft.nickname === 'string' ? draft.nickname.trim() : '';
  if (draft.nickname !== undefined && typeof draft.nickname !== 'string') errors.nickname = 'Nickname must be text';
  else if (nickname.length > NICKNAME_MAX) errors.nickname = `Nickname can be at most ${NICKNAME_MAX} characters`;
  if (!isFeedbackType(draft.type)) errors.type = 'Choose Bug, Improvement or Praise';
  const comment = typeof draft.comment === 'string' ? draft.comment.trim() : '';
  if (comment.length === 0) errors.comment = 'Write your comment';
  else if (comment.length < COMMENT_MIN) errors.comment = `At least ${COMMENT_MIN} characters (${comment.length} so far)`;
  else if (comment.length > COMMENT_MAX) errors.comment = `At most ${COMMENT_MAX} characters (${comment.length} now)`;
  return errors;
}

/** The validated, trimmed input, or the field errors. */
export function parseFeedback(body: unknown): { ok: true; value: FeedbackInput } | { ok: false; errors: FeedbackErrors } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, errors: { comment: 'Send the form as JSON' } };
  const b = body as Record<string, unknown>;
  const errors = validateFeedback(b);
  if (b.page !== undefined && b.page !== '' && safePagePath(b.page) === undefined) errors.page = 'Page must be a path on this site';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const page = safePagePath(b.page);
  return {
    ok: true,
    value: {
      nickname: typeof b.nickname === 'string' ? b.nickname.trim() : '',
      type: b.type as FeedbackType,
      comment: (b.comment as string).trim(),
      ...(page ? { page } : {}),
    },
  };
}
