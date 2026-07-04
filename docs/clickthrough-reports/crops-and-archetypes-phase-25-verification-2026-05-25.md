# Clickthrough report — /crops + archetype screens — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs
**Viewport:** browser default (dev server at http://localhost:5173)
**Auth:** demo owner session (active on /today at nav start)

---

## Summary

- Routes walked: `/crops`, `/crops/[id]`, `/hay`, `/harvest` (archetype dispatch)
- Pass: 3 | Findings: 5 (P2 × 4, P1 × 1) | Blocked: 0
- New findings: P0=0, P1=1, P2=4

---

## Area 1: `/crops` route

**What it is:** A "per-planting catalog" — crops grouped by block, filterable by status (Active / Harvested / Planned / Failed / Archived) + block + year. Each row links to `/crops/[id]`, a per-crop activity dashboard (spray, harvest, insecticide, fertility events + projected calendar actions + status transitions).

**Nav linkage:** The 7-item primary nav is Today / Plan / Spray / Scout / Harvest / Stock / Records (confirmed live). `/crops` has no top-level nav entry. It is reachable via deep links from `/plan` (planting rows) and `/harvest` (CTA links). The TopBar comment (`// 7-item nav per design`) explicitly calls this out.

**Mockup comparison:** No mockup in `direction-almanac-crops.jsx` covers the catalog view — all 4 functions in that file are archetype-specific harvest/plan screens. No Almanac artboard exists for `/crops`.

---

## Findings

### CA-001 — /crops catalog has no Almanac mockup and no primary nav entry [P2]

- **Route:** `apps/web/src/routes/crops/+page.svelte`
- **Expected (Almanac design system):** Every major route reachable from a user's daily journey should have a Direction-A mockup (established pattern for Phase 25 screens).
- **Observed:** `/crops` renders a functional, well-structured planting catalog (block-grouped, status tabs, drag-to-reorder blocks) but has no entry in the 7-item primary nav and no `direction-almanac-*.jsx` mockup. Discovery is via Plan deep-links only.
- **Console:** Font CDN 404s only (expected in dev mode). No app errors.
- **Network:** No 4xx/5xx from app routes.
- **Screenshot:** `./screenshots/2026-05-25-crops-route.png`
- **Recommendation:** File a design debt issue: either add `/crops` as an 8th nav item (or under a "Crops" submenu off Plan) and produce a Direction-A artboard, or formally document it as an intentional deep-link-only route with no mockup required.
- **Cross-ref:** None in usability-audit.md.

### CA-002 — /crops/[id] uses generic section layout, no Phase-25 Almanac chrome [P2]

- **Route:** `apps/web/src/routes/crops/[id]/+page.svelte`
- **Expected:** Phase 25 screens carry Direction-A card primitives, serif headings, forest-green token system, provenance chips.
- **Observed:** Detail page is functional (status transitions, event lists, projected calendar) but uses the pre-Phase-25 utilitarian layout (plain `<h2>` sections, no `A_Card` primitives, no Almanac color tokens). This is design-layer debt, not a broken route.
- **Screenshot:** (no separate screenshot taken; visible in /crops route screenshot context)
- **Recommendation:** Cross-reference with the open issue for per-crop dashboard styling when Phase 25d polish pass is scheduled.

### CA-003 — AWheatPlanScreen: Zadoks stage timeline + FHB forecast + harvest schema not in any route [P1]

- **Mockup ref:** `direction-almanac-crops.jsx` lines 14–172, `AWheatPlanScreen`
- **Expected:** A plan-view panel (inside `/plan` or `/crops/[id]`) for small-grain blocks shows: Zadoks stage timeline (Z11→Z99 dots with current position), FHB risk curve by stage, vernalization progress bar, and a harvest schema preview (`schemaKind: "small-grain"`, bushels + moisture % + test weight fields).
- **Observed:** `SmallGrainZadoks.svelte` exists and is wired into `HarvestRouter.svelte` (`harvestStyle === 'single-cut-grain'`), but it renders only a thin archetype header strip + delegates immediately to `FallbackHarvestRenderer`. None of the Zadoks stage timeline, FHB forecast card, or vernalization panel from the mockup are implemented. The `SmallGrainZadoks` component comment itself acknowledges this: "Future enhancement: read `crop.zadoksStages` + `crop.moistureGates` from the plugin." No route in the app renders the full AWheatPlanScreen treatment.
- **Console:** No app errors.
- **Recommendation:** This is a known shell (cross-refs #144). File this as confirming the gap is beyond the shell header — the full plan-view integration (Zadoks timeline, FHB, vernalization) has no implementation footprint at all. Not duplicating #144, which covers the harvest-renderer side; this finding covers the plan-side panels.

### CA-004 — AGrapeHarvestScreen: Brix/pH/TA quality panel not implemented in PerennialVineQuality [P2]

- **Mockup ref:** `direction-almanac-crops.jsx` lines 174–298, `AGrapeHarvestScreen`
- **Expected:** `PerennialVineQuality.svelte` renders a pick-recommendation hero, three quality-metric dials (Brix °, pH, TA g/L) each with a mini scale bar vs. target band, sample trend table, and pick-scheduling CTAs.
- **Observed:** `PerennialVineQuality.svelte` is a confirmed shell — archetype header + kicker text ("Log Brix / pH / aroma-test reading in notes") + `FallbackHarvestRenderer` delegation. The structured Brix/pH/TA capture panel, sample trend table, and pick recommendation engine from `AGrapeHarvestScreen` are not implemented.
- **Cross-ref:** Aligns with #144. No new issue required; confirms shell scope.

### CA-005 — ATreeFruitHarvestScreen: multi-pick timeline + grade table not in TreeFruitMultiPick [P2]

- **Mockup ref:** `direction-almanac-crops.jsx` lines 441–583, `ATreeFruitHarvestScreen`
- **Expected:** `TreeFruitMultiPick.svelte` renders a pick-progress hero (picks complete / harvested lb / remaining forecast), a pick timeline bar (Sep–Nov axis), and a per-pick table (date, type, reasoning, lb, grade badge, Record/Recorded status).
- **Observed:** `TreeFruitMultiPick.svelte` is a shell — archetype header + kicker ("Multiple ripening passes — record this pass's yield; the planting stays open") + `FallbackHarvestRenderer`. The progress hero, timeline visualization, and grade table from the mockup are not implemented.
- **Cross-ref:** Aligns with #144. No new issue required.

---

## Area 2: `/hay` route

**Route:** `apps/web/src/routes/hay/+page.svelte`

**What it is:** A dedicated multi-step cutting workflow page (not under `/harvest`). Covers FR-19 (cutting workflow), FR-21 (bale moisture gate), FR-22 (NOAA NWS dry-window forecast). Mow → Ted → Rake → Bale → Store sequence with kernel-enforced moisture threshold at bale step and live NOAA API integration.

**Mockup comparison vs AHayFlowScreen (lines 300–439):**

| Mockup feature | Implementation |
|---|---|
| Weather GO/NO-GO hero card | Present — "Check NOAA forecast" fetches NOAA; renders 5-day table + danger banner if rain >30% |
| Mow → Ted → Rake → Bale sequence | Present — `nextStep()` map advances through states |
| "Mark complete + log moisture" per step | Present — bale step shows moisture % + bale type fieldset |
| Per-season cuts table (bales, moisture, quality) | Present — `Cuttings` list shows timestamps, bale type, moisture |
| "Start cut #2" CTA | Present — "Record cutting now (mow done)" |
| FR-22 NWS integration | Confirmed — `/api/hay/forecast` endpoint wired to `fetchForecast()` |

**Gaps vs mockup:**

- Mockup shows a weather GO/NO-GO hero with day-card grid (5 cards, HAY OK / NO HAY label per day). Implementation shows a tabular forecast (date, Hi, Lo, Rain%, Wind, Note) — functionally equivalent but visually diverges from the Direction-A card-grid style.
- Mockup renders a visual 4-step stepper with icon boxes and connector line. Implementation uses `<ul class="timeline">` inside each cutting card — functional but no visual stepper.
- No "Season cuts" summary table per the mockup (Cut #, Mowed, Baled, Bales, Moisture, Quality). Implementation shows individual cutting `<article>` cards with timestamps. Summary view is absent.
- `/hay` is not in the 7-item primary nav (note in TopBar: "Hay into archetype renderers"). Access requires direct URL or a link from `/today` or `/harvest`. No evidence of a link to `/hay` from the main harvest flow or today page.

### CA-006 — /hay not reachable from primary nav or /harvest CTA [P2]

- **Route:** `apps/web/src/routes/hay/+page.svelte`
- **Expected (AHayFlowScreen):** Hay flow is accessible via the primary navigation or harvest route (active forage block should surface a cutting workflow entry point).
- **Observed:** `/hay` has no primary nav entry. The 7-item nav comment says "Hay into archetype renderers" but the ForageCuttingCycle harvest renderer (wired for `harvestStyle === 'forage-cutting-cycle'`) in `HarvestRouter.svelte` redirects to `FallbackHarvestRenderer`, not to `/hay`. The cutting workflow is only reachable by typing `/hay` directly. No link from `/harvest` or `/today` to `/hay` was observed in snapshots.
- **Screenshot:** `./screenshots/2026-05-25-hay-route.png`
- **Recommendation:** Wire a "Manage cuttings →" link from the ForageCuttingCycle harvest renderer (or from `/today` task cards for forage crops) to `/hay`.

---

## Skipped

- Archetype renderer shell findings (detailed shell content) deferred to #144, which is the canonical tracking issue.
- FR-22 NOAA API response validation not tested (requires live network or mock response; out of scope for structural verification).

