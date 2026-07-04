# Clickthrough report — spray-phase-25-verification — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs (dev stack, port 5173 — note: no sprayers seeded)
**Viewport:** 390x844 (iPhone 14 Pro)
**Auth:** demo owner session (Home Farm)

## Summary

- Routes walked: 3 spray + 1 decon sanity | Pass: 1 (decon) | Fail: 3 (herbicide, insecticide, fungicide) | Blocked: 0 | Skipped: 0
- New findings: P0=0, P1=7, P2=3

---

## Route 1 — /spray (Herbicide)

Spec: `docs/design/almanac/direction-almanac-rest.jsx` lines 214–575 (`ASprayScreen`)

### What matched

- **Almanac stepper** (`SprayStepper.svelte`) renders above the form. 5 steps with correct labels ("Block & crop", "Sprayer & tank", "Mix", "Safety check", "Confirm & record"). Step 1 shows checkmark when a block is selected.
- **Context strip** (`SprayContextStrip.svelte`) renders below the stepper with 4 columns: Block, Crop, Stage, Target weeds. Collapses to 2-column grid at ≤760px.
- **Product picker** shows HRAC group badges, timing, chemistry class, rate, AMS/decon flags — matches mockup content.
- **Gate stub banners** ("IPM THRESHOLD GATE — PHASE 25D", "POLLINATOR-BLOOM GATE — PHASE 25D") appear as placeholder chips.
- **Compatibility banner** in context strip is wired to kernel result — green when all blocks pass, rust when any fail, hidden until kernel runs.
- Dilution table (`result.dilutions`) and record button exist in template but only render when `result` is set (blocked by missing sprayer).

### Findings

#### CT-001 — Sprayer section renders empty with no empty-state CTA [P1]
- **Route:** /spray
- **Spec (ASprayScreen):** Sprayer card shows "label, calibration GPA, last chemistry class with decon-needed warning" (lines 349–350)
- **Impl:** `apps/web/src/routes/spray/+page.svelte` line 764–786
- **Expected:** Section "3. Sprayer" lists available sprayers (or shows "No sprayers yet — add one in Settings" with a link)
- **Observed:** Section renders with an empty `<div class="cards"><!--[--><!--]--></div>` — no cards, no empty-state message, no link to /settings/sprayers. `GET /api/sprayers` returns `{"sprayers":[]}` — no sprayers are seeded in the dev environment.
- **Consequence:** `inputsReady` is never true → kernel never evaluates → dilution table and record button never appear. The entire bottom half of the flow (steps 3–5) is unreachable.
- **Console:** No app errors
- **Network:** No 4xx/5xx from app routes
- **Screenshot:** `./screenshots/2026-05-25-herbicide-initial.png`
- **Recommendation:** Add an empty-state in the sprayer cards section: "No sprayers configured — [add one in Settings →]". Also ensure the dev seed includes at least one sprayer so the full flow can be exercised. Note that if this is intentional (no sprayer in the seed) the impact on testing is high.

#### CT-002 — Stepper step labels hidden on mobile [P2]
- **Route:** /spray
- **Spec (ASprayScreen line 253):** All 5 step labels visible in the stepper row
- **Impl:** `apps/web/src/lib/components/spray/SprayStepper.svelte` lines 98–107 — `@media (max-width: 700px) { .label { display: none } .step.active .label { display: inline } }`
- **Expected:** All 5 labels visible simultaneously
- **Observed:** At 390px, only the currently active step's label is shown. Completed step 1 ("Block & crop") shows only a checkmark with no label.
- **Console:** None
- **Recommendation:** Acceptable responsive behaviour — P2. Consider showing at minimum the active + next labels for orientation.

---

## Route 2 — /spray/insecticide

Spec: `docs/design/almanac/direction-almanac-insecticide.jsx` (386 lines, `AInsecticideScreen`)

### What matched

- **IPM threshold gate** panel is partially implemented — shows "BELOW THRESHOLD" status, current week count (0), action threshold (≥10), and a 5-week history bar chart. Matches the mockup's dial + sparkline pattern (lines 199–233).
- **Product library** sidebar shows IRAC group badges, REI/PHI, pollinator risk, EPA reg. number — matches mockup product list.
- **Provenance legend strip** present ("Plugin", "Your data", "Fallback", "You typed").
- **Server safety kernel** DID enforce the IPM gate — clicking "Record application" without meeting the threshold returned HTTP 422 with `IPM_THRESHOLD_NOT_MET` error message visible via `[role="alert"]`.

### Findings

#### CT-003 — No Almanac stepper on insecticide page [P1]
- **Route:** /spray/insecticide
- **Spec (AInsecticideScreen lines 47–71):** 6-step stepper: Block & crop → Sprayer & tank → Mix → Pre-check → IPM gate (active) → Confirm & record. The IPM gate step is insecticide-specific.
- **Impl:** `apps/web/src/routes/spray/insecticide/+page.svelte`
- **Expected:** Stepper nav component at top with 6 labeled steps
- **Observed:** No stepper. Page is a flat vertical scroll with sections "1 · Block + product", "2 · Observation (optional)", "3 · Conditions", then "Record application".
- **Screenshot:** `./screenshots/2026-05-25-insecticide-initial.png`
- **Recommendation:** Port `SprayStepper` to insecticide route with the 6-step variant from the mockup.

#### CT-004 — No context strip (Block/Crop/Stage/Pests row) on insecticide page [P1]
- **Route:** /spray/insecticide
- **Spec (AInsecticideScreen lines 78–125):** 4-column context strip with Block, Crop, Stage, and Pest targets (showing count vs. threshold chips). Below it, a green compatibility banner.
- **Impl:** `apps/web/src/routes/spray/insecticide/+page.svelte`
- **Expected:** `SprayContextStrip`-equivalent with pest target chips (count/threshold) replacing the "Target weeds" cell
- **Observed:** No context strip. Block is a plain `<select>` dropdown ("— pick a block —" / "Block A · 0.50 acres"). No crop or stage info shown next to it.
- **Screenshot:** `./screenshots/2026-05-25-insecticide-initial.png`
- **Recommendation:** Add `SprayContextStrip` (or an insecticide variant with Pest cell) below a stepper header.

#### CT-005 — Record button not disabled when IPM threshold not met (UI gate missing) [P1 — safety adjacent]
- **Route:** /spray/insecticide
- **Spec (AInsecticideScreen):** "IPM gate" is a required step before Confirm; the button should be gated until threshold is cleared
- **Impl:** `apps/web/src/routes/spray/insecticide/+page.svelte` — button is `type="submit"` with no `disabled` attribute or `aria-disabled` check
- **Expected:** "Record application" button disabled (or hidden) when `IPMgatePassed === false`; user sees preemptive inline error "Scout count (0) is below action threshold (10)"
- **Observed:** Button is enabled. Clicking it submits the form. Server returns 422 + `[role="alert"]` text "Error: safety-kernel gate(s) failed IPM_THRESHOLD_NOT_MET — acramite-bifenazate requires a scout count ≥ the action threshold for at least one declared pest. No qualifying scout observation found on this block."
- **Safety note:** Server-side enforcement is working and blocks the record. No bypass is possible. This is a UX gap, not a kernel bypass. However, showing the gate status as a submit-time error rather than pre-validation increases cognitive friction for field workers.
- **Network:** POST /api/insecticide/record → 422 Unprocessable Entity
- **Screenshot:** `./screenshots/2026-05-25-insecticide-ipm-gate-view.png`
- **Recommendation:** Derive `ipmGatePassed` from the threshold panel state; disable the Record button and surface an inline notice while below threshold.

#### CT-006 — Pollinator-protection gate is text stub only [P2]
- **Route:** /spray/insecticide
- **Spec (AInsecticideScreen lines 237–265):** Full "Pollinator-protection gate" card with pass/fail state, bloom-stage check, and per-check grid
- **Impl:** Gate renders "Blocks bee-toxic applications when any selected block is in its declared bloom window AND the product carries a bee-toxicity flag. Full evaluator lands in Phase 25d."
- **Expected:** Interactive gate panel with Clear/Triggered pill and per-check tiles
- **Observed:** Text-only stub with provenance icons. No pass/fail state, no per-check tiles.
- **Recommendation:** Track as Phase 25d follow-on. The stub clearly labels itself as deferred — acceptable if Sprint E captures it.

---

## Route 3 — /spray/fungicide

Spec: `docs/design/almanac/direction-almanac-fungicide.jsx` (341 lines, `AFungicideScreen`)

### What matched

- **FRAC group badges** present on all products in the tank-mix list (FRAC 1, FRAC 11, etc.).
- **Provenance legend strip** present.
- **fungicide_events table** exists (migration 0025, Phase 21b). POST `/api/fungicide/record` endpoint exists.
- Page header kicker reads "SPRAY · FRAC-ROTATED · PHASE 25D GATE STUB" — self-documenting stub status.

### Findings

#### CT-007 — No Almanac stepper on fungicide page [P1]
- **Route:** /spray/fungicide
- **Spec (AFungicideScreen lines 32–56):** 6-step stepper: Block & crop → Sprayer & tank → Mix → Pre-check → Disease + FRAC (active, sky/blue) → Confirm & record
- **Impl:** `apps/web/src/routes/spray/fungicide/+page.svelte`
- **Expected:** Stepper nav at top with 6 labeled steps; "Disease + FRAC" step highlighted in sky tone
- **Observed:** No stepper. Flat form: "1 · Block + product", "2 · Observation (optional)", "3 · Conditions", "Record fungicide application".
- **Screenshot:** `./screenshots/2026-05-25-fungicide-initial.png`
- **Recommendation:** Port `SprayStepper` with 6-step fungicide variant.

#### CT-008 — Disease forecast, rain/dew, and FRAC rotation gates are text stubs [P1]
- **Route:** /spray/fungicide
- **Spec (AFungicideScreen lines 153–234):** Three interactive gate panels: "Disease forecast gate" (leaf-wet hours dial + 5-day infection sparkline), "Rain/dew gate" (pass/fail pill), "FRAC rotation" (last FRAC → next FRAC display)
- **Impl:** Three banner chips: "FRAC ROTATION EVALUATOR — PHASE 25D", "DISEASE FORECAST (NEWA / FHB) — PHASE 26", "RAIN/DEW DRY-HOURS GATE — PHASE 25D"
- **Expected:** Interactive panels showing leaf-wet hour count, threshold, 5-day history, rain window clearance, and FRAC rotation check against last spray on same block
- **Observed:** Three text-only chip banners. No numeric data, no pass/fail states, no history sparklines. Disease forecast is explicitly deferred to Phase 26.
- **Screenshot:** `./screenshots/2026-05-25-fungicide-initial.png`
- **Recommendation:** Track FRAC rotation UI panel (can use `fungicide_events` data — table exists) as a Phase 25d follow-on. Disease forecast deferred to Phase 26 per NEWA integration scope. Rain/dew gate could read from existing weather cache.

#### CT-009 — Context strip absent on fungicide page [P1]
- **Route:** /spray/fungicide
- **Spec (AFungicideScreen lines 64–107):** 4-column context strip: Block, Crop, Stage, Diseases monitored
- **Impl:** Block is a `<select>` dropdown only
- **Expected:** `SprayContextStrip` with Diseases cell (replacing Target weeds) and compatibility banner
- **Observed:** Plain dropdown with no crop/stage/disease context.
- **Screenshot:** `./screenshots/2026-05-25-fungicide-initial.png`
- **Recommendation:** Same pattern as insecticide — port `SprayContextStrip` to fungicide route.

#### CT-010 — Record button not disabled with no block or product selected [P1]
- **Route:** /spray/fungicide
- **Impl:** `type="submit"` button with `disabled=false` at page load. No client-side pre-validation.
- **Expected:** Button disabled until block + product selected (and gates pass)
- **Observed:** Button enabled at page load. (Server-side enforcement assumed; not tested with a full submit here to avoid creating bad records.)
- **Recommendation:** Add client-side guard: `disabled={!selectedBlock || !selectedProducts.length}`.

---

## Route 4 — /spray/decon (sanity check)

Loaded `/spray/decon` — "Sprayer decontamination" renders with Step 1 of 8 ("Drain tank fully"), Back/Next navigation, and "Mark sprayer clean now" button. All functional. No findings.

---

## Skipped

None — all 4 routes are implemented (even if gates are stubs).

## Cross-references

- CT-005 (IPM gate UI) — server kernel enforcement confirmed working; no P0 safety bypass found. Client-side gate is the missing layer.
- CT-008 (FRAC rotation stub) — `fungicide_events` table + `lib/db/fungicideEvents.ts` exist (Phase 21b). The data layer for FRAC rotation is ready; only the UI panel is missing.
- CT-001 (no sprayers) — affects herbicide flow end-to-end. The seed script (`apps/web/scripts/seed-test-data.mjs`) should add at least one sprayer to exercise the full kernel → dilution → record path.
