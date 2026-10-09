# PRD: Upland Analytics Platform (codename "Embers")

Version: 1.0
Date: 2026-09-25
Owner: TD
Audience: Claude Code (implementation agent) and human reviewers
Source material: `uplytics_raw_crawl.json` (Uplytics.org, crawled 2026-09-23, 60 routes) and `upxland_feature_map.md` (UPXLand.me, crawled 2026-09-23, 58 routes, source + live pass)

---

## 0. How to use this document (instructions for Claude Code)

1. Build in the phase order in section 14. Do not start a phase until the previous phase's acceptance tests pass.
2. Every feature has an ID (`F-xxx`). Reference the ID in branch names, commit messages, and test names.
3. Section 5 (State & Feedback Contract) is a hard requirement for every interactive element. A feature that ships any button, form, filter, table, chart, map, live feed, or API call without the full set of states defined in section 5 is failed, regardless of anything else it does.
4. Items marked **[ASSUMPTION]** are inferred because the source only exposed a description (login-gated Uplytics pages). Implement them as specified; they are flagged so the owner can correct them.
5. Items marked **[DECISION]** are listed again in section 15. Use the stated default until the owner changes it.
6. Enumerations (option lists) live in Appendix A. Use them verbatim. Do not invent options.
7. No placeholder UI, no "coming soon" controls, no TODO stubs in shipped routes. If a feature is not in the current phase, its route and menu entry do not exist yet.

---

## 1. Product summary

### 1.1 What this is
One web application that combines every feature of Uplytics (free, community analytics, 60+ tools) and UPXLand (freemium, transactional tools: staking hub, marketplace, balance, optimizer) for the Upland metaverse. It reads Upland public data and EOS on-chain data, stores and aggregates it, and presents search, analytics, live feeds, alerts, and account-linked tools.

### 1.2 Goals
- G1. Feature superset: every capability listed in section 3 exists in the product.
- G2. Where both sources implement the same capability, ship the stronger version (merge rule in 3.1).
- G3. Every interaction gives immediate, complete visual feedback (section 5).
- G4. Public analytics are fast: p75 route TTFB under 400 ms from edge cache, p75 table data under 1.5 s.
- G5. Freemium model with configurable entitlements, so any feature can move between tiers without a deploy.

### 1.3 Non-goals (v1)
- Native mobile apps (PWA only).
- Playing Upland inside the app. All in-game actions are deep links to `play.upland.me` or Upland transaction requests the user accepts in Upland.
- Custodial wallet features beyond the UPX platform balance defined in F-310.
- The unreleased Leagues/Teams/Riot-mode APIs seen in UPXLand code.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| UPX | Upland in-game currency |
| USD (in-game) | Upland fiat-backed balance |
| Sparklet (SPK) | Upland resource staked into structures; also bridged on/off Ethereum |
| SPH | Sparklet-hours. Construction cost unit |
| STEM | Upland resource consumed by features; sold in fixed USD packages |
| UP2 | Property area unit |
| Mint price | Original price of a property; basis of yield |
| Markup | `sale_price / mint_price * 100` |
| FSA | Fair Start Agreement properties (restricted to new players) |
| Node | Community-organized neighborhood group (Uplytics tracks a curated set) |
| OU | Office units; bond strength metric for commerce offices |
| Bond | Office built in neighborhood A by a player whose home is in neighborhood B |
| Mutual bond | Reciprocal bonds between two nodes |
| SSH | Sparklet Staking Hub: marketplace where builders pay UPX per SPH to stakers |
| Construction Hub | Upland's native contracting board (builder posts job, contractor accepts) |
| Metaventure / Showroom | Player-run in-game shop selling NFTs |
| Uppie | Resident NFT; merges up levels 1 to 10 |
| Block Explorer (BE) | Collectible NFT used for sends |
| Legit | Licensed collectible NFT (NFLPA, Football/Soccer, Racing, Spirit) |
| Structure Ornament (SO) | Decoration NFT applied to a structure, seasonal |
| Map Asset | Outdoor decoration NFT placed on a property |
| Send | Teleport of a block explorer to a property; pays a fee to the owner |
| Devshop | UPXLand-owned property where Upland transactions for the platform are accepted |
| Platform balance | UPX held by this platform per user (F-310) |
| Linked account | Platform user verified as owning an Upland account (F-303) |

---

## 3. Source comparison and merge decisions

### 3.1 Merge rule
For each capability: take the union of all filters, columns, actions, and views from both sources. Where the two conflict (different defaults, orderings, labels), use the UPXLand live-verified value for property/uppie/SSH tools and the Uplytics value for everything Uplytics owns alone, unless this section says otherwise.

### 3.2 Capability matrix

Legend: U = Uplytics, X = UPXLand, Pub = public, Log = login, B = Basic, P = Premium.

| # | Capability | Uplytics | UPXLand | Decision | Feature |
|---|---|---|---|---|---|
| 1 | Global user search (top bar) | No | Yes, recent history | Take X | F-101 |
| 2 | User profile (stats, assets, charts, map) | No (user activity only) | Yes, rich | Take X, add U's ledger activity tab | F-201, F-202 |
| 3 | Ledger action history "translated" | Yes (24h) | No | Take U, extend window | F-203 |
| 4 | Account anniversaries calendar | Yes | No | Take U | F-204 |
| 5 | P2P UPX transfers + deep trace | Yes | No | Take U | F-205 |
| 6 | Properties overview (all cities + city) | No | Yes | Take X | F-401, F-402 |
| 7 | Properties search | No (listings only) | Yes, extensive | Take X, add U's collection-tier, has-building, has-map-assets, residents columns | F-403 |
| 8 | Live property listings feed | Yes | No | Take U | F-404 |
| 9 | Live property minting feed | Yes | No | Take U | F-405 |
| 10 | Property transactions search | No | Yes (P) | Take X | F-406 |
| 11 | Property statistics charts | No | Yes | Take X | F-407 |
| 12 | Mint analytics (FSA, level, location filters) | Yes | No | Take U | F-408 |
| 13 | City release timelapse map | Yes | No | Take U | F-409 |
| 14 | Property appraiser | No | Yes (B) | Take X | F-410 |
| 15 | Watchlists | No | Yes (P) | Take X | F-411 |
| 16 | Construction history per address | Yes | Partial (staking log per building) | Merge: U's address timeline + X's building stake dialog | F-412 |
| 17 | Community nodes + node stats + compare + activity rank | Yes | No | Take U | F-501 to F-504 |
| 18 | Neighborhood explorer | Yes | No | Take U | F-505 |
| 19 | Resident analytics | Yes | No | Take U | F-506 |
| 20 | Commerce bonds per neighborhood | Partial | Yes, detailed | Take X as the neighborhood view | F-601 |
| 21 | Bonds planning (partners, prospector, node vs node, relocation) | Yes | No | Take U | F-602 |
| 22 | Bonds network, trade distances, offices, logistics | Yes | No | Take U | F-603 |
| 23 | Bonds / trade score leaderboard | Yes | No | Take U | F-604 |
| 24 | Structure reference + contract estimator | Yes | No | Take U | F-701 |
| 25 | Service structure planner | Yes | No | Take U | F-702 |
| 26 | Construction Hub live listings | No | Yes (B) | Take X | F-703 |
| 27 | Construction Hub push alerts | Chrome extension | Web push (B) | Take X web push; extension later | F-704 |
| 28 | Construction Hub analytics | Yes | No | Take U | F-705 |
| 29 | In-game sparklet feed (stake/unstake/build) | Yes | No | Take U | F-706 |
| 30 | Sparklet Staking Hub (listing, staking, payouts) | No | Yes | Take X | F-801 to F-806 |
| 31 | Sparklet bridge tracker | Yes | No | Take U | F-901 |
| 32 | Sparklet store tracker | Yes | No | Take U | F-902 |
| 33 | STEM analytics | Yes | No | Take U | F-903 |
| 34 | Live seed generation + seed stats | Yes | No | Take U | F-1001, F-1002 |
| 35 | Nurseries directory | Yes | No | Take U | F-1003 |
| 36 | Uppies search | No | Yes (B) | Take X | F-1101 |
| 37 | Uppie merge price live + history | Yes | No (merge lineage only) | Take U | F-1102, F-1103 |
| 38 | Asset explorer (by mint) | Yes | NFT search | Merge into one NFT explorer | F-1201 |
| 39 | Asset analytics (sales history, trending) | Yes | No | Take U | F-1202 |
| 40 | NFT creation feed | Yes | No | Take U | F-1203 |
| 41 | Showroom listings feed | Yes | Store detail pages | Merge: feed (U) + store directory/detail (X) | F-1204, F-1205 |
| 42 | Metaventure sales analytics | Yes | No | Take U | F-1206 |
| 43 | NFT transactions search | No | Yes (P) | Take X | F-1207 |
| 44 | Block explorer catalog | Yes | No | Take U | F-1208 |
| 45 | Structure ornament catalog | Yes | No | Take U | F-1209 |
| 46 | Featured shops (sponsor showcase) | Yes | Paid ad carousel | Merge into sponsor system | F-1210, F-1703 |
| 47 | P2P marketplace (bundles via devshops) | No | Yes | Take X | F-1301 to F-1304 |
| 48 | Treasure hunting live timers + push | No | Yes | Take X | F-1401 |
| 49 | Treasure hunt global yield report | Yes | No | Take U | F-1402 |
| 50 | Personal treasure hunt report | Yes (member) | No | Take U | F-1403 |
| 51 | Find my send | No | Yes | Take X | F-1501 |
| 52 | Travel path | No | Yes (B) | Take X | F-1502 |
| 53 | Sends analytics | Yes | No | Take U | F-1503 |
| 54 | Races feed, stats, track map, completionist | Yes | No | Take U | F-1601 to F-1604 |
| 55 | Daily active users | Yes | No | Take U | F-1605 |
| 56 | Leaderboards (users, properties, upland) | No | Yes | Take X | F-1606 |
| 57 | SSH leaderboards | No | Yes | Take X | F-806 |
| 58 | Portfolio tracker | Yes (member) | Profile stats | Merge | F-1801 |
| 59 | Ornament optimizer | Yes (member) | No | Take U | F-1802 |
| 60 | Collection optimizer | No | Yes (P) | Take X | F-1803 |
| 61 | Resident optimizer | Yes (member) | No | Take U | F-1804 |
| 62 | Asset mover | Yes (member + extension) | No | Take U | F-1805 |
| 63 | Factory manager | Yes (member) | No | Take U | F-1806 |
| 64 | Showroom manager | Yes (member) | No | Take U | F-1807 |
| 65 | My plants / inventory / visitors / legits | Yes (member) | Upland Assets tab | Merge | F-1808 |
| 66 | Platform UPX balance, deposit, withdraw, transfer | No | Yes | Take X | F-310 |
| 67 | Subscriptions and payments | Free | PayPal, UPX, MUT | Take X model, Stripe default | F-304 |
| 68 | Saved/import/export filters | No | Yes | Take X, apply to every filterable page | F-104 |
| 69 | Excel/CSV export | Some (service planner CSV) | Most tables | Every table | F-105 |
| 70 | Discord webhook notifications | Yes (listings per city, seed price, merge price) | No | Take U | F-1702 |
| 71 | Web push notifications | No | Yes | Take X | F-1701 |
| 72 | Community broadcasts (YouTube/X feed) | Yes | No | Take U | F-1901 |
| 73 | External tools directory | Yes | No | Take U | F-1902 |
| 74 | Devshops directory | No | Yes | Take X | F-1903 |
| 75 | New player wizard | No | Yes | Take X | F-1904 |
| 76 | Changelog, feedback, about, supporters | Yes | Imprint, privacy, troubleshoot | Union | F-1905 to F-1910 |
| 77 | Admin dashboard | Unknown | Yes | Take X, extend | F-2001 |
| 78 | Clocks UTC/PT, seed price in header | Yes | No | Take U | F-102 |
| 79 | Sidebar favorites | Yes | No | Take U | F-103 |
| 80 | Localized stubs (de/pt/sv) | No | Yes | Full i18n framework, English only at launch | NFR-8 |

---

## 4. Users, tiers, entitlements

### 4.1 Personas
- P1 Casual player: checks treasure timers, travel costs, a property value.
- P2 Property investor: searches listings by markup, tracks transactions, watchlists.
- P3 Builder: lists constructions on SSH, compares contract rates, plans service structures and bonds.
- P4 Staker: finds best UPX/SPH contracts, tracks payouts.
- P5 Collector/merchant: uppies, BEs, ornaments, showroom sales, metaventure analytics.
- P6 Node organizer: node stats, bond partners, residents.
- P7 Admin.

### 4.2 Tiers [DECISION D-1]
Default model: Uplytics gives its member suite away free, so gating those features behind payment would lose to a free competitor. Paid tiers carry cost-heavy or transactional features.

| Tier | Who | Entitlements (default) |
|---|---|---|
| Anonymous | Not logged in | All public analytics (every F-2xx to F-16xx page not listed below), live feeds, catalogs, leaderboards, travel/send tools, treasure timers (no push) |
| Free | Registered | Anonymous + global user search, user profiles, uppies search, travel path, appraiser, construction hub live listings, 1 saved filter set per page, 1 watchlist of 25 properties, push/Discord alerts (3 rules), linked-account member tools (F-1801, F-1802, F-1804 to F-1808), personal treasure report, SSH staking and listing (5% fee) |
| Basic | Paid | Free + unlimited saved filters, 5 watchlists x 250, 20 alert rules, platform balance log, multi-structure view, ads hidden on analytics pages |
| Premium | Paid | Basic + no ads anywhere, SSH listing fee 4%, sparklet staking logs, collection optimizer (30 runs/month), extended property search (all cities, 1,000 rows per load), property transactions search, NFT transactions search, unlimited watchlists, download all transactions, 100 alert rules |
| Admin | Staff | Everything + admin dashboard |

### 4.3 Entitlement system (F-305)
- Table `entitlements(feature_key, tier_min, limit_json)`. Every gated feature checks `can(user, feature_key)` server-side and client-side.
- Changing a row takes effect within 60 s without deploy (cache TTL 60 s).
- Gated UI shows the locked state from section 5.6 with the tier name and an upgrade CTA. Never hide a gated nav item; show a lock badge.
- Prices live in `plans` table. Launch prices mirror UPXLand: Basic $2.49/mo, $25/yr, 9,990 UPX/mo, 99,900 UPX/yr; Premium $5.99/mo, $60/yr. [DECISION D-2]

---

## 5. State & Feedback Contract (mandatory for every interactive element)

This section is non-negotiable. Implement the primitives in 5.1 first (Phase 0). Every feature must be built from them. Code review and CI enforce it (5.9).

### 5.1 Required primitives

| Primitive | Purpose |
|---|---|
| `<AsyncButton>` | Any button that triggers async work |
| `<DataState>` | Wraps any region that renders fetched data (table, card grid, chart, map, stat tile) |
| `<StatTile>` | KPI tile with its own loading/error |
| `<LiveIndicator>` | Connection and freshness badge for any live/polling feed |
| `<StepFlow>` | Multi-step flows (Upland transaction accept, deposit, list construction, buy bundle, connect account) |
| `<JobProgress>` | Long-running background jobs (optimizer, portfolio sync, exports over 2 s) |
| `<FilterBar>` | Filter forms with dirty/applied/applying states |
| `<InlineField>` | Inputs with validation, async validation, saving states |
| `<Toast>` | Result notifications |
| `<ConfirmDialog>` | Destructive actions |
| `<LockedFeature>` | Tier-gated UI |

### 5.2 `<AsyncButton>` states
| State | Visual | Behavior |
|---|---|---|
| idle | Normal label | Clickable |
| pending | Spinner replaces leading icon within one frame (0 ms, no delay), label changes to present-progressive ("Searching...", "Saving...", "Depositing..."), width locked to prevent layout shift | Disabled, `aria-busy="true"`, double-submit blocked |
| slow | After 8 s pending: secondary text under button "Still working, Upland is slow" | Still disabled |
| success | Check icon + success label for 1.5 s, then idle | Toast if the result is not otherwise visible |
| error | Error icon, red outline for 3 s, inline message under the button with the server reason, "Retry" affordance | Re-enabled |
| disabled | Muted; tooltip explaining why ("Select a neighborhood first", "Connect your Upland account") | Never disabled without a reason tooltip |
| locked | Lock icon, tier label | Opens upgrade dialog |

Timeout: every request has an explicit timeout (default 20 s, override per endpoint). Timeout resolves to the error state with "Timed out" and Retry.

### 5.3 `<DataState>` states
| State | Visual |
|---|---|
| initial-loading | Skeleton matching final layout: tables show 10 skeleton rows with real column headers; charts show axis frame + shimmer; maps show tile placeholder + spinner; stat tiles show shimmer bars |
| refreshing (data present) | Existing data stays, dimmed to 60%, thin progress bar across the top of the region, header shows spinner next to "Updating" |
| loading-more (pagination / Load more / infinite scroll) | Existing rows stay; button in pending state or 3 skeleton rows appended |
| empty | Illustration-free message specific to context (e.g. "No properties match these filters") + primary action ("Reset filters") |
| empty-initial | Before first search on search pages: "Set filters and press Search" |
| error | Message with HTTP/business reason, request ID, "Retry" button (AsyncButton), and "Report" link prefilled to feedback form |
| partial | Data rendered + yellow banner naming what failed (e.g. "Could not fetch outgoing offices for residents. Bond data may be incomplete.") + Retry for the failed part only |
| stale | When data age exceeds the feature's freshness budget: banner "Data is N min old" + Refresh |
| capped | At result cap: "Showing first N. Upgrade or narrow filters." |

### 5.4 `<LiveIndicator>` (every live feed and polling page)
- States: `connecting` (pulsing gray dot, "Connecting"), `live` (green pulsing dot, "LIVE", last event time "Updated HH:MM:SS UTC"), `reconnecting` (amber dot, "Reconnecting (attempt n)"), `paused` (tab hidden or user paused; gray, "Paused" + Resume button), `offline` (red, "Offline" + Retry), `error` (red, reason + Retry).
- New rows arriving: row highlight fade (2 s), counter badge "N new" if the user has scrolled down, click to jump to top.
- Countdown to next poll shown when polling interval is 30 s or more.

### 5.5 `<StepFlow>` (Upland transaction flows)
- Stepper header shows every step with state: pending, active (spinner if awaiting server), complete (check), failed (x).
- "Awaiting acceptance in Upland" step shows: spinner, elapsed timer, instructions ("Open Upland, accept the transaction at {devshop address}"), deep link button, "I accepted" AsyncButton, and a server-side poll that auto-advances when the chain confirms. Poll every 3 s, timeout 10 min, then error with Retry and Cancel.
- Closing the dialog mid-flow requires confirm; the flow is resumable from `/profile/settings?tab=pending` until expiry.
- Final step shows receipt: amounts, fees, tx link (ledger.upland.me), timestamp.

### 5.6 `<LockedFeature>`
- Shows feature name, required tier, 1-line value statement, "Upgrade" and "Compare plans" buttons. Anonymous users see "Log in" and "Create free account" instead.
- Must render instantly (entitlements are in session); no spinner-then-lock flash.

### 5.7 Forms and filters
- Every input: default, focus, filled, invalid (message below, specific), async-validating (inline spinner in field), valid.
- `<FilterBar>` states: `clean` (matches applied), `dirty` (Apply button highlighted, "Unsaved changes" dot), `applying` (Apply in pending, results region refreshing), `applied`. Reset button shows pending while re-querying.
- Autocomplete: spinner in field while fetching, "Minimum N characters" hint, "No results", error with retry, keyboard navigation.
- Multiselects show selected count chip ("3 selected") and "Select all"/"Clear" in header.

### 5.8 Other interactions
- Copy to clipboard: icon swaps to check + toast "Copied".
- Export: under 2 s runs inline in AsyncButton; over 2 s becomes a `<JobProgress>` with percent/rows processed and a download link on completion.
- Destructive actions (delete watchlist, delete listing, unsubscribe, delete account): `<ConfirmDialog>` with typed confirmation where specified, then AsyncButton states.
- Optimistic updates (watchlist add/remove, favorites): immediate UI change + small spinner on the item until confirmed; on failure revert and toast with Retry.
- Charts: loading skeleton, empty ("No data for this range"), error, zoom/pan reset button, tooltip on hover.
- Maps: tile loading spinner, markers loading spinner overlay, "No points" empty, error overlay with Retry.
- Page transitions: top progress bar (NProgress-style) on every route change.
- Push subscription: states `unsupported`, `permission-default`, `requesting`, `denied` (with OS-specific fix steps), `subscribed`, `error`.

### 5.9 Enforcement
- ESLint rule (custom): disallow raw `<button onClick={async ...}>` and raw `fetch` in components; require `AsyncButton` / TanStack Query hooks wrapped by `DataState`.
- Every page has a Playwright test run with network throttled to "Slow 3G" that asserts: a loading indicator is visible within 100 ms of each action; error state renders when the API returns 500; empty state renders for an empty payload.
- Storybook stories for every primitive in every state.

---

## 6. Architecture

### 6.1 Stack
| Layer | Choice |
|---|---|
| Web | Next.js 15 App Router, TypeScript strict, React Server Components for public pages, client components for interactive regions |
| UI | Design system delivered by Claude Design (section 6.5), implemented as tokens + Tailwind theme + component layer; shadcn/ui primitives only as unstyled scaffolding beneath it; TanStack Table (virtualized) for all tables; TanStack Query for client data |
| Charts | Apache ECharts (dataZoom for zoom/pan, log scale, heatmaps) |
| Maps | MapLibre GL with Esri/CARTO tiles (match sources), deck.gl for timelapse |
| Export | SheetJS (xlsx) + CSV |
| DB | Supabase Postgres 16 (partitioned tables for events), Supabase Auth, Realtime, Storage |
| Workers | GCP Cloud Run jobs + Cloud Scheduler for ingestion; Cloud Tasks for per-user jobs (optimizer, sync) |
| Edge | Cloudflare DNS, CDN cache for public GET APIs, Turnstile on auth/feedback forms, WAF rate limits |
| Push | Web Push (VAPID) via a worker |
| Discord | Webhook delivery worker |
| Payments | Stripe (cards, subscriptions) [DECISION D-3]; UPX payment via platform balance or Upland transaction |
| Observability | Sentry (web + workers), Postgres slow query log, uptime checks per ingestion job |

### 6.2 Data sources [DECISION D-4, risk R-1]
| Source | Used for |
|---|---|
| Upland Developer API (official, app-authorized) | Account linking, user-authorized reads (inventory, properties, placement), transaction requests the user accepts in Upland |
| Upland public endpoints (as used by both sources, `api.prod.upland.me`) | Properties, neighborhoods, collections, treasure hunts, race lobbies, shop listings, construction hub |
| EOS chain via Hyperion (`eos.hyperion.eosrio.io` and fallbacks) | Transfers, mints, sends, stakes, merges, NFT creation, P2P UPX, bridge events |
| `ledger.upland.me` | Outbound links only |
| `static.upland.me`, IPFS | NFT images (proxied through Cloudflare image cache) |
| YouTube Data API, X links | Broadcasts (F-1901) |

Phase 0 task: produce `docs/data-sources.md` enumerating every endpoint and contract action actually used, with rate limits, and confirm ToS compliance before any ingestion job runs in production.

### 6.3 Ingestion jobs
Each job: idempotent, cursor-based, writes `ingest_runs(job, started_at, finished_at, status, rows, cursor, error)`. Admin shows health (F-2001).

| Job | Cadence | Feeds |
|---|---|---|
| chain-tail | Continuous (1 s poll) | Raw action stream into `chain_actions` partitioned by day |
| props-snapshot | Every 6 h per city (staggered) | properties, owners, status, sale price, structures |
| listings-poll | 60 s | F-404, alerts |
| mints-derive | From chain-tail | F-405, F-408 |
| neighborhood-stats | Hourly | F-401, F-402, F-407, F-505 |
| residents-snapshot | Daily 00:00 UTC | F-506 |
| treasure-poll | 2 s (only while any client subscribed or push rules exist; otherwise 10 s) | F-1401 |
| seed-price-poll | 60 s | F-1001, header, alerts |
| merge-price-poll | 120 s | F-1102 |
| construction-hub-poll | 30 s | F-703, F-704, F-705 |
| shop-listings-poll | 5 min | F-1204, F-1205 |
| race-poll | 60 s | F-1601 |
| bonds-rebuild | Hourly | F-601 to F-604 |
| catalog-sync | Daily | structures, ornaments, BEs, collections, nurseries |
| broadcasts-sync | 30 min | F-1901 |
| dau-rollup | Daily | F-1605 |
| user-sync (per linked user) | On demand + daily | F-18xx |

### 6.4 Caching
- Public aggregate endpoints: Cloudflare cache with `s-maxage` = job cadence, `stale-while-revalidate` = 2x.
- Every API response includes `generated_at`; UI shows it via LiveIndicator or "Updated" label.

### 6.5 Design system (contributed by Claude Design)
The visual language is not defined in this PRD. Claude Design delivers a Design System; Claude Code consumes it. This PRD defines behavior, states, and data; the Design System defines how they look.

Division of ownership:

| Owned by Design System (Claude Design) | Owned by this PRD (Claude Code) |
|---|---|
| Color, type, spacing, radius, elevation, motion tokens; light and dark themes | Which states exist and when they trigger (section 5) |
| Visual spec of every section 5.1 primitive in every state (spinner, skeleton, LiveIndicator dot colors, StepFlow stepper, lock badge, toasts) | Timings (0 ms button feedback, 8 s slow notice, 20 s timeout, 2 s export threshold) |
| Table, filter bar, multiselect, dialog, tab, card, stat tile, chart palette, map legend styling | Columns, filters, options, sort defaults, data contracts |
| Iconography, empty-state copy tone, brand/logo | Empty/error message content where the PRD specifies it |
| Rarity and tier colors (collection tiers A.3, treasure rarity A.13, user levels A.5) | The mapping keys those colors bind to |

Integration rules:
1. Import the Design System's tokens into `packages/ui/tokens` (CSS variables on `:root` and `[data-theme=dark]`, plus a Tailwind preset generated from them). No hex values, px font sizes, or ad hoc shadows in feature code; ESLint + Stylelint rule rejects literals outside the tokens package.
2. Build the section 5.1 primitives in `packages/ui` against the Design System specs. Feature code imports only from `packages/ui`.
3. Every primitive's Storybook story shows every state from section 5, in both themes, and links the Design System artifact it implements. A state missing from the Design System is a blocking gap: raise it to the owner, do not invent a look.
4. Semantic color keys required from the Design System (build against these names): `state-live`, `state-reconnecting`, `state-offline`, `state-success`, `state-error`, `state-warning`, `state-stale`, `tier-free`, `tier-basic`, `tier-premium`, `collection-tier-1..5`, `rarity-limited`, `rarity-exclusive`, `rarity-rare`, `price-up`, `price-down`, `chart-series-1..8`, `map-for-sale-upx`, `map-for-sale-usd`, `map-locked`, `map-owned`.
5. Until the Design System lands, Phase 0 builds primitives with a neutral temporary token set mapped to the same semantic names, so the swap is a token replacement, not a refactor. No feature phase (1 onward) ships to production before the Design System tokens are in.
6. Design System updates flow in by version: pin the version in `packages/ui/tokens/VERSION`; a token bump runs visual regression (Chromatic) across all primitive stories before merge.

---

## 7. Information architecture

### 7.1 Global shell (F-101 to F-106)

**F-101 Top bar**
- Menu toggle, logo, global user search (3-char min, debounce 250 ms, recent 10 searches stored in localStorage, "Clear history", Esc closes, keyboard nav), clocks (F-102), theme toggle (light/dark/system), notifications bell (unread count, F-1701), avatar menu (username, tier badge, Watchlist, Settings, Logout) or Log in / Create account.

**F-102 Clocks and ticker**
- UTC and PT clocks updating every second. Optional seed price chip (user setting) showing current SPK cost, green/red vs 1 h ago; LiveIndicator dot.

**F-103 Sidebar**
- Sections and items exactly as 7.2. Collapsible sections, persisted. "Favorites" section at top: star any item; order by drag. Badges: NEW (per item `new_until` date), lock (gated), LIVE (live feeds).

**F-104 Saved filters (every filterable page)**
- Save current, rename, delete (confirm), drag reorder, select to apply, export to JSON file, import JSON (validated against page schema; invalid shows field-level errors). URL always reflects filters (shareable links).

**F-105 Table standard (every table)**
- Column chooser + Reset columns (persisted per user per table), global search, per-column sort, per-column filter where sensible, "Clear all filters", pagination (10/25/50/100) or Load more per spec, virtualized over 200 rows, sticky header, export Excel and CSV (exports current filtered set, not just the page), relative dates with absolute on hover, copy buttons on IDs/addresses, EOS/ledger link icons.

**F-106 Ads and banners**
- Free/Anonymous: ad slot component on analytics pages (hidden for Basic on analytics pages, hidden everywhere for Premium). Sponsor carousel (F-1703). Discord banner, dismissible (persisted).

### 7.2 Navigation (sidebar order)
- Home
- Users: User Search, User Activity, P2P UPX Activity, Birthdays
- Properties: Overview, Search, Live Listings (LIVE), Live Minting (LIVE), Transactions, Statistics, Mint Analytics, City Release Map, Appraiser, Construction History
- Neighborhoods: Community Nodes, Node Compare, Activity Rank, Neighborhood Explorer, Resident Analytics
- Commerce & Bonds: Neighborhood Bonds, Bonds Planning, Bonds Network, Trade Score Leaderboard
- Structures: Structure Reference, Service Structure Planner, Construction Hub Listings (LIVE), Construction Alerts, Construction Hub Analytics, Sparklet Activity (LIVE)
- Sparklet Staking Hub: Active Contracts, My Contracts, My Contributions, List Construction, Leaderboards
- Economy: Sparklet Bridge, Sparklet Store, STEM Analytics, Daily Activity
- Life: Seed Generation (LIVE), Seed Stats, Nurseries
- Uppies: Uppie Search, Merge Prices (LIVE), Merge History
- NFTs & Shops: NFT Explorer, Asset Analytics, NFT Creation Feed, Showroom Feed (LIVE), Stores, Metaventure Sales, NFT Transactions, Block Explorer Catalog, Ornament Catalog, Featured Shops
- Marketplace: Listings, My Listings, List Item
- Travel & Treasure: Treasure Hunting (LIVE), Treasure Report, Find My Send, Travel Path, Sends Analytics
- Racing: Global Races, Race Stats, Track Map, Track Completionist
- Leaderboards: Users, Properties, Upland
- My Empire (login): Portfolio, Inventory, Plants, Visitors, Ornament Optimizer, Collection Optimizer, Resident Optimizer, Asset Mover, Factory Manager, Showroom Manager, My Treasure Hunts, Watchlists
- Community: Broadcasts, External Tools, Devshops, New Player Guide, Supporters
- System: Changelog, Feedback, About, Troubleshoot, Imprint, Privacy

### 7.3 Route map

| Route | Feature | Access |
|---|---|---|
| `/` | F-190 Home | Pub |
| `/users` | F-201 | Free |
| `/users/[username]` | F-202 | Free (Transactions tab P) |
| `/users/activity` | F-203 | Pub |
| `/users/p2p` | F-205 | Pub |
| `/users/birthdays` | F-204 | Pub |
| `/properties` | redirect `/properties/search` | |
| `/properties/overview` | F-401 | Pub |
| `/properties/overview/[cityId]` | F-402 | Pub |
| `/properties/search` | F-403 | Pub |
| `/properties/listings` | F-404 | Pub |
| `/properties/mints` | F-405 | Pub |
| `/properties/transactions` | F-406 | P |
| `/properties/statistics` | F-407 | Pub |
| `/properties/mint-analytics` | F-408 | Pub |
| `/properties/city-release` | F-409 | Pub |
| `/tools/appraiser` | F-410 | Free |
| `/properties/construction-history` | F-412 | Pub |
| `/nodes` | F-501 | Pub |
| `/nodes/[slug]` | F-502 | Pub |
| `/nodes/compare` | F-503 | Pub |
| `/nodes/activity-rank` | F-504 | Pub |
| `/neighborhoods` | F-505 | Pub |
| `/residents` | F-506 | Pub |
| `/bonds/neighborhood` | F-601 | Pub |
| `/bonds/planning` | F-602 | Pub |
| `/bonds/network` | F-603 | Pub |
| `/bonds/leaderboard` | F-604 | Pub |
| `/structures` | F-701 | Pub |
| `/structures/service-planner` | F-702 | Pub |
| `/construction-hub/listings` | F-703 | Free |
| `/construction-hub/alerts` | F-704 | Free |
| `/construction-hub/analytics` | F-705 | Pub |
| `/sparklet/activity` | F-706 | Pub |
| `/ssh` | redirect `/ssh/contracts` | |
| `/ssh/contracts` | F-802 | Pub (stake needs link) |
| `/ssh/contracts/me` | F-803 | Free + link |
| `/ssh/contributions` | F-804 | Free + link |
| `/ssh/create` | F-805 | Free + link |
| `/ssh/leaderboards` | F-806 | Pub |
| `/economy/bridge` | F-901 | Pub |
| `/economy/sparklet-store` | F-902 | Pub |
| `/economy/stem` | F-903 | Pub |
| `/economy/daily-activity` | F-1605 | Pub |
| `/life/seeds/live` | F-1001 | Pub |
| `/life/seeds/stats` | F-1002 | Pub |
| `/life/nurseries` | F-1003 | Pub |
| `/uppies` | F-1101 | Free |
| `/uppies/merge-prices` | F-1102 | Pub |
| `/uppies/merge-history` | F-1103 | Pub |
| `/nft` | F-1201 | Pub |
| `/nft/analytics` | F-1202 | Pub |
| `/nft/creations` | F-1203 | Pub |
| `/nft/showrooms` | F-1204 | Pub |
| `/stores` | F-1205 | Pub |
| `/stores/[id]` | F-1205 | Pub |
| `/nft/metaventure-sales` | F-1206 | Pub |
| `/nft/transactions` | F-1207 | P |
| `/catalog/block-explorers` | F-1208 | Pub |
| `/catalog/ornaments` | F-1209 | Pub |
| `/featured-shops` | F-1210 | Pub |
| `/market` | F-1301 | Pub |
| `/market/me` | F-1302 | Free + link |
| `/market/[bundleId]` | F-1303 | Pub |
| `/market/create` | F-1304 | Free + link |
| `/treasure` | F-1401 | Pub |
| `/treasure/report` | F-1402 | Pub |
| `/me/treasure` | F-1403 | Free + link |
| `/tools/find-my-send` | F-1501 | Pub |
| `/tools/travel-path` | F-1502 | Free |
| `/travel/sends` | F-1503 | Pub |
| `/racing/races` | F-1601 | Pub |
| `/racing/stats` | F-1602 | Pub |
| `/racing/track-map` | F-1603 | Pub |
| `/racing/completionist` | F-1604 | Pub |
| `/leaderboards/users` | F-1606 | Pub |
| `/leaderboards/properties` | F-1606 | Pub |
| `/leaderboards/upland` | F-1606 | Pub |
| `/me` | F-1801 | Free + link |
| `/me/inventory` | F-1808 | Free + link |
| `/me/plants` | F-1808 | Free + link |
| `/me/visitors` | F-1808 | Free + link |
| `/me/ornament-optimizer` | F-1802 | Free + link |
| `/me/collection-optimizer` | F-1803 | P + link |
| `/me/resident-optimizer` | F-1804 | Free + link |
| `/me/asset-mover` | F-1805 | Free + link |
| `/me/factories` | F-1806 | Free + link |
| `/me/showrooms` | F-1807 | Free + link |
| `/me/watchlists` | F-411 | Free (limits per tier) |
| `/community/broadcasts` | F-1901 | Pub |
| `/community/tools` | F-1902 | Pub |
| `/community/devshops` | F-1903 | Pub |
| `/new-player` | F-1904 | Pub |
| `/supporters` | F-1905 | Pub |
| `/changelog` | F-1906 | Pub |
| `/feedback` | F-1907 | Pub |
| `/about` | F-1908 | Pub |
| `/troubleshoot` | F-1909 | Pub |
| `/imprint`, `/privacy`, `/terms` | F-1910 | Pub |
| `/pricing` | F-304 | Pub |
| `/auth/login`, `/auth/sign-up`, `/auth/forgot`, `/auth/confirm` | F-301 | Not logged in |
| `/settings` (tabs: general, balance, subscription, connections, notifications, premium-tools, pending, security) | F-302 to F-310 | Log |
| `/admin` | F-2001 | Admin |
| `/maintenance` | F-1911 | Pub |

---

## 8. Feature specifications

Template per feature: purpose, access, data/refresh, filters, columns, actions, feature-specific states (on top of section 5), acceptance criteria (AC).

### 8.1 Home (F-190)
- Hero carousel (sponsor slides from F-1703, auto-advance 6 s, pause on hover, dots, swipe).
- Live strip: current seed price, treasure next spawn (user's last city), DAU, listings in last hour. Each tile is a `<StatTile>` with LiveIndicator.
- Feature grid grouped by tier (from `entitlements`), each card links to the feature.
- Pricing block (F-304), Discord CTA, account CTAs.
- AC: all tiles render skeleton then data or individual error; one failed tile does not block others.

### 8.2 Accounts and money

**F-301 Auth**
- Email + password (Supabase Auth), email confirmation code, forgot/reset with code, Turnstile on sign-up and forgot. Password rules shown live as a checklist (length 10+, number, letter); unmet rules turn red on submit. Terms checkbox required on sign-up.
- Sessions 7 days rolling ("Remember me" 30 days).
- AC: unconfirmed login routes to confirm; each submit uses AsyncButton; server errors map to field errors.

**F-302 Settings: General** timezone display (UTC/local), number format, theme, header seed price toggle, default city.

**F-303 Upland account link**
- "Connect Upland" starts Developer API authorization: shows a one-time code and countdown ("Code expires in mm:ss"), instructions with screenshot, deep link, polling every 3 s until verified. States: not linked, awaiting code entry, verified, expired (Regenerate), error. Unlink with confirm.
- Stores Upland user ID, username, EOS account, level. Tokens encrypted at rest (pgcrypto with KMS key), never sent to the client.
- AC: StepFlow compliant; linked status visible in avatar menu.

**F-304 Subscriptions and pricing**
- Plans Free/Basic/Premium, monthly/yearly toggle, feature comparison table from `entitlements`.
- Pay by: Stripe (auto-renew), platform balance in UPX (no auto-renew; expiry reminder 3 days before), Upland transaction (StepFlow, pick devshop city).
- Subscription tab: current plan, period, renewal/expiry date, status (active, cancelled-until-period-end, pending, past_due, expired), cancel with reason (textarea optional), invoices list (Stripe).
- Guard: one pending order at a time ("You have an order being processed" with link).
- AC: webhook-driven state; UI never shows paid tier until webhook confirms (pending state shown meanwhile).

**F-305 Entitlements** per 4.3.

**F-306 Settings: Notifications** device list for push (name, platform, created, last seen, Remove), Discord webhooks (F-1702), email digest toggle.

**F-307 Settings: Premium tools** Download all transactions: Properties, NFTs (JobProgress, xlsx).

**F-308 Settings: Security** change password (current, new, confirm), active sessions list with revoke, delete account (type email to confirm, 7-day grace with cancel).

**F-309 Settings: Pending flows** list of resumable StepFlows (deposit, subscription, SSH listing, market buy) with Resume/Cancel.

**F-310 Platform balance**
- Balance card with UPX amount and "Last updated".
- Deposit: amount input (min/max from settings), shows total incl. Upland 10% fee, StepFlow at a devshop, credited on chain confirmation.
- Withdraw: amount, shows "You will receive (after 10% Upland fee)", queued payout, status per request (queued, sent, confirmed, failed).
- Transfer to another user: user autocomplete, amount, confirm; recent transfers.
- Balance log: date range (from < to validated), action filter (Deposit, Withdrawal, Transfer in, Transfer out, Subscription, SSH Contract Listing, SSH Contract Boost, SSH Contract Refund, SSH Payout, Marketplace Sale, Marketplace Purchase), summary (opening, in, out, closing), table (Action, Timestamp, Details, Amount, Balance), export.
- Ledger integrity: double-entry `ledger_entries` table; balance = sum; nightly reconciliation job vs devshop on-chain balances; mismatch alerts admin.
- AC: no balance mutation without a ledger entry; all money actions StepFlow or AsyncButton + ConfirmDialog.

### 8.3 Users

**F-201 User search page**: same component as top bar in page form, with results list (avatar, username, level badge, networth, properties count).

**F-202 User profile**
- Header: avatar, username, level, join date, EOS account (copy, Hyperion creator link, ledger link), home address + neighborhood or "No home address", Discord/X links (if linked on platform), jail warning banner "This user is in jail" when flagged.
- Stat tiles: Networth, Current Balance, Number of Properties, Total UP2, Total Value of Properties, Mint Value of Properties, Yield Per Month, Yield Per Month (without boost), Total Sparklet, Staked Sparklet, Used Sends, Account age.
- Tabs:
  1. Properties: charts (Collection progress, City bar, Neighborhood bar with city picker; measure toggle Properties / UP2 / Networth / Mint Networth), Mapbox-style map (MapLibre) with legend For Sale UPX, For Sale USD, Locked, Owned; full properties table (F-403 table).
  2. Transactions (Premium): F-406 table scoped to user.
  3. Assets: sub-tabs and columns exactly as below, each with search and export:

     | Sub-tab | Columns |
     |---|---|
     | Structures | Image, Address, City, Construction Name, Status |
     | Block Explorers | Image, Name, Mint, Current Supply, Series, Minted |
     | NFLPA | Image, Name, Mint, Current Supply, Fan Points, Type, Player, Position, Team |
     | Football / Soccer | Image, Name, Mint, Current Supply, Type, Player, Position, Team, Fan Points, Boosted Fan Points |
     | Structure Ornaments | Image, Name, Address, City, Sub Name, Mint, Is Applied, Rarity, Season |
     | Map Assets | Image, Name, Address, City, Mint, Current Supply |
     | Legits (Spirit) | Image, Name, Mint, Current Supply, Rarity |
     | Vehicles | Image, Name, Address, Mint, Current Supply |
     | Racing Legits | Image, Name, Type, Mint, Current Supply, Fan Points, Boosted Fan Points |
     | Seeds | Image, Name, Mint |
     | Uppies | Image, Name, Level, Mint, Current Supply, Max Supply |
     | Totems | Image, Name, Mint |
  4. Activity: F-203 scoped to user.
  5. Market: user's platform marketplace listings and showroom listings.
- AC: each tab lazy loads with its own DataState; switching tabs keeps previous tab cache 5 min.

**F-203 User activity (ledger translation)**
- Input username (autocomplete), date range (default last 24 h, max 30 days; Premium 365 days).
- Table: expander, Time (UTC), Action Type (human label), Details (human sentence, e.g. "Bought 123 MAIN ST for 12,000 UPX from alice"), Ledger link.
- Action type filter multiselect (Appendix A.10).
- AC: unknown actions render as raw action name + JSON expander, never dropped.

**F-204 Birthdays**
- Today's celebrations cards (username, level, years), "Upcoming 14 days" list grouped by date with years.
- Search player, "Active only" toggle (sent to a property in last 60 days), show badges, show collections toggles.

**F-205 P2P UPX activity**
- KPIs (14 d UTC): total UPX transferred + tx count, top 3 senders, top 3 receivers.
- Live Flow tab: filters min amount (All, >1k, >10k, >50k; default >1k), sender level, receiver level (Appendix A.5); table Time, Sender [level], Receiver [level], Amount, Ledger; Load more; Export.
- Deep Trace tab: user or EOS input; table Time, Direction (in/out), Counterparty, Amount, Blockchain link; graph view of counterparties (force graph, top 50 by volume).

### 8.4 Properties

**F-401 Overview (all cities)**
- Updated timestamp. KPI tiles: Total Properties, Unminted, Owned, For Sale (UPX), For Sale (USD), Locked.
- City table default columns: City, Total Properties, Unminted, Unminted (Non FSA), Owned, For Sale (UPX), For Sale (USD), Locked, Floor Price (UPX), Floor Price (USD). Optional: Unminted (FSA), For Sale, Median Price (UPX/USD), UPX Per UP2 (Floor), USD Per UP2 (Floor), UPX Per UP2 (Median), USD Per UP2 (Median), Floor Markup (UPX/USD), Median Markup (UPX/USD), Properties with structure, Residents, Area.
- Row click opens F-402.

**F-402 City overview**: same KPIs for the city; Neighborhood table and Collection table (same columns, first column Neighborhood/Collection); small neighborhood map with choropleth by selected metric.

**F-403 Properties search**
- Filters:

  | Filter | Control | Options / default |
  |---|---|---|
  | City | Searchable dropdown | Default user's default city, else San Francisco. Premium: "All cities" option |
  | Neighborhood | Multiselect | All |
  | Collection | Multiselect | All |
  | Collection tier | Multiselect | Appendix A.3 |
  | Exclusive props | Multiselect | All, Marinas, Farms |
  | PES earnings boost | Dropdown | None, All, Standard, Racetrack |
  | Status | Dropdown | All, For Sale, For Sale (UPX), For Sale (USD), Unminted, Locked, Owned |
  | Currency | Segmented | UPX + USD, Only UPX, Only USD |
  | FSA | Segmented | All, Only FSA, Non FSA |
  | Structure | Multiselect of structure names | "Select all service structures", "Deselect all" |
  | Structure status | Dropdown | All, In progress and completed, In progress, Completed, Without any structures |
  | Has map assets | Toggle | |
  | Has residents | Toggle | |
  | Address | Text | contains |
  | Owner | Text | blank = all |
  | Sort by | Dropdown | Mint Price (default), Sale Price, Markup, UP2, Yield, Date Listed, Last Event |
  | Direction | Segmented | Ascending (default), Descending |
  | Min/Max panel | Numbers | Mint Price, Markup %, UP2, Sale Price (UPX), Sale Price (USD), Yield |
  | Remove jailed owners | Toggle | |
- Actions: Search, Saved filters, Import/Export filters, Reset, Load more (Free/Basic: 100 per load, cap 500; Premium: 1,000 per load, cap 10,000).
- Table columns (all): Address, City, Neighborhood, Collections, Collection Tier, Collection Boost, Mint Price, Last Price, UP2, Price Per UP2, Yield Per Month, Yield Per Month (Max), Sale Price, Currency, Markup, Date Listed, Last Event, Ownership Changed At, FSA, Owner, Owner EOS, Status, Structures, Map Assets, Residents, PES Boost, Upland Kingdom Land Type, Actions. Default: Address, City, Neighborhood, Collections, Mint Price, UP2, Sale Price, Currency, Markup, Owner, Status, Actions.
- Toggle "Show prices, markups and last price with 5% fee".
- Row actions: Go to property (play.upland.me/?prop_id=), Detail dialog, Appraise (F-410), Transactions, Add/remove watchlist (with create new), View structures (Basic for multi), PES boost dialog, Upland Kingdom dialog.
- Detail dialog: owner, neighborhood, collections, mint, last price, earnings (monthly, boosted, boost breakdown), UP2, copy ID/address; tabs Graph (price/markup history toggle), Transactions (timeline including burned, visa expired), Sends received (Username, Price, Timestamp, Tx; export), Visitors, Construction (links F-412).
- PES boost dialog: tables per UPXLand spec (Requirement/Boost rows: own 1 or 2, 3 or 4, 5+, 3 on same street, racetrack prop; additional: host metaventure, place "I Love PES" asset). Values from `pes_rules` table, admin editable.
- Upland Kingdom dialog tabs: Improvements (Type, Size, Workers), Natural Resources (Type, Amount), Jobs (Job Type, Resource, Improvement, Workers), Workers (Number, Type).
- Sponsored carousel slot above results (F-1703).
- AC: Load more appends without scroll jump; cap reached shows capped state; URL reproduces search.

**F-404 Live property listings** (from Uplytics)
- LiveIndicator (poll 60 s, count of new).
- Filters: Location multiselect (cities), Neighborhoods (enabled after city), Listing status (Active, Sold, All events), Currency, Collection tier, Property features (All structures / Has building / Is service structure), Assets (All / Has map assets), Markup range, Price range UPX, Price range USD. Apply, Reset.
- Columns: Address (link), City, Neighborhood, Collection, Building(s), Assets, Residents, Status/Owner, Last Event (relative), Mint, Price, Markup, Actions.
- Load more listings (50).
- AC: new events prepend with highlight; filters applied server-side.

**F-405 Live property minting**
- KPIs 24 h: mints, FSA count, top city (count), top 3 minters.
- Top 10 minters (rank, username, level, count).
- Latest 50 mints: Time (UTC), Player (link F-202), Address, Neighborhood, City, Type (FSA/-), Mint Price, Link.

**F-406 Property transactions (Premium)**
- Filters: City, Neighborhood, Collection, Type (All, Buying/Selling, Minting, Swapping, Accepted Offers, Burned), Currency, Owner (buyer or seller), Date range (All time default), Price min/max.
- Columns: Address, Neighborhood, Collections, Buyer, Seller, Type, Markup, Price, Currency, Price Per UP2, Timestamp, Actions. Load more (500), export.

**F-407 Statistics**
- Filters: City, Neighborhood, Collection, date range picker, Reset.
- Charts: Transactions made (bar by day, stacked by type), Properties statistics (owned/unminted/for sale over time), Price statistics UPX and USD (series toggles: Floor Price, Floor Markup, Median Price, Median Markup for each currency). Zoom/pan, reset zoom, download PNG.

**F-408 Mint analytics**
- Filters: Timeframe (7/30/60/90 days, default 30), FSA (Show all, FSA only, Normal only), User level (Appendix A.5), City or neighborhood autocomplete (3+ chars), Username. Analyze, Reset.
- KPIs: total filtered, FSA mints, normal mints, top neighborhood (count), top minter (count).
- Table as F-405 with level badge; Load more.

**F-409 City release map**
- City dropdown of releases with dates (from `city_releases`).
- Timelapse of mints over the release window (default 2 h): play/pause, step forward, restart, speed slider (1 to 100), time scrubber, UTC and PT time, minted count "n / total", mints per minute chart, user filter (highlights one user's mints).
- Detailed stats panel: per-neighborhood table (neighborhood, props, minted, % minted, time to sell out).

**F-410 Property appraiser**
- City, address/ID autocomplete (paste with city auto-selects city), Reset, Search.
- Result: estimated value UPX and USD, basis ("last sale price" or "mint-price model" with comparables list of up to 10: address, UP2, sale price, date), below-floor indicator, extra percentage stepper, click-to-copy prices, note "Excludes Upland fees". Label BETA.
- Model: median price-per-UP2 of comparable sales in same neighborhood/collection within 90 days, adjusted by markup trend; fallback city level. Show confidence (High/Medium/Low by comparable count).

**F-411 Watchlists**
- Select watchlist, refresh, edit dialog (rename, delete with confirm, counts), create. Uses F-403 table. Price change indicators since added (Δ price, Δ status). Optional alert on price drop or listing (links F-1701 rule).

**F-412 Construction history**
- Address search (autocomplete). Timeline since 2025-08-12: build started, stakes/unstakes (player, amount), contributions, completion, destruction. Summary: structure, required SPH, currently staked, started, ended/estimated end. Sparklet transactions list with export. Premium: SSH stake logs overlay.

### 8.5 Neighborhoods

**F-501 Community nodes**
- Search (nodes, cities, descriptions), "Expand all", accordion by city with node count (Appendix A.1 list seeded from Uplytics: 130 nodes, 24 city groups, "Other nodes").
- Activity rank leaderboard (30 d): #, Node, City, Owners (active/total), Active (30 d) %.
- Node list managed in admin (`nodes` table: slug, name, city, neighborhood IDs, description, links, greenery enabled).

**F-502 Node stats** [ASSUMPTION: tabs inferred from changelog]
- Header: name, city, owners, properties, residents, structures.
- Tabs: Overview (KPIs, activity chart), Homes (players with home in node; NEW badge for homes set in last 14 days), Properties (F-403 table scoped), Structures (by type), Bonds (F-603 scoped), Greenery (plants, if enabled), My Impact toggle (logged in: highlight user's contribution).

**F-503 Node compare**: pick 2 to 4 nodes; side-by-side KPI table and overlaid charts.

**F-504 Activity rank**: standalone full leaderboard of F-501 rank.

**F-505 Neighborhood explorer**
- Compare: search and add neighborhoods to compare table (Name, City, Residents, Props, Area).
- Worldwide list: #, Name, City, Residents, Properties, Area (UP2), action (open city/neighborhood). Load more 25. Drill-down (Regions) view: country, city, neighborhood tree.

**F-506 Resident analytics**
- KPIs: global residents, net change (24 h), top gainer, biggest drop.
- View mode: by neighborhood / by city. Date range (from/to, default yesterday to today). Sort (Biggest increase, Biggest decrease, High % growth, Population size). Search.
- Today's city hotspots, top 10 city movers chart.
- Table: Neighborhood, City, Previous, Current, Change, % Growth, City Share, Global Share. Row click expands 30-day growth chart.

### 8.6 Commerce and bonds

**F-601 Neighborhood bonds** (UPXLand Commerce Bonds)
- City (All cities default), Neighborhood (required).
- Actions: Search, Quick load (cached, shows cache age), Retry outgoing offices, Retry home addresses, Hide residents toggle.
- KPIs: total offices (OU), total bonds, unique owners, mutual bonds, unique player pairs, partial/complete connections, bond strength, neighborhood connections.
- Office overview table: Address, Owner, Structure, Status (completed/in progress), Bonds, Unique Bonds, Actions. Office types: Small Office, Large Office, Office Tower, Office Complex. Connection states: Connected, One-way, No reciprocal connection; reciprocal pairs list.
- Residents table: Username, Home Address, Home Neighborhood, Balance (units), incoming/outgoing offices.
- Partial state wording per 5.3.

**F-602 Bonds planning** (Uplytics, beta label)
- Tabs:
  1. My Bonds / Find My Partners: username input, auto-detect home node, scan all tracked nodes for reciprocal opportunities; table Player, Empty Props, Node, Distance.
  2. Node Prospector: select target neighborhood; players there with empty props and their home nodes.
  3. Node vs Node: select A and B; reciprocal candidates both ways (Player, Empty Props).
  4. Relocation: username + simulated home node; projected bonds and score delta.
- Strategy guide dialog.

**F-603 Bonds network**
- Tabs:
  1. Bond Network: node select; KPIs (connected nodes, potential mutual OU, total OU); table Neighborhood (with city, est. distance km), Outbound OU (+planned, buildings), Inbound OU (+planned, buildings), Active Mutual OU (Pot), Balance Ratio (One-way inbound/outbound, Pending construction, Active balance, Favors inbound/outbound). Detailed breakdown dialog.
  2. Active Offices: node filter; Player, Home Node, Built In Node, Address, Structure, Status. Paged 20.
  3. In Construction: same columns, building status.
  4. Trade Route Distances: starting node; Target Node, City, Distance km, Distance miles.
  5. Office Reference: office types with OU, SPH, build time.
  6. Logistics & Freight: Center Type, Address (neighborhood), Owner, Status (344+ rows).

**F-604 Trade score leaderboard**
- Podium: Highest active economy, Most connected hub, Future logistics capital.
- "How is the Trade Score calculated?" dialog (formula documented in code and shown).
- Search; table Rank, Neighborhood, Active Mutual OU, Connected Nodes, Planned Mutual OU, Trade Score; sortable; paged 50.
- Row expand: partner nodes (Partner Node, Outbound, Inbound, Active Mutual, Distance) and constructions (Player, Partner Node, Direction, Structure, Live Progress, ETA).

### 8.7 Structures and construction

**F-701 Structure reference**
- Tabs: Standard (Building, Living Units, Max Stake, Cost SPH, Build Time), Service/Utility (Building, Functions SU, Max Stake, Total SPH, Total SU, SPH/SU, W x D, UP2, Ratio, Efficiency, Build Time; filters Essential, Public Service, Entertainment; Advanced view toggle), Commerce & Others (Building, Category, Max Stake, Cost SPH, Build Time, Info).
- Contract estimator panel: building (click row to fill), SPH, contract price (UPX per SPH, default 5), include 10% fee toggle, result UPX (live computed).
- Credit line for dimensional data contributors (admin editable).

**F-702 Service structure planner**
- City select. Density map + table of service structures: address (verified), structure, function SU, owner, status; hotspot view for petting; export CSV.
- Logged in + linked: "Not yet built by me" filter.

**F-703 Construction Hub live listings**
- Filters: Building, Address, City, Owner, Min Offer, Max Offer. Search, Reset, Refresh, "Device alerts" link.
- Columns: Building, Address, City, Owner, Offer (UPX), Posted (relative), Actions (Go to prop). LiveIndicator poll 30 s.

**F-704 Construction alerts**
- Web push status panel (states 5.8), active devices count, Enable/Disable on this device.
- Per-device filters: City multiselect ("Select my current city"), Structures multiselect ("Select my owned blueprints", requires link), min offer. Save filters (AsyncButton). Filters disabled until subscribed, with reason tooltip.
- iOS setup guide (Safari 16.4+, add to Home Screen, launch from icon; in-app browsers unsupported).
- Discord webhook option (F-1702).

**F-705 Construction Hub analytics**
- Range: 24 h live, 7 days, all time. User search.
- KPIs: accepted contracts, UPX rewarded, active builders, hottest city (jobs), average reward, most active model.
- Top 10 builders (jobs, UPX earned), top 10 listers (jobs, UPX paid), top 5 cities (active jobs), recently accepted (Time, Lister, Taken By, Building + city, Reward), market rates (Building, Jobs, Low, Avg, High).

**F-706 Sparklet activity (in-game feed)**
- KPIs 24 h: staked, unstaked, net change, top builder (new builds), hotspot city, trending structure.
- Filter tabs: All, Builds, Contributions, Unstakes, Plants. Username search.
- Table: Time (UTC), Action (STAKE, UNSTAKE, START BUILD, PLANT), Player, Amount, Building/Asset, Location (link), Tx. Unknown structures show "Unknown struct #id" and "Location unavailable".

### 8.8 Sparklet Staking Hub (UPXLand)

**F-801 Balance widget** on all SSH pages: balance, Deposit, Withdraw (F-310), Guide dialog (FAQ: earning by staking, listing a construction, what the platform balance is, devshops).

**F-802 Active contracts**
- Filters: Structure multiselect, City multiselect, Owner, Sort by (Sparklet limit, Sparklet left to stake, UPX/SPH, Time left (default), Time left fully staked), Direction, Hide maxed-out toggle, Min/Max panel (Sparklet left to stake, UPX/SPH, Time left hours).
- Buttons: My contracts, List construction, Reset, Refresh.
- Columns: Address, City, Structure, Owner, Sparklet limit, Sparklet left to stake, UPX/SPH, Time left, Time left (fully staked), Est. earnings for N SPK (input in header), Actions (Go to prop). LiveIndicator poll 60 s.

**F-803 My contracts**
- Columns: Address, City, Structure, Owner, Sparklet limit, Left to stake, UPX/SPH, Time left, Actions: Go to prop, View stake logs (Premium: totals, listed, deleted, finished, per-staker contributions, export), Increase UPX/SPH (StepFlow: set new rate, choose payment: balance partial with max, balance full, or Upland; shows listing cost, Upland fee, total, balance, remaining), Delist (confirm; refund rules shown).
- Empty: "You have no active contracts."

**F-804 My contributions**
- Toggles: Hide completed, Hide my own (subtitle reflects filters).
- KPIs: total earned to date, total expected.
- Columns: Address, City, Structure, Construction Status, Owner, Sparklet limit, Left to stake, My staked, UPX/SPH, Time left, Payout to date, Remaining payout, Total at completion, Actions (Go to prop, stake logs: Legacy/Non-legacy contract type, your sparklet transactions).
- Refresh, export.

**F-805 List construction**
- Table of the user's in-progress builds: Address, City, Neighborhood, Structure, Required SPH, Remaining SPH, Sparklet left to stake, Time left, Action.
- List dialog StepFlow: review → set price UPX/SPH (shows suggested rate from F-705 market rates and F-802 median) → payment method → accept in Upland → done. Fee 5% (Premium 4%).
- Empty: "You have no construction in progress."

**F-806 SSH leaderboards**: Current month / All time; boards Contracts listed (#, Builder, Contracts), Total SPH listed (#, Builder, SPH), Contributed SPH (#, Staker, SPH); each searchable and paged.

**SSH payout engine (backend)**
- Hourly job computes each staker's SPH contributed per contract from chain stake/unstake actions, accrues UPX = SPH x rate, escrowed from builder's funded listing; pays to platform balance on each hour boundary (ledger entry "SSH Payout"). Contract completion or delist refunds unspent escrow ("SSH Contract Refund").
- AC: payout calculation reproducible from `chain_actions`; unit tests with fixture sequences (stake, partial unstake, re-stake, building completes early).

### 8.9 Economy

**F-901 Sparklet bridge**: range 30 d / 3 m / 6 m; KPIs bridged in, bridged out, net flow, unique bridgers; daily volume chart; top 10 deposits and withdrawals; search player/EOS/ETH address; log Time, Direction (IN/OUT), Player (chain), Amount, Tx. Paged 100.

**F-902 Sparklet store**: week selector (Appendix: weeks since 2025-10-27); KPIs total sold, est. revenue USD, transactions, est. price per 1k; tier breakdown (Appendix A.8); top buyers (50); recent transactions (Time, Player, Amount, Tx); player search.

**F-903 STEM analytics**: range 7/30/90/all; KPIs burned (Δ%), store sales USD (Δ%); USD sales chart (method note: package detection 5k=$4.99, 23k=$19.99, 135k=$99.99); top buyers 30 d; burn volume chart; daily table (Date, Burned, Minted/Earned); top burners.

### 8.10 Life (seeds)

**F-1001 Live seed generation**: KPIs 24 h seeds, SPK spent, trending seeds (top 3), current price (updated time), lowest/highest/average cost 24 h; cost and volume chart; production breakdown (seed, avg SPK, count); top generators (player, spent, total); recent activity (Time, Player, Seed # mint, Cost, Tx) with Load more.

**F-1002 Seed stats**: range 7 d / 30 d / 3 m / 6 m / all; KPIs total seeds, SPK spent, avg cost, peak cost; price & volume chart; popularity table (seed type, count); top generators (seeds, spent).

**F-1003 Nurseries**: 725+ rows; zone filter All/Cold/Mild/Hot; search; columns Shop Name, City, Address, Zone, Action (go to prop); map view toggle.

### 8.11 Uppies

**F-1101 Uppie search** (UPXLand)
- Filters: Name, Owner, Level multiselect (1 to 10, IPU), Series multiselect (Appendix A.6), Status multiselect (All, For Sale, For Sale UPX, For Sale USD, Claimed, Unclaimed, Merged), Sort by (Sale Price default, Mint, Level, Current Supply, Max Supply, Good Buy Factor), Direction, Min/Max (sale price, mint), toggles +5% fee and Hide reserved.
- Columns default: Image, Name, Level, Mint, Series, Status, Owner, Current Supply, Max Supply, Sale Price, Currency, Good Buy Factor, Shop, Actions. Optional: Description, Last Sale, Date listed, Ownership Changed At, Owner EOS.
- Good Buy Factor: ratio of listing price to expected merge-value baseline (cost to reach this level from level 1 floor prices + merge SPK costs from F-1102). Explainer dialog with the full calculation for the row and verdict (below/at/above baseline).
- Row actions: Go to shop listing, Upland ledger, Transactions dialog (event types Appendix A.7, latest first, total), Merge history (lineage tree: merged from, merged to), Swap offers (Image, Name, Category, Mint, Username, Sent at).
- Export CSV/Excel.

**F-1102 Merge prices (live)**: disclaimer (fetched every 2 min); level filter 1 to 9 chips; cards per transition (L1→L2 ... L9→L10) with current SPK, 24 h high/avg/low; 24 h trend chart (log scale); recent records table (Time, Level, Reference dGood ID, Price).

**F-1103 Merge history**: range 7 d / 30 d / 3 m / 6 m / all; level selector 1 to 9; KPIs avg (Δ%), lowest (Δ%), highest (Δ%); trend chart; daily table (Date, Avg, Low, High).

### 8.12 NFTs and shops

**F-1201 NFT explorer** (merge of Uplytics Asset Explorer and UPXLand NFT Search)
- Three-pane: Asset types (search as you type, category filter Appendix A.4) → Mints (list with owner, status, location) → Details (image, description, series, mint, supply, owner, location, placement, transaction history: Buyer, Type, Timestamp, Tx).
- List/grid toggle, sort (name, owner, status), username filter.

**F-1202 Asset analytics**: market overview 7 d (UPX/USD toggle): top volume (name, sold count, avg price), top sales; hide overview toggle; asset search → price chart, stats per range (7/30/90/all), sales table (Date, Price, Buyer, Seller), metaventure breakdown.

**F-1203 NFT creation feed**: category filter (Appendix A.9), search asset or block story, date range (default last 30 d); category count tiles; table Time, Image, Asset Name, Category, Designer, Max Supply, Block Story, Links (ledger, IPFS); paged 25.

**F-1204 Showroom feed**: filters Category, Currency, Status (Active, Sold, Withdrawn, All), search, Hide reserved, Hide seeds, UPX min/max, USD min/max, Uppie level min/max (visible when Uppie selected); table Image, Asset info (name, ID, mint #), Category, Price, Seller, Shop/Location (Map asset or shop name + address), Updated; Load more; LiveIndicator (5 min). Made-by-Upland badge on official ornaments.

**F-1205 Stores**: search, sort name asc/desc, type filter (All, Block Explorers, NFLPA Legits, Soccer Legits, Map Assets, Cars, Ornaments, Uppies, Seeds), list/grid, paginator. Store detail: banner (name, owner, Discord, X, property link), items with search, currency, sort by price, "Listed" date; sales summary from F-1206.

**F-1206 Metaventure sales**: highlights (7/30/90 d): global gross volume UPX and USD, top 10 shops UPX, top 10 shops USD, top 10 cities; shop search → sales table (Date, Asset, Gross, Seller, Buyer) and top assets (Asset, Volume, Gross). Disclaimer text.

**F-1207 NFT transactions (Premium)**: filters Type (All, Buying/Selling, Minting, Swapping, Transfers, Exchange), Category (Appendix A.4), Shop, User, Dates; columns Buyer, Seller, Type, Message, Price, Currency, Timestamp; export.

**F-1208 Block explorer catalog**: stats (total, unique 1/1, supply buckets sub 25, 26 to 50, 51 to 100, 101 to 300, 301 to 1K, 1K+); filters year, series (Appendix, from DB), search, hide Directors, supply bucket; cards (supply, name, description, image); "Owned" badge and "Missing in series" filter for linked users.

**F-1209 Ornament catalog**: tabs Catalog / Analytics & charts; filters season (Appendix A.11), structure type, per page, search, Official only; KPIs total, official, dominant season, top structure type; table Image, Name, Season, Structure Type, Max Supply; charts by type and season.

**F-1210 Featured shops**: shops displaying the platform's sponsor map asset or paid placement; shop filter, sort (lowest UPX, lowest USD, name); sections Cars, Block Explorers, Map Assets, Legits & Seeds, Other; cards price, name, shop, "N locations".

### 8.13 Marketplace (UPXLand P2P bundles)

**F-1301 Listings**: search, category (All, Block Explorers, Essentials, Structure Ornaments, Mementos, Jacky Tsai, Spirit Legits), type (All, Bundles, Singles), sort (Price, Seller, Newest, Name), direction; cards image, price, ends countdown, "Yours" badge; infinite scroll; guide dialog.

**F-1302 My listings**: same with delete action.

**F-1303 Bundle page**: items (category, mint, rarity tooltip), price, seller, ends; Buy StepFlow (login + link; accept at devshop); Share (copy link); Delete (owner); other listings from seller. Invalid ID → redirect `/market` with error toast.

**F-1304 List item**: category tabs; per tab search and table (Image with zoom, Name, Mint, Rarity for Spirit Legits, Select/Remove), 5 per page; header Reset, Deselect all, "List N items"; StepFlow: confirm items → price UPX (shows buyer price and seller net) → devshop city → accept transfer to escrow → done. Duration select (7/14/30 days).
- Backend: escrow custody at devshop account; settlement on buyer payment; auto-return on expiry or delete.

### 8.14 Travel and treasure

**F-1401 Treasure hunting**: city select (persisted); cards per treasure (rarity Limited/Exclusive/Rare, type Classic/Stealth, state Ready in mm:ss / Charging / Expired, Riot mode badge, color by rarity); players hunting count; history (normal/riot counts); enable notifications (push rule: city, rarity, "starts in 60 s" and "found" events). LiveIndicator 2 s.

**F-1402 Treasure report**: 24 h / 7 d; KPIs UPX found, sparklet found, chests, active cities; UPX payout chart by city; yield leaderboard (#, City, Hunters, Chests, Avg UPX, Avg Sparklet, Total UPX, Total Sparklet); methodology dialog (location from player's last send within 10 min; treasure web excluded).

**F-1403 My treasure hunts**: history by day, city, chests, UPX, sparklet, yield per send, best cities; export.

**F-1501 Find my send**: city (grouped by country, flags), username; results list of sends with property, distance (m), cost, time; copy. Last inputs persisted.

**F-1502 Travel path**: from city, to city (same city error); Cheapest vs Fastest toggle; cost UPX, time, route hops (with JFK bus special case). Data from `travel_edges` table (admin editable).

**F-1503 Sends analytics**: range 7/14/30/60 d; KPIs total sends, UPX spent, active travelers, avg fee; daily trend, fee tier distribution (Economy ≤15, Standard 16 to 45, Premium >45), hourly heatmap UTC; most visited props (Address/Owner, City, Visits, Earned; row expand visitors: Player, Visits, Total paid); top travelers (Player, Sends, Spent).

### 8.15 Racing and activity

**F-1601 Global races**: search driver/track/city, date range (default 7 d), reset; table Status (OPEN, CLOSED, FINISHED), Race details (track, city, surface), Drivers & results (position, driver, time, vehicle, MPS, W), Wager, Date/time, Tools (Copy, Scorecard dialog); paged.

**F-1602 Race stats** (bots excluded): KPIs drivers 24 h, total races, unique tracks, UPX wagered; trending tracks 7 d; top drivers 30 d; daily races 14 d chart.

**F-1603 Track map**: find by owner, select track (searchable); owner stats; map with property status legend (Completed, In progress, Other, Area, Speedway); map owner filter.

**F-1604 Track completionist**: username; tracks raced vs not raced (since 2026-01-30), by city, progress bars.

**F-1605 Daily activity**: range 30/90/180/all; KPIs latest DAU (Δ%), interval average, all-time high (date); user trend chart; economy mix donut (action categories).

**F-1606 Leaderboards**
- Users (top 100): sort by Number of properties (default), Mint networth, Properties networth, UP2, Sparklet; columns Rank, Username, Mint Networth, Properties Networth, Properties, UP2, Sparklet; export.
- Properties: city, neighborhood, sort (Number of properties, Mint networth, UP2); columns Rank, Username, Mint Networth, Properties, UP2.
- Upland: leaderboard (Visitors, Completed Collections, Uplanders Referred, Treasures Claimed, Total UPX Proceeds, Trades), timescope (Today, Last week, Last month); top 3 styled.

### 8.16 Notifications

**F-1701 Push and in-app notifications**
- Rule builder: type (Property listed in city/neighborhood with filters from F-403, Watchlist price drop, Construction Hub job, Treasure spawn, Seed price below X, Merge price below X for level L, SSH contract above X UPX/SPH, Uppie listed matching filters), channel (push, Discord, email digest), quiet hours. Limits per tier.
- Bell dropdown: last 50, unread count, mark all read, click opens target.
- Delivery worker dedupes per rule per event.

**F-1702 Discord webhooks**: add webhook URL (validated by test message: AsyncButton "Send test"), map rules to webhook, status (active, failing with last error, disabled after 10 consecutive failures).

**F-1703 Sponsor system**: admin-managed slides (title, eyebrow, text, image, CTA label/url, spots, pages, start/end); impression and click tracking; "Apply for a spot" link to form.

### 8.17 Member tools (linked account)

All member tools require F-303. Data comes from user-sync (JobProgress with task viewer, "Sync now" button, last synced time).

**F-1801 Portfolio**: net worth tiles (properties mint, market value, UPX, USD, sparklet total/staked/free, residents count, construction boost); breakdown charts (by city, collection); sparklet overview with progress bars per structure; join date.

**F-1802 Ornament optimizer** [ASSUMPTION] matches owned ornaments to eligible structures by structure type and current season; proposes assignments maximizing resident attraction; table Structure, Address, Current ornament, Suggested ornament, Gain; "Apply" generates move list for F-1805 (no automatic in-game action unless the Developer API allows it).

**F-1803 Collection optimizer (Premium)**: runs left and refill date (30/month); Optimize (JobProgress; timeout 5 min); result table grouped by collection (Address, Mint Price, Yield, Yield Max, Actions), non-city-specific group, total boosted yield/month vs current.

**F-1804 Resident optimizer** [ASSUMPTION]: ranks properties by resident potential (structure, decorations, neighborhood services, PI score from "PI Goldmine" logic: high residents, low services); quick wins list; threat assessment of nearby competitors' sparklet.

**F-1805 Asset mover** [ASSUMPTION]: list map assets and ornaments with current placement; select many; choose target property; generate move plan; execute via Developer API if permitted, otherwise export step list and link the companion extension (F-2101). Per-item status (queued, moving, done, failed).

**F-1806 Factory manager** [ASSUMPTION]: factories list with queue, current job, time remaining (live countdown), completed today; alerts when idle.

**F-1807 Showroom manager** [ASSUMPTION]: user's metaventures, inventory per shop, listed vs unlisted, sales (from F-1206), low stock flags.

**F-1808 Inventory, plants, visitors, legits**: Inventory tabs as F-202 assets plus Wallet (unplaced assets), Totems, service structures not yet built; Plants (plant, property, stage, uppie attached); Visitors (who sent to your props: Player, Visits, Paid, Last visit).

### 8.18 Community and system

- **F-1901 Broadcasts**: fresh content feed (latest 8 videos), live broadcasters (schedule, "Add to calendar" iCal, upcoming stream countdown), on-demand creators; creators managed in admin.
- **F-1902 External tools**: cards (name, badge Official/Community/Market helper/etc., description, feature chips, Install link, privacy link, 3rd-party disclaimer).
- **F-1903 Devshops**: search; list of devshop addresses with city, open-in-Upland button; map.
- **F-1904 New player guide**: 4-step wizard: welcome; pick city (sorted by cheapest property, updated time, search); 5 cheapest properties (link/copy); community links.
- **F-1905 Supporters**: tiers (whale donors >400k UPX, patrons, property donors, asset contributors); admin managed.
- **F-1906 Changelog**: grouped by year, count per year, entries with date and linked routes; admin editor (markdown).
- **F-1907 Feedback**: nickname, type (Bug, Improvement, Praise), comment (min 10 chars), Turnstile; success confirmation with reference ID; admin inbox.
- **F-1908 About**: story, philosophy, credits, disclaimer (not affiliated with Uplandme, Inc.; DYOR).
- **F-1909 Troubleshoot**: button clears local storage, caches, service worker; reports each step; prompts reload.
- **F-1910 Legal**: imprint, privacy (cookies, data collected, sharing, contact), terms (subscriptions, balance, marketplace escrow, refunds).
- **F-1911 Maintenance**: global flag shows maintenance page for chosen routes.

### 8.19 Admin (F-2001)
- Ingestion health: each job, last run, duration, rows, lag, status; rerun button.
- SSH and balance: total user balances, devshop on-chain balance, net, reconciliation diffs, pending withdrawals queue (approve/retry).
- Subscribers: totals by plan/period, active; searchable table (Username, Email, Plan, Period, Status, Since); filter chips.
- Sponsors: CRUD + analytics (range 7/30/90/365; impressions, clicks, CTR, unique visitors, unique ads, last impression/click; by ad; by page).
- Entitlements editor, plan prices, PES rules, travel edges, nodes, broadcasts creators, external tools, devshops, supporters, changelog, feedback inbox, feature flags, maintenance flag.
- Audit log of admin actions.

### 8.20 Browser extensions (F-2101, Phase 6)
Chrome MV3 extensions, each with privacy policy page: Asset Mover companion, Construction Hub notifier (for users without push support), Send helper. Out of scope for the web launch.

---

## 9. Data model (core tables)

| Table | Key fields |
|---|---|
| `users` | id, email, tier, created_at |
| `upland_links` | user_id, upland_user_id, username, eos_account, level, token_enc, verified_at |
| `plans`, `subscriptions`, `payments` | Stripe IDs, provider, status, period_end |
| `entitlements` | feature_key, tier_min, limit_json |
| `ledger_entries` | id, user_id, type, amount_upx, balance_after, ref_type, ref_id, created_at |
| `step_flows` | id, user_id, kind, state, payload, expires_at |
| `cities`, `neighborhoods`, `collections` | ids, names, geometry, tier, boost |
| `properties` | prop_id, address, city_id, neighborhood_id, up2, mint_price, owner_eos, status, sale_price, currency, fsa, structure, updated_at |
| `property_events` | prop_id, type, price, currency, buyer, seller, ts, tx_id |
| `structures_catalog`, `structures_live` | type metadata; per property state, SPH required/staked, start/end |
| `stake_events` | player, prop_id, action, amount, ts, tx |
| `nodes`, `node_neighborhoods` | curated nodes |
| `offices`, `bonds_snapshot` | commerce |
| `residents_daily` | neighborhood_id, date, residents |
| `nft_assets`, `nft_mints`, `nft_events` | category, series, supply, owner, location |
| `shop_listings`, `metaventure_sales` | showroom data |
| `uppies`, `uppie_merges`, `merge_prices` | |
| `seed_generations`, `seed_prices` | |
| `sparklet_bridge`, `sparklet_store_sales`, `stem_events` | |
| `treasures`, `treasure_claims` | |
| `sends` | player, prop_id, fee, ts |
| `races`, `race_results`, `tracks` | |
| `ssh_contracts`, `ssh_accruals`, `ssh_payouts` | |
| `market_bundles`, `market_items` | |
| `watchlists`, `watchlist_items`, `saved_filters`, `alert_rules`, `push_subscriptions`, `discord_webhooks`, `notifications` | |
| `chain_actions` | raw, partitioned daily, retained 400 days |
| `ingest_runs`, `audit_log`, `feedback`, `sponsors`, `sponsor_events` | |

Row Level Security on every user-owned table. Public aggregates served from materialized views refreshed by jobs.

---

## 10. API conventions
- Route handlers under `/api/v1/*`; public GETs cacheable; all responses `{ data, generated_at, next_cursor?, warnings? }`. `warnings` drives the partial state.
- Errors `{ error: { code, message, request_id, retryable } }`; UI shows message and request_id.
- Cursor pagination everywhere; `limit` bounded by entitlement.
- Rate limits: anonymous 60 req/min/IP, Free 120, Paid 300 (Cloudflare + server check); 429 renders error state with retry-after countdown.

---

## 11. Non-functional requirements
- NFR-1 Performance: LCP < 2.5 s p75 mobile on public pages; tables virtualized; charts over 10k points downsampled server-side.
- NFR-2 Accessibility: WCAG 2.1 AA; all states announced (`aria-live` polite for loading/success, assertive for errors); keyboard operable tables and dialogs.
- NFR-3 Responsive: 360 px to 2560 px; tables become card lists under 640 px with the same state handling.
- NFR-4 Security: tokens encrypted; CSP; CSRF on mutations; Turnstile on public forms; money endpoints idempotency keys.
- NFR-5 Reliability: ingestion lag alert when a job exceeds 3x cadence; public pages degrade to stale cache with stale banner.
- NFR-6 Privacy: minimal PII (email); account deletion purges within 7 days; analytics cookie consent.
- NFR-7 Observability: Sentry release tracking; per-endpoint latency dashboards.
- NFR-8 i18n: next-intl, all strings externalized, English at launch; locales de, pt, sv, es, fr, it scaffolded (untranslated locales fall back to English, no stub pages).
- NFR-9 Dark/light themes with system default; charts themed.
- NFR-10 Disclaimers: data accuracy disclaimer in footer and on analytics pages with estimates (F-902, F-903, F-1206, F-410).

---

## 12. Testing
- Unit: calculators (markup, Good Buy Factor, trade score, SSH accrual, appraiser, travel path).
- Integration: ingestion parsers against recorded fixtures of every chain action type.
- E2E (Playwright): every route: loads, filters, empty, error, slow network state assertions (5.9); every StepFlow with mocked chain confirmation and timeout.
- Visual: Storybook + Chromatic for primitives and key pages in both themes.

---

## 13. Analytics (product)
Track per feature: views, searches, exports, saved filter usage, alert rule creation, upgrade CTA impressions/clicks, StepFlow completion and drop-off step.

---

## 14. Phases (build order)

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 Foundations | Repo, CI, Supabase, auth (F-301), shell (F-101 to F-106), tokens package with temporary neutral set (6.5), section 5 primitives + Storybook + lint rules, entitlements (F-305), data-sources doc, chain-tail + props-snapshot jobs, admin ingestion health | All primitives in all states in Storybook; lint rules active; one public page end to end; Claude Design tokens imported and visual regression baseline recorded |
| 1 Property core | F-401 to F-412, F-202, F-201, F-1606, F-1901 to F-1911 | E2E green; data freshness within cadence |
| 2 Live economy | F-404, F-405, F-706, F-901 to F-903, F-1001 to F-1003, F-1102, F-1103, F-1401, F-1402, F-1501 to F-1503, F-1601 to F-1605, F-203 to F-205 | LiveIndicator on all feeds; reconnect tested |
| 3 Accounts & money | F-302 to F-310, F-801 to F-806, payout engine, F-703, F-704, F-705, F-1701, F-1702 | Reconciliation job clean for 7 days on staging |
| 4 NFTs & neighborhoods | F-1101, F-1201 to F-1210, F-501 to F-506, F-601 to F-604, F-701, F-702 | |
| 5 Member tools & market | F-1801 to F-1808, F-1301 to F-1304, F-411, F-1403, F-1703, F-2001 complete | Escrow audit passes |
| 6 Extensions | F-2101 | Store approval |

---

## 15. Decisions and open questions

| ID | Question | Default until changed |
|---|---|---|
| D-1 | Tier split | Section 4.2 (generous free tier, paid for cost-heavy/transactional) |
| D-2 | Prices | Match UPXLand |
| D-3 | Payment processor | Stripe + UPX balance + Upland transaction; PayPal and MUT not built |
| D-4 | Data access method | Official Developer API where available; public endpoints and Hyperion for public data, pending ToS review |
| D-5 | Public product name and domain | Codename "Embers"; public name and domain not yet chosen |
| D-8 | Design System source | Claude Design artifact; Claude Code consumes tokens and primitive specs per 6.5 |
| D-6 | Devshop properties | Need owned devshop accounts per city before Phase 3 |
| D-7 | Sponsor map asset (Uplytics "Laban asset" model) | Build F-1210 against any configured asset ID |
| R-1 | Risk: Upland API changes or ToS | Abstract every source behind adapters; contract tests nightly |
| R-2 | Risk: custody of user UPX and escrowed NFTs | Legal review of terms before Phase 3 launch |

---

## Appendix A. Enumerations

**A.1 Community nodes (seed data)**
- Bakersfield: Quailwood, Tyner Homes, Vonola
- Bronx: Bronxdale, Country Club, Hunts Point, Spuyten Duyvil
- Brooklyn: Park Slope, Red Hook
- Buenos Aires: Flores, Palermo, Puerto Madero, Recoleta
- Chicago: Avalon Park, Galewood, Hegewisch, Norwood Park, Portage Park, Ukrainian Village
- Detroit: Airport Sub, Boston Edison, Evergreen Lahser 7/8, Sherwood Forest, The Eye
- Fresno: Little Italy, Roosevelt
- Kansas City: Boone Hills, Citadel, Lake Waukomis, Raytown, Timber Valley
- Las Vegas: Paradise, Sunrise, The Lakes
- London: Bridge, Holland, Knightsbridge & Belgravia, St James
- Los Angeles: Beverlywood, Century City, Chatsworth, Downtown, El Sereno, Encino, Granada Hills, Highland Park, Hollywood, Hyde Park, Lake Balboa, Reseda, Sun Valley, Sunland, Toluca Lake, Westchester, Winnetka, Woodland Hills
- Madrid: Arguelles, Estrella, Quintana
- Manhattan: Harlem, Hells Kitchen, Little Italy, Manhattan Valley, Morningside Heights, Tribeca, Upper West Side
- Miami: Melrose, North Grapeland Heights
- Miami Beach: Biscayne Point, Interior, La Gorce, Mid-Beach, Millionaires Row, North Beach, Ocean Drive Area, South Normandy Isle, Sunset Islands, West Avenue
- Nashville: Donelson, Midtown, North Nashville, Priest Lake
- New Orleans: Milneburg, West End
- Queens: Bay Terrace, Bayswater, Bellerose, Flushing, Howard Beach, Kew Garden Hills, Maspeth, Springfield Gardens, Whitestone
- Rio de Janeiro: Cosme Velho, Recreio dos Bandeirantes
- Rome: Appio Pignatelli, Ardeatino, Esquilino, Nomentano, Prati, Trastevere
- San Francisco: Financial District, Merced Manor, Midtown Terrace, Mission, Outer Sunset, Parkmerced, South of Market, Treasure Island
- São Paulo: Interlagos, Moema, Pinheiros
- Washington: American University Park, Crestwood, Downtown, Forest Hills
- Other: Downtown (Vancouver), East (Arlington), Field Club (Omaha), Five Mile Creek (Dallas), Fremont (Seattle), Harbor Bay Isle (Oakland), Kowloon City (Hong Kong), North Central (Santa Clara), North Trenton (Trenton), Pacific (Stockton), Roquette (Paris), Saint-Denis (Saint-Denis), Tahoe Valley (South Lake Tahoe), Wedding (Berlin)

**A.2 Property status**: All, For Sale, For Sale (UPX), For Sale (USD), Unminted, Locked, Owned.

**A.3 Collection tiers**: None, Standard (Blue) 1, Limited (Purple) 2, Exclusive (Orange) 3, Rare (Red) 4, Ultra Rare (Yellow) 5.

**A.4 NFT categories (merged)**: Block Explorer, Car, Watercraft, Decoration / Structure Ornament, Map Asset / Outdoor Decor, Football Legit, NFLPA Legit, Racing Legit, Spirit Legit, Seed, Uppie, Totem, Totem Potion, Structure, Season Pass, City Pass, Essentials, Mementos, Jacky Tsai, Unknown.

**A.5 User levels**: Visitor, Uplander, Pro, Director, Executive, Chief Executive, Level 7+ (render as "Lvl N").

**A.6 Uppie series**: UOrigin, UFRST26, UBLSM26, UGENS26 (extend from DB). Levels 1 to 10, IPU.

**A.7 Uppie event types**: Minted on blockchain, Claimed by user, Bought in UPX, Bought in USD, Swapped, Transferred to escrow, Acquired from escrow, Removed from escrow, Merged from uppies, Merged into new uppie, Unclaimed (Upland treasury).

**A.8 Sparklet store tiers**: $5 = 163; $10 = 362 or 490; $20 = 724, 731 or 978; $50 = 1,810 or 2,444; $300 = 10,861. STEM packages: 5k $4.99, 23k $19.99, 135k $99.99.

**A.9 Chain NFT categories**: blkexplorer, citypass, genesisweek, landvehicle, lorelegit, nflpaclctble, outdoordecor, racepaslegit, seasonpass, seeds, sparkletwarz, structornmt, structure, totempotion, upldtotems, uppie, watercraft.

**A.10 Ledger action labels (F-203)**: Property mint, Property buy, Property sell, Offer made, Offer accepted, Swap, Send, Visa/burn, Stake, Unstake, Start build, Plant, Seed generate, Uppie merge, NFT buy, NFT sell, NFT transfer, UPX transfer, Sparklet bridge in/out, Treasure claim, Race wager, Race payout, Construction Hub post, Construction Hub accept, Unknown (raw).

**A.11 Ornament seasons**: Blossom, Frost, Genesis, Harvest, Sizzle, Wonderland.

**A.12 Send fee tiers**: Economy ≤15 UPX, Standard 16 to 45, Premium >45.

**A.13 Treasure**: rarity Limited, Exclusive, Rare; type Classic, Stealth; mode Normal, Riot.

**A.14 Nursery zones**: Cold, Mild, Hot, Unknown.

**A.15 Fees**: Upland marketplace fee 5% (display toggle); Upland deposit/withdraw fee 10%; SSH listing fee 5% (Premium 4%); structure contract estimator optional 10% fee.
