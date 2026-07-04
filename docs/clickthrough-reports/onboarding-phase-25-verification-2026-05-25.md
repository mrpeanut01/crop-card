# Clickthrough report — /onboarding Phase 25 Almanac verification — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs (dev DB, port 5173)
**Viewport:** default (1280×720 headless Chromium)
**Auth:** demo owner (role=owner, farm "Home Farm" — already onboarded)

## Summary
- Checks: 13 (all spec items + repeatability + progress persistence) | Pass: 3 | Fail: 10 | Blocked: 0
- New findings: P0=2, P1=6, P2=2

---

## Findings

### CT-OB-001 — Second owner silently created when onboarded user submits /onboarding [P0]
- **UC:** Phase 18f + repeatability requirement
- **Route:** `apps/web/src/routes/onboarding/+page.server.ts` (POST action)
- **Expected:** A fully-onboarded user navigating to `/onboarding` and submitting the form should either (a) be redirected away before the form renders, or (b) receive a guard error. The `hooks.server.ts:345` partial-session redirect only fires when `activeOwnerId` is absent; an onboarded user carries a valid `activeOwnerId` and is let through by `allowsPartialSession('/onboarding')` (line 119). The POST action has no guard that short-circuits when the session already has `activeOwnerId`.
- **Observed:** Submitting "Test Farm 2" on `/onboarding` while logged in as an existing owner created a second `owners` row, a second `helper_assignments` row, a second `owner_subscriptions` row, and a second `fields ("Home Field")` row. The owner-picker chip in the top-nav now shows both "Home Farm owner" and "Test Farm 2 owner". No warning or confirmation was shown. The `writeSession` call at line 105 of `+page.server.ts` silently switched `activeOwnerId` to the new farm.
- **Console:** No errors (the operation succeeded silently).
- **Network:** POST `/onboarding` → 303 → `/today`.
- **Screenshot:** `./screenshots/2026-05-25-onboarding-second-owner.png`
- **Recommendation:** Add a server-side guard at the top of the POST action: if `currentUser(event)?.activeOwnerId` is already set, return `fail(400, { error: 'Your farm is already set up. Visit Settings to rename it.' })`. Separately, the `load` function should redirect a fully-onboarded user away from `/onboarding` (e.g. to `/today`) so the form is never rendered.

---

### CT-OB-002 — No UI affordance to re-enter the 6-step setup wizard for an existing user [P0]
- **UC:** Repeatability requirement ("an existing user can re-enter it on demand")
- **Route:** `/settings`, `/today`
- **Expected:** The mockup's 6-step wizard should be accessible to onboarded users (e.g. a "Setup guide" link in Settings or the /today bootstrap card) without triggering a new farm creation.
- **Observed:** `/settings` contains no link to `/onboarding`, no "Setup tour", no "Restart setup" affordance. The `/today` bootstrap card (UC-20, `+page.svelte:653`) covers only 3 steps (block+planting, sprayer, calibrate) and disappears once those are done. There is no in-app path for an existing user to review or re-walk the 6-step Almanac wizard — only typing `/onboarding` in the URL bar, which triggers CT-OB-001.
- **Console:** None relevant.
- **Network:** None relevant.
- **Screenshot:** `./screenshots/2026-05-25-onboarding-initial.png`
- **Recommendation:** The Phase 25 6-step wizard should be a separate component (e.g. `/setup` or `/onboarding/guide`) that reads farm state (block count, sprayer count, calibration count, season philosophy set, etc.) and renders the step cards as done/pending without ever calling the `owners` INSERT. `/onboarding` (the "create a farm" form) and the "setup guide" are two different things that need to be decoupled.

---

### CT-OB-003 — Phase 25 Almanac 6-step wizard not built; Phase 18f single-form stub is the implementation [P1]
- **UC:** Phase 25 Almanac design `direction-almanac-onboarding.jsx`
- **Route:** `apps/web/src/routes/onboarding/+page.svelte`
- **Expected:** Two-column layout with a left "Your setup" column containing 6 step cards (status circle + 36px icon tile + serif label + detail line + per-step action button), a progress ring card (SVG donut + done/total + est. N min left), and a right column with AI offer card, Shortcuts card, and "Why these six" explainer card.
- **Observed:** A single-column narrow (max-width 32rem) form with: farm name input, location input, "Create farm →" submit button, a next-step hint paragraph (inline emoji), the AI offer card, and the footer reassurance line. The entire step-cards structure, progress ring, "Your setup" heading, Shortcuts card, and "Why these six" card are absent.
- **Console:** Font 404s only (Google Fonts offline); no app errors.
- **Network:** No failures.
- **Screenshot:** `./screenshots/2026-05-25-onboarding-initial.png`
- **Recommendation:** Build the Phase 25 wizard as a separate `/setup` route (or refactor `/onboarding` into a two-phase flow: phase A creates the farm, phase B is the 6-step guide). Each step card should derive its done/pending state from live data (block count, sprayer count, calibration count, season philosophy flag, etc.).

---

### CT-OB-004 — "FIRST-RUN SETUP" kicker missing [P1]
- **Spec:** `direction-almanac-onboarding.jsx` line 28 — `First-run setup` uppercase kicker with Sun icon.
- **Route:** `apps/web/src/routes/onboarding/+page.svelte`
- **Expected:** A small-caps/uppercase kicker above the H1 reading "FIRST-RUN SETUP" with a Sun icon.
- **Observed:** No kicker element exists. The page opens directly with `<h1 class="serif">Welcome to CropCard</h1>`.

---

### CT-OB-005 — H1 reads "Welcome to CropCard" not "Welcome, {firstName}." [P1]
- **Spec:** `direction-almanac-onboarding.jsx` line 31 — `Welcome, {ob.user.split(" ")[0]}.` using the session user's first name.
- **Route:** `apps/web/src/routes/onboarding/+page.svelte:36`
- **Expected:** Personalized greeting using the logged-in user's first name (e.g. "Welcome, Sherry.").
- **Observed:** Static "Welcome to CropCard" with no interpolation. The `load` function does return `user` from locals but `+page.svelte` does not consume it for the greeting.

---

### CT-OB-006 — Lede does not mention "six small steps" or "fifteen minutes" [P1]
- **Spec:** `direction-almanac-onboarding.jsx` lines 33–35 — "Six small steps to turn your paper field card into a working record system. About **fifteen minutes**. You can leave and come back — your progress saves automatically."
- **Route:** `apps/web/src/routes/onboarding/+page.svelte:37`
- **Expected:** Lede paragraph with "Six small steps", "fifteen minutes" (bold), and "leave and come back" save promise.
- **Observed:** Lede reads: "Tell us about your farm. You can change these later in settings." — no reference to step count, time estimate, or progress persistence.

---

### CT-OB-007 — Progress ring (SVG donut) absent [P1]
- **Spec:** `direction-almanac-onboarding.jsx` lines 39–51 — SVG donut ring showing done/total steps, farm name, and "est. N min left".
- **Route:** `apps/web/src/routes/onboarding/+page.svelte`
- **Expected:** Right-column card containing a 120×120 SVG ring, "done of total" counter, farm name label, and "est. N min left" subtitle.
- **Observed:** No SVG ring. The page contains an `<svg>` only inside the Provenance icon (a small inline badge). No progress dial structure exists.

---

### CT-OB-008 — No progress persistence; /onboarding state resets on every load [P1]
- **Spec:** "leave and come back — your progress saves automatically" (mockup line 35).
- **Route:** Schema search for `onboarding_progress` / `owner_settings.onboarding.*` in `apps/web/src/lib/db/schema.ts` and `apps/web/src/lib/server/` — found zero matches.
- **Expected:** An `onboarding_progress` table or settings key tracking which of the 6 steps is complete.
- **Observed:** No backing table or settings key for onboarding step state. The `/today` bootstrap card at `+page.svelte:653` derives step completion from live counts (hasBlock, hasPlanting, hasSprayer, hasCalibration) which is a partial implementation of the concept for 3 of the 6 steps but it lives on a different route. On `/onboarding` itself there is no derived state at all — the page always shows the blank farm-creation form.

---

### CT-OB-009 — AI offer card primary CTA reads "Add Claude key now" not "Seed a sample plan with Claude" [P2]
- **Spec:** `direction-almanac-onboarding.jsx` line 150-151 — primary button: `Seed a sample plan with Claude` (with Sprout icon).
- **Route:** `apps/web/src/routes/onboarding/+page.svelte:109`
- **Expected:** Primary CTA labeled "Seed a sample plan with Claude" linking to sample-plan seeding flow.
- **Observed:** CTA reads "Add Claude key now" linking to `/settings/ai`. This is a functional divergence — the mockup offers to pre-populate sample data using Claude, while the implementation only opens the API key settings page.

---

### CT-OB-010 — "Skip ahead — import a CSV →" dashed strip absent [P2]
- **Spec:** `direction-almanac-onboarding.jsx` lines 115–120 — dashed-border strip below the step cards with "Skip ahead and import a CSV →" link.
- **Route:** `apps/web/src/routes/onboarding/+page.svelte`
- **Expected:** Dashed-border strip with CSV import skip link below the 6 step cards.
- **Observed:** Not present. The implementation has a `next-step-hint` paragraph mentioning the Plan route but no CSV import strip.

---

### CT-OB-011 — Shortcuts card and "Why these six" card absent [P1]
- **Spec:** `direction-almanac-onboarding.jsx` lines 159–183 — right column contains a "Shortcuts" card (bulleted tips) and a cream-bg "Why these six" explainer card with a "Read the 2-min explainer" link.
- **Route:** `apps/web/src/routes/onboarding/+page.svelte`
- **Expected:** Both sidebar cards rendered in the right column.
- **Observed:** Neither card exists. The right column of the two-column layout does not exist at all — the page is single-column.

---

## Element-by-element spec checklist

| Mockup element | Status |
|---|---|
| "FIRST-RUN SETUP" kicker + Sun icon | Missing (CT-OB-004) |
| "Welcome, {firstName}." personalized H1 | Missing (CT-OB-005) |
| Lede: "six small steps / fifteen minutes / leave and come back" | Missing (CT-OB-006) |
| Progress ring SVG card (done/total + farm name + est. min) | Missing (CT-OB-007) |
| "Your setup" heading + 6 step cards (status circle / icon / label / detail / button) | Missing (CT-OB-003) |
| "Skip ahead — import a CSV →" dashed strip | Missing (CT-OB-010) |
| AI offer card (structure + Provenance badge) | Present |
| AI offer card primary CTA "Seed a sample plan with Claude" | Wrong text (CT-OB-009) |
| AI offer card ghost CTA "Skip · I'll add a key later (or never)" | Present |
| AI offer card without-key capability list | Present |
| Shortcuts card | Missing (CT-OB-011) |
| "Why these six" explainer card | Missing (CT-OB-011) |
| Lock-icon footer reassurance line | Present |

## Step plumbing (spec vs. impl)

All 6 step cards are absent (CT-OB-003). Intended routes per spec:

| Step | Mockup intent | Current status |
|---|---|---|
| 1 — Tell us about your farm | /onboarding (first form) | Exists as a standalone form (not a wizard step) |
| 2 — Pick your season philosophy | /settings/season | Route exists; not linked from /onboarding |
| 3 — Define your first block | /plan or /blocks/new | Route exists; not linked from /onboarding |
| 4 — Record what you've planted | /plan | Route exists; not linked from /onboarding |
| 5 — Register a sprayer | /equipment | Route exists; not linked from /onboarding |
| 6 — Calibrate | /calibrate | Route exists; not linked from /onboarding |

## Skipped
None — this is a targeted design-gap audit, not a UC-list walk.
