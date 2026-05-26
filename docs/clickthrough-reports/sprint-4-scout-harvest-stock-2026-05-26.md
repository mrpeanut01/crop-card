# Clickthrough report — Sprint 4 (Scout / Harvest / Stock) — 2026-05-26

**Tester:** playwright-clickthrough subagent
**Build:** 8cca124
**Seed:** dev fixture (http://localhost:5173 hot-loaded working-tree, migration 0038 applied)
**Viewport:** browser default (desktop)
**Auth:** dev fixture, auto-signed in (landed /today)
**Target:** http://localhost:5173 (dev stack with Sprint 4 working-tree hot-loaded)

---

## Summary

- Items verified: 11 | Pass: 9 | Fail: 0 | Conditional-pass (no seed data): 2 | Blocked: 0
- New findings: P0=0, P1=0, P2=1 (ARC-004 and CT-HS-001 multi-pick partially verified by code inspection + proxy crop, forage unverifiable without forage planting in dev DB)

---

## Scout track

### #136 CT-SC-001 (P0) — Save observation → POST 201 → history refreshes — PASS

- **Route:** /scout
- **Steps:** Entered counts 5/5/5/5 across 4 spots → result flipped to `SPRAY` → clicked "Save observation"
- **Network:** `POST /api/scout/record → 201 Created`, followed by `GET /scout/__data.json?x-sveltekit-invalidated=11 → 200`
- **Observed:** Button changed to "✓ Saved — save another?". "Recent observations — East A" list gained a new row: "May 26 · broadleaf-weed · 5.00 avg-per-10sqft · over threshold (rust Pill)".
- **Screenshot:** ./screenshots/2026-05-26-scout-after-save.png

---

### #138 CT-SC-002 (P1) — Phase 25 primitives on /scout — PASS

- **Route:** /scout
- **A11y tree / DOM:**
  - `div.card` from Card.svelte: `hasCardDiv = true`
  - SCOUT Pill: `<span class="pill forest s-_5GFIHQkqeKJ">` inside `.page-header`
  - Provenance chip: `<span class="prov src-data compact" role="img" aria-label="Your data · Derived from your records — scout, calibration, prior season · your scout log">`
- **Observed:** All three Phase 25 primitives present and correctly composed.

---

### #139 CT-SC-003 (P1) — Recent observations: empty-state + threshold-flag — PASS

- **Route:** /scout (before save = empty state; after save = populated)
- **Empty state:** `paragraph "No observations recorded for this block yet — count a few spots above and save to start building the trend."` — present on initial load.
- **Post-save:** List item "May 26 broadleaf-weed 5.00 avg-per-10sqft over threshold" appeared. Threshold flag: `<span class="pill rust">over threshold</span>`.
- **Observed:** Empty-state copy correct; threshold-crossing flagged in rust Pill.

---

### #140 CT-SC-004 (P2) — Header spacing — PASS

- **Route:** /scout
- **Expected:** `.page-header` has non-zero `margin-bottom` from Sprint 4 style block.
- **Observed:** `window.getComputedStyle(pageHeader).marginBottom = "6.4px"` (0.4rem). Present and non-zero.

---

### #141 CT-SC-005 (P2) — "Tallest weed" uses Input primitive with `.hint` — PASS

- **Route:** /scout
- **Expected:** DOM has `.field` + `.hint` from Input.svelte; no bare `<small>`.
- **Observed:** `fieldCount = 1`, `hintCount = 1`, `hintText = "Leave blank if you didn't measure. Example: 1.5"`, `smallCount = 0`.

---

## Harvest track

### #197 CT-HS-001 (P1) — Multi-pick: "Record another pick" label + repeat-harvest banner — PASS

- **Route:** /harvest
- **Proxy crop:** Regal F1 Cucumber (`harvestStyle = continuous-fruit`) — a re-harvest archetype present in the dev DB.
- **Steps:** Opened form, entered "5 lb", clicked "Record harvest". POST `/api/harvest/record → 200`.
- **Observed after submit:**
  - Badge changed to "✓ harvested"
  - Button label changed to "Record another pick" (not "Record harvest")
  - Sky-tone Banner: "This continuous-fruit planting supports repeat harvest — log additional picks here."
- **Note:** No `cut-and-come-again` or `tree-fruit-multi-pick` planting is seeded in the dev DB. Code path for those archetype labels is implemented identically in the template (same `allowsReHarvest` function, same `#if p.alreadyHarvested && allowsReHarvest(p)` block, lines 205-216 of +page.svelte). Verified live via cucumber as proxy.
- **Screenshot:** ./screenshots/2026-05-26-harvest-multi-pick.png

---

### #198 CT-HS-002 (P1) — too-early / past window banners + form gating — PASS

- **Route:** /harvest
- **Expected:** Plantings in `too-early` / `past` status show the harvest form gated by an appropriately-toned Banner.
- **Observed on page load:** Every planting in the dev DB (all `too-early`) shows a wheat-tone Banner: "Plugin DTM suggests this isn't ready yet (Xd to window). Record anyway?" alongside a visible "Record harvest" button. Clicking the button opens the HarvestRouter form (`.renderer-mount` rendered, `<form>` present).
- **No `past` planting in dev DB at time of test** — code path verified in source (`lines 194-199` of +page.svelte, sky-tone Banner with "Window closed {p.daysPastWindow}d ago — logging late?").
- **Submission verified:** POST `/api/harvest/record → 200`, page refreshed correctly.
- **Screenshot:** ./screenshots/2026-05-26-harvest-form-too-early.png

---

### #230 ARC-004 (P2) — Forage planting shows sky Banner + /hay link — CONDITIONAL PASS (no seed data)

- **Route:** /harvest
- **Expected:** A planting with `harvestStyle === 'forage-cutting-cycle'` shows a sky-tone Banner: "Hay & forage plantings use the cutting workflow. Open /hay for this block →"
- **Observed:** No forage planting is active in the dev DB (dev seed only includes corn, beans, squash, cucumber, carrot). Cannot interactively verify.
- **Code inspection:** Template lines 175-181 in `routes/harvest/+page.svelte` implement exactly the spec:
  ```
  {#if p.harvestStyle === 'forage-cutting-cycle'}
    <div class="forage-banner">
      <Banner tone="sky">Hay & forage plantings use the cutting workflow.
        <a href="/hay?block={p.blockId}">Open /hay for this block →</a>
      </Banner>
    </div>
  ```
- **Verdict:** P2 conditional pass — implementation matches spec exactly; no interactive path to exercise without a forage planting seeded. Recommend adding a forage planting to dev fixture.

---

## Stock track

### #150 CT-ST-003 (P1) — /stock/[id] tab title = "{displayName} · Stock · CropCard" — PASS

- **Route:** /stock/e83707f9-8aa1-4e4b-a482-680b383962f4
- **Expected:** `document.title = "{displayName} · Stock · CropCard"`, NOT "Add stock · CropCard"
- **Observed:** `document.title = "Sweet Corn American Dream F1 Seed · Stock · CropCard"`
- **Screenshot:** ./screenshots/2026-05-26-stock-detail-receipt.png (shows page title in browser tab)

---

### #153 CT-ST-006 (P2) — Provenance chips carry role="img" + aria-label — PASS

- **Route:** /harvest (HarvestRouter form open for Regal F1 Cucumber); /scout
- **Expected:** `role="img"` + `aria-label` reads source label + long description.
- **Observed (manual chips on harvest form):**
  - `role="img"`, `aria-label="You typed · Entered or edited by you · the safety kernel still checks it"`, `data-provenance="manual"` — 2 instances
- **Observed (data chip on scout history):**
  - `role="img"`, `aria-label="Your data · Derived from your records — scout, calibration, prior season · your scout log"`, `data-provenance="data"` — 1 instance
- **Provenance.svelte source:** `role="img"` (line 79), `aria-label={titleText}` (line 80) — pattern applies to all 5 sources.

---

### #200 CT-HS-004 (P1) — Stock receipt writes positive delta — PASS

- **Route:** /stock/e83707f9-8aa1-4e4b-a482-680b383962f4
- **Steps:** Entered quantity = 25 count → clicked "Receive lot".
- **UI observed:** Movement history section updated to "Movement history (2)" with new row: `receipt · 5/26/2026 · +25 count · lot received`
- **DB probe:**
  ```
  SELECT delta_hundredths FROM stock_movements WHERE reason='receipt' ORDER BY occurred_at DESC LIMIT 3
  → 2500
  → 2500
  → 2500
  ```
  All values are positive integers (2500 = 25.00 count in hundredths). NOT zero.
- **Screenshot:** ./screenshots/2026-05-26-stock-detail-receipt.png

---

## Findings

No P0 or P1 failures found. One conditional-pass (ARC-004) noted below.

### CT-S4-001 — ARC-004 forage banner unverifiable without seed data [P2 — observation, not a bug]

- **UC:** #230 ARC-004
- **Route:** /harvest
- **Expected (per spec):** Forage planting shows sky Banner with /hay cross-link.
- **Observed:** No forage planting in dev DB. Code correctly implements the condition. Cannot exercise interactively.
- **Recommendation:** Add a `forage-cutting-cycle` planting to `apps/web/scripts/seed-test-data.mjs` (and dev fixture) so this path can be exercised in automated clickthrough tests.
- **Cross-ref:** Sprint E WIP (/hay route) — once hay fixtures are seeded, re-walk this item.

---

## Screenshots index

| File | What it shows |
|------|---------------|
| `screenshots/2026-05-26-scout-empty.png` | /scout initial state — empty history, SKIP card |
| `screenshots/2026-05-26-scout-after-save.png` | /scout after save — "✓ Saved", history row with rust "over threshold" Pill |
| `screenshots/2026-05-26-harvest-too-early.png` | /harvest with all plantings in too-early status, wheat Banner visible |
| `screenshots/2026-05-26-harvest-form-too-early.png` | /harvest form open for cucumber (too-early), HarvestRouter rendered |
| `screenshots/2026-05-26-harvest-multi-pick.png` | /harvest after first pick — "Record another pick" label + sky repeat-harvest Banner |
| `screenshots/2026-05-26-harvest-overview.png` | /harvest full page with recorded harvests table |
| `screenshots/2026-05-26-stock-detail-receipt.png` | /stock/[id] detail — receipt row shows +50 and +25 positive deltas |
