# Clickthrough report — /scout Phase 25 verification — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs (dev server)
**Viewport:** 390×844 (iPhone 14 Pro) — full-page screenshots taken
**Auth:** demo owner role (cookie session via /?/demo)
**Dev server:** http://localhost:5173 (user-specified; test stack on :5273 was not reachable)

---

## Lead finding — No Phase 25 Almanac mockup exists for /scout [P2]

The Phase 25 Almanac design pack (`docs/design/almanac/`) has no canonical
`AScoutScreen` artboard. The closest design references are incidental mentions:
`direction-almanac-today.jsx` (Scout tone-pill + quick-action), `direction-almanac-plan-v2.jsx`
(scout history in IPM context), `direction-almanac-insecticide.jsx` (IPM gate reads prior
observations). This design debt means the Phase 25 visual audit below compares against
the implemented reference screens (/spray, /today) rather than a Scout-specific artboard.

---

## Summary

- UCs walked: UC-05 (Scout-and-spray decision) — primary; UC-32 connection verified
- Pass: UC-05 primary path completes end-to-end
- Fail: 0 blocking, several drift findings
- Blocked: 0
- Skipped: none applicable

**New findings: P0=0, P1=1, P2=4**

---

## Findings

### CT-001 — /scout does not persist weed-count scout observations to the DB [P1]

- **UC:** UC-05
- **Route:** `apps/web/src/routes/scout/+page.svelte` + `+page.server.ts`
- **Expected (per use-cases.md UC-05 and Phase 25d #95):** Scout observations should
  be written to `scout_observations` via `POST /api/scout/record`. The Phase 25d work
  explicitly created `scoutObservations.ts` repo + `insertScoutObservation()` + the
  `/api/scout/record` endpoint, with the comment "New scout observations should write here."
  The IPM gate evaluator at `/spray/insecticide` reads from `scoutLogByBlock()` to
  decide threshold state.
- **Observed:** The /scout page is a pure client-side decision tool. It has no `<form
  action>`, no `fetch` call, and `+page.server.ts` is load-only. Submitting a weed count
  (e.g., 4×5 weeds/10sqft → SPRAY) produces a live decision card but writes nothing
  to the DB. The `POST /api/scout/record` endpoint (`+server.ts`, line 56) is never
  called from the UI. Consequence: the IPM threshold dial on `/spray/insecticide` will
  always show zero prior observations even after the operator scouts a block.
- **Console:** No app errors.
- **Network:** No POST to `/api/scout/record` observed during or after entering weed counts.
- **Screenshot:** `./screenshots/2026-05-25-scout-spray-cta.png` (SPRAY card visible with
  CTA but no save action)
- **Recommendation:** Add a "Save observation" action after the SPRAY/SKIP card renders.
  For the herbicide-weed UC-05 flow the payload would be: `pest: 'broadleaf-weeds'`,
  `metric: 'count-per-10sqft'`, `value: averagePer10SqFt`. Wire to `POST /api/scout/record`.
  The decision should optionally persist even on SKIP so mid-season weed pressure trends
  are visible in records.
- **Cross-ref:** Blocks the IPM threshold continuity between UC-05 and UC-32
  (`scoutLogByBlock()` will be empty).

---

### CT-002 — Phase 25 Card primitive not used; local `.card` diverges from design system [P2]

- **UC:** UC-05 visual language
- **Route:** `apps/web/src/routes/scout/+page.svelte` lines 48–60, 62–74, 76–87
- **Expected (per Phase 25 design):** Pages use the `$lib/components/ui/Card.svelte`
  primitive (used in /today). /spray uses `SprayPageHeader` which composes `Kicker` +
  `Pill` + `Banner`. Both are the Phase 25 canonical pattern.
- **Observed:** Scout uses three locally-styled `<section class="card">` divs with
  ad-hoc CSS (`background: white`, `border-radius: 8px`, `box-shadow: 0 1px 2px …`).
  The `Card.svelte` primitive is not imported. The `Pill` and `Provenance` components
  are not used anywhere on the page. The gate-slot pill row present in `SprayPageHeader`
  (e.g., "IPM threshold gate — Phase 25d") is absent from /scout.
- **Console:** No errors.
- **Network:** N/A.
- **Screenshot:** `./screenshots/2026-05-25-scout-initial-load.png`
- **Recommendation:** Replace `<section class="card">` with `<Card>` primitive. Add a
  gate-slot Pill row (at minimum a single "FR-07 · Weed threshold" pill) consistent with
  /spray pages. No mockup exists to prescribe the exact layout — design ticket needed.

---

### CT-003 — No scout history view; past observations are not surfaced [P2]

- **UC:** UC-05 Success; UC-32 IPM gate continuity
- **Route:** `apps/web/src/routes/scout/+page.svelte`
- **Expected (per docs/design/almanac/direction-almanac-plan-v2.jsx and UC-32 primary
  path step 2):** Prior scout observations for the selected block should appear as a
  chronological list with count trends, supporting the "scout history" mentioned in the
  plan-v2 design reference.
- **Observed:** After selecting a block (Block A in seeded data), the page shows only the
  live entry form. There is no historical observations panel, no sparkline, no threshold
  line. The `listScoutObservations()` function exists in `scoutObservations.ts` and
  `+page.server.ts` could easily load recent observations — but it does not call it.
- **Console:** No errors.
- **Network:** N/A.
- **Screenshot:** `./screenshots/2026-05-25-scout-initial-load.png`
- **Recommendation:** Add `listScoutObservations({ blockId, limit: 20 })` to the server
  load function and render a history card below the entry form. This is also the missing
  visual that the Almanac design pack would need to specify.

---

### CT-004 — `page-header` class has no style definition in the scout page [P2]

- **UC:** UC-05 visual language
- **Route:** `apps/web/src/routes/scout/+page.svelte` line 38
- **Expected:** `<header class="page-header">` renders with the Phase 25 spacing
  (`margin-bottom: 1.25rem` as defined in `SprayPageHeader.svelte` lines 106–108).
- **Observed:** The scout page declares `<header class="page-header">` but has no
  corresponding CSS rule in its `<style>` block (confirmed by source inspection). Svelte's
  CSS scoping means `SprayPageHeader`'s `.page-header` rule does not bleed through.
  The header renders with no explicit margin/padding, relying on browser defaults.
  Visual effect: header is tight against the top bar with no breathing room.
- **Console:** No errors.
- **Network:** N/A.
- **Recommendation:** Add `.page-header { margin-bottom: 1.25rem; }` to the scout page
  `<style>` block, or replace the `<header>` with the `SprayPageHeader` component
  (adapted for a `scouting` chemistry type).

---

### CT-005 — Tallest-weed hint text uses inline `Example:` copy rather than `<small>` label [P2]

- **UC:** UC-05 (pre-existing audit finding F-F in use-cases.md)
- **Route:** `apps/web/src/routes/scout/+page.svelte` line 86
- **Expected (per HCD §2.6):** Input helper text must be a persistent visible label, not
  a disappearing placeholder. Audit note in use-cases.md UC-05 flagged `placeholder="e.g. 1.5"`
  as F-F.
- **Observed:** The placeholder issue from the original audit has been partially fixed:
  the tallest-weed input no longer uses `placeholder` — it uses `<small>Leave blank if you
  didn't measure. Example: 1.5</small>` (line 86). However the helper text still contains
  "Example: 1.5" which is the same content that was the placeholder, now as static text
  below the input. This is an improvement (text persists) but the copy style is inconsistent
  with the `Input.svelte` primitive pattern used elsewhere (`$lib/components/ui/Input.svelte`).
- **Console:** No errors.
- **Network:** N/A.
- **Recommendation:** Use the `Input.svelte` primitive with a `hint` prop for consistency.
  Reword copy to describe the field purpose rather than show an example value
  (e.g., "Tallest weed you observed while walking the block").

---

## Items verified as PASS

1. **Top nav active state.** 7-item nav renders; Scout link has `aria-current="page"` and
   `.active` class. Bottom-bar on mobile (390px) shows all 7 items at ≥48px height. Pass.

2. **Phase 25 Kicker + serif H1.** `<Kicker>FR-07 · Threshold-driven scouting</Kicker>`
   and `<h1 class="serif">Scout & spray decision</h1>` are both present. The Kicker
   component is imported from `$lib/components/ui/Kicker.svelte`. Pass.

3. **Block selector pre-fill from deep-link.** `?block=<uuid>&windowStage=POST` correctly
   pre-selects the block in the combobox and renders the "Window: POST (from today's
   calendar)" meta line. Pass. Screenshot: `./screenshots/2026-05-25-scout-deeplink.png`.

4. **Live SPRAY/SKIP decision.** Entering 5 weeds across all 4 spots triggers the SPRAY
   card with `aria-live="polite"` (screen-reader update) and renders the
   "Plan the spray for Block A →" deep-link to `/spray?block=<uuid>&fromScout=1`. Pass.

5. **Deep-link CTA to /spray.** The generated href includes `block`, `windowStage`, and
   `fromScout=1` params (confirmed in a11y tree). Pass.

6. **Tap targets ≥48dp.** Remove-spot button (48×48), Add-another-spot button (165×48),
   spot input (96×48), nav Scout link (55×48). All pass CLAUDE.md invariant.

7. **No app-level console errors.** All 6 console errors are Google Fonts CDN 404s
   (network isolation in dev environment). No SvelteKit, Svelte, or app-code errors. Pass.

8. **No app-level network 4xx/5xx.** All 4xx responses are external Google Fonts CDN
   requests. Application routes return 200. Pass.

9. **Add/remove spot buttons work.** "+ Add another spot" adds a 5th spot row; "✕"
   removes individual rows (minimum 1 enforced by conditional render). Pass.

---

## Skipped

- UC-26 Sidebar nav — Proposed, not Implemented
- /hay routes — Sprint E WIP (per agent instructions)

---

## Design debt note

The finding that no Phase 25 Almanac mockup exists for /scout is the highest-leverage
gap: CT-001 (no persistence), CT-003 (no history view), and CT-002 (visual drift) all
trace back to the absence of a Scout-screen artboard in the Almanac design pack. A single
design ticket covering the Scout screen in the Almanac direction would unblock all three.

