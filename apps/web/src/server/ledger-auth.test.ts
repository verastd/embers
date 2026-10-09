import { jwtVerify } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { ledgerAuthorization } from './ledger-auth';

const SECRET = 'forge-assertion-secret-0123456789abcdef';
const key = new TextEncoder().encode(SECRET);
const NOW = 1_791_584_000;

async function claims(header: string | undefined) {
  const token = (header ?? '').replace(/^Bearer /, '');
  return (await jwtVerify(token, key, { issuer: 'forge-web', audience: 'forge-api', currentDate: new Date(NOW * 1000) })).payload;
}

describe('ledgerAuthorization', () => {
  it('sends nothing when no assertion secret is configured (direct ledger)', async () => {
    expect(await ledgerAuthorization(null, {})).toEqual({ ok: true });
  });

  it('mints a 60 s forge-api assertion as the signed-in visitor', async () => {
    const res = await ledgerAuthorization({ sub: '4242', login: 'td' }, { FORGE_API_ASSERTION_SECRET: SECRET, EMBERS_LEDGER_SUB: '1', EMBERS_LEDGER_LOGIN: 'svc' }, NOW);
    expect(res.ok).toBe(true);
    const c = await claims(res.ok ? res.authorization : undefined);
    expect([c.sub, c.login, (c.exp ?? 0) - (c.iat ?? 0)]).toEqual(['4242', 'td', 60]);
  });

  it('falls back to the service identity for signed-out reads', async () => {
    const res = await ledgerAuthorization(null, { FORGE_API_ASSERTION_SECRET: SECRET, EMBERS_LEDGER_SUB: '320311834', EMBERS_LEDGER_LOGIN: 'verastd' }, NOW);
    const c = await claims(res.ok ? res.authorization : undefined);
    expect([c.sub, c.login]).toEqual(['320311834', 'verastd']);
  });

  it('refuses without any identity, or with a weak secret or a malformed service identity', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await ledgerAuthorization(null, { FORGE_API_ASSERTION_SECRET: SECRET })).toEqual({ ok: false, reason: 'no_identity' });
    expect(await ledgerAuthorization(null, { FORGE_API_ASSERTION_SECRET: 'short', EMBERS_LEDGER_SUB: '1', EMBERS_LEDGER_LOGIN: 'svc' })).toEqual({ ok: false, reason: 'bad_config' });
    expect(await ledgerAuthorization(null, { FORGE_API_ASSERTION_SECRET: SECRET, EMBERS_LEDGER_SUB: 'not-a-number', EMBERS_LEDGER_LOGIN: 'svc' })).toEqual({ ok: false, reason: 'bad_config' });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(SECRET);
  });
});
