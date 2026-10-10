// A stand-in Upland Ledger for e2e: serves the captured examples in
// @embers/ledger/examples as /v1/* (GET), so the browser → BFF → ledger
// path runs for real. `?__status=500` or `?__empty=1` force those answers;
// `?__delay=ms` delays it. `POST /v1/analytics/query` answers in the shape
// the spec asks for (its dimensions and measure aliases), with names taken
// from the captured accounts, so every query spec gets a well-formed result.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EX = path.resolve(here, '../../../packages/ledger/examples');
const RULES = [
  [/^\/v1\/status$/, 'GET_status'],
  [/^\/v1\/search$/, 'GET_search'],
  [/^\/v1\/properties$/, 'GET_properties'],
  [/^\/v1\/properties\/\d+\/history$/, 'GET_properties_{propertyId}_history'],
  [/^\/v1\/properties\/\d+$/, 'GET_properties_{propertyId}'],
  [/^\/v1\/ingest\/windows$/, 'GET_ingest_windows'],
  [/^\/v1\/sales$/, 'GET_sales'],
  [/^\/v1\/listings$/, 'GET_listings'],
  [/^\/v1\/accounts$/, 'GET_accounts'],
  [/^\/v1\/accounts\/[a-z1-5.]+\/actions$/, 'GET_accounts_{account}_actions'],
  [/^\/v1\/accounts\/[a-z1-5.]+$/, 'GET_accounts_{account}'],
  [/^\/v1\/analytics\/overview$/, 'GET_analytics_overview'],
  [/^\/v1\/analytics\/timeseries$/, 'GET_analytics_timeseries'],
  [/^\/v1\/treasures$/, 'GET_treasures'],
];

const example = (name) => JSON.parse(readFileSync(path.join(EX, `${name}.json`), 'utf8'));

/** A result for an analytics query spec: its columns, a few rows of plausible values. */
function analyticsAnswer(spec) {
  const accounts = [...example('GET_accounts').data, example('GET_accounts_{account}')];
  const names = new Map(accounts.map((a) => [a.account, a.username]));
  const dims = (spec.dimensions ?? []).map((d) => d.field ?? (d.time ? d.time.bucket : 'bin'));
  const measures = (spec.measures ?? []).map((m, i) => m.alias ?? `m${i}`);
  const columns = [...dims.map((name) => ({ name, type: 'string' })), ...measures.map((name) => ({ name, type: 'number' }))];
  const filtered = (spec.filters ?? []).find((f) => f.field === 'account' && f.op === 'in');
  const keys = filtered ? filtered.value.filter((a) => names.has(a)) : accounts.map((a) => a.account);
  const value = (dim, key, i) => {
    if (dim === 'username' || dim === 'user_name') return names.get(key) ?? `player${i + 1}`;
    if (dim === 'city') return 'Cleveland';
    return key;
  };
  const rows = dims.length === 0 ? [measures.map((_, j) => 1234 * (j + 1))] : keys.map((key, i) => [...dims.map((d) => value(d, key, i)), ...measures.map((_, j) => (keys.length - i) * 10 * (j + 1))]);
  return { columns, rows, stats: { rows: rows.length, elapsed_ms: 1, rows_read: rows.length, bytes_read: 0, truncated: false, table: spec.source, dedup: 'exact' }, sql: '-- stub', chain: 'upland' };
}
const port = Number(process.env.STUB_LEDGER_PORT || 4010);

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => answer(req, res, raw));
}).listen(port, '127.0.0.1');

function answer(req, res, raw) {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const delay = Number(url.searchParams.get('__delay') || 0);
  setTimeout(() => {
    if (url.searchParams.get('__status') === '500') return send(500, { error: { code: 'internal_error', message: 'boom' } });
    if (req.method === 'POST' && url.pathname === '/v1/analytics/query') return send(200, analyticsAnswer(JSON.parse(raw || '{}')));
    const hit = RULES.find(([re]) => re.test(url.pathname));
    if (!hit) return send(404, { error: { code: 'not_found', message: 'no such route' } });
    const body = example(hit[1]);
    if (url.searchParams.get('__empty') === '1' && Array.isArray(body.data)) return send(200, { ...body, data: [], has_more: false });
    return send(200, body);
  }, delay);
}
