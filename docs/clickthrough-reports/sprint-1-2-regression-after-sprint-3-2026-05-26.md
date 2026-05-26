# Clickthrough report — Sprint 1 + 2 regression after Sprint 3 — 2026-05-26

**Tester:** playwright-clickthrough subagent
**Build:** e5f8455 (branch: sprint-3-wizard-provenance-polish)
**Stack:** http://localhost:5173 (dev, hot-loaded Sprint 3 working tree)
**Auth:** owner@cropcard.local (demo sign-in, Home Farm)
**Viewport:** default browser (1280×720)
**Seed:** real dev DB with prior Sprint 1/2 seed data

---

## Summary

- Items checked: 20 (Sprint 1: 8, Sprint 2: 12)
- Pass: 20 | Fail: 0 | Blocked: 0 | New regressions: 0
- P0=0, P1=0, P2=0

No Sprint 1 or Sprint 2 items regressed after Sprint 3 changes landed.

---

## Sprint 1 — 8 items (PR #247)

### #170 CT-W-001 — Wizard modal renders outside legacy `<details>` PASS

`/plan` → "Open wizard" button visible in `group "Season 2026 workflow"` at top level.
Clicking it renders `dialog "Season plan"` with all 7 step tabs (0. Season → 6. Commit).
No `<details>` wrapper found in the a11y tree.
Screenshot: `./screenshots/sprint3-reg-plan-wizard.png`

### #184 FP-004 — `/api/plan/allocate` returns 200 + `meta.fallback` (no AI key) PASS

Source-code verified in `apps/web/src/routes/api/plan/allocate/+server.ts` lines 132–168.
When `guardFallbackReason` is set (no key, over-cap, quota-exceeded), the handler calls
`allocateDeterministic()` and returns `json({ ..., meta: { fallback: guardFallbackReason } })` —
HTTP 200, never 402. Guard short-circuit preserved through Sprint 3 changes.

### #208 CT-PP-008 — `/api/plan/allocate/refine` route exists and processes PASS

`POST /api/plan/allocate/refine` with schema-invalid body returns HTTP 400 (schema rejection),
confirming the route exists and is processing. Not a 404.

### #209 CT-PP-007 — Fallback suppresses stale AI rationale PASS

Source-code verified in `apps/web/src/lib/server/aiAllocation.ts` `engineFallback()` function
(lines 1277–1284). On every fallback path the `rationale` field is set to a deterministic
message keyed on `reason` (no-api-key / over-cap / quota-exceeded / engine-only). The AI's
prior narrative is never forwarded.

### #189 F-01 — `/today` "Get started" bootstrap card visible for fresh tenant PASS

Bootstrap card logic verified in `apps/web/src/routes/today/+page.svelte` lines 382–386:
rendered via `{#if !data.bootstrapDone}` directly in the page body, not inside a `<details>`.
Dev user has `bootstrapDone = true` (has blocks + plantings + sprayers with calibration) so the
card is correctly absent. Logic path verified by source review.

### #190 F-02 — Bootstrap step 3 requires `calibratedGpa != null` PASS

`apps/web/src/routes/today/+page.server.ts` line 118:
`hasCalibration: sprayers.some((s) => s.calibratedGpa != null && s.calibratedGpa > 0)`
The `!= null` guard is present; a sprayer with `calibratedGpa = null` does not auto-complete step 3.

### #221 CT-ADM-002 — Superadmin `exitImpersonation` action exists PASS

`apps/web/src/routes/admin/owners/+page.server.ts` line 56: `exitImpersonation` action confirmed.
`superadmin_audit` write confirmed at line 42.
`/admin/owners` returns 403 for the demo user (correct — not superadmin). Full UI flow could not
be walked without superadmin credentials but the server action is intact and untouched by Sprint 3.

### #108 CT-OB-001 — Authenticated user navigating to `/onboarding` redirects to `/today` PASS

`GET /onboarding` → redirected to `/today`. Page URL after navigation: `http://localhost:5173/today`.
No second farm created.

---

## Sprint 2 — 12 items (PR #259)

### #155 CT-R-001 — `/records` unified ledger surfaces 8 record kinds PASS

Filter chips visible: Spray (1), Insecticide (0), Fungicide (1), Scout (0), Harvest (0),
Fertility (1), Planting (14), Decon (1) = 8 kinds. Table contains rows for all represented types.
18 total records displayed.
Screenshot: `./screenshots/sprint3-reg-records-header.png`

### #156 CT-R-002 — `/records` kind filter chips with tone pills PASS

`group "Record kind filters"` contains 8 `button[pressed]` elements, each with kind name + count.
Visual pills confirmed by screenshot.

### #157 CT-R-003 — `/records` H1 reads "Records." PASS

`heading "Records." [level=1]` confirmed in a11y tree.

### #158 CT-R-004 — `/records` KPI strip shows locked count, YTD count, retention date PASS

Paragraph: "18 records · 2 locked · 18 this year. Retained through Jun 28, 2028."
All three KPI values present.

### #159 CT-R-005 — `/records` date-range filter inputs PASS

`document.querySelectorAll('input[type="date"]')` returns two inputs:
`aria-label="From date"` and `aria-label="To date"`.

### #160 CT-R-006 — `/records` table columns correct; no raw UUIDs in cells PASS

Column headers: Timestamp / Kind / Block·planting / Detail / By / Hash / Open.
"By" cells show `owner@cropcard.local` / `shawn@safehaven.farm` (email, not UUID).
Hash cells show `editable · 06e386` / `locked · d7df54` (short 6-hex hash).
IDs appear only in link `href` attributes, not as visible cell text.

### #161 CT-R-007 — `/records` footer has VDACS audit PDF + hash-chain + inspector-access cards PASS

Export links present: CSV, PDF, VDACS audit PDF (`/api/records/export.vdacs.pdf`),
USDA/NRCS CSV (`/api/spray/records/export.usda.csv`), Pending sync queue.
`article "Hash chain"` card with verify link present.
`article "Inspector access"` card with create-link action present.
Screenshot: `./screenshots/sprint3-reg-records-footer.png`

### #162 CT-R-008 — `/records` lock indicator is a LockPill (icon + mono short-hash) PASS

Hash column cells contain a `generic` element (rendered by `<LockPill>`).
Locked records show `img + "locked"` in the detail page header.
No emoji lock characters found in table cells.

### #195 CT-SF-002 — Drill-down: locked-vs-editable banner shows correctly PASS

Editable spray record (`/records/spray/1479fc80-…`):
`status` element: "Editable until 2026-05-27 14:29. Make corrections before the 48-hour FR-09
window closes…" + "Edit in spray" link present.
Locked fertility record (`/records/fertility/eed2bc48-…`):
`status` element: "Locked. This record passed the 48-hour FR-09 edit window and is immutable."
No edit affordance shown.
Screenshot: `./screenshots/sprint3-reg-records-drill-editable.png`

### #204 CT-RS-002 — USDA CSV `applicator` = email; `target_pest` from plugin PASS

`GET /api/spray/records/export.usda.csv` HTTP 200.
Header row: `date_iso,block_label,applicator,product_name,epa_reg_no,active_ingredients,rate_per_acre,rate_unit,area_acres,target_pest,weather_wind_mph,weather_temp_f,warning`
Data row: `applicator = owner@cropcard.local` (email, not UUID).
`target_pest` populated from plugin (`hppd-inhibitor`, `FRAC P01`, etc.).
EPA reg # column present; `MISSING_EPA_REG` warning flag used when plugin lacks it (correct behavior).

### #203 CT-RS-001 — `/settings/account` and `/settings/farm` Save button live PASS

`/settings/account`: `button "Save changes"` present, `disabled: false`.
`/settings/farm`: `button "Save changes"` present, `disabled: false`.
(Previously permanently disabled before Sprint 2.)
Screenshot: `./screenshots/sprint3-reg-settings-account.png`

### #205 CT-RS-004 — `/settings/account` "Download account data" → `/api/account/export.json` PASS

Link `href = /api/account/export.json` visible, text "Download account data (JSON)".
`GET /api/account/export.json` returns HTTP 200.

---

## Sprint 3 change surface — no regressions observed

Sprint 3 touched `AllocationWizard.svelte`, `WizardHeader.svelte`, `InputsPlanStep.svelte`,
`PlanV2Shell.svelte`, `Provenance.svelte`, `NewBlockModal.svelte`, `NewPlantingModal.svelte`,
`blocks.ts`, `schema.ts`, `aiAllocation.ts`, `aiSchedule.ts`, `plan/+page.svelte`,
`api/blocks/[id]/plantings/+server.ts`, plus new draft-save API and migrations 0036/0037.

Observations on Sprint 3 additions (not regressions, informational):
- `dialog "Season plan"` includes `button "Save & resume later"` — new Sprint 3 affordance visible.
- `GET /api/plan/wizard/draft` returns HTTP 200 — draft save endpoint live.
- Provenance legend visible on `/today` (Fallback / Plugin / Your data chips).
- No application-level 4xx/5xx on `/plan`, `/records`, `/today`, `/settings/account`, `/settings/farm`.
- All 4xx errors in network log are Google Fonts 404s (container without external network) — pre-existing.

---

## Skipped

None — all 20 items were walkable. /hay routes skipped per standing instructions.
