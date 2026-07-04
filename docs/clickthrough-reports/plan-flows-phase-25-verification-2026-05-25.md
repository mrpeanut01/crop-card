# Clickthrough report — Plan flows (Phase 25 end-to-end) — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Target:** http://localhost:5173 (dev stack, cropcard.db)
**Viewport:** 390×844 (iPhone 14 Pro)
**Auth:** owner@cropcard.local (Home Farm + Test Farm 2 tenants)

---

## Coverage table

| # | Flow | Result | Findings |
|---|------|--------|----------|
| 1 | Block lifecycle (add → edit name → save → DB verify) | PASS | — |
| 2 | Planting lifecycle (add crop to block via Crops tab) | PASS | FP-002 (UX routing) |
| 3 | AllocationWizard end-to-end | PARTIAL | FP-001 (P0), FP-003 (P1), FP-004 (P1), FP-005 (P2) |
| 4 | Pollination resolver warnings | BLOCKED* | No two-variety corn blocks available; geometry missing banner confirmed |
| 5 | Schedule step + succession spacing | BLOCKED† | Could not reach schedule step (wizard blocked at 402) |
| 6 | Inputs Plan step | BLOCKED† | Same 402 block |
| 7 | Block geometry / map | PASS | "View on map" opens, dialog + Leaflet rendered |
| 8 | Drag-to-reorder blocks | PASS (affordance only) | `draggable="true"` on `<li>` elements; persistence untested |
| 9 | Calendar derivation → /today | PASS | Spray window + harvest window surfaced for dated corn planting |
| 10 | Deep-link `/plan#block-<id>` | PASS | Selects block and renders block header correctly |
| 11 | Owner switch → tenant isolation | PASS | Plan re-renders with different tenant's blocks; no leak |

*Pollination warnings appear in wizard chat panel at Review step; could not reach Review with a multi-variety crossing pair in the test seed.
†The `/api/plan/allocate` returns 402 when AI cap exceeded, no deterministic fallback provided.

---

## Summary

- Flows walked: 11 | Pass: 7 | Partial: 1 | Blocked: 3 | Fail: 0
- New findings: P0=1, P1=2, P2=2

---

## Findings

### FP-001 — AllocationWizard overlay invisible when `<details>` closed [P0]

- **UC:** UC-37
- **Route:** `apps/web/src/routes/plan/+page.svelte` lines 2427–4768 (the `<details class="legacy-detail">` block)
- **Expected (per UC-37 step 1):** Clicking "Open wizard" on the PlanV2 season-workflow strip opens the fullscreen wizard overlay immediately, regardless of the legacy `<details>` state.
- **Observed:** The `.aw-backdrop` element has `position: fixed; inset: 0` in CSS (line 2033–2042 of `AllocationWizard.svelte`) but is rendered as a child of `<details class="legacy-detail">` (line 3750 inside the block that closes at 4768). When `<details>` is closed (the default), the browser collapses the content and the fixed overlay computes as 32 px tall at y=1355 — completely off-screen. The WorkflowStrip "Open wizard" CTA appears to do nothing.
- **Root cause:** `AllocationWizard` must be rendered **outside** the `<details>` element (at the page's root DOM level). The fix is to move the `{#if showAllocationWizard}` block (lines 3750–3791) to after the closing `</details>` at line 4768.
- **Workaround confirmed:** Opening the `<details>` first (clicking the disclosure) then clicking "Open wizard" makes the overlay display correctly (844 px height, top: 0).
- **Console:** clean
- **Network:** no 4xx/5xx
- **Screenshot:** `./screenshots/2026-05-25-plan-wizard-offscreen.png` (full-page, backdrop at y=1355), `./screenshots/2026-05-25-plan-wizard-step0.png` (wizard visible after workaround)
- **Recommendation:** Move `{#if showAllocationWizard}<AllocationWizard .../>` to after `</details>` at plan/+page.svelte:4768. A SvelteKit portal/teleport (`createPortal` equivalent via `mount` or a dedicated `<Portal>` wrapper) is the cleanest solution; moving the block outside `<details>` is the minimal fix.
- **Cross-ref:** Confirms finding in prior audit (plan-phase-25-verification-2026-05-25.md §CT-P25-PLAN-WIZ-001, linked to GH #170).

---

### FP-002 — "New block" and "Add planting" CTAs in PlanV2 shell reroute to legacy editor [P2]

- **UC:** UC-25, UC-37
- **Route:** `apps/web/src/lib/components/plan/PlanV2Shell.svelte` lines 226–228
- **Expected (per Phase 25b design intent):** "New block" and "Add planting" in the Almanac PlanV2 shell open inline forms or a modal within the new shell.
- **Observed:** Both buttons navigate to `?tab=layout#legacy-plan` and `?tab=crops#legacy-plan` respectively, scrolling the user into the legacy `<details>` editor. This is a context-switch interruption acknowledged in `+page.svelte:2387–2392` ("Mutations defer to the legacy tabbed editor below for now — clicking 'Edit block' / 'Add planting' / 'Refine with AI' routes the operator into the existing flows.").
- **Console:** clean
- **Network:** no 4xx/5xx
- **Screenshot:** `./screenshots/2026-05-25-plan-block-created.png`, `./screenshots/2026-05-25-plan-planting-created.png`
- **Recommendation:** This is known / accepted technical debt per the code comment. File a follow-up issue for inline add-block and add-planting forms in PlanV2Shell to avoid the tab-switch UX break.

---

### FP-003 — Wizard seed list always empty when opened from non-crops tab [P1]

- **UC:** UC-37 Step 1
- **Route:** `apps/web/src/routes/plan/+page.server.ts` lines 267–302 (crops tab branch), line 3752 in `+page.svelte`
- **Expected (per UC-37):** The wizard's Step 1 (Seeds) shows all seed stock with `onHand > 0` and a registered `pluginId` regardless of which tab is active when the wizard opens.
- **Observed:** `data.seedStock` is only populated when `tab === 'crops'` (server loader branch at `+page.server.ts:267`). The wizard `AllocationWizard` receives `seedStock={(data.seedStock ?? [])}` at `+page.svelte:3752`. On the default tab (no `?tab=crops` param), `data.seedStock` is `undefined` → empty array → wizard shows "No seed stock with a known crop plugin and on-hand > 0."
- **Reproduction:** Add seed stock via DB or `/stock/add`, reload `/plan` (no tab param), click "Open wizard". Step 1 is empty. Navigate to `/plan?tab=crops#legacy-plan` and open wizard → seed stock appears.
- **Console:** clean
- **Network:** no 4xx/5xx
- **Screenshot:** `./screenshots/2026-05-25-plan-wizard-step1-seeds.png` (empty), `./screenshots/2026-05-25-plan-wizard-step1-crops-tab.png` (populated after crops tab)
- **Recommendation:** Move seed stock loading to the `base` loader object (lines ~185–257 of `+page.server.ts`) so it's available on all tabs. Or use `data.seedStockForWizard` (already computed on the schedule tab branch at line 749–760) — consolidate so wizard always has the seed list. The schedule-tab branch at line 749 already has the right logic with `onHand > 0` filter.

---

### FP-004 — AI cap (402) blocks entire allocation with no deterministic fallback [P1]

- **UC:** UC-37 Step 3, CLAUDE.md Invariant 7 ("AI assists, never gates")
- **Route:** `apps/web/src/routes/api/plan/allocate/+server.ts` lines 35–48
- **Expected (per Invariant 7 + UC-37):** When `aiGuard.checkGuard` fails (over-cap, no-key, offline, rate-limit, timeout), the server runs the deterministic `planLayout()` engine and returns a plan with `meta.fallback='over-cap'`. The wizard shows the plan + an advisory banner.
- **Observed:** At line 36–48, `checkGuard` returning `!ok` causes an immediate 402 `{ error: "Monthly AI cap ... reached" }` with no allocation body. The wizard client (line 768–770 of `AllocationWizard.svelte`) sets `error = body.error` and returns, leaving `response = null`. The Review step shows the error in red text with an empty allocation table. "Accept all → schedule" is rendered but has no response to pass to the schedule step.
- **Network:** `POST /api/plan/allocate → 402 Payment Required`
- **Screenshot:** `./screenshots/2026-05-25-plan-wizard-step3-review.png`
- **Recommendation:** In `allocate/+server.ts`, when `!guard.ok`, parse the request body and run `planLayout()` deterministically, then return the result with `meta.fallback=guard.reason`. This matches the pattern already used in `aiInputsPlan.ts` and `aiSchedule.ts`. The guard check at line 35 should only gate the Anthropic API call, not the entire endpoint.

---

### FP-005 — AllocationWizard overlay lacks `role="dialog"` and `aria-modal` [P2]

- **UC:** UC-37 (accessibility)
- **Route:** `apps/web/src/lib/components/AllocationWizard.svelte` line 1516
- **Expected:** The fullscreen wizard overlay (`<div class="aw-backdrop">`) should have `role="dialog"` and `aria-modal="true"` so screen readers treat it as a modal dialog, and `aria-label` describing its purpose.
- **Observed:** The a11y snapshot does not include the wizard overlay at all — Playwright's accessibility tree cannot find it (no `role="dialog"`). The backdrop is a plain `<div>` with no ARIA role. Focus is not trapped inside the overlay.
- **Console:** clean
- **Recommendation:** Add `role="dialog" aria-modal="true" aria-label="Season planning wizard"` to the `.aw-backdrop` div. Add focus trap (e.g., `inert` on siblings or a focusTrap library) so keyboard users cannot tab behind the overlay. This is especially important now that the backdrop is a fixed overlay covering the entire screen.

---

## Skipped / Out of scope

- Planting lifecycle "mark harvested → archive" — the existing corn planting has a fixed `status='active'`; harvest archival UI tested separately in crops-and-archetypes report.
- Succession sowing (Flow 5) and Inputs Plan (Flow 6): blocked by FP-004 (wizard cannot reach schedule/inputs steps while AI cap is exceeded and no deterministic fallback fires).
- Pollination resolver (Flow 4): geometry is missing for all test blocks; the geometry-missing banner was confirmed in the prior structural audit (plan-phase-25-verification-2026-05-25.md CT-P25-PLAN-003). Two-variety same-species crossing scenario requires adding a second corn variety planting to a second block with drawn geometry — not practical in this session.

---

## Pass evidence

| Flow | Evidence |
|------|----------|
| Block created + persisted | `POST /api/blocks → 201`; block appears in PlanV2 left rail and legacy list |
| Block name edited + saved | `PATCH /api/blocks/<id> → 200`; "Block Beta" visible in rail after reload |
| Planting added to block | `POST /api/blocks/<id>/plantings → 201`; "Spinach — Bloomsdale Long-Standing" in Crops tab |
| Calendar derivation | /today shows spray window "POST grass + late broadleaf (V4-V6)" and harvest window for Block A corn |
| Deep-link `/plan#block-<id>` | Block A auto-selected; `h1` shows "Block A — Bloody Butcher Dent Corn" |
| Owner switch → isolation | Switching to Home Farm shows East A/B/C/D/E blocks; Block A/Beta not present |
| Map overlay | `dialog[open]` + Leaflet SVG rendered on "View on map" click; URL adds `?map=open` |

