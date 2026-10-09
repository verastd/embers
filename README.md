# Embers

Live Upland analytics: property markets, sparklet staking, community nodes and
treasure timers, in one dashboard. The product spec is [`PRD (5).md`](./PRD%20(5).md)
(v1.0, 2026-09-25); build order follows its section 14 phases.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 15 app (App Router, TypeScript strict) |
| `apps/web/src/app/bff/ledger/[...path]` | The browser's only route to the Upland Ledger (allowlisted, server-side) |
| `packages/ui` (`@embers/ui`) | The Embers design system: tokens, fonts, theme and every component. Feature code imports UI only from here (PRD 6.5) |
| `packages/ledger` (`@embers/ledger`) | OpenAPI contract, zod schemas and typed client for the Upland Ledger API |
| `packages/auth` (`@embers/auth`) | Sign in with GitHub: PKCE, sealed session cookies, key rotation (Edge-safe) |
| `packages/eslint-plugin` | PRD §5.9 / §6.5 lint enforcement |

The packages ship TypeScript source; nothing needs building before `pnpm dev`.

## Data

The Upland Ledger is Embers' backend. The web server reaches it at
`LEDGER_URL` (server-only; see `.env.example`). In production that is
FORGE's forge-api gateway, which needs a short-lived assertion signed with
`FORGE_API_ASSERTION_SECRET`: a signed-in visitor's reads go out as that
visitor, signed-out reads as `EMBERS_LEDGER_SUB`/`EMBERS_LEDGER_LOGIN`.
The ledger itself has no public route. The browser only ever calls
same-origin `/bff/ledger/*`.

## Sign-in

GitHub sign-in. Register a GitHub OAuth app whose callback URL is
`<EMBERS_PUBLIC_ORIGIN>/auth/callback`, then set `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `EMBERS_PUBLIC_ORIGIN` and `EMBERS_SESSION_SECRET`
(see `.env.example`). Without them the app runs signed-out and says
sign-in is unavailable. Embers reads the GitHub profile once and revokes
the token; it stores no GitHub token.

## Commands

- `make setup`: install
- `make lint`: eslint and `tsc --strict` everywhere
- `make test` / `make test-coverage`: unit tests
- `make dev`: run the web app
- `make e2e`: Playwright
