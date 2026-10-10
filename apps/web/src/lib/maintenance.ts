/**
 * The maintenance flag (F-1911): "global flag shows maintenance page for
 * chosen routes". Until the admin's flag editor exists (F-2001), the flag is
 * the server's environment:
 *
 *   EMBERS_MAINTENANCE_ROUTES   comma-separated path prefixes (`/properties,/users`),
 *                               or `*` for every page; unset or empty = off
 *   EMBERS_MAINTENANCE_MESSAGE  optional line shown on the maintenance page
 *
 * A prefix matches the path itself and everything under it (`/properties`
 * covers `/properties/search`, not `/propertiesx`). The maintenance page,
 * auth, the BFF and the API are never put behind the flag.
 */

export const MAINTENANCE_PATH = '/maintenance';
export const MESSAGE_MAX = 280;

const NEVER = ['/maintenance', '/auth', '/bff', '/api', '/_next'];

export interface MaintenanceFlag {
  /** Every page. */
  all: boolean;
  prefixes: string[];
  message: string | null;
}

export function readMaintenance(env: Record<string, string | undefined>): MaintenanceFlag {
  const parts = (env.EMBERS_MAINTENANCE_ROUTES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const all = parts.includes('*');
  const prefixes = all ? [] : parts.filter((p) => p.startsWith('/') && !p.startsWith('//')).map((p) => (p.length > 1 ? p.replace(/\/+$/, '') : p));
  const raw = env.EMBERS_MAINTENANCE_MESSAGE?.trim() ?? '';
  return { all, prefixes, message: raw.length > 0 ? raw.slice(0, MESSAGE_MAX) : null };
}

export function isMaintenanceActive(flag: MaintenanceFlag): boolean {
  return flag.all || flag.prefixes.length > 0;
}

function under(path: string, prefix: string): boolean {
  return prefix === '/' ? true : path === prefix || path.startsWith(`${prefix}/`);
}

/** True when `pathname` should show the maintenance page. */
export function isUnderMaintenance(pathname: string, flag: MaintenanceFlag): boolean {
  if (NEVER.some((p) => under(pathname, p))) return false;
  if (flag.all) return true;
  return flag.prefixes.some((p) => under(pathname, p));
}
