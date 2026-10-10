/**
 * Users (F-201, F-202): how a `/users/[username]` segment becomes a chain
 * account, and the routes the user pages link to. Pure; no React.
 *
 * Upland users are an EOS (Antelope) account plus a username. The ledger
 * keys profiles by account (`/accounts/{account}`) and searches usernames
 * by substring (`/accounts?username=`), so a profile URL carries the
 * username people know and resolves it here: the current username first,
 * then a previous one (`usernames`), then the segment itself when it is a
 * valid account name (links from chain-only views, such as leaderboards
 * that rank accounts, use the account).
 */
import type { Account } from '@embers/ledger';
import { isAntelopeAccount } from '@embers/ledger';

export const USER_ROUTES = {
  search: '/users',
  leaderboardUsers: '/leaderboards/users',
  leaderboardProperties: '/leaderboards/properties',
  leaderboardUpland: '/leaderboards/upland',
} as const;

/** Upland usernames and account names both fit well inside this. */
export const USER_PARAM_MAX = 64;

/** The profile route for a username or account. */
export function userHref(nameOrAccount: string): string {
  return `${USER_ROUTES.search}/${encodeURIComponent(nameOrAccount)}`;
}

/** The `[username]` segment as typed (decoded, trimmed), or null when unusable. */
export function readUserParam(raw: string | string[] | undefined): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === undefined) return null;
  let value = first;
  try {
    value = decodeURIComponent(first);
  } catch {
    // Already decoded and carrying a bare '%': keep it as typed.
  }
  value = value.trim();
  return value.length === 0 || value.length > USER_PARAM_MAX ? null : value;
}

export type Resolution =
  | { kind: 'account'; account: string; via: 'username' | 'previous-username' | 'account' }
  | { kind: 'none' };

type NameRow = Pick<Account, 'account' | 'username' | 'usernames'>;

/**
 * Which account `name` means, given the `/accounts?username=<name>` rows
 * (a substring match, so the exact name must be picked out). Case never
 * matters: Upland usernames are case-insensitive.
 */
export function resolveUser(name: string, rows: readonly NameRow[]): Resolution {
  const n = name.toLowerCase();
  const current = rows.find((r) => r.username.toLowerCase() === n);
  if (current) return { kind: 'account', account: current.account, via: 'username' };
  const previous = rows.find((r) => r.usernames.some((u) => u.toLowerCase() === n));
  if (previous) return { kind: 'account', account: previous.account, via: 'previous-username' };
  if (isAntelopeAccount(n)) return { kind: 'account', account: n, via: 'account' };
  return { kind: 'none' };
}

/** Earlier usernames of an account, newest naming excluded. */
export function previousUsernames(row: NameRow): string[] {
  const current = row.username.toLowerCase();
  return row.usernames.filter((u) => u.toLowerCase() !== current);
}

/** The name to show for an account row: its username, else the account. */
export function displayName(row: Pick<Account, 'account' | 'username'>): string {
  return row.username.trim() || row.account;
}

/* --- resolving a name through the ledger ------------------------------------------ */

/**
 * `/accounts?username=` is a substring match on CURRENT usernames, ranked by
 * activity, so a short name ("bo") can sit pages deep behind everyone whose
 * name contains it. The lookup pages until the exact name turns up, the
 * matches run out, or the cap is hit. No ledger route searches earlier
 * usernames (`usernames` is returned, never filtered on), so an old name
 * resolves only when the renamed player's current name happens to contain it.
 */
export const LOOKUP_PAGE = 100;
export const LOOKUP_MAX_PAGES = 10;

export interface Lookup {
  resolution: Resolution;
  /** Accounts read while looking. */
  scanned: number;
  /** Every account whose username contains the name was read. */
  complete: boolean;
}

export type LookupPage = (page: { offset: number; limit: number }) => Promise<{ data: NameRow[]; has_more: boolean }>;

export async function lookupUser(name: string, fetchPage: LookupPage, maxPages: number = LOOKUP_MAX_PAGES): Promise<Lookup> {
  const n = name.toLowerCase();
  const rows: NameRow[] = [];
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetchPage({ offset: page * LOOKUP_PAGE, limit: LOOKUP_PAGE });
    rows.push(...res.data);
    const exact = res.data.find((r) => r.username.toLowerCase() === n);
    if (exact) return { resolution: { kind: 'account', account: exact.account, via: 'username' }, scanned: rows.length, complete: !res.has_more };
    if (!res.has_more || res.data.length === 0) {
      complete = true;
      break;
    }
  }
  return { resolution: resolveUser(name, rows), scanned: rows.length, complete };
}

/** What the not-found page says, honest about what was and could not be searched. */
export function notFoundMessage(name: string, lookup: Pick<Lookup, 'scanned' | 'complete'> | null): string {
  if (!name) return 'That is not a username or EOS account.';
  const earlier = 'Earlier usernames can’t be searched yet, so a player who has renamed is not found by an old name.';
  if (lookup && !lookup.complete) {
    return `No exact match for “${name}” among the first ${new Intl.NumberFormat('en-US').format(lookup.scanned)} usernames that contain it. Try a longer name. ${earlier}`;
  }
  return `No Upland player currently uses the username “${name}”. ${earlier}`;
}
