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

## Data

The Upland Ledger is Embers' backend. The web server reaches it at
`LEDGER_URL` (server-only; see `.env.example`), optionally through an
authenticating proxy (`LEDGER_API_KEY`). The browser only ever calls
same-origin `/bff/ledger/*`.

## Commands

- `make setup`: install and build the packages
- `make lint`: eslint and `tsc --strict` everywhere
- `make test` / `make test-coverage`: unit tests
- `make dev`: run the web app
- `make e2e`: Playwright
