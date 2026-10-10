// A stand-in Upland Ledger for e2e: serves the captured examples in
// @embers/ledger/examples as /v1/* (GET), so the browser → BFF → ledger
// path runs for real. `?__status=500` or `?__empty=1` force those answers;
// `?__delay=ms` delays it. POST /v1/analytics/query answers by the spec's
// shape: the Live Minting specs get the fixtures in e2e/fixtures/ (test
// data, not captures); anything else gets the captured example.
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
];
const FIXTURES = path.resolve(here, 'fixtures');

/** Which file answers an analytics query spec. */
function queryFile(spec) {
  const dims = (spec.dimensions ?? []).map((d) => d.field ?? '?').join(',');
  const minted = (spec.filters ?? []).some((f) => f.field === 'event_type' && f.value === 'property_minted');
  if (spec.source === 'events' && minted) {
    if (dims === 'action,city_id') return path.join(FIXTURES, 'mints-kpis.json');
    if (dims === 'account') return path.join(FIXTURES, 'mints-top.json');
    if (dims.startsWith('timestamp')) return path.join(FIXTURES, 'mints-latest.json');
  }
  if (spec.source === 'properties' && dims.startsWith('property_id')) return path.join(FIXTURES, 'mints-places.json');
  if (spec.source === 'accounts' && dims === 'account,username') return path.join(FIXTURES, 'mints-names.json');
  return path.join(EX, 'POST_analytics_query.json');
}
const port = Number(process.env.STUB_LEDGER_PORT || 4010);

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const delay = Number(url.searchParams.get('__delay') || 0);
  setTimeout(() => {
    if (url.searchParams.get('__status') === '500') return send(500, { error: { code: 'internal_error', message: 'boom' } });
    if (req.method === 'POST' && url.pathname === '/v1/analytics/query') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let spec = {};
        try {
          spec = JSON.parse(raw || '{}');
        } catch {
          return send(400, { error: { code: 'validation_error', message: 'invalid JSON' } });
        }
        return send(200, JSON.parse(readFileSync(queryFile(spec), 'utf8')));
      });
      return undefined;
    }
    const hit = RULES.find(([re]) => re.test(url.pathname));
    if (!hit) return send(404, { error: { code: 'not_found', message: 'no such route' } });
    const body = JSON.parse(readFileSync(path.join(EX, `${hit[1]}.json`), 'utf8'));
    if (url.searchParams.get('__empty') === '1' && Array.isArray(body.data)) return send(200, { ...body, data: [], has_more: false });
    return send(200, body);
  }, delay);
}).listen(port, '127.0.0.1');
