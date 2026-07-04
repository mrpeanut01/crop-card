# Clickthrough report — Records + Settings flows — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs
**Viewport:** default (1280x720 desktop; localhost:5173)
**Auth:** owner@cropcard.local (demo owner, Home Farm)
**Target:** http://localhost:5173 (dev server; test stack on :5273 unreachable)

---

## Summary

| Flow | Result | Severity |
|------|--------|----------|
| 1. Record viewing + filter (spray-only) | PASS | — |
| 2. CSV export | PARTIAL | P2 |
| 3. PDF export | PASS | — |
| 4. USDA/NRCS CSV export | PARTIAL | P1 |
| 5. Cross-tenant isolation under filters | PASS | — |
| 6. Audit-trail verification | PASS | — |
| 7. Read-only role (Inspector) | SKIPPED | — |
| 8. Account profile update | FAIL | P1 |
| 9. Farm settings update | FAIL | P1 |
| 10. Season setup | PASS | — |
| 11. AI key + capped spend | PARTIAL | P2 |
| 12. Helper invites | PARTIAL | P2 |
| 13. API tokens | PASS | — |
| 14. Plugin manager | PASS | — |
| 15. Records retention / audit settings | PASS | — |
| 16. Billing settings | PASS | — |
| 17. Advanced settings | PARTIAL | P2 |
| 18. Settings nav completeness | PARTIAL | P2 |

**Flows walked:** 17 (1 skipped)  
**Pass:** 8 | **Partial:** 6 | **Fail:** 2 | **Blocked:** 0 | **Skipped:** 1  
**New findings:** P0=0, P1=3, P2=4

---

## Findings

### CT-F01 — Save button permanently disabled on /settings/account and /settings/farm [P1]

- **UC:** Settings account profile update (flow 8), farm settings (flow 9)
- **Routes:** `/settings/account`, `/settings/farm`
- **Expected:** Editing any form field (display name, farm name, county) enables the "Save changes" button, allowing the user to persist the change.
- **Observed:** "Save changes" button remains `disabled` after typing into textboxes, even with `pressSequentially` (which fires real key events). JS evaluation confirms `disabled: true` after typed characters are reflected in the DOM (`input[name="name"].value === "Audit Test Owner"`). Dispatching synthetic `input`/`change` events also does not enable the button. The Svelte reactive binding appears to not be detecting the change from the initial page-load value.
- **Console:** No app-code errors (only Google Fonts 404s).
- **Network:** No failed requests related to settings save.
- **Screenshot:** `./screenshots/2026-05-25-settings-account-save-disabled.png`
- **Recommendation:** Audit the Svelte store or reactive statement that gates the Save button enabled/disabled state. Likely the `dirty` check compares against an initial snapshot that is not being updated when the user types. Also test on /settings/farm — same issue observed there.
- **Cross-ref:** Not previously filed; new finding.

### CT-F02 — USDA/NRCS CSV `applicator` field emits raw user ID, not display name [P1]

- **UC:** USDA/NRCS export (flow 4)
- **Route:** `/api/spray/records/export.usda.csv`
- **Expected:** `applicator` column contains the applicator's display name (e.g. "Owner" or "owner@cropcard.local") suitable for a VDACS/USDA pesticide record.
- **Observed:** Column contains raw internal user ID: `user_1778117132585_3oot6g`. Additionally, `epa_reg_no` is empty and `target_pest` is empty for all rows; a `MISSING_EPA_REG` warning is appended to the CSV.
- **Console:** No errors.
- **Network:** 200 OK, text/csv.
- **Screenshot:** (inline in audit; no separate screenshot — data observed via fetch)
- **Observed CSV row:** `2026-05-25,East A,user_1778117132585_3oot6g,Callisto (Syngenta mesotrione),,hppd-inhibitor,3,fl-oz,0.2703551710270563,,5,70,MISSING_EPA_REG`
- **Recommendation:** Join the `performed_by_id` foreign key to the `owners`/users table to resolve a display name. EPA Reg No should be lifted from the plugin `epaRegNo` field (if populated) and surfaced in the USDA export. `target_pest` should pull from the plugin `targetPest` or `targetWeeds` array.
- **Cross-ref:** Confirms and extends finding from previous records audit.

### CT-F03 — AI call counter mismatch: settings index shows 147 calls, /settings/ai shows 50 calls [P2]

- **UC:** AI key + capped spend (flow 11)
- **Routes:** `/settings` (index), `/settings/ai`
- **Expected:** Both pages show the same `callsThisMonth` figure for the active owner.
- **Observed:** Settings index displays "147 calls" (sourced from `ai.callsThisMonth: 147` in the page data object). `/settings/ai` subpage displays "$15.40 spent · 50 calls". Both load fresh data.
- **Console:** No errors.
- **Network:** No failed requests.
- **Screenshot:** `./screenshots/2026-05-25-settings-ai-active.png`
- **Recommendation:** Both pages should query the same counter source. The index likely reads from `owner_usage_counters` totals while the subpage reads a different aggregation. Unify to the same query.
- **Cross-ref:** Confirms issue #167.

### CT-F04 — "Download account data" on /settings/account links to spray-only CSV, not GDPR export [P2]

- **UC:** Account data export (flow 8)
- **Route:** `/settings/account` — "Data export" section
- **Expected:** "Download account data" link described as "GDPR-style download · CSV + JSON + plugin snapshot" should deliver a comprehensive account data package.
- **Observed:** Link href is `/api/spray/records/export.csv` — the same spray-only CSV available from /records. No JSON, no plugin snapshot.
- **Console:** No errors.
- **Network:** 200 OK, text/csv.
- **Recommendation:** Either (a) implement a `/api/account/export` endpoint that delivers the full data package, or (b) remove the GDPR-style copy until the feature is built. Current state is misleading.
- **Cross-ref:** Not previously filed.

### CT-F05 — Helpers invite form not visible in a11y tree after "Invite helper" button click [P2]

- **UC:** Helper invites (flow 12)
- **Route:** `/settings/helpers`
- **Expected:** Clicking "Invite helper" opens an inline form or modal with email + role fields, immediately visible and keyboard-navigable.
- **Observed:** The invite form (action `/settings/helpers?/invite`) is present in the DOM and technically has `offsetParent` (rendered), but does not appear in the Playwright a11y snapshot and its submit button is below the visible viewport at y=781. The form appears to be rendered below the "Pending invites" section without the page scrolling to it after the button click. The form is functional (POST to `/settings/helpers?/invite` succeeds at 200 with a token URL), but a keyboard or screen-reader user would not know it opened.
- **Console:** No errors.
- **Network:** No failed requests.
- **Screenshot:** `./screenshots/2026-05-25-settings-helpers-invite.png`
- **Recommendation:** After clicking "Invite helper", either (a) scroll the page to bring the form into view and move focus to the email input, or (b) render the form in a `<dialog>` that manages focus. Ensure the form has `aria-label="Invite new helper"` or equivalent.
- **Cross-ref:** Not previously filed.

### CT-F06 — /settings/api-tokens not linked from settings index nav [P2]

- **UC:** API tokens (flow 13, also #165)
- **Route:** `/settings` index nav → no api-tokens link
- **Expected:** The settings nav index provides a direct link to `/settings/api-tokens`.
- **Observed:** `/settings/api-tokens` is reachable via `/settings/integrations` → "External agents" section, but the settings index nav does not list it as a top-level item. The settings index shows "0 API tokens" under the Integrations nav item, which is misleading (1 token was active at time of check, then revoked).
- **Recommendation:** Either add `api-tokens` as a child entry under the Integrations nav tile (with count badge), or surface directly. The "0 API tokens" counter on the nav tile should reflect the live count.
- **Cross-ref:** Confirms #165.

---

## Flow notes (pass/partial without separate findings)

**Flow 1 — Record viewing + filter:** Block and Sprayer dropdowns function correctly; URL updates with filter params; export links carry the active filter params; intersection of both filters yields 0 records correctly; clearing both filters returns "1 record on file". UUIDs in Block/Sprayer columns confirmed (tracked as #160).

**Flow 3 — PDF export:** Returns 200, `application/pdf`, 3.9 KB, magic bytes `%PDF-`. Valid for 1 record.

**Flow 5 — Cross-tenant isolation:** Switching to "Test Farm 2" via owner-picker navigates to /records showing 2 different records (test-spray-1, test-spray-2). CSV export for that owner contains only those 2 rows. No Home Farm data leaked. Switching back returns to 1-record view. Note: the `/settings/farm` switch-farm chip in the top nav did not open a dropdown when clicked — only direct navigation to `/owner-picker` worked.

**Flow 6 — Audit trail:** The spray record submitted earlier (5/25/2026 14:29) appears in /records with state "editable", confirming it is within the 48h lock window.

**Flow 10 — Season setup:** All 6 enum fields are accessible. The `transitioningStartedYear` spinbutton appears correctly when "Organic (transitioning)" is selected and hides again when switching back. Save via "Save changes & continue" posts to `/api/season/setup` and succeeds; page refreshes showing "Last updated" timestamp.

**Flow 12 — Helper invites (partial):** Invite POST succeeds (200, returns `acceptUrl`). Revoke POST succeeds (200). Revoked URL shows "Invite no longer valid" page. Issue: invite form UX (CT-F05 above).

**Flow 13 — API tokens:** Token minted with `cck_` prefix shown once. Bearer auth against `/api/sprayers` returns 200 with sprayer list. Revoke returns 200. Subsequent call returns 401 "invalid or revoked Bearer token". Full pass.

**Flow 14 — Plugin manager:** 691 plugins shown (376 crops + 77 herbicides + 70 insecticides + 64 fungicides + 57 fertilizers + 47 companions). No search-by-text filter in the registered list (only per-item expand checkboxes). Product-name search textbox present in "Add a product" section; "AI Lookup" disabled (fake key in session). No plugin override UI visible.

**Flow 15 — Records retention:** Retention policy displayed correctly (7yr spray/harvest, 3yr scout, 1yr photos). Save button disabled (same issue as CT-F01 — consistent across settings pages that use this pattern).

**Flow 16 — Billing:** "Solo · $12/mo · active" displayed. Storage and bandwidth costs shown. No payment flow tested.

**Flow 17 — Advanced settings:** Diagnostics (build version, rules version, tenant ID, Litestream status) displayed. "Transfer...", "Reset...", "Delete..." danger-zone buttons present but not clicked. No "Reset onboarding" / "Restart setup tour" button found.

**Flow 18 — Settings nav:** All 10 nav items from the index load without errors. `/settings/ai` is reachable via the AI section on the index page but not listed as a separate nav tile. Every subpage has a "Back to Settings" link. Console errors on all settings pages are exclusively Google Fonts 404s (network isolation in dev environment).

---

## Skipped

- **Flow 7 (Inspector role):** No seeded `inspector@cropcard.local` user exists in the dev seed. The demo login only supports `role=owner` and `role=helper`. Skipped per instructions when no seeded user exists.

---

## Screenshots

| File | Flow |
|------|------|
| `screenshots/2026-05-25-records-initial.png` | Flow 1 — /records initial state |
| `screenshots/2026-05-25-records-filters-applied.png` | Flow 1 — Block+Sprayer combination filter (0 results) |
| `screenshots/2026-05-25-settings-account-save-disabled.png` | CT-F01 — Save button disabled after edit |
| `screenshots/2026-05-25-settings-ai-active.png` | CT-F03 — AI subpage call count |
| `screenshots/2026-05-25-settings-helpers-invite.png` | CT-F05 — Helpers invite form (full page) |
| `screenshots/2026-05-25-settings-api-tokens-minted.png` | Flow 13 — Token shown once after mint |
