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

## Phase status

- **1 Foundation** ✓ — Repo scaffold, Docker dev env, Bicep, GitHub Actions
- **2 Plugin engine + safety core** ✓ — kernel modules, registry, bypass check, dilution calculator, fast-check property tests
- **3 Field action UX** ✓ — Spray flow, decon wizard, today card
- **4 Planning + records** ✓ — Drizzle migrations, spray-record persistence + 48hr lock + 2yr retention alert, CSV export, calendar engine, blocks/plantings, scout flow
- **5 Harvest + plugin manager** ✓ — Harvest events, Plugin Manager UI + upload, plugin authoring wizard
- **6 Auth + offline + PDF** ✓ — HMAC cookie sessions, owner/helper role gates, structured bypass-error modal, PDF export, Dexie write queue, Workbox runtime cache
- **7 Calibration + a11y polish** ✓ — UC-10 1/128-acre calibration wizard, sprayer filter on /records, skip-link, focus-visible, aria-live status banners

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
