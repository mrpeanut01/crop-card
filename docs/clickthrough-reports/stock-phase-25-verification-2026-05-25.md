# Clickthrough report — Stock Phase-25 verification — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs
**Viewport:** 1280x800 (default desktop; mobile tap-target check performed in-session)
**Auth:** owner role (demo session via /?/demo)
**Spec sources:**
- `docs/design/almanac/direction-almanac-pages.jsx` — `AStockScreen`
- `docs/design/almanac/direction-almanac-stock-add.jsx` — `AStockAddScreen`

---

## Summary

- Screens walked: /stock (main), /stock/add (all 4 active tabs), /stock/[id] (item detail)
- New findings: P0=0, P1=3, P2=3

---

## Findings

### CT-001 — /stock main page: H1 reads "Inventory" not "Stock." [P2]

- **Route:** `apps/web/src/lib/components/InventoryView.svelte` line 1755
- **Expected (per `AStockScreen`):** Kicker `Inventory · {farm}` + serif H1 `Stock.` (fontSize 34, forestDeep, letterSpacing -0.02em)
- **Observed:** H1 text is `Inventory` (not `Stock.`). No kicker above it. Serif font and forest-deep color are applied correctly, so the token wiring is correct but the copy does not match the Almanac design.
- **Console:** Google Fonts 404s only (network issue, not app code)
- **Network:** No 4xx/5xx on app routes
- **Screenshot:** `./screenshots/2026-05-25-stock-main.png`
- **Recommendation:** Update `InventoryView.svelte` h1 text to "Stock." and add kicker paragraph above it per AStockScreen spec.

---

### CT-002 — /stock main page: KPI strip, category tabs, action buttons, and Recent Movement panel all absent [P1]

- **Route:** `apps/web/src/routes/stock/+page.svelte` + `apps/web/src/lib/components/InventoryView.svelte`
- **Expected (per `AStockScreen`):**
  1. 4-cell KPI strip: SKUs (count), Short (low-stock count), Expiring 30d, Lots tracked
  2. Horizontal category tab strip: All / herbicide / insecticide / fungicide / fertilizer / seed — with item-count badges and rust dots for low-stock categories
  3. Header action buttons: "Shopping list CSV" (ghost), "Receive shipment" (ghost), "Add item" (primary)
  4. Right-rail "Recent movement" panel (last received date + scrollable transaction list)
  5. Per-row low-stock "Reorder" rust button and expiring-soon wheat-tone expiry date
- **Observed:** None of the above are present. The page renders a flat accordion grouped by category (collapse/expand), a plain search bar, a legacy "+ Add item" modal button, and the new "+ Add stock (5-method waterfall)" link CTA. Low-stock alert fires as an `<aria-live>` status banner (correct a11y, wrong visual treatment). No KPI strip, no tab filter bar, no recent-movement panel.
- **Console:** No app errors
- **Network:** No 4xx/5xx
- **Screenshot:** `./screenshots/2026-05-25-stock-main-with-item.png`
- **Recommendation:** The InventoryView component predates Phase 25. A Phase 25d reskin of this component — parallel to what was done for /today and /plan — is needed to deliver `AStockScreen`. Current state is the legacy component plus only the new /stock/add CTA link grafted on top.

---

### CT-003 — /stock/add: "AI photo" (5th method) absent; tab bar shows 4 methods [P1]

- **Route:** `apps/web/src/routes/stock/add/+page.svelte`
- **Expected (per `AStockAddScreen`):** 5 method tabs: Scan barcode / Scan label / AI photo / Textual search / Manual entry. The `photo` (AI photo) method is explicitly wired in the mockup as `active === "ai"` rendering `<AStockAIBody>`.
- **Observed:** Tab bar renders 4 tabs: "Type it in" / "Search" / "Scan barcode" / "Scan label". No "AI photo" tab is present. `addMethods.ts` reserves `photo` as a constant but `parseEnabledMethods` excludes it from the default set, and `+page.svelte` renders a `placeholder` paragraph for `active === 'photo'` rather than calling the AI body.
- **Console:** No app errors
- **Network:** No 4xx/5xx
- **Screenshot:** `./screenshots/2026-05-25-stock-add-manual.png`
- **Recommendation:** This is an acknowledged deferral in the codebase: "Phase 26 — full bottle/bag photo → vision-extracted draft." The finding is recorded as P1 per the spec; the implementation intentionally defers it. Consider a visible "Coming in Phase 26" placeholder tab so users know the method exists rather than silently omitting the tab.

---

### CT-004 — /stock/add: Almanac method-picker card grid replaced by ARIA tablist [P2]

- **Route:** `apps/web/src/routes/stock/add/+page.svelte`, `apps/web/src/lib/components/stock/add/MethodTabs.svelte`
- **Expected (per `AStockAddScreen`):** A 5-column card grid where each card has an icon chip (30×30 rounded, forest when active), bold label, and mono hint text (e.g. `UPC · EAN · DataMatrix`). Borders are `forest` when active, `divider` when inactive.
- **Observed:** Implementation uses ARIA `tablist`/`tab` with icon images. Accessible names and keyboard nav are correct, but the visual is a compact tab bar rather than the card-grid selector from the mockup. No hint text below each method label (the mockup shows mono-font sub-labels like "UPC · EAN · DataMatrix").
- **Console:** No app errors
- **Screenshot:** `./screenshots/2026-05-25-stock-add-search.png`
- **Recommendation:** P2 polish — add sub-label hint text to each tab and consider expanding to the card-grid layout for desktop at wider viewports.

---

### CT-005 — /stock/add manual form: Provenance badges present but icon-only (no visible label) [P2]

- **Route:** `apps/web/src/lib/components/stock/add/ManualForm.svelte`
- **Expected (per Phase 25d AI-provenance addendum):** Every pre-populated value carries a `<Provenance>` badge with `provenance` tag rendered visually.
- **Observed:** Provenance `<span>` elements are present on every manual form field with correct `title="You typed · Entered or edited by you · the safety kernel still checks it"`. The badge is icon-only (image with no visible text label), which passes for sighted users with tooltips but may not convey provenance to screen-reader users without a more explicit `aria-label` on the icon.
- **Console:** No errors
- **Recommendation:** Add `aria-label` to the provenance icon span matching its title text, or use an `<abbr>` pattern so screen readers surface the tooltip.

---

### CT-006 — /stock/[id] item detail: No lot history, movements table, or Almanac visual treatment [P1]

- **Route:** `apps/web/src/routes/stock/[id]/+page.svelte`
- **Expected (per `AStockMatchPanel` lot section + `AStockScreen` "View history" affordance):** After adding a new item, the item detail page should show: current balance, lot history table with lot#/qty/expiry, movement history (received / spray-decrement rows with timestamps), and a "Receive lot" form with lot number as required field.
- **Observed:** The item detail page shows the correct structure (Summary / Receive new lot / Lots / Movement history sections), the "Receive lot" form is functional with all expected fields (Lot number, Expires, Supplier, Quantity), and after item creation with 0 balance it correctly shows "No lots received yet." and "No movements yet." The page title is "Add stock · CropCard" even when viewing an existing item — the `<svelte:head>` title in `/stock/add/+page.svelte` bleeds into the `/stock/[id]` route.
- **Console:** No errors
- **Network:** No 4xx/5xx
- **Screenshot:** `./screenshots/2026-05-25-stock-item-detail.png`
- **Note on P1 classification:** The functional structure exists and works correctly. The finding is P1 because the page title is wrong ("Add stock · CropCard" instead of "{Item name} · Stock · CropCard") and the Almanac visual treatment (serif product name header, category pill, KPI summary card, safety-kernel read-out card) from AStockMatchPanel is absent. The lot-history and movement-history sections are present but empty because no lots have been received yet — that is correct behavior, not a bug.

---

## What works correctly

- Nav: 7-item nav renders with "Stock" active — correct.
- Auth gate: Helpers see the surface but "Add to inventory" is disabled (enforced at API level, not just UI).
- /stock/add submission: Manual entry with category + name + unit posts to `POST /api/stock`, receives a created item ID, and redirects to `/stock/{id}?added=1` — persistence path end-to-end works.
- Search tab: Type a query, click "Search library" — renders "Nothing found in your library" appropriately for a fresh seed database.
- Scan barcode tab: Renders "Open camera" button with correct description text.
- Scan label tab: Renders file-upload drop zone with "Take or upload a photo" CTA.
- Provenance badges: Present on all 7 manual form fields with correct `title` text.
- Low-stock alert: Fires as `aria-live="polite"` status region — correct a11y pattern.
- "Add stock (5-method waterfall)" CTA: Visible, links to `/stock/add`, min-height 38px (just below 48dp threshold — see tap-target note below).

## Tap-target note (mobile / glove operability)

The "+ Add stock (5-method waterfall)" CTA link has computed height 38px, which is 10px below the ≥48dp CLAUDE.md spec. All nav links and the "+ Add item" button measured at 36–44px. The Category collapse/expand buttons in the accordion measure at 44px — acceptable. The "+" quick-add buttons per item row measured at ~32px — below threshold. These are pre-existing issues in InventoryView, not regressions from Phase 25.

## Skipped

- /stock/[id] lot-receive full walkthrough (would require seed data with pre-existing lots)
- /today low-stock + expiring banners cross-check (addressed in today-phase-25 report)
