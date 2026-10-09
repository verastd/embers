/**
 * The Upland Ledger gateway: Embers' server forwards one allowlisted request
 * to the ledger and hands back its status and JSON body. The browser only
 * ever talks to same-origin `/bff/ledger/*`; it never sees the ledger's URL
 * or credentials.
 *
 * Ported from FORGE's forge-api gateway (same allowlist, limits and
 * deadlines). LEDGER_URL is the base the ledger path is appended to: the
 * forge-api gateway (`https://…/api/ledger`, TD's access decision) or a
 * ledger directly (`http://127.0.0.1:3000/v1`). What goes up: `Accept:
 * application/json`, the POST body as JSON, and the `Authorization` header
 * the route handler supplies (a short-lived forge-api assertion). No header
 * of the caller's is ever forwarded.
 *
 * Every answer carries `x-request-id`. Errors the gateway produces use the
 * PRD §10 envelope: `{ error: { code, message, request_id, retryable } }`.
 * The ledger's own errors (`{ error: { code, message } }`) pass through
 * unchanged apart from the header.
 */

export type Method = 'GET' | 'POST';

const PARAMS: Record<string, RegExp> = {
  // An Antelope account or contract name: up to 12 of [a-z1-5.], or 12 plus a 13th of [a-j1-5].
  account: /^(?:[a-z1-5.]{1,12}|[a-z1-5.]{12}[a-j1-5])$/,
  contract: /^(?:[a-z1-5.]{1,12}|[a-z1-5.]{12}[a-j1-5])$/,
  globalSequence: /^[0-9]{1,20}$/,
  propertyId: /^[0-9]{1,20}$/,
  trxId: /^[0-9a-fA-F]{64}$/,
};

const GET_TEMPLATES = [
  'accounts',
  'accounts/{account}',
  'accounts/{account}/actions',
  'actions',
  'actions/{globalSequence}',
  'analytics/accounts/top',
  'analytics/calendar',
  'analytics/flows',
  'analytics/keys',
  'analytics/overview',
  'analytics/sales',
  'analytics/timeseries',
  'chains',
  'collections',
  'contracts',
  'contracts/{contract}/actions',
  'ingest/windows',
  'listings',
  'market/cities',
  'market/fiat',
  'market/upx-usd',
  'neighborhoods',
  'offers',
  'properties',
  'properties/{propertyId}',
  'properties/{propertyId}/history',
  'rates',
  'sales',
  'search',
  'signals',
  'stats/actions',
  'status',
  'transactions/{trxId}',
  'transfers',
  'treasures',
] as const;
const POST_TEMPLATES = ['analytics/query'] as const;

const ROUTES: ReadonlyArray<{ method: Method; segments: string[] }> = [
  ...GET_TEMPLATES.map((t) => ({ method: 'GET' as const, segments: t.split('/') })),
  ...POST_TEMPLATES.map((t) => ({ method: 'POST' as const, segments: t.split('/') })),
];

/** True when `method` + `segments` (the path below /v1/) match one allowlisted route exactly. */
export function isAllowed(method: Method, segments: readonly string[]): boolean {
  return ROUTES.some(
    (r) =>
      r.method === method &&
      r.segments.length === segments.length &&
      r.segments.every((tpl, i) => {
        const seg = segments[i] ?? '';
        if (tpl.startsWith('{')) return PARAMS[tpl.slice(1, -1)]?.test(seg) ?? false;
        return tpl === seg;
      }),
  );
}

export const LIMITS = {
  maxQueryBytes: 4 * 1024,
  maxBodyBytes: 16 * 1024,
  maxResponseBytes: 8 * 1024 * 1024,
  connectTimeoutMs: 3_000,
  totalTimeoutMs: 25_000,
} as const;

export interface GatewayError {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

const ERRORS = {
  not_found: { status: 404, message: 'No such ledger route.', retryable: false },
  query_too_long: { status: 414, message: 'The query string is too long.', retryable: false },
  too_large: { status: 413, message: 'The request body is too large.', retryable: false },
  unsupported_media_type: { status: 415, message: 'Send JSON.', retryable: false },
  ledger_not_configured: { status: 503, message: 'The ledger connection is not configured.', retryable: false },
  ledger_timeout: { status: 504, message: 'The ledger did not answer in time.', retryable: true },
  ledger_unavailable: { status: 502, message: 'The ledger is unreachable.', retryable: true },
  ledger_response_too_large: { status: 502, message: 'The ledger answer was too large.', retryable: false },
  ledger_bad_response: { status: 502, message: 'The ledger answered with something that is not JSON.', retryable: true },
} as const satisfies Record<string, Omit<GatewayError, 'code'>>;

export type GatewayErrorCode = keyof typeof ERRORS;

export function gatewayError(code: GatewayErrorCode): GatewayError {
  return { code, ...ERRORS[code] };
}

export function errorBody(err: GatewayError, requestId: string): string {
  return JSON.stringify({ error: { code: err.code, message: err.message, request_id: requestId, retryable: err.retryable } });
}

/** LEDGER_URL without a trailing slash, or null when it is not a plain http(s) URL with a host. */
export function ledgerBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.search || u.hash || u.username || u.password) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export interface ForwardInput {
  method: Method;
  segments: readonly string[];
  query: string;
  body?: string;
  contentType?: string | null;
}

export interface ForwardResult {
  status: number;
  body: string;
}

export interface ForwardDeps {
  baseUrl: string | null;
  /** The whole Authorization header value, e.g. `Bearer <jwt>`. */
  authorization?: string;
  fetch: typeof fetch;
}

/** Validates and forwards. Never throws: every failure is a GatewayError. */
export async function forward(input: ForwardInput, deps: ForwardDeps): Promise<ForwardResult | GatewayError> {
  if (!isAllowed(input.method, input.segments)) return gatewayError('not_found');
  if (new TextEncoder().encode(input.query).length > LIMITS.maxQueryBytes) return gatewayError('query_too_long');
  if (input.method === 'POST') {
    if (!(input.contentType ?? '').toLowerCase().startsWith('application/json')) return gatewayError('unsupported_media_type');
    if (new TextEncoder().encode(input.body ?? '').length > LIMITS.maxBodyBytes) return gatewayError('too_large');
  }
  if (!deps.baseUrl) return gatewayError('ledger_not_configured');

  const url = `${deps.baseUrl}/${input.segments.map(encodeURIComponent).join('/')}${input.query ? `?${input.query}` : ''}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (input.method === 'POST') headers['content-type'] = 'application/json';
  if (deps.authorization) headers.authorization = deps.authorization;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.totalTimeoutMs);
  try {
    const res = await deps.fetch(url, { method: input.method, headers, body: input.method === 'POST' ? input.body : undefined, redirect: 'manual', signal: controller.signal });
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > LIMITS.maxResponseBytes) return gatewayError('ledger_response_too_large');
    const text = await res.text();
    if (new TextEncoder().encode(text).length > LIMITS.maxResponseBytes) return gatewayError('ledger_response_too_large');
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!type.startsWith('application/json')) return gatewayError('ledger_bad_response');
    try {
      JSON.parse(text);
    } catch {
      return gatewayError('ledger_bad_response');
    }
    return { status: res.status, body: text };
  } catch {
    return controller.signal.aborted ? gatewayError('ledger_timeout') : gatewayError('ledger_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export function isGatewayError(x: ForwardResult | GatewayError): x is GatewayError {
  return 'code' in x;
}
