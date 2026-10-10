// A stand-in Upland Ledger for e2e: serves the captured examples in
// @embers/ledger/examples as /v1/* (GET), so the browser → BFF → ledger
// path runs for real. `?__status=500` or `?__empty=1` force those answers;
// `?__delay=ms` delays it. `POST /v1/analytics/query` answers by the spec's
// source: the captured sales example, or an e2e fixture shaped like the
// ledger's answer for the property / event specs the pages send.
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
  [/^\/v1\/market\/cities$/, 'GET_market_cities'],
  [/^\/v1\/neighborhoods$/, 'GET_neighborhoods'],
  [/^\/v1\/analytics\/sales$/, 'GET_analytics_sales'],
];
const FIXTURES = path.resolve(here, 'fixtures');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The answer for a query spec: by source, then by what it groups on. */
function queryAnswer(spec) {
  const dims = (spec.dimensions ?? []).map((d) => d.field);
  if (spec.source === 'events') return readJson(path.join(FIXTURES, 'query_minters.json'));
  if (spec.source === 'properties' && dims.includes('mint_kind')) return readJson(path.join(FIXTURES, 'query_mints.json'));
  if (spec.source === 'properties') return readJson(path.join(FIXTURES, 'query_neighborhoods.json'));
  return readJson(path.join(EX, 'POST_analytics_query.json'));
}
const port = Number(process.env.STUB_LEDGER_PORT || 4010);

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const delay = Number(url.searchParams.get('__delay') || 0);
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => setTimeout(() => {
    if (url.searchParams.get('__status') === '500') return send(500, { error: { code: 'internal_error', message: 'boom' } });
    if (req.method === 'POST' && url.pathname === '/v1/analytics/query') {
      let spec;
      try {
        spec = JSON.parse(raw);
      } catch {
        return send(400, { error: { code: 'validation_error', message: 'body is not JSON' } });
      }
      return send(200, queryAnswer(spec));
    }
    const hit = RULES.find(([re]) => re.test(url.pathname));
    if (!hit) return send(404, { error: { code: 'not_found', message: 'no such route' } });
    const body = readJson(path.join(EX, `${hit[1]}.json`));
    if (url.searchParams.get('__empty') === '1' && Array.isArray(body.data)) return send(200, { ...body, data: [], has_more: false });
    // The order book holds one currency per listing: answer `book=` honestly.
    const book = url.searchParams.get('book');
    if (hit[1] === 'GET_listings' && (book === 'upx' || book === 'fiat')) {
      const data = body.data.filter((l) => (book === 'upx' ? l.ask_upx > 0 : l.ask_fiat > 0));
      return send(200, { ...body, data, count: data.length, has_more: false });
    }
    return send(200, body);
  }, delay));
}).listen(port, '127.0.0.1');
