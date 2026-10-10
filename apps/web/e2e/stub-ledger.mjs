// A stand-in Upland Ledger for e2e: serves the captured examples in
// @embers/ledger/examples as /v1/* (GET), so the browser → BFF → ledger
// path runs for real. `?__status=500` or `?__empty=1` force those answers;
// `?__delay=ms` delays it. `POST /v1/analytics/query` answers by the spec's
// shape: e2e fixtures (test data, not captures) for the property and event
// specs the pages send, and for anything else a well-formed result in the
// shape the spec asks for, with names from the captured accounts.
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
  [/^\/v1\/offers$/, 'GET_offers'],
  [/^\/v1\/market\/upx-usd$/, 'GET_market_upx-usd'],
  [/^\/v1\/market\/cities$/, 'GET_market_cities'],
  [/^\/v1\/neighborhoods$/, 'GET_neighborhoods'],
  [/^\/v1\/analytics\/sales$/, 'GET_analytics_sales'],
  [/^\/v1\/accounts$/, 'GET_accounts'],
  [/^\/v1\/accounts\/[a-z1-5.]+\/actions$/, 'GET_accounts_{account}_actions'],
  [/^\/v1\/accounts\/[a-z1-5.]+$/, 'GET_accounts_{account}'],
  [/^\/v1\/analytics\/overview$/, 'GET_analytics_overview'],
  [/^\/v1\/analytics\/timeseries$/, 'GET_analytics_timeseries'],
  [/^\/v1\/treasures$/, 'GET_treasures'],
];
const FIXTURES = path.resolve(here, 'fixtures');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const example = (name) => readJson(path.join(EX, `${name}.json`));

/** Account → username: the captured accounts plus the Live Minting fixture's names. */
function knownNames() {
  const names = new Map([...example('GET_accounts').data, example('GET_accounts_{account}')].map((a) => [a.account, a.username]));
  for (const [account, username] of readJson(path.join(FIXTURES, 'mints-names.json')).rows) if (!names.has(account)) names.set(account, username);
  return names;
}

/** A result in the spec's own shape (its dimensions and measure aliases), a few rows of plausible values. */
function shapedAnswer(spec) {
  const names = knownNames();
  const dims = (spec.dimensions ?? []).map((d) => d.field ?? (d.time ? d.time.bucket : 'bin'));
  const measures = (spec.measures ?? []).map((m, i) => m.alias ?? `m${i}`);
  const columns = [...dims.map((name) => ({ name, type: 'string' })), ...measures.map((name) => ({ name, type: 'number' }))];
  const filtered = (spec.filters ?? []).find((f) => f.field === 'account' && f.op === 'in');
  const keys = filtered ? filtered.value.filter((a) => names.has(a)) : [...names.keys()];
  const value = (dim, key, i) => {
    if (dim === 'username' || dim === 'user_name') return names.get(key) ?? `player${i + 1}`;
    if (dim === 'city') return 'Cleveland';
    return key;
  };
  const rows = dims.length === 0 ? [measures.map((_, j) => 1234 * (j + 1))] : keys.map((key, i) => [...dims.map((d) => value(d, key, i)), ...measures.map((_, j) => (keys.length - i) * 10 * (j + 1))]);
  return { columns, rows, stats: { rows: rows.length, elapsed_ms: 1, rows_read: rows.length, bytes_read: 0, truncated: false, table: spec.source, dedup: 'exact' }, sql: '-- stub', chain: 'upland' };
}

/** The answer for a query spec: the page-specific fixtures first, then a result shaped like the spec. */
function queryAnswer(spec) {
  const fields = (spec.dimensions ?? []).map((d) => d.field ?? '?');
  const dims = fields.join(',');
  const minted = (spec.filters ?? []).some((f) => f.field === 'event_type' && f.value === 'property_minted');
  // Live Minting (F-405).
  if (spec.source === 'events' && minted) {
    if (dims === 'action,city_id') return readJson(path.join(FIXTURES, 'mints-kpis.json'));
    if (dims === 'account') return readJson(path.join(FIXTURES, 'mints-top.json'));
    if (dims.startsWith('timestamp')) return readJson(path.join(FIXTURES, 'mints-latest.json'));
  }
  if (spec.source === 'properties' && dims.startsWith('property_id')) return readJson(path.join(FIXTURES, 'mints-places.json'));
  // Properties analytics (F-401, F-402, F-408).
  if (spec.source === 'events') return readJson(path.join(FIXTURES, 'query_minters.json'));
  if (spec.source === 'properties' && fields.includes('api_status')) return readJson(path.join(FIXTURES, 'query_status.json'));
  if (spec.source === 'properties' && fields.includes('mint_kind')) return readJson(path.join(FIXTURES, 'query_mints.json'));
  if (spec.source === 'properties') return readJson(path.join(FIXTURES, 'query_neighborhoods.json'));
  // Users, leaderboards, Home, and account → username lookups.
  return shapedAnswer(spec);
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
    if (req.method === 'POST' && url.pathname === '/v1/analytics/query') {
      let spec;
      try {
        spec = JSON.parse(raw || '{}');
      } catch {
        return send(400, { error: { code: 'validation_error', message: 'body is not JSON' } });
      }
      return send(200, queryAnswer(spec));
    }
    const hit = RULES.find(([re]) => re.test(url.pathname));
    if (!hit) return send(404, { error: { code: 'not_found', message: 'no such route' } });
    const body = example(hit[1]);
    if (url.searchParams.get('__empty') === '1' && Array.isArray(body.data)) return send(200, { ...body, data: [], has_more: false });
    // The order book holds one currency per listing: answer `book=` honestly.
    const book = url.searchParams.get('book');
    if (hit[1] === 'GET_listings' && (book === 'upx' || book === 'fiat')) {
      const data = body.data.filter((l) => (book === 'upx' ? l.ask_upx > 0 : l.ask_fiat > 0));
      return send(200, { ...body, data, count: data.length, has_more: false });
    }
    return send(200, body);
  }, delay);
}
