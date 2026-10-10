import { describe, expect, it } from 'vitest';

import { csvFileName, toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header and rows with CRLF line ends', () => {
    expect(toCsv(['Rank', 'Name'], [[1, 'kingbo'], [2, null]])).toBe('Rank,Name\r\n1,kingbo\r\n2,\r\n');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv(['a'], [['x,y'], ['say "hi"'], ['two\nlines']])).toBe('a\r\n"x,y"\r\n"say ""hi"""\r\n"two\nlines"\r\n');
  });

  it('defuses cells a spreadsheet would run as formulas, but not numbers', () => {
    expect(toCsv(['a'], [['=1+1'], ['@cmd'], [-5], [true]])).toBe("a\r\n'=1+1\r\n'@cmd\r\n-5\r\ntrue\r\n");
  });
});

describe('csvFileName', () => {
  it('slugs the stem and dates the file', () => {
    expect(csvFileName('Users leaderboard: UPX spent', Date.parse('2026-10-10T12:00:00Z'))).toBe('embers-users-leaderboard-upx-spent-2026-10-10.csv');
  });
});
