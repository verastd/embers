/**
 * Where feedback goes (F-1907). Embers has no database yet, so the admin
 * inbox (F-2001) is a GitHub repository's issues: each submission becomes one
 * issue, and its number is the reference the visitor gets back. Server-only.
 *
 *   EMBERS_FEEDBACK_GITHUB_TOKEN   a token that may create issues in that repo
 *   EMBERS_FEEDBACK_REPO           owner/name, e.g. verastd/embers-feedback
 *
 * With either missing, nothing is sent and the route answers 503
 * `feedback_not_configured`: the form never says "sent" when it was not.
 */
import type { FeedbackInput } from '@/lib/feedback';

export interface FeedbackConfig {
  token: string;
  owner: string;
  repo: string;
}

const REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;

export function feedbackConfig(env: Record<string, string | undefined> = process.env): FeedbackConfig | null {
  const token = env.EMBERS_FEEDBACK_GITHUB_TOKEN?.trim();
  const m = REPO.exec(env.EMBERS_FEEDBACK_REPO?.trim() ?? '');
  if (!token || !m || !m[1] || !m[2]) return null;
  return { token, owner: m[1], repo: m[2] };
}

/** A fence longer than any backtick run in `text`, so the comment cannot close it. */
function fence(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Nickname as plain text: no markdown, no @mentions that would ping anyone. */
export function plainNickname(nickname: string): string {
  const s = nickname.replace(/[^\p{L}\p{N} ._-]/gu, '').trim();
  return s.length > 0 ? s : 'Anonymous';
}

export function issueTitle(f: FeedbackInput): string {
  const first = f.comment.split('\n')[0]?.trim() ?? '';
  const short = first.length > 60 ? `${first.slice(0, 59)}…` : first;
  return `[${f.type}] ${short}`;
}

export function issueBody(f: FeedbackInput, requestId: string): string {
  const f3 = fence(f.comment);
  return [
    `**Type:** ${f.type}`,
    `**Nickname:** ${plainNickname(f.nickname)}`,
    f.page ? `**Page:** \`${f.page.replace(/`/g, '')}\`` : null,
    `**Request ID:** \`${requestId}\``,
    '',
    `${f3}text`,
    f.comment,
    f3,
    '',
    '_Sent from the Embers feedback form._',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export type SubmitResult = { ok: true; number: number } | { ok: false; status: number; code: string; message: string; retryable: boolean };

/** Creates the issue. Never throws; a GitHub failure is reported, not hidden. */
export async function submitFeedback(f: FeedbackInput, requestId: string, config: FeedbackConfig, fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<SubmitResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(`https://api.github.com/repos/${config.owner}/${config.repo}/issues`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'embers-feedback',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ title: issueTitle(f), body: issueBody(f, requestId) }),
      signal: ctrl.signal,
    });
    if (res.status === 201) {
      const body = (await res.json().catch(() => null)) as { number?: unknown } | null;
      if (body && typeof body.number === 'number') return { ok: true, number: body.number };
      return { ok: false, status: 502, code: 'feedback_bad_response', message: 'The feedback inbox answered without a reference.', retryable: true };
    }
    const retryable = res.status >= 500 || res.status === 429;
    return { ok: false, status: 502, code: 'feedback_rejected', message: `The feedback inbox refused it (HTTP ${res.status}).`, retryable };
  } catch {
    const timedOut = ctrl.signal.aborted;
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      code: timedOut ? 'feedback_timeout' : 'feedback_unavailable',
      message: timedOut ? 'The feedback inbox did not answer in time.' : 'The feedback inbox is unreachable.',
      retryable: true,
    };
  } finally {
    clearTimeout(t);
  }
}
