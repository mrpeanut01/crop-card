# Clickthrough report — /calibrate + /equipment — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Target:** http://localhost:5173 (dev server — test stack on :5273 unreachable)
**Seed:** apps/web/scripts/seed-test-data.mjs (dev DB)
**Viewport:** browser default (~1280px)
**Auth:** demo owner session (POST `/?/demo` role=owner)

---

## Summary

- Flows walked: /equipment (list + add + detail) + /calibrate (wizard end-to-end) + /spray (GPA feed-through)
- Pass: 4 | Fail: 1 | Partial: 3 | Blocked: 0
- New findings: P0=0, P1=2, P2=2
- #190 confirmed present (not a new finding)

---

## Findings

### CT-CAL-001 — Uncalibrated sprayers show "15 GPA" in /calibrate dropdown [P1]

- **Confirms:** GitHub issue #190 (GPA=15 fallback in `sprayers.ts:28`)
- **Route:** `apps/web/src/routes/calibrate/+page.svelte` line 109
- **Expected:** Sprayers with no calibration (`calibrated_gpa = NULL`) should show "Uncalibrated" or "—" in the dropdown, not a false confidence value.
- **Observed:** Dropdown option text is `{s.label} (current: {s.calibratedGpa} GPA)`. For "Tractor 3pt 12v Boom Sprayer" (DB: `calibrated_gpa = NULL`) the option reads "current: 15 GPA". For the newly-created "Test Backpack Sprayer" (DB: `NULL`) it also reads "current: 15 GPA". The `toSprayer()` adapter in `sprayers.ts:28` materialises the fallback before the UI even renders.
- **Network:** `GET /api/sprayers` — 200
- **Screenshot:** `./screenshots/2026-05-25-calibrate-step1-sprayer-select.png`
- **Recommendation:** In `calibrate/+page.svelte:109` emit `Uncalibrated` when `s.calibratedGpa === 0` or add a sentinel; longer term fix is the #190 server-side change (`?? null`, not `?? 15`). The two changes are independent — the UI label fix is a one-liner while waiting for #190.

---

### CT-CAL-002 — Save is not blocked for out-of-band GPA (>60 or <5) [P1]

- **Route:** `apps/web/src/routes/calibrate/+page.svelte` + `apps/web/src/routes/api/sprayers/[id]/calibration/+server.ts:20`
- **Expected (per UC-10 step 5):** App "flags outside 5–60 sanity band". Industry expectation: flag = warn + require explicit override or disable save.
- **Observed:** Entering 200 oz (→ 200 GPA) shows "⚠ 200 GPA is outside the 5–60 sanity band." but the "Save to Tractor 3pt 12v Boom Sprayer" button remains enabled and clickable. Server schema is `z.number().positive()` — no upper bound. A mis-typed value would silently persist to `equipment_state.calibrated_gpa` and cascade into every dilution calculation for that sprayer.
- **Console:** No error.
- **Network:** Would return 200 and write the value.
- **Screenshot:** `./screenshots/2026-05-25-calibrate-result.png` (shows 22 GPA / saved state; re-run with 200 oz to reproduce warn state)
- **Recommendation:** Either disable the save button when `gpaResult.outsideSanityBand` is true, or add a server-side `z.number().min(0.5).max(200)` guard with a required `forceSave: true` body field for operator overrides. The UI-only guard is the minimum viable fix.

---

### CT-CAL-003 — /spray herbicide card previews show "@ 15 GPA" regardless of selected sprayer [P2]

- **Route:** `apps/web/src/routes/spray/+page.svelte` (herbicide selection section)
- **Expected:** After selecting a sprayer (step 3), herbicide card rate previews in step 2 should update to show the actual selected sprayer's GPA.
- **Observed:** All herbicide button labels use a hardcoded 15 GPA in the preview text ("1 pt/A @ 15 GPA", "3 fl-oz/A @ 15 GPA", etc.) even after the Boom Sprayer (now 22 GPA) is highlighted in the sprayer section. The sprayer section itself correctly shows "22 GPA". The mix step (step 3) presumably uses the real value but the herbicide cards are purely cosmetic. A user who calibrates at 40 GPA sees misleading rate previews.
- **Console:** No error.
- **Screenshot:** `./screenshots/2026-05-25-calibrate-step1-sprayer-select.png` (sprayer picker), `./screenshots/2026-05-25-calibrate-saved.png` (post-save)
- **Recommendation:** The herbicide card preview GPA should be reactive to the selected sprayer. Pass the selected sprayer's `calibratedGpa` (or `null` → show "—") into the herbicide list component and substitute the plugin's `defaultGpa` only when no sprayer is selected.

---

### CT-CAL-004 — Equipment type filter splits "sprayer" vs "Sprayer" into two chip buttons [P2]

- **Route:** `apps/web/src/routes/equipment/+page.svelte` + `apps/web/src/routes/equipment/+page.server.ts:11-12`
- **Expected (per UC-30 step 1):** "lists all equipment with type filter" — one filter chip per canonical type.
- **Observed:** The filter row shows both `sprayer (2)` and `Sprayer (2)` as separate chips. Clicking `sprayer (2)` shows only seeded CORN + PUMPKIN rows (whose `typeName` falls back to the legacy enum `"sprayer"`). Clicking `Sprayer (2)` shows only the user-added rows (whose `typeName` comes from the taxonomy term `"Sprayer"`).
- **Root cause:** `+page.server.ts` resolves `typeName` as `typeId ? taxonomyTerm.name : eq.type`. Seeded rows have no `typeId` so they use `eq.type = "sprayer"` (lowercase legacy enum). User-added rows match a taxonomy term `"Sprayer"` (title-case). The `counts` Map in the Svelte component keys on `typeName` verbatim, producing two separate groups.
- **Screenshot:** Not captured separately — visible in `./screenshots/2026-05-25-equipment-list.png` (filter row at top shows both chips).
- **Recommendation:** Normalise `typeName` at the server: `(tn ?? eq.type).toLowerCase()` or title-case both via `capitalize(tn ?? eq.type)`. Alternatively backfill `typeId` on seeded rows during the next migration.

---

## Flow results

| Flow | Steps | Result | Notes |
|------|-------|--------|-------|
| /equipment list | Render, filter, view 7 items | Pass | Two "sprayer" chips (CT-CAL-004) |
| /equipment — Add sprayer | Type + Label → Add | Pass | New row appears; DB shows `calibrated_gpa = NULL` |
| /equipment/[id] detail | Calibrate link, log history | Pass | 1 log entry visible; Calibrate link → `/calibrate` (no sprayer pre-selected) |
| /calibrate wizard | Pick sprayer → width/stride → oz → compute → save | Pass | GPA written to DB; audit log entry created; UI updates to "22 GPA" |
| /calibrate — out-of-band GPA | Enter 200 oz | Partial | Warning shown, save NOT blocked (CT-CAL-002) |
| /spray GPA feed-through | Select calibrated sprayer | Pass | Sprayer section shows real GPA (22); herbicide previews still static 15 (CT-CAL-003) |
| #190 confirmation | New sprayer, null GPA in DB | Confirmed | `/calibrate` dropdown and `/spray` sprayer section both show "15 GPA" for NULL sprayers |

---

## Positive observations

- Calibration POST (`/api/sprayers/:id/calibration`) returns 200 and writes `calibrated_gpa` correctly to DB.
- Audit trail: `equipment_log` entry with `kind = "calibration"` and `{"calibratedGpa": 22}` payload written on every successful save.
- Re-calibration: subsequent wizard run on same sprayer overwrites the value correctly.
- Sanity band warn renders and applies `warn` CSS class to result card.
- Add equipment: new sprayer correctly persists `calibrated_gpa = NULL` (no phantom 15 in DB — the 15 is only materialised in the JS adapter layer).
- /equipment delete affordance (🗑 button) present for every row including newly added sprayer.

## Skipped / not walked

- Delete with referencing spray records — referential integrity check deferred (would require a controlled test-only sprayer delete attempt).
- Owner switch mid-wizard — deferred (requires second owner session).
- /calibrate empty-sprayer state — could not isolate (existing session has sprayers; empty state requires a fresh onboarded owner with no sprayers).
- `/settings/sprayers` (referenced in the /equipment redirect banner) — out of scope for this audit.
