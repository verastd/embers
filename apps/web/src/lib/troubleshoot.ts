/**
 * Troubleshoot (F-1909): the browser-side checks and the reset ("clears
 * local storage, caches, service worker; reports each step"). Each step
 * takes the browser APIs it needs as an argument, so it is testable and a
 * missing API is reported as such rather than thrown.
 */

export type CheckOutcome = { ok: true; detail: string } | { ok: false; detail: string };

export function checkCookies(nav: { cookieEnabled?: boolean } | undefined): CheckOutcome {
  if (!nav || nav.cookieEnabled === undefined) return { ok: false, detail: 'This browser does not say whether cookies are on.' };
  return nav.cookieEnabled ? { ok: true, detail: 'Cookies are on, so signing in can work.' } : { ok: false, detail: 'Cookies are off for this site. Sign-in needs them; allow cookies for this site and reload.' };
}

export function checkStorage(storage: () => Storage | undefined): CheckOutcome {
  const key = 'embers:troubleshoot-probe';
  try {
    const s = storage();
    if (!s) return { ok: false, detail: 'Local storage is not available.' };
    s.setItem(key, '1');
    const back = s.getItem(key);
    s.removeItem(key);
    return back === '1' ? { ok: true, detail: 'Local storage works, so favorites, recent searches and the theme are remembered.' } : { ok: false, detail: 'Local storage did not keep a value.' };
  } catch {
    return { ok: false, detail: 'Local storage is blocked (private window or site data blocked). Favorites, recent searches and the theme will not be remembered.' };
  }
}

export type StepResult = { status: 'done' | 'skipped'; detail: string } | { status: 'error'; detail: string };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function clearLocalStorage(storage: () => Storage | undefined): StepResult {
  try {
    const s = storage();
    if (!s) return { status: 'skipped', detail: 'Local storage is not available in this browser.' };
    const n = s.length;
    s.clear();
    return n === 0 ? { status: 'skipped', detail: 'Nothing stored.' } : { status: 'done', detail: `Removed ${plural(n, 'item', 'items')}.` };
  } catch {
    return { status: 'error', detail: 'The browser refused to clear local storage.' };
  }
}

export async function clearCaches(cacheStorage: CacheStorage | undefined): Promise<StepResult> {
  if (!cacheStorage) return { status: 'skipped', detail: 'Cache storage is not available in this browser.' };
  try {
    const keys = await cacheStorage.keys();
    if (keys.length === 0) return { status: 'skipped', detail: 'No caches.' };
    const results = await Promise.all(keys.map((k) => cacheStorage.delete(k)));
    const failed = results.filter((r) => !r).length;
    return failed > 0 ? { status: 'error', detail: `Could not delete ${plural(failed, 'cache', 'caches')}.` } : { status: 'done', detail: `Deleted ${plural(keys.length, 'cache', 'caches')}.` };
  } catch {
    return { status: 'error', detail: 'The browser refused to clear its caches.' };
  }
}

export async function unregisterServiceWorkers(container: Pick<ServiceWorkerContainer, 'getRegistrations'> | undefined): Promise<StepResult> {
  if (!container) return { status: 'skipped', detail: 'Service workers are not available in this browser.' };
  try {
    const regs = await container.getRegistrations();
    if (regs.length === 0) return { status: 'skipped', detail: 'None registered.' };
    const results = await Promise.all(regs.map((r) => r.unregister()));
    const failed = results.filter((r) => !r).length;
    return failed > 0 ? { status: 'error', detail: `Could not remove ${plural(failed, 'service worker', 'service workers')}.` } : { status: 'done', detail: `Removed ${plural(regs.length, 'service worker', 'service workers')}.` };
  } catch {
    return { status: 'error', detail: 'The browser refused to remove its service workers.' };
  }
}
