/**
 * The Authorization header for the ledger upstream (TD's access decision:
 * Embers mints forge-api assertions).
 *
 *   FORGE_API_ASSERTION_SECRET  the shared HS256 secret (set in Embers' deploy env)
 *   EMBERS_LEDGER_SUB / EMBERS_LEDGER_LOGIN
 *                               the GitHub identity public (signed-out) reads go
 *                               out as: a numeric GitHub user id and its login
 *
 * A signed-in visitor's reads go out as that visitor, so forge-api sees who is
 * really reading. With no secret set the upstream is assumed to be a ledger
 * that needs no auth (local development, the e2e stub) and nothing is sent.
 */
import { AuthError, mintApiAssertion } from '@embers/auth';
import type { ApiIdentity } from '@embers/auth';

export type LedgerAuth = { ok: true; authorization?: string } | { ok: false; reason: 'no_identity' | 'bad_config' };

export interface LedgerAuthEnv {
  FORGE_API_ASSERTION_SECRET?: string;
  EMBERS_LEDGER_SUB?: string;
  EMBERS_LEDGER_LOGIN?: string;
}

export async function ledgerAuthorization(visitor: ApiIdentity | null, env: LedgerAuthEnv & Record<string, string | undefined> = process.env, now?: number): Promise<LedgerAuth> {
  const secret = env.FORGE_API_ASSERTION_SECRET;
  if (!secret) return { ok: true };
  const service = env.EMBERS_LEDGER_SUB && env.EMBERS_LEDGER_LOGIN ? { sub: env.EMBERS_LEDGER_SUB, login: env.EMBERS_LEDGER_LOGIN } : null;
  const who = visitor ?? service;
  if (!who) return { ok: false, reason: 'no_identity' };
  try {
    return { ok: true, authorization: `Bearer ${await mintApiAssertion(who, secret, { ttlSeconds: 60, now })}` };
  } catch (e) {
    // A weak secret or a malformed service identity: a deployment problem, logged by code only.
    console.warn(`ledger assertion not minted: ${e instanceof AuthError ? e.code : 'unexpected'}`);
    return { ok: false, reason: 'bad_config' };
  }
}
