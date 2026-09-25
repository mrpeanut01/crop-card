# Lifecycle playtest — In-season stages S4–S6

**Date:** 2026-07-04
**Method:** HTTP-level probes (curl) against the running dev server (`http://localhost:5283`) + direct source reads. Browser tooling unavailable; this mirrors the S1–S3 wave method.
**Sessions:** owner (`owner@cropcard.local`), helper (`helper@cropcard.local`) — both logged in via `POST /?%2Fdemo` with `Origin` header. `RULES_VERSION` on the wire: **0.5.2-sprint19**.
**Spec:** `docs/design/SEASON_LIFECYCLE.md` §S4 (S4-A1..A20, S4-G1..G10), §S5 (S5-A1..A30, S5-G1..G10), §S6 (S6-A1..A33, S6-G1..G7).
**Prior art cited (not re-derived):** `scratchpad/playtest/api-kernel-records.md` — Probe 1 (kernel STOP non-bypassable), Probe 2 (S6-G1 moisture UI-unreachable), Probe 3 (FR-09 lock on non-spray DELETE), Probe 4 (S6-G2 bale override), Probe 6 (rulesVersion stamping REFUTED-as-herbicide-only → all three stamp).

Seed handles: Block-A corn planting `3d0a4fbd-278c-460f-9d74-c120eaef994d`; calibrated 22-GPA sprayer `1ef93769-1abe-48f9-8da4-944ee3a76147`; sprayer `31951298…` (XTENANT2, calibratedGpa 1).

---

## Tally

| | Pass | Fail (gap confirmed) | Blocked / not reachable over HTTP |
|---|---|---|---|
| S4 | 5 | 2 (S4-G1, S4-G2) | task-abort live cascade (no open task in seed) |
| S5 | 6 | 3 (S5-G1, S5-G3, S5-G6) | stock-decrement GPA math live (no pesticide SKU in seed) |
| S6 | 8 | 3 (S6-G5, S6-G7 + prior S6-G1/G2) | hay-diary full walk (out of scope this wave) |

**Gaps: confirmed 8 / refuted 1 / new 3.**
Confirmed: S4-G1, S4-G2, S5-G1, S5-G3, S5-G6, S6-G5, S6-G7 (+ prior-confirmed S6-G1, S6-G2).
Refuted: none newly (Probe-6 "herbicide-only rulesVersion" was already refuted by the API agent).
New findings: **CT-S4-003** (unknown-task PATCH → raw 500), **CT-S5-004** (cross-tenant sprayer reachable + decon-able), **CT-S6-005** (squash cure-gate copy says "drying required").

---

## S4 — In-season daily operations

### CT-S4-001 · /today loader returns the full alert + strip set · PASS
**GET /today** (owner) → HTTP 200, 95 KB. Rendered markers grep-confirmed: Week/Month/Season strip labels, `priority` hero, `low-stock`/`lowStock`, `expiring`/`EXPIRING`, `decontam` + "Run decon" CTA, harvest surfacing. Loader source (`routes/today/+page.server.ts`) confirms the projections: `derivePriorityAction()` (:155), `lowStockItems()` (:233), `expiringSoon(30)` (:241), plus the site-wide dirty-sprayer banner in `+layout.server.ts:18-31`.
**Assertions covered:** S4-A1, S4-A2 (hero), S4-A6 (84-day strips), S4-A9 (low-stock + expiring banners), S4-A11 (decon banner).
**Verdict:** PASS. Loader shape matches spec.

### CT-S4-002 · Skip-with-reason PATCH + helper mutate parity · PASS (schema + auth), live-abort BLOCKED
**PATCH /api/tasks/[id]** schema (`routes/api/tasks/[id]/+server.ts:17-26`) is a discriminated union; `action:'abort'` carries `reason: z.string().max(500).optional()`. Auth gate at :47 blocks inspector (`canMutate`), lets owner + helper through.
Live: no open task exists in the seed (`GET /api/tasks` → `{"tasks":[]}`), so the full abort→persist→leave-list cascade could not be walked. Instead I probed the auth boundary against a synthetic id:
- **helper** PATCH abort → HTTP **500** "unknown task id" (passed the auth gate — helper *can* abort; the 500 is the missing-row throw, not a 403).
- **owner** PATCH abort → HTTP **500** "unknown task id" (same).
**Assertions covered:** S4-A3 (schema), S4-A5 (helper succeeds past auth — confirmed; inspector-403 path is source-verified, not live-tested).
**Verdict:** PASS on schema + auth; live cascade BLOCKED (seed has no open task).

### CT-S4-003 · Unknown task id → raw 500 instead of 404 · P2 · NEW FINDING
**PATCH /api/tasks/00000000-…** (valid uuid, no row) → HTTP **500** `{"message":"Server error: unknown task id: …"}`. `abortTask`/`completeTask` throw on a missing row and the handler has no catch → leaks a 500 + internal message where a clean **404** is correct. Low-severity (only reachable with a crafted id), but it's an unhandled-throw pattern worth a guard. Not in the gap list.
**Verdict:** P2, new.

### CT-S4-004 · S4-G1 — drain summary drops `skippedOtherOwner` · P1 · CONFIRMED
`routes/records/pending/+page.svelte:27` renders `Synced ${result.succeeded.length}; ${result.failed.length} still pending.` — `DrainResult.skippedOtherOwner` (computed + returned by `drainQueue`, `syncQueue.ts`) is **never shown** in the drain action. The pre-drain badge (`otherOwnerCount > 0`) covers the state passively, but CLAUDE.md Phase 18h says the drain itself "surfaces `skippedOtherOwner`". Source-confirmed.
**Verdict:** CONFIRMED (P1). Matches spec S4-G1 exactly.

### CT-S4-005 · S4-G2 — `cropcard.activeOwnerId` only seeded on owner *switch* · P1 · CONFIRMED
Sole **writer** of the sessionStorage key is `lib/client/tenantSwitch.ts:34` (fires only on owner-switch). Grep across `routes/` + `lib/` finds no `+layout` mount that seeds it from `data.activeOwner.id`. Three **readers** depend on it:
- `syncQueue.ts:44` — `enqueueSprayRecord` falls back to hard-coded `'owner_home_farm'` when null → **wrong owner tag** for any non-home-farm tenant that never switched.
- `syncQueue.ts:87` — `listPendingForActiveOwner()` returns `[]` when null → `/records/pending` shows an empty queue while the layout banner counts rows.
- `syncQueue.ts` `drainQueue` guard is `if (ownerId && rec.ownerId !== ownerId)` — when `ownerId` is **null the tenant filter is skipped entirely** and the drain submits **all** owners' rows.
- (fourth reader `dexie.ts:102` falls back to Home Farm — same null-blindness.)
A fresh tab / first login that never switches Owner hits all three. Source-confirmed.
**Verdict:** CONFIRMED (P1). Matches spec S4-G2. Fix: seed the key from `data.activeOwner.id` on layout mount.

*Not walked this wave (require offline/Dexie browser context):* S4-A16..A20 (offline queue drain, two-farm scoping), S4-G3 (legacy abort hardcoded reason), S4-G4 (reload-instead-of-invalidate). S4-G3/G4 are source-visible in the spec's cited line refs and remain as filed.

---

## S5 — In-season spray operations

### CT-S5-001 · Happy-path herbicide record · PASS
**POST /api/spray/record** — atrazine on the corn block, 22-GPA calibrated sprayer, conditions `{windMph:5, tempF:70, rainForecastMmNext24h:0}`, tank 20 gal → HTTP **200**. Persisted `event`: `rulesVersion:"0.5.2-sprint19"`, `pluginHashes.atrazine-4l-generic` present (64-hex), `customRateOverride:false`. `products[0].rate = {amount:2, unit:"qt"}`.
(Schema note: `conditions.rainForecastMmNext24h` is **required** — an omitted value 400s. Not a gap, just a payload contract.)
**Assertions covered:** S5-A1.
**Verdict:** PASS.

### CT-S5-002 · Kernel STOP non-bypassable + non-persisting · PASS (cite prior)
Cited from `api-kernel-records.md` Probe 1: glyphosate-on-corn → 422 `CROP_INCOMPATIBLE`; stray `override/force/bypass/overrideKernel/customRateOverride` fields Zod-stripped, verdict unchanged; `export.csv` shows 0 glyphosate rows (never written).
**Assertions covered:** S5-A2, S5-A4, S5-A5.
**Verdict:** PASS (kernel holds).

### CT-S5-003 · Untracked-product warns, never blocks · PASS
Atrazine has no linked stock SKU → the 200 record carried `stockDecrements:[]` + `stockWarnings:["atrazine-4l-generic: not tracked in stock — add a SKU on /stock to enable auto-decrement"]`.
**Assertions covered:** S5-A18.
**Verdict:** PASS. *Minor:* the warning links **/stock** (dead → 308) instead of `/inventory` (Phase 27 canonical). Cosmetic copy drift, sibling of #280.

### CT-S5-004 · S5-G3 — decon endpoint has NO auth/role gate · P1 · CONFIRMED (live + source)
`POST /api/sprayers/:id/decon` (`routes/api/sprayers/[id]/decon/+server.ts`) checks only `params.id` + `getSprayer(id)`. **No `currentUser`, no `canMutate`, no `requireOwner`.**
Live: **helper** (read-widened role) `POST …/decon` → HTTP **200**, `lastDeconAt` advanced to a fresh server timestamp — clearing contamination state, which *opens* a safety gate. Contrast: the three record endpoints 403 an inspector before kernel work.
**Also — cross-tenant reach (NEW):** the sprayer I decon'd (`31951298…`, label **XTENANT2**) is not the owner's own rig yet was fully readable via `GET /api/equipment` and mutable via the decon POST from the owner session. Combined with the missing role gate this is a two-part exposure: (a) any session role can decon, (b) sprayers outside the active tenant appear in the list. Flagging (a) as the confirmed S5-G3; (b) as a NEW cross-tenant observation for the authz wave to corroborate.
**Assertions covered:** S5-A10 (fabricated `deconAt:1` **ignored** — server stamps its own `Date.now()`; server-authoritative timestamp PASSES).
**Verdict:** S5-G3 CONFIRMED (P1). New sub-finding: cross-tenant sprayer visibility/mutation (P1, needs authz-wave corroboration).

### CT-S5-005 · S5-G1 — insecticide/fungicide decrement ignores calibrated GPA · P1 · CONFIRMED (source)
Herbicide path decrements with `stored?.calibratedGpa` (`api/spray/record/+server.ts:245`). Insecticide (`api/insecticide/record/+server.ts:348`) and fungicide (`api/fungicide/record/+server.ts:320`) both call `computeRatedDilution` with `gpaCalibration: p.gpaCalibration ?? 15` — the **plugin default, ignoring the sprayer's stored calibration**. An 18-GPA (or here 22-GPA) rig under-decrements insecticide/fungicide stock by the calibration ratio. Live decrement-math verification blocked (no pesticide SKU in seed) but the divergence is unambiguous in source.
**Assertions covered:** S5-A19/A20 pass for herbicide (calibrated GPA used); *would fail* if extended to the other two flows, exactly as the spec predicts.
**Verdict:** CONFIRMED (P1). Matches spec S5-G1.

### CT-S5-006 · S5-G6 — synthetic conditions persisted as measured · P1 · CONFIRMED (live)
The 200 record from CT-S5-001 persisted `conditions:{windMph:5, tempF:70, rainForecastMmNext24h:0}` verbatim — the exact synthetic defaults the UI hard-codes (`spray/+page.svelte:83-84`). There is **no provenance flag** on `conditionsJson` distinguishing a measured reading from the 5-mph/70-°F placeholder. A real 20-mph day would still record as 5 mph. The environment gate is therefore exercised only against defaults on this path.
**Verdict:** CONFIRMED (P1). Matches spec S5-G6.

*Not walked this wave:* S5-A6..A9 (cross-contamination decon gate live), S5-A21..A26 (IPM / pollinator / FRAC / copper×sulfur — the API agent covered the kernel gates; rulesVersion stamping on all three flows is confirmed there), S5-A28 (offline replay), S5-G2 (insecticide/fungicide never run cross-contamination gate — source-filed), S5-G4/G5 (decon "mark clean" bypass; dead PATCH guard — source-filed). These remain as filed in the spec; nothing observed contradicts them.

---

## S6 — In-season harvest & forage

### CT-S6-001 · Moisture kernel gate fires per-archetype · PASS (API)
**POST /api/harvest/record** live:
- wheat (small-grain.zadoks, 13.5) @ 13.0 → **200** committed (warn band).
- winter-squash-cure @ **71%** → **422** `HARVEST_MOISTURE_OVER_THRESHOLD`, `thresholdPct:70`, human `message`; @ **65%** → **200**.
- habanero (continuous-harvest-fruit, no gate) @ **90%** → **200** (no gate, any moisture commits).
Prior-agent Probe 2 already covered the full wheat table (18→422, 13.5 equality→200, omitted→200, stray override→422).
**Assertions covered:** S6-A17..A22 (via API), S6-A18, S6-A20, S6-A22.
**Verdict:** PASS at the API layer. *(S6-G1 — the shipping /harvest UI never sends `moisturePct`, so a gloved operator can't trip this gate — remains CONFIRMED per prior agent Probe 2; not re-derived.)*

### CT-S6-002 · S6-G7 — moisture never persisted on the event row · P2 · CONFIRMED (source + live)
`insertHarvestEvent({blockId, cropId, cropPluginId, occurredAt, quantity, lotNumber})` at `api/harvest/record/+server.ts:72-79` **omits `moisturePct`** — it is validated (:26) and gate-checked (:51-57) then dropped. `HarvestEventInput` (`lib/db/harvestEvents.ts:17-23`) has no moisture field; the `harvest_events` table (`schema.ts:610-628`) has **no `moisture_pct` column** (cols: id, owner_id, block_id, crop_id, crop_plugin_id, occurred_at, quantity, lot_number, provenance_json).
Live: wheat harvest posted with `moisturePct:13.0` (passed the gate) → the 200 `event` object contains only `quantity` + `lotNumber`, **no moisture trace**. UC-16 "export shows moisture column for inspector" is unmet; the YTD CSV has no moisture column.
**Verdict:** CONFIRMED (P2). Matches spec S6-G7. Fix: add `moisture_pct` to `harvest_events` + thread it through `insertHarvestEvent`.

### CT-S6-003 · S6-G5 — no PHI enforcement at harvest time · P1 · CONFIRMED (source + live)
`detectPhiConflict()` (`lib/schedule/timeline.ts:10`) is consumed **only** by `routes/plan/+page.svelte:299` (plan-timeline render). Grep confirms neither `api/harvest/record/+server.ts` nor `harvest/+page.server.ts` references `spray_events` / `insecticide` / `fungicide` / `preHarvestInterval` / `detectPhiConflict`.
Live: recorded an atrazine herbicide spray on the corn block, then immediately posted a corn harvest on the same block → clean **200**, no PHI warning, no PHI field, no conflict flag. Spraying then harvesting the same block the same minute produces no signal anywhere on the harvest path.
**Verdict:** CONFIRMED (P1). Matches spec S6-G5. Silence is the gap, not a pass. Candidate fix: loader-computed PHI chip per planting + a warn on the record endpoint.

### CT-S6-004 · Bale fire-risk override + moisture UI-unreachability · CONFIRMED (cite prior)
- **S6-G1 (P1):** Phase 26A moisture kernel unreachable from shipping UI — prior agent Probe 2 (renderer contract `{quantity?, lotNumber?}` only; page POST omits `moisturePct`; renderers pack moisture into the lot-tag string). CONFIRMED.
- **S6-G2 (P1):** FR-21 bale danger STOP is server-overridable — prior agent Probe 4 (`overrideBaleGate:true` skips even `severity:"danger"`, `api/hay/cuttings/[id]/+server.ts:120`). CONFIRMED.
- **S6-G3 (P2):** 422 surfaces as raw error code (`harvest/+page.svelte:56` assigns `lastError = out.error`), discarding the human `message` + `thresholdPct`. CONFIRMED by prior agent. Corroborated: the API `message` **is** human-readable ("Stored moisture 71.0% > 70.0% … Drying required") — the loss is UI-side.
**Verdict:** CONFIRMED (cited, not re-derived).

### CT-S6-005 · Cure-archetype 422 copy says "Drying required" · P2 · NEW FINDING
Winter-squash-cure @ 71% → message `"Stored moisture 71.0% > 70.0% safe-storage threshold for this crop family. Drying required before commit."` For a **cure** archetype, 70% is a *maximum cure moisture ceiling*, not a drying floor — "drying required" reads oddly for a squash whose whole point is to cure down slowly. The generic small-grain "drying required" string is reused for the cure band. Cosmetic; the gate itself is correct. Not in the gap list.
**Verdict:** P2, new (copy).

### CT-S6-006 · Helper read-widening on /harvest + /hay · PASS
**GET /harvest** (helper) → 200; **GET /hay** (helper) → 200. No 403 (Invariant 8).
**Assertions covered:** S6-A33.
**Verdict:** PASS.

*Not walked this wave:* S6-A1..A6 (list staging / export chrome — UI render), S6-A7..A16 (per-archetype renderer field packing — UI), S6-A24..A30 (full hay-diary mow→bale→store walk — deferred to a hay-focused wave; prior agent covered the bale-override kernel gate), S6-A31 (/fertility reconcile), S6-G4/G6 (stale UC doc; re-harvest set keyed on legacy harvestStyle — source-filed).

---

## Summary of gap dispositions

| Gap | Stage | Disposition | Evidence |
|---|---|---|---|
| S4-G1 | drain summary drops skippedOtherOwner | **CONFIRMED (P1)** | `records/pending/+page.svelte:27` source |
| S4-G2 | activeOwnerId only seeded on switch → null-blind enqueue/list/drain | **CONFIRMED (P1)** | `tenantSwitch.ts:34` sole writer; `syncQueue.ts:44/87/drain` readers |
| S5-G1 | insecticide/fungicide decrement ignores calibratedGPA | **CONFIRMED (P1)** | `insecticide:348` + `fungicide:320` `?? 15` vs `spray:245` calibratedGpa |
| S5-G3 | decon endpoint no auth gate | **CONFIRMED (P1, live)** | helper POST decon → 200; handler has no canMutate |
| S5-G6 | synthetic 5mph/70F persisted as measured | **CONFIRMED (P1, live)** | recorded conditions echo UI defaults, no provenance |
| S6-G1 | moisture kernel UI-unreachable | **CONFIRMED** (prior Probe 2) | renderer contract omits moisturePct |
| S6-G2 | bale danger STOP overridable | **CONFIRMED** (prior Probe 4) | overrideBaleGate skips danger |
| S6-G5 | no PHI enforcement at harvest | **CONFIRMED (P1, live)** | detectPhiConflict plan-only; harvest 200 after same-block spray |
| S6-G7 | moisture not persisted on event row | **CONFIRMED (P2, live)** | no moisture_pct column; insert omits it; 200 row has no moisture |

**New (not in gap list):**
- **CT-S4-003 (P2):** unknown-task PATCH throws raw 500 instead of 404.
- **CT-S5-004 (P1):** cross-tenant sprayer (`XTENANT2`) readable via `/api/equipment` and decon-able from the owner session — needs authz-wave corroboration (companion to the S5-G3 missing role gate).
- **CT-S6-005 (P2):** cure-archetype 422 copy reuses "Drying required" (wrong mental model for a curing crop).
