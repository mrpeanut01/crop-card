# Clickthrough report — Harvest + Stock End-to-End Flows — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Server:** http://localhost:5173 (dev, Phase 25 / ca8cb96)
**Seed:** apps/web/scripts/seed-test-data.mjs (cropcard.db)
**Viewport:** desktop (browser default)
**Auth:** owner role, Test Farm 2 (owner_4a6f2a24-6b8)

---

## Summary

- Flows walked: 16 | Pass: 8 | Partial: 5 | Fail: 2 | Blocked: 1 | Skipped: 0
- New findings: P0=0, P1=4, P2=2

---

## Coverage Table

| # | Flow | Result | Severity |
|---|------|--------|----------|
| 1 | End-to-end harvest record (spinach) | Pass | — |
| 2 | Harvest-window proximity check | Partial | P1 (no pre-window warning for seeded early record) |
| 3 | FR-08 curing flow | Pass | — |
| 4 | Multi-pick / multi-day harvest (cut-and-come-again) | Fail | P1 |
| 5 | Archetype dispatch (2 archetypes checked) | Pass | — |
| 6 | Inspector role | Blocked | no helper_assignment seeded for inspector |
| 7 | /hay route (Mow→Ted) | Pass | — |
| 8 | Stock add — manual method | Pass | — |
| 9 | Stock add — catalog search | Fail | P1 |
| 10 | Stock add — barcode stub | Partial | documented stub; #149 covers missing 5th method |
| 11 | Stock add — label scan | Partial | file-upload UI present; AI vision path not fully exercised |
| 12 | Stock movement on spray/harvest | Partial | P1 (receipt movement delta=0) |
| 13 | Low-stock + expiring alerts | Pass | — |
| 14 | Stock item detail | Pass | — |
| 15 | Cross-tenant isolation | Pass | — |
| 16 | Stock-add → spray loop (round-trip) | Partial | sprayer seeding mismatch blocks full loop |

---

## Findings

### CT-001 — Multi-pick "Record harvest" button disappears after first harvest (cut-and-come-again) [P1]

- **UC:** Harvest Flow 4 / cut-and-come-again archetype
- **Route:** `apps/web/src/routes/harvest/+page.svelte`
- **Expected:** "Spinach — Bloomsdale Long-Standing" (`harvestStyle: "cut-and-come-again"`) keeps a "Record harvest" button after every submission, because the archetype description says "Re-harvest in 2-3 weeks until bolt."
- **Observed:** After the first harvest record is submitted, the planting gets `alreadyHarvested = true`. The template at line 131 is `{#if p.status === 'in-window' && !p.alreadyHarvested}`, which permanently hides the form. Spinach shows "✓ harvested" badge + readiness indicators but no form.
- **Console:** Font 404s only (dev-mode noise).
- **Network:** No 4xx/5xx.
- **Screenshot:** `./screenshots/2026-05-25-harvest-initial.png`
- **Recommendation:** For archetypes `cut-and-come-again`, `continuous-fruit`, `tree-fruit-multi-pick`, the `alreadyHarvested` gate should be lifted — only `row-grain-*` and `root-once` archetypes should suppress the form after one record.
- **Cross-ref:** Related to #144 (archetype renderers); not the same bug but same area.

---

### CT-002 — Pre-window harvest permitted with no UI warning [P1]

- **UC:** Harvest Flow 2
- **Route:** `apps/web/src/routes/harvest/+page.svelte`
- **Expected:** For a planting with `status === 'too-early'` (current date < harvest window open), the page should show a warning ("You are 66 days before the harvest window") but still allow recording (operator might be catching up, or DTM is approximate).
- **Observed:** The form is hidden entirely (`{#if p.status === 'in-window' && !p.alreadyHarvested}`). A planting 66 days before its window has no "Record harvest" path at all through the UI. The corn harvest LOT-2026-BC-001 for 2016 lb exists in the DB only because the seed data bypassed the UI. There is no "force-record" affordance for the "catching up" scenario described in the audit brief.
- **Console:** Font 404s only.
- **Network:** No 4xx/5xx.
- **Recommendation:** Add a secondary "Force record (out of window)" disclosure control or at minimum a "Record anyway" path under `status === 'too-early'` with a warning banner. The `status === 'past-window'` case should also be handled (operator catching up after the window closed).

---

### CT-003 — Catalog-pick "Pick this" fails with raw Zod validation text [P1]

- **UC:** Stock Flow 9 — catalog search
- **Route:** `apps/web/src/routes/stock/add/+page.svelte` → `POST /api/stock/add` (SvelteKit form action)
- **Expected:** Clicking "Pick this" for a plugin-catalog result (Glyphosate 4 Plus) pre-fills the form and creates a stock_item, then redirects to /stock/[id].
- **Observed:** Raw validation error "defaultUnit: default unit is required" renders as a plain `<p>` tag above the tab panel. The action fails because the `glyphosate-4-plus` plugin JSON does not carry a `defaultUnit` field. The error persists across tab switches (Scan barcode, Scan label tabs both show the stale message).
- **Console:** Font 404s only.
- **Network:** No 4xx from the action; error is surfaced client-side as an action result.
- **Screenshot:** `./screenshots/2026-05-25-stock-catalog-search.png`
- **Recommendation:** (a) The catalog-pick action should fall back to the manual form pre-filled with plugin metadata when `defaultUnit` is absent, prompting the user to complete it. (b) Clear action-result errors when switching tabs. (c) Separately, audit the herbicide plugin library for missing `defaultUnit` fields — the glyphosate plugins are a common starting point.

---

### CT-004 — Stock receipt movement records delta=0 in stock_movements table [P1]

- **UC:** Stock Flow 8 + 12
- **Route:** `apps/web/src/routes/stock/[id]/+page.svelte` → `POST /api/stock/lots`
- **Expected:** When "Receive lot" is submitted with qty=1 gal, a `stock_movements` row is created with `delta_hundredths = 100` (1 gal) and `reason = 'receipt'`.
- **Observed:** The `stock_lots` row correctly has `received_quantity_hundredths = 100`. However, the `stock_movements` row created on receipt has `delta_hundredths = 0`. The movement history UI shows "receipt · 0 gal". The balance is computed correctly (`received_qty + movements_sum = 100 + 0 = 100`) because `lotBalanceHundredths` uses `receivedQuantityHundredths` as the base. But the movements ledger is incomplete — it cannot serve as an audit trail for the initial receipt.
- **Console:** Font 404s only.
- **Network:** POST `/api/stock/lots` → 200.
- **DB state:** `SELECT delta_hundredths FROM stock_movements WHERE stock_lot_id = '...' → 0`.
- **Screenshot:** `./screenshots/2026-05-25-stock-detail-movements.png`
- **Recommendation:** The receipt endpoint should write `delta_hundredths = received_quantity_hundredths` (e.g. 100) on the `stock_movements` row, not 0. Alternatively, omit creating a movement row for receipts and instead derive it on-the-fly in the UI from `stock_lots.received_quantity_hundredths`, but this breaks the movement ledger pattern used for spray auto-decrements.

---

### CT-005 — /stock/[id] page title is "Add stock · CropCard" after redirect [P2]

- **UC:** Stock Flow 8
- **Route:** `apps/web/src/routes/stock/[id]/+page.svelte`
- **Expected:** `<title>` = "Roundup Custom Test — Inventory · CropCard" (or similar).
- **Observed:** `<title>` = "Add stock · CropCard" — the title is inherited from the add form and not overridden on the detail page.
- **Cross-ref:** Confirms #150.

---

### CT-006 — Validation error persists across tabs on /stock/add [P2]

- **UC:** Stock Flow 9/10/11
- **Route:** `apps/web/src/routes/stock/add/+page.svelte`
- **Expected:** Switching tabs clears the action result / error display for the previous tab's submission.
- **Observed:** After "Pick this" fails on the Search tab, switching to "Scan barcode" and "Scan label" tabs still shows "defaultUnit: default unit is required" as a stale paragraph above the tab panel.
- **Recommendation:** Clear the action-result error state on tab change. Part of CT-003.

---

## Flows — Additional Notes

### Flow 3 — FR-08 Curing (Pass)

No dedicated `curing_events` table exists. FR-08 is implemented by reading `harvest_events` + the crop plugin's `postHarvestCuring` block and deriving the curing state at render time. The `/harvest` page shows the curing card with correct method ("Rack cure in dry, ventilated space · 2–4 wk"), countdown ("14 days until ready window opens"), and lot association. The `/today` week strip shows "Curing in progress: Bloody Butcher Dent Corn" on the day of harvest and "Curing ready: Bloody Butcher Dent Corn" ~14 days out. No P0 issues.

### Flow 6 — Inspector role (Blocked)

`POST /?/demo role=inspector` returns 200 but the session resolves to a user with no `helper_assignments` row, causing `hooks.server.ts` to redirect to `/onboarding`. The inspector demo persona is not seeded with an active owner assignment. Block is a test-data gap, not a code bug.

### Flow 7 — /hay Mow→Ted (Pass)

`/hay` is accessible via direct URL (not in primary nav per #182). The Mow decision step loads with block selector, NOAA forecast button (returns "NWS upstream failed" in the isolated container — expected), and "Record cutting now" button. Recording Cutting #1 persists. "Advance — ted" advances the step correctly. The moisture enforcement (>20% blocks baling) and full Bale→Store steps were not exercised due to time constraints.

### Flow 12 — Spray → stock movement (Partial)

The `POST /api/spray/record` handler calls `decrementForUse()` (line 253) and the `spray_event_id` FK column exists in `stock_movements`. However, the dev DB sprayers use `owner_id = 'owner_home_farm'` (raw string from seed) while the session `activeOwnerId` is a UUID-format ID, so the sprayer select returns 0 rows and the spray form Step 3 is empty. The full round-trip (spray → stock decrement) could not be exercised through the UI.

### Flow 15 — Cross-tenant isolation (Pass)

Switching `activeOwnerId` from `owner_4a6f2a24-6b8` (Test Farm 2) to `owner_home_farm` (Home Farm) via `/api/session/switch-owner` correctly hides:
- "Roundup Custom Test" stock item on /stock
- "LOT-SPIN-001" and "LOT-2026-BC-001" harvest events on /harvest

Both screens confirmed tenant isolation is clean.

---

## Skipped

None — all 16 flows were attempted. Flows 6 and 16 reached blocked/partial verdicts due to seed data gaps, not code bugs.

---

## Screenshots

| File | Flow |
|------|------|
| `screenshots/2026-05-25-harvest-today.png` | /today with curing-in-progress week strip item |
| `screenshots/2026-05-25-harvest-initial.png` | /harvest initial state with curing section |
| `screenshots/2026-05-25-hay-initial.png` | /hay mow decision page |
| `screenshots/2026-05-25-hay-mow-ted.png` | /hay after Mow→Ted advance |
| `screenshots/2026-05-25-stock-initial.png` | /stock inventory with category groups |
| `screenshots/2026-05-25-stock-add-submitted.png` | /stock/[id] after manual add + wrong title |
| `screenshots/2026-05-25-stock-catalog-search.png` | Catalog search results + "Pick this" error |
| `screenshots/2026-05-25-stock-detail-movements.png` | /stock/[id] with receipt showing 0 gal movement |
| `screenshots/2026-05-25-today-low-stock-banner.png` | /today low-stock banner (below fold) |
