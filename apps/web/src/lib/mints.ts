/**
 * Live Minting (F-405) over `POST /analytics/query`. Mints are the ledger's
 * decoded `property_minted` events (decoder `mint.ts`: Upland `a4`, `a44`,
 * `i44`), refreshed every 15 min. The `events` source exposes plain columns
 * only (timestamp, event_type, action, property_id, account, amount_upx,
 * city_id "City, RG", …); the address and the minter's username are looked
 * up in the `properties` and `accounts` sources by id.
 *
 * Mint type: the ledger's decoder records `a4` as "FSA property purchase
 * settled in UPX" (mint_kind `fsa_upx`) and `a44`/`i44` as mints with no
 * UPX transfer. So "FSA" here is exactly the `a4` action, as the ledger
 * classifies it.
 *
 * Specs are built at fetch time (the 24 h window ends "now"); everything
 * here is pure and tested.
 */
import type { QueryResult, QuerySpec } from '@embers/ledger';

export const MINT_EVENT = 'property_minted';
/** The decoder's UPX-settled FSA mint action. */
export const FSA_ACTION = 'a4';

const HOUR = 3_600_000;
const mintFilter = { field: 'event_type', op: 'eq', value: MINT_EVENT } as const;

function span(now: number, hours: number): { after: string; before: string } {
  return { after: new Date(now - hours * HOUR).toISOString(), before: new Date(now).toISOString() };
}

/** Mints in the last 24 h by action and city: the KPI tiles. */
export function mintKpiSpec(now: number): QuerySpec {
  return {
    source: 'events',
    range: span(now, 24),
    filters: [mintFilter],
    dimensions: [{ field: 'action' }, { field: 'city_id' }],
    measures: [{ fn: 'count', alias: 'mints' }],
    limit: 2000,
  };
}

/** The 10 accounts that minted most in the last 24 h. */
export function topMintersSpec(now: number, n = 10): QuerySpec {
  return {
    source: 'events',
    range: span(now, 24),
    filters: [mintFilter],
    dimensions: [{ field: 'account' }],
    measures: [{ fn: 'count', alias: 'mints' }],
    orderBy: [{ measure: 'mints', dir: 'desc' }],
    limit: n,
  };
}

/** The newest mints, one row per mint (within `days`). */
export function latestMintsSpec(now: number, limit = 50, days = 7): QuerySpec {
  return {
    source: 'events',
    range: span(now, days * 24),
    filters: [mintFilter],
    dimensions: [{ field: 'timestamp' }, { field: 'property_id' }, { field: 'account' }, { field: 'action' }],
    measures: [{ fn: 'max', field: 'amount_upx', alias: 'mint_price_upx' }],
    orderBy: [{ dimension: 0, dir: 'desc' }],
    limit,
  };
}

/** Address and place for a set of property ids (the property dimension). */
export function propertyLookupSpec(ids: readonly string[]): QuerySpec {
  return {
    source: 'properties',
    filters: [{ field: 'property_id', op: 'in', value: [...ids] }],
    dimensions: [{ field: 'property_id' }, { field: 'address' }, { field: 'city' }, { field: 'neighborhood' }],
    measures: [{ fn: 'count', alias: 'n' }],
    limit: Math.max(1, ids.length),
  };
}

/** Upland usernames for a set of chain accounts. */
export function accountLookupSpec(accounts: readonly string[]): QuerySpec {
  return {
    source: 'accounts',
    filters: [{ field: 'account', op: 'in', value: [...accounts] }],
    dimensions: [{ field: 'account' }, { field: 'username' }],
    measures: [{ fn: 'count', alias: 'n' }],
    limit: Math.max(1, accounts.length),
  };
}

/* --- reading results ------------------------------------------------------------ */

type Cell = string | number | null;

/** The rows as objects keyed by column name. */
export function rowsOf(result: QueryResult): Array<Record<string, Cell>> {
  const names = result.columns.map((c) => c.name);
  return result.rows.map((row) => Object.fromEntries(names.map((n, i) => [n, row[i] ?? null])));
}

const str = (v: Cell | undefined): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const num = (v: Cell | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);

export interface MintKpis {
  total: number;
  fsa: number;
  /** The city with most mints ("Las Vegas, NV"), null when there were none. */
  topCity: { city: string; mints: number } | null;
}

export function mintKpis(result: QueryResult): MintKpis {
  const byCity = new Map<string, number>();
  let total = 0;
  let fsa = 0;
  for (const r of rowsOf(result)) {
    const n = num(r.mints);
    total += n;
    if (str(r.action) === FSA_ACTION) fsa += n;
    const city = str(r.city_id);
    if (city !== '') byCity.set(city, (byCity.get(city) ?? 0) + n);
  }
  let topCity: MintKpis['topCity'] = null;
  for (const [city, mints] of byCity) {
    if (topCity === null || mints > topCity.mints || (mints === topCity.mints && city < topCity.city)) topCity = { city, mints };
  }
  return { total, fsa, topCity };
}

export interface Minter {
  rank: number;
  account: string;
  mints: number;
}

export function topMinters(result: QueryResult): Minter[] {
  return rowsOf(result)
    .map((r) => ({ account: str(r.account), mints: num(r.mints) }))
    .filter((m) => m.account !== '')
    .sort((a, b) => b.mints - a.mints || a.account.localeCompare(b.account))
    .map((m, i) => ({ rank: i + 1, ...m }));
}

export interface MintRow {
  /** timestamp + property: one mint. */
  key: string;
  timestamp: string;
  property_id: string;
  account: string;
  action: string;
  fsa: boolean;
  /** null when the mint carried no price. */
  mint_price_upx: number | null;
}

export function latestMints(result: QueryResult): MintRow[] {
  return rowsOf(result)
    .map((r) => {
      const price = r.mint_price_upx;
      const action = str(r.action);
      return {
        key: `${str(r.timestamp)}|${str(r.property_id)}`,
        timestamp: str(r.timestamp),
        property_id: str(r.property_id),
        account: str(r.account),
        action,
        fsa: action === FSA_ACTION,
        mint_price_upx: typeof price === 'number' && price > 0 ? price : null,
      };
    })
    .filter((m) => m.property_id !== '')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : a.property_id.localeCompare(b.property_id)));
}

export interface PlaceInfo {
  address: string;
  city: string;
  neighborhood: string;
}

export function placesById(result: QueryResult): Map<string, PlaceInfo> {
  const out = new Map<string, PlaceInfo>();
  for (const r of rowsOf(result)) {
    const id = str(r.property_id);
    if (id !== '') out.set(id, { address: str(r.address), city: str(r.city), neighborhood: str(r.neighborhood) });
  }
  return out;
}

export function usernamesByAccount(result: QueryResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rowsOf(result)) {
    const account = str(r.account);
    const username = str(r.username);
    if (account !== '' && username !== '') out.set(account, username);
  }
  return out;
}

/** Distinct values in first-seen order, for the lookup specs (and their cache keys). */
export function distinct(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => v !== ''))];
}
