# Feature backlog — CropCard

UC × functionality audit performed 2026-05-16. This file is the working backlog; it derives from [use-cases.md](./use-cases.md), [personas.md](./personas.md), and [CLAUDE.md](../CLAUDE.md) "open follow-ups". Update this list when items ship or scope changes.

Status conventions:

- **Open** — work has not started.
- **In progress** — partial implementation exists on disk.
- **Ready to merge** — code is on a feature branch and only needs review.
- **Done** — shipped to `main`; close out by deleting the row.

Priority conventions:

- **P0** — blocks a normative use case or a persona's core journey; ship next.
- **P1** — documented gap with clear user impact; ship this season.
- **P2** — polish, micro-improvement, or speculative; ship when convenient.

---

## 1 — Audit findings (status drift in `use-cases.md`)

These are not feature work; they are corrections to the spec doc itself. The summary table at the bottom of [use-cases.md](./use-cases.md) still labels rows that have shipped as "Proposed".

| UC | Doc status | Code reality | Action |
| --- | --- | --- | --- |
| UC-20 | "Proposed" | Implemented — [`/onboarding`](../apps/web/src/routes/onboarding/+page.svelte) creates an `owners` row + Home Field on first sign-in (Phase 18f) | Flip table row to **Implemented**; remove "Proposed primary path" from body |
| UC-21 | "Proposed" | Implemented — [`/settings/helpers`](../apps/web/src/routes/settings/helpers/+page.svelte) issues SHA-256-hashed invite tokens via `lib/server/invites.ts` (Phase 18e) | Flip to **Implemented**; cross-link to UC-17 |
| UC-35 | "Implemented (API only)" | Implemented — wipe UI lives in [`/settings/+page.svelte`](../apps/web/src/routes/settings/+page.svelte) Danger Zone (line ~1436, `WIPE-EVERYTHING` confirm) | Drop the "API only" qualifier |
| Missing `/docs/usability-audit.md` | use-cases.md links to it from 5+ places | File is absent from the repo | Either restore the audit doc from a prior commit, or replace cross-references with this backlog + `clickthrough-reports/` |

Cost: ~20 minutes of editing on `use-cases.md`. Defer the missing audit doc decision to the user.

---

## 2 — P0 backlog (ship next)

### B-01 · UC-16 small-grain harvest-moisture capture *(spec-defined, NOT implemented)*

- **Persona:** P3 (Hay Operator); P1 secondary.
- **Why P0:** UC-16 is normative from HCD Guide §3.6 and is the only outstanding hay/small-grain gap after Sprint E. FR-21 (moisture gate) extends here.
- **Scope:**
  1. Add `moisturePercent` (hundredths) + `moistureReadingsJson` to `harvest_events`; Drizzle migration + `RULES_VERSION` bump.
  2. Extend [`harvest/+page.svelte`](../apps/web/src/routes/harvest/+page.svelte) record form: when the active crop plugin has `moistureGates`, surface a daily-reading input + a target-band indicator and a "trend" sparkline.
  3. Server-side gate: refuse to record harvest if measured moisture is outside the plugin's hard-fail band (mirrors the bale-moisture kernel rule at FR-21).
  4. Export column added to CSV/PDF on `/records` (UC-09).
  5. Vitest property tests for the kernel rule; integration test for the trend chart.
- **Acceptance:**
  - Wheat harvest record carries `moisturePercent`; inspector export shows the column.
  - Plugin-declared `moistureGates.bandPct` outside-band attempts return 422 from the API regardless of UI.
- **Estimate:** 1.5 days (kernel rule + migration + UI + tests).

### B-02 · UC-15 stage-gated task auto-firing *(observation capture deferred)*

- **Persona:** P1, P3.
- **Why P0:** UC-15 is normative. Stage *projection* shipped in v1.3; the missing piece is auto-firing tasks (e.g., "Z30 — N topdress now") from `stage-window` engine events into the task table.
- **Scope:**
  1. Extend [`lib/tasks/`](../apps/web/src/lib/tasks/) materializer to subscribe to `stage-window` events from [`engine.ts`](../apps/web/src/lib/calendar/engine.ts).
  2. Plugin schema add: optional `stageTasks[]` on `growthStageTable` rows (`stageId`, `taskKind`, `daysFromStageStart`).
  3. Idempotent via `pluginTemplateKey` (mirrors UC-38 companion-check task pattern).
- **Acceptance:** Z30 jointing fires a "N topdress" task once per planting; re-running the engine never duplicates it.
- **Note:** Observed-stage capture (operator records "saw Z65 anthesis on May 14") stays deferred — needs the `crop_observations` table from the inspection-card slice; track separately under B-08.
- **Estimate:** 1 day.

### B-03 · Email transport (replace stdout stub)

- **Persona:** P1 (cannot invite helpers without an inbox); blocks UC-21 from being production-ready.
- **Why P0:** [`lib/server/email.ts`](../apps/web/src/lib/server/email.ts) logs invite URLs to stdout. The UI tells helpers to "share the link if email delivery fails" — that's a launch blocker for non-developer owners.
- **Scope:**
  1. Pluggable adapter (Postmark / SES / Resend); pick one — recommend **Resend** for the smallest dependency footprint.
  2. Wire `EMAIL_PROVIDER_KEY` through Bicep + GitHub Actions; document in `infra/azure/parameters.dev.bicepparam`.
  3. Add a "test send" button in `/settings` (owner-only) that hits a sandbox endpoint.
  4. Fallback: if env var missing, keep the stdout stub but flag in the UI ("dev mode — emails are not sent").
- **Acceptance:** Invite email reaches a real inbox within ~30 s of the form submit.
- **Estimate:** 0.5 day.

---

## 3 — P1 backlog (ship this season)

### B-04 · UC-22 inspector-export polish (Sprint D')

- **Persona:** P4 (Dale).
- **Why P1:** Export is the only artifact P4 sees; the audit's quick wins T1/T2/T5/T9 are low-cost, high-trust improvements.
  - **T1** — block name in CSV row (today only block ID).
  - **T2** — sprayer name in CSV row.
  - **T5** — farm context header on PDF first page (farm name, export date, owner email).
  - **T9** — exporter signature footer on PDF + CSV ("Generated by CropCard v{version} on {date}").
- **Scope:** Single pass through the records export endpoint (search `apps/web/src/routes/records/` for the CSV/PDF generators). All four are layout-only changes, no schema or kernel involvement.
- **Acceptance:** PDF and CSV exports each render the new fields; a fresh-eyed reader (run the playwright-clickthrough subagent against `/records?audit=true`) can identify block + sprayer without consulting the app.
- **Estimate:** 0.5 day.

### B-05 · UC-24 search records (brand / chemistry / date)

- **Persona:** P1.
- **Why P1:** With 2-year retention now live, brand search ("when did I last spray Roundup") becomes the dominant query. UC-19 filters cover only sprayer + block today.
- **Scope:**
  1. Add filter row above the records table in [`/records/+page.svelte`](../apps/web/src/routes/records/+page.svelte): text-input (brand / chemistry-class fuzzy), date-range (from / to).
  2. Client-side filter against `data.records` — no new endpoint.
  3. Persist filter state in the URL query so deep-links are shareable.
- **Acceptance:** Typing "Roundup" filters in <1 s; date-range narrows further; URL reflects the filter state.
- **Estimate:** ~30 LOC / 2 hours per UC-24.

### B-06 · UC-23 device-loss mitigation (force-sync + boundary doc)

- **Persona:** P1, P2.
- **Why P1:** Marco's phone breaks before sync → those queued records are lost. Currently silent failure.
- **Scope:**
  1. "Force sync now" button on [`/records/pending`](../apps/web/src/routes/records/pending/+page.svelte) that calls `syncQueue.drainQueue()` and surfaces success/failure.
  2. Banner on `/records/pending` explaining the durability boundary: server-persisted = safe (Litestream), queued = lost on device loss.
  3. Add the boundary explainer to CLAUDE.md follow-ups → close on this branch.
- **Out of scope:** Server-side draft-spray endpoint (the durable solution). Track under B-12.
- **Acceptance:** Owner reads `/records/pending` and understands what's at risk before driving a tractor.
- **Estimate:** 0.5 day.

### B-07 · UC-26 sidebar navigation + footer (nav hierarchy)

- **Persona:** P1, P2, P5.
- **Why P1:** Nav already exceeds the 7-item bottom-tab limit; First-Run Sherry (P5) cannot orient. Scoped in UC-26 — single-file change confined to `+layout.svelte`.
- **Scope:** As specified in UC-26 §"Implementation locus" — sidebar with collapsible sections (`Plan / Today / Operations / Field & Crop / Admin`), header identity strip, footer with `PUBLIC_APP_VERSION`.
- **Acceptance:** UC-26 success-criteria checklist (5 items).
- **Estimate:** 1.5 days (focus trap + a11y review + dev-tools env-var plumbing).

### B-08 · UC-15 observation capture (`crop_observations` table)

- **Persona:** P1, P3.
- **Why P1:** Completes UC-15's "observed-stage capture" half. Foundation for inspection-card UX.
- **Scope:**
  1. New table `crop_observations` with `cropId`, `observedAt`, `stageCode`, `stageBodyKind`, `notes`, `photoUrl?`.
  2. Tenant-scoped via `tenantWhere`/`withTenant` (Phase 18 invariant).
  3. Surface on Plan→Schedule swim-lane bar hover tooltip; "Mark stage" inline action.
- **Acceptance:** Operator records "Z65 anthesis on 2026-05-14"; tooltip shows observed vs. projected delta.
- **Estimate:** 1 day.

---

## 4 — P2 backlog (polish)

| ID | Title | UC | Estimate |
| --- | --- | --- | --- |
| B-09 | Acreage hint text on block + field entry forms | UC-28 | 15 min |
| B-10 | Bulk multi-field entry on Plan Overview | UC-27 | 2 hours |
| B-11 | Auth.js magic-link upgrade (replace HMAC cookie) | UC-17 | 1 day |
| B-12 | Server-side draft-spray endpoint (durable offline) | UC-23 | 1.5 days |
| B-13 | Push notifications (NFR-06) | — | 1 day |
| B-14 | Orchard-specific seasonal calendar (dormant spray, bloom fungicide) | UC-18 | 1 day plugin work + minor engine hook |
| B-15 | Workbox per-tenant cache keys (avoid wipe on owner switch) | — | 0.5 day |
| B-16 | Sync-queue conflict resolution beyond last-write-wins | UC-12 | 1.5 days |
| B-17 | Orchard / vine-fruit growth-stage templates beyond annuals | UC-40 | 0.5 day |

---

## 5 — Tech debt (non-UC, from CLAUDE.md "open follow-ups")

| ID | Title | Notes |
| --- | --- | --- |
| T-01 | Wire `eslint/no-raw-tenant-table.cjs` as a custom ESLint rule | Phase 18b-LINT; needs `eslint-plugin-rulesdir` or workspace package promotion |
| T-02 | Drop legacy `users.role` column | Once `helper_assignments.role_within_owner` is the only writer; new migration |
| T-03 | Restore or retire `docs/usability-audit.md` | Referenced from `use-cases.md` and `design_docs_reference.md` memory but absent from disk |
| T-04 | Replace remaining placeholder text inputs (audit F-F) | Scout's tallest-weed input; harvest's quantity/lot |
| T-05 | UC-03 STOP card 7:1 contrast (audit F-A) | HCD §2.2 stop-screen spec; currently 4.8:1 AA only |
| T-06 | `/today` primary CTA min-height bump to 48 px+ (audit F-H) | Currently 44 px ([today:241](../apps/web/src/routes/today/+page.svelte#L241)) |
| T-07 | Promote `/` to redirect to `/today` (audit F-E) | Today is the workflow hub but the HTTP root still renders the tile grid |

---

## 6 — Phase-9 follow-ups (plugin library expansion)

Sourced from [phase-9-resume.md](./phase-9-resume.md). Verified against current code: rotation engine (Phase 0 item) + trait-gating (Phase 11 item) **shipped** — dropped from this list. The rest are still open.

### B-18 · `/spray/fungicide` UI route *(P1)*

- **Why:** 27 fungicide plugins ship in [`plugins/fungicides/`](../plugins/fungicides/) but no UI consumes them — they're inert. Mid-Atlantic vegetable growers need fungicide application records for organic certification and CSA member trust.
- **Scope:** Mirror `/spray/+page.svelte` against `registry.fungicides()`. Reuse dilution math (class-agnostic). Skip the cross-contamination kernel call — use FRAC rotation hints from [`agronomy/resistance.ts`](../apps/web/src/lib/agronomy/resistance.ts). Wire decon (UC-04) only when `deconRequired: true` on the plugin (rare — copper after Bordeaux mix).
- **Acceptance:** Owner records a copper-fungicide application against a tomato block; row lands in a new `fungicide_events` table; export shows it on `/records`.
- **Estimate:** 1.5 days (new table + migration + endpoint + UI).

### B-19 · `/equipment/new` template picker UI *(P1)*

- **Why:** [`equipmentTemplates.ts`](../apps/web/src/lib/server/equipmentTemplates.ts) ships 30 seed templates across tractor / sprayer / tillage / planter / mower / hay / irrigation but no UI surfaces them. First-Run Sherry (P5) hand-types every equipment row.
- **Scope:** New `GET /equipment/new` route — category-grouped picker; POST instantiates via existing `createEquipment()` at [`equipment.ts:184`](../apps/web/src/lib/db/equipment.ts#L184); persist `spec` JSON; redirect to detail page. ≥48 dp tap targets per CLAUDE.md field-UI invariant.
- **Acceptance:** Sherry registers a 12-ft Lemken plough from a template in <30 s without retyping spec fields.
- **Estimate:** 0.5 day.

### B-20 · Class-specific decon protocols (kernel design) *(P1, design first)*

- **Why:** The cross-contamination kernel at [`crossContamination.ts:18`](../apps/web/src/lib/safety/crossContamination.ts#L18) uses generic "previous class differs → standard decon" semantics. Several common chemistries need class-specific protocols the standard SOP misses:
  - **Paraquat** — bipyridyl ion binds tank surfaces; needs 1 % bleach + 1 % TSP + 3 water rinses (not ammonia).
  - **Glufosinate (Liberty)** — adsorbs to tank fittings; needs detergent + water.
  - **Copper-based fungicides** — filter-screen residue damages next-pass crop; needs vinegar rinse.
- **Open decision:** Bake per-class protocols into the decon kernel + wizard, OR document only and let users follow product-label SOPs? **Owner input needed before scoping.**
- **If we bake them in:** Add `deconProtocol` discriminated union on `cropFamilyLethality.ts` chemistry profiles; extend [`spray/decon/+page.svelte`](../apps/web/src/routes/spray/decon/+page.svelte) to render alternate step lists; bump `RULES_VERSION`.
- **Estimate:** 1 day after design decision.

### B-21 · HRAC / IRAC / FRAC group-code badges *(P2)*

- **Why:** All data is wired (`ChemistryProfile.hracGroup`, `activeIngredients.iracGroup`, `activeIngredients.fracCode`; labels at [`agronomy/resistance.ts`](../apps/web/src/lib/agronomy/resistance.ts) — `HRAC_LABELS`, `FRAC_LABELS`, `IRAC_LABELS`). No consumer renders them. Resistance-management is a real planning concern — visible group codes let the owner avoid back-to-back same-group passes.
- **Scope:** Small color-coded badge next to each product in `/spray` herbicide list, `/spray/fungicide` (when B-18 lands), and `/plugins`. Same palette as the kernel decon banner.
- **Acceptance:** Owner sees an HRAC-2 badge next to all sulfonylureas and can plan rotation by eye.
- **Estimate:** 0.5 day.

### B-22 · Refresh public JSON schemas under `/schemas/` *(P2, docs-only)*

- **Why:** Author-facing JSON schemas at [`schemas/`](../schemas/) are stale: missing `fungicide.schema.json` + `fertilizer.schema.json`; existing `crop.schema.json` + `insecticide.schema.json` lack newer fields (`seasonalTasks`, `iracGroup`, `preHarvestIntervalDays`, `targetPests`, `pollinatorRisk`, `ratePerAcre`, `dilutionTable`, `labelClaims`, `crossesWith`, `isolationFeet`, `growthStageTable`).
- **Scope:** One-shot `apps/web/scripts/gen-schemas.mjs` using `zod-to-json-schema` that walks the discriminated union in [`plugins/schemas.ts`](../apps/web/src/lib/plugins/schemas.ts) and writes all six files. Add `pnpm gen:schemas` script. No runtime impact — Zod stays the source of truth.
- **Acceptance:** External plugin authors can read `schemas/*.schema.json` and have it match Zod validation 1:1.
- **Estimate:** 2 hours.

### B-23 · International / Canadian product equivalents *(P2, scope question)*

- **Why:** Library is US-label-anchored. Same active ingredients ship in EU / CA with different brand names + formulations (Liberty 200 SL vs 280 SL; Roundup Transorb HC in Canada). Not blocking the primary Loudoun VA persona but flagged for completeness if CropCard ever leaves the single-farm scope.
- **Open decision:** Scope CropCard to US-label only and reject EU/CA plugin contributions? Or accept a `region` field on each plugin and surface a region filter on `/plugins`? **No work until decided.**

---

## How to use this file

1. Pick the highest-priority **Open** item; spawn a Plan agent against the UC body in [use-cases.md](./use-cases.md) for the full spec.
2. Branch name format: `feature/B-NN-short-slug` (e.g., `feature/B-01-uc16-harvest-moisture`).
3. On merge: delete the row from this file in the same PR — keep the backlog short.
4. When scoping a feature that adds or changes a UC, edit [use-cases.md](./use-cases.md) **in the same PR** (per memory `feedback_update_ucs.md`).
