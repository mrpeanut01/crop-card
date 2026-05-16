# CropCard — agent guidance

This file is read by Claude Code (and similar agents) on every session in this repo. Keep it short and actionable.

## What this project is

CropCard is an offline-first PWA replacing the paper "Field Card" for a small-plot Loudoun County, VA farm. SvelteKit + TypeScript, single container, deployed to Azure Container Apps with SQLite + Litestream.

## Invariants — DO NOT BREAK

1. **Safety rules live in `apps/web/src/lib/safety/`.** Plugin JSON files cannot override them. Adding a new rule means editing TypeScript, bumping `RULES_VERSION` in `apps/web/src/lib/safety/version.ts`, and writing exhaustive vitest + fast-check tests.
2. **Plugins are data-only.** No executable JavaScript in any file under `plugins/`. Schema validation at registration is mandatory.
3. **Single replica only.** `infra/azure/main.bicep` sets `maxReplicas: 1` and `revisionMode: 'single'`. SQLite + Litestream is single-writer; multi-replica would corrupt the DB. Do not change these without a database migration plan.
4. **Spray records are immutable after the lock window** (default 48h, FR-09). Server endpoint must enforce this regardless of UI.
5. **Helper role cannot edit locked records or override custom rates.** Server enforces in addition to UI.
6. **Tenant isolation is row-level via `owner_id`** (Phase 18a). Every tenant-scoped repo MUST funnel reads/writes through `tenantWhere`, `withTenant`, or `tenantValues` from `apps/web/src/lib/db/tenant.ts`. The `TenantScoped` brand on schema tables is the compile-time gate; the cross-tenant property test (`apps/web/src/lib/db/tenant.crossTenant.test.ts`) is the runtime gate. Adding a new tenant-scoped table requires: (a) brand it via `tenantScoped(...)` in `schema.ts`, (b) add an `owner_id` column + composite index, (c) wire it into the cross-tenant test, (d) refactor consuming repos. Intentionally-global queries must call `unscopedQueryNote('reason')` in the same function.

## Where things go

| Concern | Path |
|---------|------|
| Hard-locked safety rules + kernel | `apps/web/src/lib/safety/` |
| Plugin registry, Zod validators, bypass check | `apps/web/src/lib/plugins/` |
| Dilution math + 1/128-acre calibration | `apps/web/src/lib/dilution/` |
| Season calendar engine | `apps/web/src/lib/calendar/` |
| Drizzle (server) DB schema + repos | `apps/web/src/lib/db/` |
| Client Dexie / sync queue (offline → cloud) | `apps/web/src/lib/client/` |
| Server-only helpers (auth, sprayers, registry) | `apps/web/src/lib/server/` |
| HMAC cookie sessions + role gates | `apps/web/src/lib/server/session.ts`, `auth.ts`, `hooks.server.ts` |
| Plugin JSON files | `plugins/{crops,herbicides,insecticides,companions}/` |
| Public JSON Schemas | `schemas/` |
| Container build | `infra/Dockerfile` |
| Local dev orchestration | `infra/docker-compose.yml` |
| Litestream replication | `infra/litestream.yml`, `infra/entrypoint.sh` |
| Azure infra | `infra/azure/main.bicep` |
| Planter plate matching engine + Lincoln Ag catalog | `apps/web/src/lib/planterPlate/` |

## Phase status

- **1 Foundation** ✓ — Repo scaffold, Docker dev env, Bicep, GitHub Actions
- **2 Plugin engine + safety core** ✓ — kernel modules, registry, bypass check, dilution calculator, fast-check property tests
- **3 Field action UX** ✓ — Spray flow, decon wizard, today card
- **4 Planning + records** ✓ — Drizzle migrations, spray-record persistence + 48hr lock + 2yr retention alert, CSV export, calendar engine, blocks/plantings, scout flow
- **5 Harvest + plugin manager** ✓ — Harvest events, Plugin Manager UI + upload, plugin authoring wizard
- **6 Auth + offline + PDF** ✓ — HMAC cookie sessions, owner/helper role gates, structured bypass-error modal, PDF export, Dexie write queue, Workbox runtime cache
- **7 Calibration + a11y polish** ✓ — UC-10 1/128-acre calibration wizard, sprayer filter on /records, skip-link, focus-visible, aria-live status banners
- **18a Multi-tenant foundation** ✓ — `owner_id` column on every operational table, `tenant.ts` AsyncLocalStorage context, `tenantWhere`/`withTenant`/`tenantValues` scoped helpers, `TenantScoped` type brand, ESLint rule (file ready, wiring deferred), backfill into `owner_home_farm`. New tables: `owners`, `helper_assignments`, `helper_invites`, `plugin_overrides`, `owner_subscriptions`, `owner_usage_counters`, `superadmin_audit`. Migrations 0020 (schema) + 0021 (backfill) + 0022 (NOT NULL enforcement) + 0023 (superadmin_audit.owner_id stays nullable).
- **18b Repo rewrites** ✓ — every repo in `apps/web/src/lib/db/` funnels through tenant helpers. Cross-tenant property test at `tenant.crossTenant.test.ts`; cross-tenant export hardening at `exports.crossTenant.test.ts`. 413 tests passing.
- **18c Session + Owner-picker** ✓ — `SessionPayload` carries `activeOwnerId`/`activeRole`/`isSuperadmin`/`impersonating`. `/owner-picker` route + `/api/session/switch-owner` API. `loginByEmail` returns a `LoginResult` indicating onboarding / picker / today.
- **18d UI plumbing** ✓ — top-nav Owner chip with switcher (calls `resetTenantCaches` in `lib/client/tenantSwitch.ts` then reloads), impersonation banner, role banners.
- **18e Helper invites** ✓ — DB-stored tokens (SHA-256 hashed) in `helper_invites`. `lib/server/invites.ts` issue/list/revoke/redeem; `/settings/helpers` + `/api/invites` + `/invite/[token]`. Email stub at `lib/server/email.ts` logs invite URLs to stdout (replace with provider in prod).
- **18f Self-serve onboarding** ✓ — `/onboarding` route creates an `owners` row, mints `helper_assignments(role='owner')`, seeds a Home Field. New users land here automatically via `hooks.server.ts`.
- **18g Superadmin + billing scaffold** ✓ — `/admin/owners` cross-tenant UI, `setBillingStatus`, `impersonate`/`exitImpersonation` actions, `superadmin_audit` writes per mutation. `owner_usage_counters` UPSERT in `aiGuard.recordCall` and `insertSprayEvent` via `incrementUsageCounter`.
- **18h Client offline scoping** ✓ — Dexie v2 migration adds `ownerId` to `pendingSprayRecords` and `cachedCatalogs`; `syncQueue.drainQueue` filters to the active Owner and surfaces `skippedOtherOwner`; `pendingCountForOtherOwners` for the banner.
- **18i Exports hardening** ✓ — cross-tenant integration tests verify `listSprayEvents`/`listInsecticideEvents` never leak between Owners under arbitrary filter combinations.
- **19 Cross-pollination spatial advisor (UC-37 extension)** ✓ — Plugin schema `crossesWith[]` + `isolationFeet` + `isolationStaggerDays`. Resolver `lib/plan/pollination.ts` (corn + brassica family defaults, cucurbit species table for C. pepo / moschata / maxima). Haversine block-distance helper at `lib/blocks/distance.ts` (null on missing geometry). Pollination layer at `lib/plan/pollinationLayer.ts` produces crossing pairs, sorted distance grids for the prompt, and post-hoc `PollinationConstraint[]` (`isolated-spatially` / `must-stagger` / `geometry-missing`). Allocator prompt + validator extended; carry-forward through `allocate` + `/api/plan/allocate/refine`. UI: compact single-summary chip per row, geometry-missing banner, chat seed message lists pollination findings.
- **20 Schedule pane + dated commit + succession sowing (UC-37c)** ✓ — 4th wizard step. `lib/schedule/scheduleCandidacy.ts` derives `{earliestMs, latestMs, hardiness, dtmDaysMax, freeSubWindows}` per assignment from frost dates + plugin `soilTempMinF` + DTM + `existingCrops` block occupancy. `lib/schedule/succession.ts` family-keyed intervals (leafy-green/legume 14d, brassica/alliums 21d, cucurbit/solanaceae 0). `lib/plan/companionOffsets.ts` detects 3-sisters etc. from the accepted allocation; reuses `plantingOffsetDays` from companion plugins. Server module `lib/server/aiSchedule.ts` exposes `schedulePlantings()` + `refineSchedule()` with the same validator pattern as `aiAllocation` (deterministic fallback on invalid). Endpoints: `POST /api/plan/schedule` + `POST /api/plan/schedule/refine`. Wizard: same chat panel continues; "Accept all → schedule" advances; commit posts per-row with `plantingDate` populated. 82 unit tests across the new modules.
- **21 Season Setup + AI Inputs Plan (UC-42 + UC-37d)** ⏳ In progress — closes the gap between "what + where + when to plant" (Phases 14–20) and "what to apply + when + what to buy." Canonical tracker: [docs/phase-21-plan.md](docs/phase-21-plan.md). Sub-tasks: **A** Season Setup (`settings`-backed per-(owner, year) 6-question form; first step of `/plan`; see UC-42) — in progress. **B** Plugin schema additions (`complianceFlags` on inputs + `purpose`/`*Gate` on crop `sprayWindows[]`; additive, bumps plugin version). **C** `lib/plan/inputsPlan.ts` — pure deterministic planner covering weeds + pests + fertility + cover-crop terminate. **D** `lib/server/aiInputsPlan.ts` — substitution/tank-mix layer mirroring `aiSchedule.ts`. **E** 5th wizard step UI + commit (writes `tasks` rows with `relatedEventTable` pre-set, shopping list rail). **F** Remediation (gate UC-41 planter-plate UI behind `display_planter_setup`; auto-hide pollination panel when no crossing pairs). Target persona: P1 only. Explicitly out of scope: enterprise budgets, forward contracts, APH insurance, VRT prescriptions, per-cutting hay spray planning (Sprint E owns that).

## Phase 18 — open follow-ups

- **18b-LINT** — wire `apps/web/eslint/no-raw-tenant-table.cjs` as a custom ESLint rule (needs `eslint-plugin-rulesdir` or workspace package promotion).
- **Email transport** — `lib/server/email.ts` is a stdout stub; wire Postmark/SES/Resend before public launch.
- **users.role legacy column** — drop in a follow-up migration once `helper_assignments.role_within_owner` is the only writer.
- **Workbox per-tenant cache keys** — current approach deletes the cache on switch; richer namespacing (custom `cacheKeyWillBeUsed` plugin) would avoid the wipe.
- **Migration runner** — `db:migrate` now uses `node scripts/migrate.mjs` (which disables FKs around `migrate()` because SQLite ignores `PRAGMA foreign_keys=OFF` inside a transaction, and drizzle wraps each migration file in one). Keep using the wrapper, not bare `drizzle-kit migrate`.

## Known follow-ups (not blocking)

- Auth.js magic-link upgrade — `@auth/sveltekit` is installed; current sessions are HMAC-cookie for v1. Swap is localized to `loginByEmail` + `hooks.server.ts`.
- Workbox precache only takes effect on `pnpm build`; dev mode disables the SW intentionally.
- Sync-queue conflict resolution is last-write-wins on the *server*; multi-device same-spray race detection is not implemented (single-farm scope).
- Push notifications (NFR-06) not wired.
- Orchard-specific seasonal calendar (dormant spray, bloom fungicide) — orchards work as a kernel crop family today, but a richer calendar dataset is future plugin work.

## Common commands

```sh
docker compose -f infra/docker-compose.yml up          # local dev
pnpm test:unit                                         # vitest
pnpm test:e2e                                          # playwright
pnpm db:generate                                       # author migration
pnpm db:migrate                                        # apply migrations
az deployment group create -g cropcard-dev-rg \
  --template-file infra/azure/main.bicep \
  --parameters infra/azure/parameters.dev.bicepparam   # manual deploy
```

## Code style

- Default to no comments; only add when the *why* is non-obvious.
- TypeScript strict mode is on; do not weaken it.
- Field UI must be one-handed-glove operable (≥48dp tap targets, high-contrast).
- Test the safety kernel like a security boundary, not feature code.
