import { AccountPageSchema, SearchResultSchema } from '@embers/ledger';
import { describe, expect, it } from 'vitest';

import { searchRows } from '@/components/shell/search';

import { fixture } from './fixtures.test-helper';
import { LOOKUP_MAX_PAGES, LOOKUP_PAGE, displayName, lookupUser, notFoundMessage, previousUsernames, readUserParam, resolveUser, userHref } from './users';

const accounts = fixture('GET_accounts', AccountPageSchema).data;

describe('readUserParam', () => {
  it('decodes, trims and bounds the segment', () => {
    expect(readUserParam('kingbo')).toBe('kingbo');
    expect(readUserParam(' King%20Bo ')).toBe('King Bo');
    expect(readUserParam(['first', 'second'])).toBe('first');
    expect(readUserParam('100%')).toBe('100%');
  });

  it('rejects empty, missing and oversized segments', () => {
    expect(readUserParam(undefined)).toBeNull();
    expect(readUserParam('   ')).toBeNull();
    expect(readUserParam('x'.repeat(65))).toBeNull();
  });
});

describe('resolveUser', () => {
  it('picks the exact username out of a substring match, case-insensitively', () => {
    expect(resolveUser('FreakyMan51', accounts)).toEqual({ kind: 'account', account: 'oumfkb1vplp5', via: 'username' });
  });

  it('falls back to an earlier username', () => {
    const rows = [{ account: 'abc12345abcd', username: 'newname', usernames: ['oldname', 'newname'] }];
    expect(resolveUser('OldName', rows)).toEqual({ kind: 'account', account: 'abc12345abcd', via: 'previous-username' });
  });

  it('treats a valid account name as the account when no username matches', () => {
    expect(resolveUser('ymc55j4fboxi', [])).toEqual({ kind: 'account', account: 'ymc55j4fboxi', via: 'account' });
  });

  it('finds nothing for a name that is neither', () => {
    expect(resolveUser('No_Such_User', accounts)).toEqual({ kind: 'none' });
  });
});

describe('names and links', () => {
  it('lists earlier usernames without the current one', () => {
    expect(previousUsernames({ account: 'a', username: 'Now', usernames: ['before', 'now'] })).toEqual(['before']);
  });

  it('shows the username, else the account', () => {
    expect(displayName({ account: 'abc', username: 'kingbo' })).toBe('kingbo');
    expect(displayName({ account: 'abc', username: ' ' })).toBe('abc');
  });

  it('links to the profile with the name encoded', () => {
    expect(userHref('king bo')).toBe('/users/king%20bo');
  });

  it('offers users in the global search, linking to their profiles', () => {
    const rows = searchRows(fixture('GET_search', SearchResultSchema));
    const users = rows.filter((r) => r.kind === 'User');
    expect(users.map((r) => r.href)).toEqual(['/users/multimaine', '/users/leromain']);
    expect(users[0]?.label).toBe('multimaine · srexinftriez');
    expect(searchRows({ query: 'x', accounts: [{ account: 'abc', username: '', buys: 0, sells: 0, likely_bot: false }] })[0]?.href).toBe('/users/abc');
  });
});

describe('lookupUser (Codex review on #11)', () => {
  type Row = { account: string; username: string; usernames: string[] };
  // 250 players whose names contain "bo", ranked ahead of the one actually called "Bo".
  const many: Row[] = Array.from({ length: 250 }, (_, i) => ({ account: `acct${i}`, username: `bo${i}x`, usernames: [`bo${i}x`] }));
  const pages = (rows: Row[]) => {
    const calls: number[] = [];
    const fetchPage = async ({ offset, limit }: { offset: number; limit: number }) => {
      calls.push(offset);
      return { data: rows.slice(offset, offset + limit), has_more: offset + limit < rows.length };
    };
    return { calls, fetchPage };
  };

  it('finds an exact current username past the first page', async () => {
    const { calls, fetchPage } = pages([...many, { account: 'realbo12345a', username: 'Bo', usernames: ['Bo'] }]);
    const found = await lookupUser('bo', fetchPage);
    expect(found.resolution).toEqual({ kind: 'account', account: 'realbo12345a', via: 'username' });
    expect(calls).toEqual([0, 100, 200]);
    expect(found.complete).toBe(true);
  });

  it('stops at the first page holding the exact name', async () => {
    const { calls, fetchPage } = pages([{ account: 'abc', username: 'kingbo', usernames: ['kingbo'] }, ...many]);
    expect((await lookupUser('KINGBO', fetchPage)).resolution).toEqual({ kind: 'account', account: 'abc', via: 'username' });
    expect(calls).toEqual([0]);
  });

  it('resolves an earlier username when the current one contains it', async () => {
    const { fetchPage } = pages([{ account: 'renamed1', username: 'oldname_v2', usernames: ['oldname', 'oldname_v2'] }]);
    expect((await lookupUser('oldname', fetchPage)).resolution).toEqual({ kind: 'account', account: 'renamed1', via: 'previous-username' });
  });

  it('cannot resolve an earlier username the current one does not contain, and says why', async () => {
    const { fetchPage } = pages([]);
    const found = await lookupUser('former_name', fetchPage);
    expect(found).toEqual({ resolution: { kind: 'none' }, scanned: 0, complete: true });
    expect(notFoundMessage('former_name', found)).toBe(
      'No Upland player currently uses the username “former_name”. Earlier usernames can’t be searched yet, so a player who has renamed is not found by an old name.',
    );
  });

  it('stops at the cap and says the search was cut short', async () => {
    const endless = Array.from({ length: LOOKUP_PAGE * (LOOKUP_MAX_PAGES + 2) }, (_, i) => ({ account: `a${i}`, username: `zz${i}`, usernames: [] }));
    const { calls, fetchPage } = pages(endless);
    const found = await lookupUser('zz_', fetchPage);
    expect(calls).toHaveLength(LOOKUP_MAX_PAGES);
    expect(found).toEqual({ resolution: { kind: 'none' }, scanned: 1000, complete: false });
    expect(notFoundMessage('zz_', found)).toMatch(/^No exact match for “zz_” among the first 1,000 usernames that contain it\. Try a longer name\./);
  });

  it('explains an empty segment', () => {
    expect(notFoundMessage('', null)).toBe('That is not a username or EOS account.');
  });
});
