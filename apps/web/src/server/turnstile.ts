/**
 * Cloudflare Turnstile, verified server-side (PRD NFR-4, F-1907: Turnstile
 * on public forms). The widget gives the browser a single-use token; this
 * asks Cloudflare whether it is genuine before the form's action runs, so a
 * script that copies the Origin header still cannot file anything.
 *
 *   EMBERS_TURNSTILE_SECRET          the widget's secret key (server only)
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY   the widget's site key (inlined at build)
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing' | 'invalid' | 'unavailable' };

/** Never throws. `unavailable` means Cloudflare could not be asked, not that the visitor failed. */
export async function verifyTurnstile(
  token: unknown,
  opts: { secret: string; remoteIp?: string | null; fetcher?: typeof fetch; timeoutMs?: number },
): Promise<TurnstileResult> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return { ok: false, reason: 'missing' };
  const form = new URLSearchParams({ secret: opts.secret, response: token });
  if (opts.remoteIp) form.set('remoteip', opts.remoteIp);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await (opts.fetcher ?? fetch)(SITEVERIFY_URL, { method: 'POST', body: form, signal: ctrl.signal });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const body = (await res.json().catch(() => null)) as { success?: unknown } | null;
    if (body === null) return { ok: false, reason: 'unavailable' };
    return body.success === true ? { ok: true } : { ok: false, reason: 'invalid' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(t);
  }
}
