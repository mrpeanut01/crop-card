# Onboarding flow audit — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Server:** http://localhost:5173 (dev container, docker compose up)
**DB seed:** apps/web/scripts/seed-test-data.mjs (dev DB, port 5173)
**Auth paths tested:** fresh sign-in (email → /onboarding), demo owner (?/demo role=owner), invite acceptance
**Prior structural audit:** `docs/clickthrough-reports/onboarding-phase-25-verification-2026-05-25.md` (epic #107)

---

## Coverage matrix

| Flow | Description | Result |
|---|---|---|
| 1 | Fresh signup → onboarding → /today | Partial — /today renders but bootstrap card hidden |
| 2 | Bootstrap step 1 — block + planting | Pass (with workaround: details must be expanded first) |
| 3 | Bootstrap step 2 — register sprayer | Pass (Equipment page works) |
| 4 | Bootstrap step 3 — calibrate | Blocked (step auto-passes due to GPA default — see F-02) |
| 5 | Bootstrap complete state | Partial — card disappears but was hidden in collapsed details |
| 6 | AI offer card path | Pass |
| 7 | Invite acceptance flow | Pass |
| 8 | Mid-flow interruption / refresh | Pass |
| 9 | Partial-bootstrap interruption (sign out + back) | Pass |
| 10 | Superadmin onboarding | Blocked — no superadmin user seeded |
| 11 | Owner-picker (multi-owner) | Pass |

**Summary — Flows: 11 | Pass: 6 | Partial: 2 | Blocked: 2 | Fail: 0**
**New findings: P1=2, P2=1 (not already in #107)**

---

## Findings

### F-01 — Bootstrap card (UC-20 "Get started") rendered inside collapsed `<details>`, invisible to fresh users [P1]

- **Flow:** 1, 2, 3, 4, 5
- **Route:** `apps/web/src/routes/today/+page.svelte` line ~653
- **Expected (UC-20):** The "Get started" bootstrap card with three steps (block+planting, sprayer, calibrate) should be prominently visible to a freshly-onboarded user with no data. It is the primary CTA for a new user on /today.
- **Observed:** The entire bootstrap card (`{#if !data.bootstrapDone}…Card…{/if}`) is located inside `<details class="legacy-detail">` (the "Full schedule view — tasks · calendar · sprayers · kernel info" disclosure widget). The disclosure renders closed by default. A fresh user landing on /today sees Quick Actions, the week strip, the AI Recommendations card, and the Season-at-a-Glance — but NOT the bootstrap card. The card only appears when the user manually expands the disclosure. The a11y snapshot confirms the `button "Open Plan →"` exists in the DOM but is not reachable from the page's visible content.
- **Console:** No errors related to this issue.
- **Network:** No failures.
- **Screenshot:** `./screenshots/2026-05-25-flow1-bootstrap-card-missing.png` (full-page; no "Get started" visible), `./screenshots/2026-05-25-flow1-bootstrap-card-inside-details.png` (after manually expanding).
- **Recommendation:** Move the `{#if !data.bootstrapDone}…{/if}` block outside the `<details>` element to appear in the main content flow, above the Quick Actions card. The Phase 25 Almanac design puts it at the top of the right column; even placing it in the scrollable main content above the week strip would restore correct priority. The `<details>` wrapper is the "legacy plan editor" that should not contain onboarding UI.
- **Cross-ref:** Related to CT-OB-003 from #107 (6-step wizard not built); but this is a separate, actionable bug in the current 3-step implementation.

---

### F-02 — Bootstrap step 3 (calibrate) auto-completes for every new sprayer; calibration wizard never required [P1]

- **Flow:** 3, 4, 5
- **Route:** `apps/web/src/lib/db/sprayers.ts:28` + `apps/web/src/routes/today/+page.server.ts:114`
- **Expected:** Step 3 ("Calibrate the sprayer") should show ✓ only after the user has actually walked the UC-10 1/128-acre calibration wizard and a non-null `calibratedGpa` is stored. The bootstrap check at `+page.server.ts:114` reads: `sprayers.some((s) => (s.calibratedGpa ?? 0) > 0)`.
- **Observed:** `sprayers.ts:28` returns `calibratedGpa: eq.state.calibratedGpa ?? 15` — any sprayer that has never been calibrated reports a GPA of 15 (the fallback). Since `15 > 0`, the `hasCalibration` check passes for every freshly-added sprayer. Adding a sprayer via `/equipment` immediately makes `bootstrapDone = true` (all three: hasBlock + hasPlanting + hasSprayer + hasCalibration), causing the bootstrap card to vanish. The user never needs to open `/calibrate`.
- **Evidence:** After adding "Backpack Sprayer 4gal" via `/equipment`, `/api/sprayers` returned `calibratedGpa: 15`. The bootstrap card disappeared on the next `/today` load without the user visiting `/calibrate`.
- **Console:** None.
- **Network:** None.
- **Recommendation:** The `hasCalibration` check should test `sprayers.some((s) => s.calibratedGpa !== null && s.calibratedGpa !== undefined)` rather than `> 0`. A sprayer that has never been calibrated should have `calibratedGpa: null` in `sprayers.ts:28` (i.e., `eq.state.calibratedGpa ?? null`, not `?? 15`). The 15 GPA default in `toSprayer()` makes sense as a runtime dilution-math fallback but should not satisfy the bootstrap prerequisite. Alternatively, keep the `?? 15` default and move the check to a separate `hasCalibratedSprayer` flag that tests `eq.state.calibratedGpa !== null`.
- **Cross-ref:** `apps/web/src/lib/db/sprayers.ts` line 28, `apps/web/src/routes/today/+page.server.ts` line 114.

---

### F-03 — No superadmin user seeded in dev environment; Flow 10 (superadmin onboarding path) untestable [P2]

- **Flow:** 10
- **Route:** `apps/web/scripts/seed-test-data.mjs`
- **Expected:** A `superadmin@cropcard.local` user (or equivalent) with `is_superadmin = 1` should exist in the dev DB so the superadmin routing path (`/admin/owners`) can be verified. This is especially important given the Phase 18g superadmin audit trail feature.
- **Observed:** `SELECT email, is_superadmin FROM users WHERE is_superadmin = 1` returns zero rows in `/data/cropcard.db`. No seed script creates a superadmin user. The `/admin/owners` route cannot be reached and the hooks routing for superadmin users (which may skip onboarding entirely and land on `/admin/owners`) is untestable.
- **Recommendation:** Add `INSERT INTO users (id, email, is_superadmin) VALUES ('user_superadmin', 'superadmin@cropcard.local', 1)` (and a matching helper_assignment or no assignment — to verify the "skip onboarding" path) to `seed-test-data.mjs`. This would also enable the impersonation flow to be walk-tested.

---

## Flows that passed

**Flow 1 (partial):** Fresh email → Continue → /onboarding (renders "Welcome to CropCard" form) → fill "Test Flow Farm" + "Loudoun County, VA" → Create farm → 303 → /today. The page renders without errors. The owner-chip in the top nav shows "Test Flow Farm". No crash with zero blocks/plantings. The bootstrap card exists in the DOM but is hidden inside the collapsed `<details>` (F-01). `/api/sprayers` correctly returns empty.

**Flow 6:** "Add Claude key now" → /settings/ai (correct). "Skip · I'll add a key later (or never)" → /today (correct). On /today without an AI key, the Recommendations card renders with a `Fallback · AI off — using plugin order` provenance chip and an aria-label of "AI key not set — listed in plugin-default order". The "AI assists, never gates" invariant is satisfied.

**Flow 7 — Invite acceptance:** Demo owner (Home Farm) issues invite for `flow-helper-2026-05-25@example.com`. Server logs the invite URL. New user navigates to `/invite/[token]` → redirected to `/?invite=[token]` with a status message "You've been invited to a farm — sign in to accept." → signs in → redirected to `/invite/[token]` → acceptance page shows "Join Home Farm · helper role" → "Accept invite →" → /today as helper of Home Farm. No /onboarding redirect. Farm context is correct (Home Farm chip).

**Flow 8 — Mid-flow refresh:** Fresh user lands on /onboarding, types farm name, refreshes. Form resets to empty (no localStorage persistence). No partial `owners` row written (submission never fired). Correct behavior.

**Flow 9 — Partial bootstrap persistence:** User with no blocks/sprayers signs out and back in. Bootstrap card (once expanded from the collapsed `<details>`) still shows steps 1/2/3 as incomplete. State is correctly derived from live DB counts, not a flag.

**Flow 11 — Owner-picker:** Demo owner with two farm assignments (`Home Farm` + `Test Farm 2`) lands on `/owner-picker` with the two farm buttons. Clicking "Home Farm owner" routes to /today with the correct farm context.

---

## Skipped (already in #107 or out of scope)

- Phase 25 6-step wizard UI drift — covered by CT-OB-003/004/005/006/007/008/010/011 in #107.
- /hay routes — Sprint E WIP per scope instruction.
- UC-10 calibration wizard deep-walk — F-02 reveals the bootstrap step never requires it; a separate UC-10 report covers the wizard internals.
