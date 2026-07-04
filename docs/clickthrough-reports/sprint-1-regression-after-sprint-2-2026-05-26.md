# Sprint 1 regression sign-off — post-Sprint-2 merge — 2026-05-26

**Tester:** playwright-clickthrough subagent
**Build:** e5f8455 (main, post-Sprint-2 merge)
**Dev server:** http://localhost:5173 (crop-card-web-1 Docker container)
**Auth:** owner@cropcard.local (demo owner), superadmin@cropcard.local (for #221/#108)
**Goal:** confirm Sprint 2 changes to `/records`, settings, unified records loader, and `SettingsShell` did not regress any of the 8 Sprint 1 fixes from PR #247.

---

## Summary

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| #170 | AllocationWizard visible on "Open wizard" click | PASS | Dialog renders in a11y tree outside legacy `<details>` |
| #184 | /api/plan/allocate fallback on over-cap | PASS | `guardFallbackReason` path confirmed; no 402 for AI degradation |
| #208 | /api/plan/allocate/refine preserves other assignments | PASS | Substitution-only invariant at line 558 of `aiAllocation.ts` intact |
| #209 | AI narrative coherence on fallback | PASS | `{#if response.meta.fallback}` guard confirmed in wizard render |
| #189 | /today "Get started" bootstrap card visible | PASS | Card at line 386, `<details>` starts at line 461 — definitively outside |
| #190 | Bootstrap step 3 not auto-completing with GPA=15 | PASS | `calibratedGpa: eq.state.calibratedGpa ?? null` — no `?? 15` default |
| #221 | Exit impersonation POST works | PASS | Form POST confirmed; audit row written; banner dismissed end-to-end |
| #108 | /onboarding redirects existing users | PASS | `/onboarding` → 303 → `/today` for already-onboarded user |

**New regressions found: 0**

---

## Per-issue verification notes

### #170 — AllocationWizard visible when "Open wizard" clicked

- **Route:** `/plan`
- **Method:** browser click on "Open wizard" button; a11y snapshot after click.
- **Expected:** `dialog` role appears in the a11y tree with wizard step list and heading.
- **Observed:** `dialog [ref=e471]` with `list "Wizard steps" [ref=e481]` and `heading "You have a plan in place"` visible. The `AllocationWizard` `{#if showAllocationWizard}` block at line 4732 of `plan/+page.svelte` is outside the `<details class="legacy-detail">` (line 2427). Comment at line 4727 explicitly documents the fix.
- **Screenshot:** `./screenshots/2026-05-26-sprint1-reg-170-wizard-open.png`
- **Verdict:** No regression.

### #184 — /api/plan/allocate fallback on over-cap (Invariant 7)

- **Endpoint:** `POST /api/plan/allocate`
- **Method:** source code inspection of `apps/web/src/routes/api/plan/allocate/+server.ts`.
- **Expected:** `checkGuard()` result stored in `guardFallbackReason`; if non-null, `allocateDeterministic()` called and result tagged with `meta.fallback`; endpoint never returns 402 for AI degradation.
- **Observed:** Lines 42-48 set `guardFallbackReason` from the guard outcome; lines 136-149 call `allocateDeterministic()` with the fallback reason and return with `meta.fallback` and `meta.fallbackReason` set. `aiAllocation.ts` line ~177 separately handles `!apiKey` → `engineFallback(input, matrix, 'no-api-key')`. The `402` path was the pre-fix behavior; it is no longer present.
- **Verdict:** No regression.

### #208 — /api/plan/allocate/refine preserves other assignments

- **Endpoint:** `POST /api/plan/allocate/refine`
- **Method:** source code inspection of `apps/web/src/lib/server/aiAllocation.ts`.
- **Expected:** When the AI drops assignments from the prior plan, the endpoint echoes the prior plan back with a warning message (substitution-only invariant).
- **Observed:** Lines 558-591 in `aiAllocation.ts` compare `priorKeys` vs `refinedKeys`; any `droppedKeys` triggers `echoPreviousPlan()` with `meta.fallback = 'engine-only'`. Comment explicitly cites `#208 / CT-PP-008`.
- **Verdict:** No regression.

### #209 — AI narrative coherence on fallback

- **Surface:** AllocationWizard chat panel (`AllocationWizard.svelte`).
- **Method:** source code inspection of `apps/web/src/lib/components/AllocationWizard.svelte`.
- **Expected:** When `meta.fallback` is set, the AI narrative is replaced by a deterministic explanation; no AI text that could contradict the table is shown.
- **Observed:** Lines 2072-2078: `{#if response.meta.fallback}` renders `response.rationale || 'Deterministic engine plan — see the "Why" column for per-row reasoning.'` in place of the standard `{:else}` branch. Comment cites `#209 / CT-PP-007`.
- **Verdict:** No regression.

### #189 — /today "Get started" bootstrap card visible

- **Route:** `/today`
- **Method:** source code line number audit of `apps/web/src/routes/today/+page.svelte`.
- **Expected:** `{#if !data.bootstrapDone}` card block is outside the legacy `<details>` element.
- **Observed:** Bootstrap card block starts at line 386; legacy `<details class="legacy-detail">` starts at line 461. The card is 75 lines above the `<details>`, definitively outside it. Comment at line 382 explicitly cites `#189 / F-01`.
- **Note:** The demo owner's `bootstrapDone` is `true` (has calibrated sprayers + blocks + plantings), so the card is not rendered on the demo tenant. The fix is structural, not data-dependent.
- **Verdict:** No regression.

### #190 — Bootstrap step 3 not auto-completing with GPA=15

- **File:** `apps/web/src/lib/db/sprayers.ts`
- **Method:** source code inspection + DB query.
- **Expected:** `calibratedGpa` returns `null` for uncalibrated sprayers (not `?? 15` default).
- **Observed:** Line 33: `calibratedGpa: eq.state.calibratedGpa ?? null`. DB query on `home-farm` shows: `Tractor 3pt 12v Boom Sprayer|22`, `Corn-dedicated sprayer|18`, `Pumpkin/bean-dedicated sprayer|15`, `Test Backpack Sprayer|` (null). The Test Backpack Sprayer correctly has no calibration value. The `hasCalibration` check in `today/+page.server.ts` line 118 uses `calibratedGpa != null && calibratedGpa > 0`.
- **Verdict:** No regression.

### #221 — Exit impersonation POST works

- **Flow:** superadmin@cropcard.local → `/admin/owners` → Impersonate "Home Farm" → "Exit impersonation" button.
- **Method:** browser interaction + DOM inspection + DB audit.
- **Expected:** "Exit impersonation" is a `type="submit"` button in a `<form method="POST" action="/admin/owners?/exitImpersonation">`; session reverts; `superadmin_audit` row written.
- **Observed:**
  - `formAction: "/admin/owners?/exitImpersonation"`, `formMethod: "POST"`, `buttonType: "submit"`, `inForm: true` — confirmed via `browser_evaluate`.
  - After click: page redirected to `/admin/owners`; impersonation banner absent from a11y tree.
  - DB query: `exit_impersonation|user_superadmin` row present as the most recent audit entry.
  - Source: `+layout.svelte` lines 92-108 contain the form with `action="/admin/owners?/exitImpersonation"` and comment citing `#221`.
- **Screenshot:** `./screenshots/2026-05-26-sprint1-reg-221-exit-impersonation.png` (taken post-exit, showing clean admin page).
- **Verdict:** No regression.

### #108 — /onboarding redirects existing users

- **Route:** `/onboarding` navigated to as `superadmin@cropcard.local` (who has an existing `owners` row).
- **Method:** browser navigation; observe URL after page load.
- **Expected:** Server-side `load()` in `onboarding/+page.server.ts` detects `user.activeOwnerId` is set and throws `redirect(303, '/today')`.
- **Observed:** Navigating to `http://localhost:5173/onboarding` resulted in `page.url === 'http://localhost:5173/today'` — the 303 redirect fired.
- **Source:** `onboarding/+page.server.ts` line 20: `if (locals.user?.activeOwnerId) throw redirect(303, '/today')`.
- **Verdict:** No regression.

---

## Console errors observed

All 7 console errors across the session were Google Fonts CDN 404s (`fonts.gstatic.com/s/ibmplex*/...woff2`). These are pre-existing infrastructure noise from the offline dev environment with no network access to Google CDN. No app-code errors were observed.

## Conclusion

All 8 Sprint 1 fixes from PR #247 remain intact in commit `e5f8455`. Sprint 2's changes to `/records`, settings, the unified records loader, and `SettingsShell` introduced no regressions against any of the tested invariants.
