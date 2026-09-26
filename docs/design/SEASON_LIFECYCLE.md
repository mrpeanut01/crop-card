# CropCard — Season Lifecycle Specification

**Date:** 2026-07-04

> **Status (2026-09-24):** Remediated. Every gap in this audit was closed in Phase 28 (PRs #358–#376, epics #299–307), and UC-44..47 have shipped. The "works / drifts / missing" statuses below are the audit-time snapshot — see `docs/use-cases.md` and the Phase 28 entry in `CLAUDE.md` for current state.

**Purpose:** normative desired-outcome narrative of one full farm year, stages S1–S8, produced by the season-lifecycle audit. Companion artifacts: clickthrough reports under `docs/clickthrough-reports/` dated 2026-07-04, the GH stage epics, and UC-44..47 in `docs/use-cases.md`.

**Reading guide:** each stage follows the same shape — a *Desired outcome* narrative (what the operator should experience), a *Surface & UC map* tying each capability to its route/UC with a works / drifts / missing status and file:line evidence, *Playtest assertions* (numbered `S<n>-A<m>` so clickthrough reports can cite them), and *Gaps & drift hypotheses* (numbered `S<n>-G<m>` so playtest waves and GH issues can cite them).

## Stage index

| Stage | Scope |
|---|---|
| [S1 — Genesis & farm setup](#s1--genesis--farm-setup) | First contact → sign-in, onboarding wizard, helper invites, farm identity, billing gate, superadmin routing |
| [S2 — Pre-season planning](#s2--pre-season-planning) | Season philosophy setup (UC-42) + 7-step allocation wizard → committed, dated planting plan + inputs tasks + shopping list |
| [S3 — Pre-season stocking & equipment readiness](#s3--pre-season-stocking--equipment-readiness) | Fill the digital shed: inventory add methods, canonical form, sprayer registration + UC-10 calibration, soil-test baseline |
| [S4 — In-season daily operations](#s4--in-season-daily-operations) | The morning `/today` loop: priority action, skip-with-reason, scouting (FR-07), alerts, offline queue hygiene |
| [S5 — In-season spray operations](#s5--in-season-spray-operations) | Safety-critical core: plan → kernel check → apply → record → decon; dual UI/server enforcement, 48h lock, stock decrement |
| [S6 — In-season harvest & forage](#s6--in-season-harvest--forage) | Archetype-aware harvest recording, moisture kernel (Phase 26A), curing countdown, hay diary (UC-13/14), PHI |
| [S7 — Post-season compliance & exports](#s7--post-season-compliance--exports) | The audit binder: unified `/records` ledger, VDACS/USDA exports, retention, inspector read-only access (UC-22) |
| [S8 — Post-season close-out & winterization](#s8--post-season-close-out--winterization) | Mostly unbuilt: season close (UC-44), equipment winterization (UC-45), year-end summary (UC-46), rotation-aware carry-forward (UC-47) |

---

## S1 — Genesis & farm setup

### Desired outcome

A brand-new farmer's first contact is the public landing at `/`: marketing copy above a single email sign-in form, with a collapsible "Try the demo" panel offering one-tap entry as Owner, Helper, Inspector, or Custom operator. There is no password — email is the identity (magic-link is the eventual transport; today the form signs in directly). Legacy `/signin` bookmarks and emailed invite links 307-redirect to `/`, preserving any `?invite=<token>` parameter.

Submitting an email routes by what the server knows about that user: zero `helper_assignments` → `/onboarding`; exactly one → `/today` with that Owner bound; multiple → `/owner-picker`; superadmin with zero assignments → `/admin/owners`. The session is an HMAC cookie carrying `activeOwnerId` + `activeRole`; every route except a tight anonymous allowlist funnels through this gate in `hooks.server.ts`.

**Onboarding (UC-20)** must establish "first farm context" in under a minute. Pre-farm, `/onboarding` shows only the farm-creation form (farm name + optional location). Submission atomically creates the `owners` row (trial billing), an owner-role `helper_assignments` row, a free/trial `owner_subscriptions` row, and seeds a "Home Field", then re-mints the cookie with the new tenant bound. The user stays on `/onboarding`, which now renders the re-entrant 6-step wizard (Farm ✓ · Season · Block · Sprayer · Calibration · Planting) with a progress donut, personalized greeting (first name inferred from email), an AI offer card ("Seed a sample plan with Claude" — explicitly optional; the no-key path is first-class), and a skip strip. Step completion derives from live DB state, so progress ticks as work happens on other pages, with no separate progress store. A defence-in-depth POST guard rejects duplicate farm creation from a stale tab.

**Helper provisioning (UC-21):** the Owner opens `/settings/helpers`, enters an email and role (helper / inspector / custom-operator), and the server mints a single-use invite token (SHA-256 hashed at rest, expiring). The accept URL is emailed (stdout stub by default; Postmark behind `EMAIL_TRANSPORT=postmark`) *and* echoed back in the UI so the Owner can share it out-of-band. The invitee opens `/invite/[token]`: unauthenticated users bounce to `/?invite=<token>`, sign in, and round-trip back; the invite only redeems when the signed-in email matches the invited email. Acceptance creates the assignment, marks the invite used, re-mints the session bound to the inviting Owner, and lands on `/today` with the helper role badge visible. Owners can revoke pending invites and remove members (never themselves).

**Farm identity:** `/settings/farm` (owner-only) shows farm name, location, lat/lon, frost dates, and a read-only block-map preview with a link to the full geometry editor at `/settings/farm/map` (owner-only; helpers get 403 by design — geometry is not inventory). `/settings/account` shows the identity card (email, role, active Owner, member-since) for every role; email changes are refused pending a magic-link confirmation flow.

**Billing gate:** a suspended tenant is redirected to `/suspended` on every navigation except `/admin`, `/settings/billing`, `/suspended`, and `/signout`, and the page offers "Manage billing →" (allowlisted for self-remediation) plus a support mailto.

**Superadmin first login** skips farming entirely: zero assignments + `is_superadmin` routes to `/admin/owners` rather than `/onboarding`.

### Surface & UC map

| Capability | Route | UC/FR | Status | Evidence |
|---|---|---|---|---|
| Public landing + email sign-in + 4-role demo grid | `/` | UC-17 | works | `routes/+page.server.ts:16-78`, `+page.svelte:10-14,163-221` |
| Legacy signin redirect w/ invite threading | `/signin` | UC-17 | works | `routes/signin/+page.server.ts:10-14` |
| Post-login routing (onboarding/picker/today/admin) | `hooks.server.ts` | UC-17/20 | works | `hooks.server.ts:275-280,345-354`; `lib/server/auth.ts:93-197` |
| Farm creation (owners + assignment + subscription + Home Field) | `/onboarding` POST | UC-20 | works | `routes/onboarding/+page.server.ts:95-181` |
| Re-entrant 6-step wizard w/ live progress | `/onboarding` | UC-20 | works | `routes/onboarding/+page.server.ts:42-70`, `+page.svelte:38-110` |
| Duplicate-farm POST guard | `/onboarding` POST | UC-20 | drifts | `+page.server.ts:105-110` — error copy points to `/setup`, which 404s |
| AI offer / no-key first-class skip | `/onboarding` | Invariant 7 | drifts | `+page.svelte:299-303` — CTA links to `/settings/ai`; no seed flow exists |
| CSV-import skip strip | `/onboarding` | UC-20 | drifts | `+page.svelte:263-268` — links to `/today`; no CSV import surface |
| Multi-Owner picker + re-mint | `/owner-picker` | Phase 18c | works | `routes/owner-picker/+page.server.ts:16-67` |
| Invite issue / revoke / remove | `/settings/helpers` | UC-21 | works | `routes/settings/helpers/+page.server.ts:41-96` |
| Invite redemption + auth round-trip | `/invite/[token]` | UC-21 | works | `routes/invite/[token]/+page.server.ts:20-77` |
| Invite email transport | `lib/server/email.ts` | UC-21/B-03 | works | stdout default; Postmark behind env (Sprint 21) |
| Farm identity card + name save | `/settings/farm` | UC-20 | drifts | `+page.server.ts:64-79` saves name only; `+page.svelte:49-66` location/zone/lat-lon/frost inputs are unwired mock data |
| Field/block geometry editor | `/settings/farm/map` | Phase 27 | works | `routes/settings/farm/map/+page.server.ts:13-25` (owner-only) |
| Account identity card | `/settings/account` | UC-17 | works | `routes/settings/account/+page.server.ts:21-75` |
| Suspended billing gate + self-remediation | `/suspended` | Phase 18g/#224 | works | `hooks.server.ts:282-294`; `routes/suspended/+page.svelte:9-12` |
| Superadmin zero-assignment routing | `/` → `/admin/owners` | #222 | drifts | `routes/+page.server.ts:42-53` `nextForLogin` lacks the `'admin'` arm (falls to `/today`; hooks re-bounce heals it — extra hop) |
| Bulk field entry, acreage hints, sidebar nav | `/plan`, layout | UC-26/27/28 | missing | proposed-only in `docs/use-cases.md:350-448` |

### Playtest assertions

- **S1-A1** — `/` unauthenticated → renders marketing hero + "Sign in" form + collapsed "Try the demo" `<details>`; no app chrome (no nav tabs, no owner chip).
- **S1-A2** — `/signin` unauthenticated → 307 to `/`; `/signin?invite=abc123` → 307 to `/?invite=abc123` and the page shows the "You've been invited to a farm" banner.
- **S1-A3** — `/today` unauthenticated → 303 redirect to `/`; `GET /api/blocks` without a cookie → 401 JSON (`{"error":"authentication required"}`), not a redirect.
- **S1-A4** — Sign in with a brand-new email (e.g. `sherry.miller@example.com`) → lands on `/onboarding` showing only the farm-creation form (no 6-step wizard yet), H1 personalized "Sherry".
- **S1-A5** — Submit farm name "Hilltop Farm" + location → stays on `/onboarding`, now rendering the 6-step wizard with step 1 (farm) ticked, progress donut ≈17%, and the top-nav Owner chip reading "Hilltop Farm".
- **S1-A6** — After farm creation, re-POST the same onboarding form (stale-tab simulation, e.g. via fetch) → 400 failure, no duplicate `owners` row, Owner chip unchanged. Note the error copy references `/setup` — verify that path 404s (expected drift).
- **S1-A7** — Wizard step links resolve: Season → `/settings/season`, Block → `/settings/farm/map`, Sprayer → `/inventory/sprayer/add`, Calibration → `/calibrate`, Planting → `/plan` — each loads without error for the new owner.
- **S1-A8** — Complete a step elsewhere (create a block at `/settings/farm/map`), return to `/onboarding` → that step shows done without any explicit "mark complete" action; donut % increases.
- **S1-A9** — **No-AI-key path:** with no Anthropic key configured, `/onboarding` still renders fully; the AI offer card's "Skip · I'll add a key later (or never)" link goes to `/today` and nothing on the wizard is gated on AI. "Seed a sample plan with Claude" navigates to `/settings/ai` (verify: does any sample-seeding actually occur there? expected: no — key-management page only).
- **S1-A10** — As the new owner, open `/settings/helpers` → members list shows exactly one active owner (self); invite form accepts email + role select with helper/inspector/custom-operator options.
- **S1-A11** — Issue an invite for `marco@example.com` (role helper) → success panel echoes the accept URL (`/invite/<token>`); the pending invite appears in the list with an expiry; server stdout logs the invite email (default transport).
- **S1-A12** — Open the accept URL in a fresh session (no cookie) → bounced to `/?invite=<token>` with the invite banner; sign in as `marco@example.com` → returned to `/invite/<token>` showing farm name + role confirmation; Accept → lands on `/today` with a Helper role badge.
- **S1-A13** — Open the same accept URL signed in as a *different* email → page shows the invalid/expired state, no assignment created.
- **S1-A14** — Re-open the already-redeemed token → invalid state (single-use enforced).
- **S1-A15** — Owner revokes a pending invite → it leaves the pending list; its URL now shows invalid. Owner "remove" on their own row → 400 "cannot remove yourself".
- **S1-A16** — **Helper role:** signed in as the helper, `/settings/helpers` → 403 (owner-only); `/settings/farm` → 403; `/settings/farm/map` → 403; but `/inventory` and `/inventory/sprayer/…` detail views render (Invariant 8 read access); `/settings/account` renders the helper's identity card with role "helper".
- **S1-A17** — **Inspector role:** demo-sign-in as Inspector → any `POST /api/**` returns 403 `{"error":"inspector role is read-only"}`; page views still render.
- **S1-A18** — Helper accepts an invite from a *second* Owner, signs out, signs back in → lands on `/owner-picker` listing both farms with role labels; picking one → `/today` with that Owner chip; visiting `/` while partially signed-in → redirected to `/owner-picker`, never the marketing page.
- **S1-A19** — `/owner-picker` POST with an ownerId the user has no assignment to (forged form) → 403 "no assignment to that Owner".
- **S1-A20** — **Suspended gate:** set the demo owner's `billing_status='suspended'` (via `/admin/owners` as superadmin) → owner's next navigation to `/today` 303s to `/suspended`; the styled card renders with "Manage billing →" → `/settings/billing` loads (allowlisted); `/signout` still works; after re-activation `/today` loads again.
- **S1-A21** — **Superadmin first login:** sign in as the seeded `user_superadmin` (zero assignments) → ends at `/admin/owners`, not `/onboarding`. Verify redirect chain (may hop through `/today` per the `nextForLogin` drift).
- **S1-A22** — `/settings/farm` as owner: edit farm name + Save → persists (reflected in Owner chip after reload); edit the lat/lon or frost-date inputs and Save → values do NOT persist (unwired inputs — expected drift, confirm).
- **S1-A23** — `/settings/account`: submit a changed email → 400 with the magic-link explanation message; submitting unchanged → ok.
- **S1-A24** — Demo grid: each of the 4 role cards signs in with one tap and lands on a working surface (`/today` or `/onboarding` on a fresh DB); no dead-ends.

### Gaps & drift hypotheses

- **S1-G1 — `/setup` 404 in duplicate-farm error copy** — `routes/onboarding/+page.server.ts:108` tells the user to "open the Setup guide from /setup"; no `routes/setup/` exists (route listing). Should say `/onboarding`.
- **S1-G2 — "Seed a sample plan with Claude" doesn't seed anything** — `routes/onboarding/+page.svelte:300` links to `/settings/ai` (key management). The mockup's promise (mock blocks, scout history, starter plan) has no backing action; either the CTA copy overstates or the seed flow is unbuilt.
- **S1-G3 — CSV-import skip strip is a decoy** — `routes/onboarding/+page.svelte:264` `href="/today"` labelled "Skip ahead and import a CSV →"; no CSV *import* surface exists anywhere (exports only). Mockup artifact.
- **S1-G4 — /settings/farm mock inputs** — `+page.svelte:49` location input hardcodes `value="Loudoun, VA"` (not loaded from data); `:52` zone select (7a/7b) unwired; `:56-66` lat/lon + frost inputs have no `name` attrs so Save persists only `farmName` (`+page.server.ts:70-77`). Loader comment (`:6-8`) says lat/lon edits "stay in /settings/system" — but Sprint 14 deleted `/settings/system` (308 → `/settings/ai`), so **farm lat/lon + frost dates have no owner-facing edit surface at all** (writes only via `PUT /api/settings`). Frost/GDD-dependent scheduling silently uses defaults for any farm outside Loudoun.
- **S1-G5 — `nextForLogin` missing the `'admin'` arm** — `routes/+page.server.ts:44-52` switch handles onboarding/picker/today but `LoginResult.next` also emits `'admin'` (`lib/server/auth.ts:95,141`); superadmin login falls to `/today`, then relies on the hooks partial-session bounce (`hooks.server.ts:345-354`) to reach `/admin/owners`. Works via double redirect; the existing `redirectFromLogin()` helper (`auth.ts:190-197`) already handles all four arms and isn't used here.
- **S1-G6 — Invite for an email that mistypes case/alias silently invalid** — `routes/invite/[token]/+page.server.ts:28` matches `(token, user.email)` exactly; the invalid-state page (`status:'invalid'`) gives no hint that the mismatch is the signed-in email. Playtest S1-A13 confirms behavior; UX gap worth a hint line.
- **S1-G7 — Demo Helper on a fresh DB becomes a farm owner** — `loginByEmail` with zero assignments routes any role, including demo `helper@cropcard.local`, to `/onboarding` (`auth.ts:141`), where completing the form mints them an owner-role assignment. Harmless in seeded dev, confusing on an empty DB.
- **S1-G8 — UC-26/27/28 remain proposed** — no sidebar nav / identity strip / footer, no bulk field entry, no acreage hints (`docs/use-cases.md:350-448`); first-run field setup is still one-at-a-time.

---

## S2 — Pre-season planning

**Window:** late winter → last-frost minus ~6 weeks. Entry state: onboarding complete (S1), ≥1 block, seed stock received or being received. Exit state: a committed, dated planting plan with philosophy-compliant input tasks and a shopping list.

### Desired outcome

The operator answers six season-philosophy questions once per year (UC-42), then walks a single 7-step wizard (`season-setup → seeds → blocks → review → schedule → inputs → commit`, `AllocationWizard.svelte:176-184`) that turns seed inventory into dated plantings on blocks plus a season of pre-scheduled input tasks. Every step completes with **no Anthropic key** — the deterministic engine (`lib/layout/engine.ts`), the plant-at-earliest scheduler, and the pure `lib/plan/inputsPlan.ts` planner are the source of truth; AI is a refinement layer gated by `aiTry()` and validators, never a gate itself (Invariant 7). Committed plantings carry `sourceProvenance: 'ai' | 'fallback'` so the audit trail records how the plan was produced. Supporting surfaces: plugin authoring/upload (UC-08) feeds the crop catalog; `/crops` (UC-29) shows the resulting planned rows; the planter-plate tool (UC-41) is opt-in niche tooling.

### Surface & UC map

| Capability | Route | UC/FR | Status | Evidence |
|---|---|---|---|---|
| Season setup form (6 enums + conditional transitioning year) | `/settings/season` | UC-42 | works | `routes/settings/season/+page.server.ts:7-17`; `lib/season/setup.ts` |
| Carry-forward last year's answers | `/settings/season`, wizard step 0 | UC-42 | works | `routes/api/season/setup/carry-forward/` exists; loader returns `lastYearSetup` |
| Wizard gates on missing season setup | `/plan` → AllocationWizard step 0 | UC-42 | works | `AllocationWizard.svelte:157-164` (`if (!activeSetup) return 'season-setup'`) |
| Plan-state chooser (continue vs start over) | wizard `plan-state` gate | UC-37 follow-up | works | `AllocationWizard.svelte:149-167` |
| Plan v2 shell (rail, block header, plantings grid, Gantt, tasks) | `/plan` | UC-01, UC-36 | drifts | #119 (epic), #120 step buttons disabled, #121 PlantingCard metadata, #122 "+ Task" unwired, #123 geometry badge — all OPEN |
| Deterministic seed-to-block engine + preview | `/plan` rail, `POST /api/crops/plan` | UC-36 | works | `lib/layout/engine.ts`; UC map row 874 |
| AI allocation wizard steps 1–3 (Seeds/Blocks/Review) | `/plan` → wizard | UC-37 | works | `AllocationWizard.svelte:133-141`; `POST /api/plan/allocate` |
| Cross-pollination advisor + must-stagger carry-through | wizard Review → Schedule | UC-37 (Phase 19) | works | `lib/plan/pollinationLayer.ts`; geometry-missing banner `AllocationWizard.svelte:2262-2269` |
| Chat refinement (allocate/schedule/inputs) with no-key degrade | wizard steps 3–5 | UC-37b | works | `AllocationWizard.svelte:1720-1750` — off-state header links Settings → AI |
| Schedule pane + succession sowing + dated commit | wizard step 4 | UC-37c | works | `lib/schedule/scheduleCandidacy.ts`, `succession.ts`; `POST /api/plan/schedule` |
| Inputs plan (philosophy-gated applications + shopping list) | wizard step 5 | UC-37d | works | `lib/plan/inputsPlan.ts`; `POST /api/plan/inputs` + `/commit` + `/refine` |
| Season-setup 409 gate on Inputs endpoint | `POST /api/plan/inputs` | UC-42 | drifts | `+server.ts:76-84` returns `{error, year}`, spec says `{needsSeasonSetup: true}` (see S2-G2) |
| Commit → dated plantings + provenance flag | wizard step 6 | UC-37/37c | works | `AllocationWizard.svelte:1334, 1402-1415` (`sourceProvenance`, `plantingDate: p.plantingDateMs`) |
| Fallback banner + Provenance chips on Review/Schedule | wizard steps 3–4 | Invariant 7 | works | `AllocationWizard.svelte:2250-2260` (banner), 2274/2294/2335/2371/2394 (chips + legend) |
| Plugin upload + registry validation | `/plugins` | UC-08 | works | `routes/plugins/+page.svelte`; Zod v1.1 schema `lib/plugins/schemas.ts` |
| Plugin authoring wizard | `/plugins/new` | UC-08 | works | `routes/plugins/new/+page.svelte` |
| Crops dashboard (Planned tab shows committed plan) | `/crops` | UC-29 | works | `routes/crops/+page.svelte` + `[id]` detail |
| Planter plate selector (gated) | `/tools/planter-plate-selector` | UC-41 | drifts | gate only on `/tools` tile (`routes/tools/+page.server.ts:11`); route itself ungated (see S2-G3) |
| Wheat plan-side panels (Zadoks timeline, FHB, vernalization) | `/plan/wheat` | UC-16-adjacent | missing | #177 OPEN (deferred to Phase 26+; route doesn't exist) |

### Playtest assertions

Setup for the no-key run: `ANTHROPIC_API_KEY` unset (or `user.ai_enabled = false`), signed in as owner, ≥2 blocks (≥1 with GeoJSON, ≥1 without), ≥3 seed lots with `onHand > 0` and registered `pluginId`s (include 2 corn varieties for pollination), season setup **not** yet saved for the current year.

- **S2-A1** — `/settings/season` as owner → six labeled selects render with ≥48dp targets; selecting `organic-transitioning` reveals the "Transitioning started" year field; any other philosophy hides it.
- **S2-A2** — `/settings/season` → save → revisit → values persist (settings rows under `season_setup.<year>.*`); "Last updated" timestamp shown.
- **S2-A3** — `/settings/season` with a prior-year setup and none for the current year → "Use last year's answers" carry-forward affordance appears; one click copies all six values into the current year.
- **S2-A4** — `/settings/season` as helper → server rejects (requireOwner); no form rendered.
- **S2-A5** — `/plan` → PlanV2Shell renders (left rail, block header, plantings grid); "Plan Plantings" CTA opens the fullscreen AllocationWizard.
- **S2-A6** — Wizard opens with **no season setup for the year** → lands on step "0. Season" (SeasonSetupStep), not Seeds; saving advances to Seeds and a summary chip (philosophy · pest · fertility · year) persists in the wizard header on all later steps.
- **S2-A7** — Wizard opened when blocks already have plantings → `plan-state` chooser renders first ("Continue planning" vs "Start over"); "Start over" clears, "Continue" enters additive flow.
- **S2-A8** — **[no-key]** Step 1 Seeds → only seed lots with on-hand > 0 and a registered crop plugin are listed with per-row quantity inputs defaulting to on-hand; zero eligible seeds shows the empty-state with a link out to inventory, not a blank table.
- **S2-A9** — **[no-key]** Step 2 Blocks → each block shows a usable-area chip (geometry-inset value for the GeoJSON block; `acres × 0.85` for the other), sun exposure, and active-planting count; multi-select works.
- **S2-A10** — **[no-key]** Step 3 Review → `POST /api/plan/allocate` completes (deterministic `planLayout()`); a warn banner renders reading "No Anthropic API key configured — plan generated by the deterministic engine…" (`AllocationWizard.svelte:2251-2254`); assignments table is non-empty with sufficiency chips (`match/surplus/deficit`).
- **S2-A11** — **[no-key]** Step 3 Review → every per-row Provenance chip renders as `fallback` (rust tone), **never** `ai`; the ProvenanceLegend is present above the table.
- **S2-A12** — **[no-key]** Step 3 chat panel → renders the "off" header variant with a link to Settings → AI (`AllocationWizard.svelte:1740-1744`) instead of a live claude-haiku prompt box; no chat POST fires.
- **S2-A13** — **[no-key]** Two corn varieties assigned to blocks where ≥1 lacks geometry → info banner "📐 Pollination check skipped for N blocks…" renders on Review.
- **S2-A14** — **[no-key]** Step 4 Schedule ("Accept all → schedule") → `POST /api/plan/schedule` completes with `meta.fallback` (`'no-api-key'`/`'deterministic'`); every assignment receives a planting date at its earliest feasible window (last-frost-relative by hardiness); succession-eligible leafy greens split into N dated rows with `1/N` chips; long-DTM fruiting crops do not succession.
- **S2-A15** — **[no-key]** Step 4 → fallback banner + `fallback` Provenance chips render again on the schedule table (second ProvenanceLegend at `AllocationWizard.svelte:2371`).
- **S2-A16** — **[no-key]** Step 5 Inputs → `POST /api/plan/inputs` completes with the pure deterministic plan; per-planting collapsible cards show dated Application rows; with `pestStrategy = ipm` no prophylactic insecticide rows appear, only recurring scout tasks; with `philosophy = certified-organic` every proposed product is OMRI-listed (philosophyFilter), and any slot with no compliant product surfaces a warning rather than a silent substitute.
- **S2-A17** — Step 5 shopping list (right rail) aggregates by pluginId with have-on-hand vs need-to-buy columns and shortfall badges.
- **S2-A18** — `POST /api/plan/inputs` before season setup exists (direct API call with a year that has no setup) → 409 returned; the wizard never reaches this state because step 0 gates the flow.
- **S2-A19** — **[no-key]** Step 6 Commit → one `POST /api/blocks/[id]/plantings` per scheduled row with `plantingDate` populated (ms epoch) and `sourceProvenance: 'fallback'` in the body (`AllocationWizard.svelte:1402-1415`); progress bar advances to N/N with zero failures; seed quantities across a split stock sum back to the operator's step-1 quantity (largest-remainder for integer units).
- **S2-A20** — **[no-key]** After commit → `/plan` plantings grid shows the new dated rows; PlantingCard footer reads "Fallback" (not "AI plan" / "Manual entry"); `/crops?status=planned` lists the same rows; seed stock on-hand decremented FIFO.
- **S2-A21** — After commit → inputs tasks exist (`/today` + calendar show the first scheduled application/scout tasks); re-running the wizard and re-committing inputs replaces prior `pluginTemplateKey='inputs-plan'` tasks instead of duplicating them.
- **S2-A22** — Repeat assertions S2-A10–S2-A19 **with** a key configured → banner absent, chips render `ai`, chat panel is live, and validator failures (if forced) still land the deterministic plan with the "AI output failed validation twice" banner — commit then writes `sourceProvenance: 'fallback'`.
- **S2-A23** — `/plugins` → upload a malformed crop JSON → structured rejection with field-level errors; upload a valid v1.1 crop plugin → it appears among eligible seeds in wizard step 1 once matching seed stock exists.
- **S2-A24** — `/plugins/new` → author a minimal crop plugin via the form → registry validates and loads it; it renders in the catalog.
- **S2-A25** — `/tools` with `display_planter_setup` unset → planter-plate tile hidden; set the toggle in Settings → Display → tile appears; `/tools/planter-plate-selector?stockId=<seed>` pre-fills for that lot and "Save to seed lot" persists `planterPlateConfig` into `stock_items.metadata_json` (owner only; helper browse-only).

### Gaps & drift hypotheses

- **S2-G1 — Dead `/fields` link in the geometry-missing banner** — `apps/web/src/lib/components/AllocationWizard.svelte:2268` says "add field geometry on /fields to enable", but no `routes/fields/` exists (route listing has no `fields`); geometry editing lives at `/settings/farm/map` per the comment at `apps/web/src/routes/plan/+page.svelte:2007`. Operator following the banner hits a 404 mid-wizard.
- **S2-G2 — UC-42 409 contract drift** — `apps/web/src/routes/api/plan/inputs/+server.ts:76-84` returns `{ error: 'no season setup for year…', year }`; docs/use-cases.md (UC-42, "Defaults when never set") specifies `409 { needsSeasonSetup: true }`. Any client/agent branching on the documented flag (including Phase 24 Bearer agents reading `/api/openapi.json`) gets a string-match-only signal. Fix either the endpoint body or the UC doc.
- **S2-G3 — Planter-plate gate is tile-deep only** — `apps/web/src/routes/tools/+page.server.ts:11` reads `display_planter_setup` to hide the tile, but `routes/tools/planter-plate-selector/+page.server.ts` has no gate check (only auth). Deep links (inventory modal, bookmarks) bypass the Phase 21 B-29 opt-in. Likely intentional for the `?stockId=` integration path, but undocumented — UC-41/CLAUDE.md say the UI is "gated behind" the setting.
- **S2-G4 — Stale `/stock` reference in planner warning copy** — `apps/web/src/lib/components/InputsPlanStep.svelte:64` tells the operator to "review on /settings/season and /stock"; `/stock` is a 308-redirect shell since Sprint 9 (#280 tracks link repointing). Copy should say `/inventory`.
- **S2-G5 — Plan v2 shell drift** — tracked, do not re-derive: #119 (epic), #120 workflow-strip step buttons disabled, #121 PlantingCard missing variety/Role/Stage cells, #122 "+ Task" unwired, #123 missing geometry-status badge. All still OPEN as of 2026-07-04.
- **S2-G6 — Wheat plan surface missing** — #177 (AWheatPlanScreen Zadoks timeline / FHB / vernalization panels); route doesn't exist, deferred pending the NEWA hourly weather feed shared with #132.
- **S2-G7 — Dual catalog surfaces** — `/plugins` (+ `/plugins/new`, `/community`, `/[pluginId]`) remains a live route while Phase 27 made `/inventory?type=crop&mode=catalog` the canonical catalog chrome (Invariant 8: "one inventory chrome"); `/settings/plugins` was 308-redirected but `/plugins` was not consolidated. UC-08's success criterion ("appears in /plan crop list") predates Phase 27 taxonomy. Hypothesis: either `/plugins` should redirect into `/inventory` catalog mode or Invariant 8 should document it as the sanctioned authoring/upload exception.
- **S2-G8 — UC-36 doc anchors pre-v2 URLs** — docs/use-cases.md UC-36 primary path cites `/plan?tab=schedule` + "To schedule" tray; the tab param survives only as a legacy-load shim (`apps/web/src/routes/plan/+page.svelte:61` comment) and UC-38 notes the tray was deleted. UC-36 needs a Plan-v2-era rewrite pass (doc drift, not code).

---

## S3 — Pre-season stocking & equipment readiness

Late winter / early spring. The seed and chemical orders arrive in boxes; the sprayers come out of the barn. Before anything touches a field, the operator (P1 owner, sometimes with a P2 helper) fills the digital shed — every pesticide, fertilizer, and seed SKU registered with lots, every sprayer registered and calibrated, and a soil-test baseline on file per block so the fertility ledger starts the year defensible.

### Desired outcome

- Every product on the physical shelf exists in `/inventory` with the correct type (pesticide / fertility / seed), a lot with `lotNumber` + `expiresAt` + quantity, and a reorder threshold — so FIFO auto-decrement (UC-31) and low-stock alerts work all season.
- Adding a SKU is fast in any circumstance: barcode, label photo, product URL, library search, or bare-hands manual entry — and the AI-assisted methods degrade to recovery CTAs (never dead-ends) when no Anthropic key is configured (Invariant 7).
- Every add method funnels into the same canonical review form (`A_InventoryEditForm`) so every entry route produces the same row + the same audit trail (Invariant 8), with provenance visible on pre-filled fields and Lot # always `manual`.
- Every sprayer exists in `/equipment` with chemistry-history/decon/GPA state readable by the safety kernel; each is calibrated via the UC-10 1/128-acre wizard before first spray. A helper can run the wizard and submit the result for owner approval — no owner-only dead-end.
- Each block has a current-year soil test (pH, CEC, OM, NO₃, P, K) entered on `/fertility` so the N/P/K budget rollup (UC-33) has a baseline before the inputs plan (S4) consumes it.
- The moment stock dips under a reorder threshold or a lot nears expiry, `/today` surfaces it with a working deep link to the item.

### Surface & UC map

| Surface | UC | Status | Evidence |
|---|---|---|---|
| `/inventory` unified list (5-chip type swap, Stock/Catalog toggle, KPI strip, search) | UC-31 / Inv-8 | works | `apps/web/src/routes/inventory/+page.server.ts:1-24` — canonical loader replacing `/stock` + `/settings/plugins` + `/settings/sprayers`; helper-readable (no role gate in loader), mutations gate at `/api/stock` + `/api/equipment` via `requireOwner` |
| `/inventory/[type]/add` multi-method flow | UC-31 | drifts | `apps/web/src/lib/components/inventory/A_InventoryAddFlow.svelte:39-86` — live method set is **search · barcode · label · URL · manual**; the Sprint-20 `photo` method (`addMethods.ts`) was deleted in commit `2c01901` and "any product shot" was folded into the Label blurb. Nominal 5-method invariant (barcode · label OCR · **AI photo** · search · manual) no longer matches the shipped chips |
| No-key degradation of AI methods | Inv-7 | drifts | `A_InventoryAddFlow.svelte:91` hides `aiRequired` chips entirely (`visibleMethods` filter) + a one-line note at `:154-159`; UC-31 no-key contract (docs/use-cases.md §UC-31, #250/#251) says AI tabs "MUST NOT silently disappear" — they must render a pre-flight empty state with recovery CTAs. That empty state exists in `LabelOcrPanel.svelte:165-190` but is unreachable when the chip is hidden |
| Barcode method (deterministic tier) | UC-31 | works | `apps/web/src/lib/components/stock/add/BarcodePanel.svelte:13-15,47,65,71` — OpenFoodFacts first (`source:'data'`), Claude text-lookup fallback (`source:'ai'`), failure copy points to Label/Manual next steps |
| Search method (2-tier waterfall) | UC-31 | works | `apps/web/src/lib/components/stock/add/SearchPanel.svelte:11-21,46,165` — local fuzzy typeahead free/no-quota; web tier opt-in behind a button, hidden without key |
| Draft → approve handoff (provenance) | Inv-7/8 | works | `A_InventoryAddFlow.svelte:109-126` + `A_InventoryEditForm.svelte:363` ("Pre-filled for your review… Nothing is recorded until you do"); `apps/web/src/lib/stock/normalizeStockEntry.ts:15-16,62` — Lot # always `manual`, draft carries `source: 'manual'|'plugin'|'data'|'ai'|'fallback'` |
| Canonical form per-type field matrix | UC-31 / Inv-8 | drifts | `A_InventoryEditForm.svelte:171-246` — field map is generic (displayName, unit, pluginId, reorderThreshold, barcode, notes); the ratified per-type matrix (seed `germPct`+`germTestDate`+`treated` ■, fertility `npk`+`form` ■, pesticide `epaRegNo`+`moaGroup` ■) is not rendered. Tracked under #255/#256 — reference, don't re-derive |
| Hash-chain audit row per save | Inv-8 | missing | `apps/web/src/routes/api/stock/+server.ts:46-59` — POST validates + `createStockItem`, no audit/hash-chain write; design requires "write row + create hash-chain audit entry" (`docs/design/almanac/INVENTORY_UNIFICATION.md:144,317`) |
| `/inventory/[type]/[id]` detail + lots | UC-31 | works | `apps/web/src/routes/inventory/[type]/[id]/+page.server.ts:171-182` — lots + movements + plugin payloads per type; lot receive via owner-gated `POST /api/stock/[id]/lots` (`+server.ts:22`) |
| `/equipment` + `/equipment/[id]` | UC-30 | works | `apps/web/src/routes/equipment/+page.server.ts:20` (`canEdit` = owner; helper read + log); `[id]/+page.svelte:139-166` shows GPA/date + Calibrate CTA; usage-log kinds incl. `calibration`, `decon` |
| `/calibrate` UC-10 wizard | UC-10 | works | `apps/web/src/routes/calibrate/+page.svelte:21-38` (distance + GPA math), `:163-172` (5–60 sanity band blocks save, #216/#217), `:61-66` helper POST → 202 `pending-owner-review`; owner review queue `:219-263` via `POST/DELETE /api/calibrations/pending/[id]`; loader gates queue to owner (`+page.server.ts:11`) |
| Pending-calibration approval location | UC-10/30 | drifts | Approval UI lives on `/calibrate` only; `docs/use-cases.md:474` says "owners approve from `/equipment/[id]`" — no pending panel exists there (`equipment/[id]/+page.svelte` renders GPA + link only). Doc-vs-code drift |
| `/fertility` soil-test baseline | UC-33 | drifts | Page + rollup work (`apps/web/src/routes/fertility/+page.server.ts:11-36`); but `POST /api/fertility/soil-tests` has **no role gate** (`apps/web/src/routes/api/fertility/soil-tests/+server.ts:19-41` — no `requireOwner`) despite UC-33's owner-role precondition |
| `/tools/planter-plate-selector` | UC-41 | works | `apps/web/src/routes/tools/planter-plate-selector/+page.server.ts:17-19` — off by default, redirect to `/tools` unless `display_planter_setup === 'true'` (Phase 21 B-29); seed-typed stock pre-fill via `?stockId=` |
| Low-stock / expiring surfacing on `/today` | UC-31 | works | `apps/web/src/routes/today/+page.server.ts:233-241` (`lowStockItems()` + `expiringSoon(30)` with `category` lifted); `+page.svelte:747-777` links via `STOCK_CATEGORY_TO_INVENTORY_TYPE` (Sprint 17 #280 repoint — no 308 RTT) |

### Playtest assertions

Setup: seeded owner + helper accounts; one browser session each. Run the no-key group with the Anthropic key cleared in `/settings/ai`, then re-run the AI-path spot-checks with a key.

**Add methods — no-key mode (Invariant 7):**

- **S3-A1** — `/inventory/pesticide/add` with no key: Manual, Search, and Barcode chips render and are fully operable; the flow never 500s or blanks.
- **S3-A2** — No-key: per the UC-31 contract, Scan-label (and any AI method) should render a disabled/pre-flight state with "Configure AI key →" + "Switch to Manual" CTAs — **expected to fail today** (chips are hidden instead; the note at the top is the only affordance). Record actual behavior.
- **S3-A3** — No-key Search: typeahead returns local plugin-library matches; no "Search the web" button appears; selecting a match lands on the approve form with `FROM PLUGIN` provenance.
- **S3-A4** — No-key Barcode: scanning a known-OpenFoodFacts UPC resolves deterministically (`source: data`); an unknown barcode surfaces the "try Label scan or Manual" copy — not a silent failure or infinite retry.
- **S3-A5** — No-key Manual: full add completes end-to-end (SKU + lot) — proving the deterministic path works without any key.
- **S3-A6** — Key revoked mid-session (set key, open Label panel, clear key in another tab, submit a photo): the error path matches `/No Anthropic API key configured/i` and swaps the dead-end retry for the recovery CTA pair (Sprint 17 #251 fix — `LabelOcrPanel.svelte:117-122`).
- **S3-A7** — With key: Label scan of a real product photo pre-fills the approve form with `ai`-provenance chips on extracted fields; Lot # remains blank/`manual` (never pre-filled by AI).
- **S3-A8** — With key: From-URL paste of a seed-company product page pre-fills a draft (`source: claude-url` path); operator can discard and switch methods without losing the identity-section input.

**Canonical form + audit (Invariant 8):**

- **S3-A9** — Each of the five methods, committed, produces an identical-shape `stock_items` row (verify via `GET /api/stock`) — same columns populated regardless of entry route.
- **S3-A10** — For each method's save, check for an audit/hash-chain row. **Expected to fail today** — `POST /api/stock` writes no audit entry (S3-G3); assert and log per-method so the fix is testable.
- **S3-A11** — Type-chip switch mid-entry (pesticide → seed) preserves the display-name input (INVENTORY_UNIFICATION "switching types swaps the field stack without losing identity-section input").
- **S3-A12** — Helper session: `/inventory` and `/inventory/pesticide/[id]` render read-only (no 403); helper POST to `/api/stock` returns 403 (mutations gate at API layer).
- **S3-A13** — Seed add without a linked plugin is rejected with the inline "Seed entries must link to a crop plugin" error (`A_InventoryEditForm.svelte:240`, #253).

**Equipment + calibration:**

- **S3-A14** — Owner registers a sprayer on `/equipment` (type=sprayer, spec JSON); it appears in `/inventory?type=sprayer` and in the `/calibrate` dropdown as "Uncalibrated" (no silent 15-GPA default — #216).
- **S3-A15** — Owner runs the wizard: 20 in spread → walk distance ≈ 204 ft is displayed; entering ounces yields GPA = ounces; a value outside 5–60 shows the warn card and the Save button is disabled.
- **S3-A16** — Owner save: `POST /api/sprayers/[id]/calibration` → 200 `applied`; `/equipment/[id]` shows the new GPA + calibration date, and an `equipment_log` entry of kind `calibration` exists.
- **S3-A17** — **Helper calibration → pending flow:** helper completes the wizard; button reads "Send N GPA to owner →"; POST returns 202 `pending-owner-review`; sprayer GPA is unchanged.
- **S3-A18** — Owner then visits `/calibrate`: "Pending calibrations from helpers (1)" lists the submission with submitter email + measurements; **Approve & apply** updates the sprayer GPA; **Reject** discards; either way the row leaves the queue. Helper never sees the queue.
- **S3-A19** — Server clamps calibration payloads to 0.5–200 GPA even if the client is bypassed (#217 — direct curl with `calibratedGpa: 999` → 400).

**Fertility + low stock:**

- **S3-A20** — Owner enters a soil test on `/fertility` (pH/CEC/OM/NO₃/P/K); it lists under the block and the year's budget rollup renders.
- **S3-A21** — Helper session POSTs `/api/fertility/soil-tests` directly — per UC-33 this should 403; **expected to fail today** (no role gate). Record actual.
- **S3-A22** — Set a reorder threshold above on-hand for one SKU; `/today` shows the low-stock banner naming the SKU, and its link resolves to `/inventory/[type]/[id]` in one hop (no 308).
- **S3-A23** — Receive a lot with `expiresAt` < 30 days out; `/today` expiring-stock list surfaces it with a working deep link.
- **S3-A24** — `/tools/planter-plate-selector` deep-link with the display setting off redirects to `/tools`; enabling "Show planter setup" in Settings makes it reachable and pre-fills from `?stockId=`.

### Gaps & drift hypotheses

- **S3-G1 — "AI photo" is no longer a distinct 5th method.** `apps/web/src/lib/stock/addMethods.ts` (Sprint 20's `photo` in `DEFAULT_METHODS`) was deleted by commit `2c01901`; the live set in `apps/web/src/lib/components/inventory/A_InventoryAddFlow.svelte:39-86` is search/barcode/label/url/manual, with photo capture folded into the Label blurb. Either CLAUDE.md Invariant 8's method list or the component should be reconciled (URL was previously the UC-31 "Add From URL" extra, photo the canonical 5th).
- **S3-G2 — No-key hides AI methods instead of degrading them.** `A_InventoryAddFlow.svelte:91` filters `aiRequired` chips out when `!aiEnabled`, contradicting the UC-31 no-key contract (docs/use-cases.md §UC-31 "MUST NOT silently disappear") and stranding the fully-built recovery empty-state in `apps/web/src/lib/components/stock/add/LabelOcrPanel.svelte:165-190`. Note the AI_PROVENANCE_ADDENDUM matrix (line ~103) says CTAs get *replaced with a settings link* — the two spec texts themselves disagree; the UC-31 wording is newer and more specific.
- **S3-G3 — No hash-chain/audit row on inventory save.** `apps/web/src/routes/api/stock/+server.ts:46-59` (and `PATCH /api/stock/[id]`) persist without an audit entry; `docs/design/almanac/INVENTORY_UNIFICATION.md:144,317` requires "write row + create hash-chain audit entry" per save. Playtest assertion S3-A10 will fail until this lands (part of the #147/#256 epic scope — reference, not new).
- **S3-G4 — Per-type field matrix unimplemented on the canonical form.** `apps/web/src/lib/components/inventory/A_InventoryEditForm.svelte:171-246` renders a generic field set; seed germ/treated, fertility NPK/form, pesticide EPA/MoA/REI required fields from the ratified matrix are absent. Covered by #255 (metadata audit) + #256 (implementation tracker).
- **S3-G5 — Soil-test POST missing owner gate.** `apps/web/src/routes/api/fertility/soil-tests/+server.ts:19` has no `requireOwner`/`requireUser` beyond the global session hook; UC-33 preconditions say owner role. Check siblings `applications/+server.ts` + `credits/+server.ts` for the same omission.
- **S3-G6 — UC-30 doc drift on approval location.** `docs/use-cases.md:474` states owners approve pending calibrations from `/equipment/[id]`; the shipped approval queue lives only on `/calibrate` (`apps/web/src/routes/calibrate/+page.svelte:219-263`). Fix the doc or add the panel to the equipment detail.
- **S3-G7 — Scan endpoints bypass `aiTry()`.** Invariant 7 declares `aiTry()` the *only* degradation chokepoint, but `/api/scan-label` + `/api/scan-url` throw their own no-key error from `apps/web/src/lib/server/scanResult.ts:706`; only `/api/audit/re-ask-ai` calls `aiTry()` today. Degradation behavior is correct in practice, but the single-chokepoint invariant is aspirational for the scan family.
- **S3-G8 — Known open issues referenced above, not re-derived here:** #147 (stock epic umbrella), #152 (method-picker card-grid visual treatment — `A_InventoryAddFlow.svelte:137-152` chips vs mockup cards), #249 (multi-file batch upload for unboxing — LabelCapture is single-shot), #255/#256 (plugin metadata completeness / inventory-unification tracker).

---

## S4 — In-season daily operations

The morning-coffee loop, repeated from first spray window to last harvest: open `/today`, read the one thing that matters, act on it (scout → spray, harvest, decon), and keep the offline queue clean so the audit trail never has a gap. This stage is where the calendar engine's projections (S3) become recorded events (S5's raw material).

### Desired outcome

- The operator opens the app once each morning and leaves knowing **the single highest-priority action** (overdue task > today's task > tomorrow's task > today's derived window — `apps/web/src/lib/today/priorityAction.ts:7-14`), with the right page pre-filled one tap away.
- Every skipped action carries a **reason** on the task row (`abort` + reason), so end-of-season review can distinguish "didn't need to" from "forgot to".
- Scouting is threshold-driven, not vibes-driven: FR-07 (≥3 weeds/10 sq ft average OR any weed >2") produces a SPRAY/SKIP card, the walk is **persisted** as a `scout_observations` row (feeding the insecticide IPM gate), and a SPRAY result deep-links into `/spray` with block + window stage carried.
- Alerts that would otherwise surprise the operator mid-task surface passively: low stock, expiring lots, dirty sprayers (decon owed), harvest windows opening, pending offline records.
- Records confirmed offline queue in Dexie, drain automatically on reconnect, and drain **only for the active Owner** (Phase 18h) — with foreign-owner rows counted, never silently dropped.
- Helpers see everything the owner sees on `/today` (read parity, invariant 8); mutation authority is enforced at the API layer, not by hiding cards.

### Surface & UC map

| Surface | UC | Status | Evidence |
|---|---|---|---|
| `/today` hero priority action | UC-11 | **Works** | `derivePriorityAction()` ranks overdue → today → tomorrow → derived window (`lib/today/priorityAction.ts:117-190`); loader widens the task window (−30d/+14d) so the hero never nulls out on the season tab (`routes/today/+page.server.ts:149-160`) |
| Skip-with-reason (#104) | UC-11 | **Works** | `TodayHero.svelte:90-114` inline reveal → `onSkip` → `PATCH /api/tasks/[id]` `{action:'abort', reason}` (`routes/today/+page.svelte:365`); schema allows `reason` ≤500 chars (`routes/api/tasks/[id]/+server.ts` patchSchema); aborting a primary cascades the reason to open pre/post-tasks (endpoint header comment) |
| Week/Month/Season strip (#103) | UC-11 | **Works** | 84-day item map feeds all three segmented views (`routes/today/+page.svelte:92-109`); passive kinds (emergence, stage-window, shade-window) filtered out (`:103`) |
| Recommendations + "+ Schedule task" (#105) | UC-11 | **Works** | next-14d events → `onSchedule(id)` → index back into `data.upcoming` → `scheduleFromEvent()` POST `/api/tasks` (`routes/today/+page.svelte:112-119, 235-263, 376-380`) |
| Weather card | UC-11 | **Works (conditional)** | best-effort NWS fetch off the first block *with geometry*; any failure hides the strip rather than crashing (`routes/today/+page.server.ts:162-184`) |
| Low-stock + expiring alerts | UC-11 | **Works** | wheat Banners with per-item links resolved via `STOCK_CATEGORY_TO_INVENTORY_TYPE` → `/inventory/[type]/[id]`, no 308 RTT (#280) (`routes/today/+page.svelte:747-787`, loader `:233-249`) |
| Dirty-sprayer / decon banner | UC-11 / FR-05 | **Works** | site-wide layout banner: chemistry loaded + no decon since last spray → rust urgent Banner + "Run decon wizard →" CTA (`routes/+layout.server.ts:18-31`, `routes/+layout.svelte:125-137`); per-sprayer "Decon →" links also in the /today sprayers card (`routes/today/+page.svelte:839-858`) |
| Harvest-ready surfacing | UC-11/UC-06 | **Works (indirect)** | no dedicated "harvest-ready" banner; harvest windows surface via hero (`harvest-window` → "Record harvest"), week strip, and Today's-actions CTA "Open harvest →" (`lib/today/priorityAction.ts:48-55,96-107`; `routes/today/+page.svelte:319-322`) |
| `/scout` decision + persistence | UC-05 / FR-07 | **Works** | pure evaluator `lib/safety/scout.ts:34-72` (≥3 avg OR >2"); live `$derived` decision card (`routes/scout/+page.svelte:44`); Save POSTs `/api/scout/record` with avg + raw spots + tallest in notes (`:66-114`); 30-day per-block history from loader (`routes/scout/+page.server.ts:14-32`) |
| Scout → spray prefill | UC-05→UC-02 | **Works** | SPRAY card renders "Plan the spray for {block} →" with `?block=&windowStage=&fromScout=1` (`routes/scout/+page.svelte:51-57,205-209`); `/spray` loader consumes all three params (`routes/spray/+page.server.ts:7-11`) |
| `/records/pending` drain + discard | UC-12 | **Works** | Sync-now button → `drainQueue()`; per-row discard with confirm, owner-scoped (`routes/records/pending/+page.svelte:22-42`); aria-live drain status stays mounted (#242, `:65-68`) |
| Foreign-owner badge | UC-12 / 18h | **Drifts** | pre-drain badge works via `pendingCountForOtherOwners()` (`:69-74`), but the drain summary string omits `result.skippedOtherOwner` — see S4-G1 |
| Offline queue + auto-drain | UC-12 / NFR-02 | **Works** | `enqueueSprayRecord` from the spray flow (`routes/spray/+page.svelte:481-482,536-537`); `watchOnline()` drains on `online` event + app init (`lib/client/syncQueue.ts:147-157`); server re-runs the kernel on every drained POST (`:101-113`) |
| Layout pending banner | UC-12 | **Works (cross-tenant by design)** | banner counts *all* tenants via `pendingCount()` polled every 4 s (`routes/+layout.svelte:29-39, 86-93`); offline banner takes precedence |
| Tenant-scoped drain | 18h | **Drifts** | `drainQueue` skips foreign rows only when `currentOwnerId()` is non-null (`lib/client/syncQueue.ts:119-127`) — but the sessionStorage key is written *only* on owner switch — see S4-G2 |
| Device-loss boundary | UC-23 (proposed) | **Missing** | `/records/pending` lede explains queue mechanics but not the durability boundary; "Sync now" is a de-facto force-sync but nothing recommends running it before field work |
| Helper/owner parity on /today | inv. 8 | **Works** | `/today` loader and layout banners have no role gates; inspector/custom-operator get role banners only (`routes/+layout.svelte:117-123`); task mutation blocks inspector via `canMutate` (`routes/api/tasks/[id]/+server.ts`), helpers may complete/abort |

### Playtest assertions

- **S4-A1** — Fresh morning with one overdue task, one task today, and a spray window today → hero shows the **overdue** task, with `overdueDays` set (`priorityAction.ts:122-130`).
- **S4-A2** — No open primaries but a `spray-window` derived event starting today → hero falls back to it with tone `spray`, CTA "Open spray flow"; `emergence`/`stage-window` events never claim the hero (`priorityAction.ts:48-55,157-161`).
- **S4-A3** — Hero "Skip — note why" → type a reason → Save skip → network shows `PATCH /api/tasks/{id}` with `{action:'abort', reason}` → task leaves the open list on reload; the reason string persists on the task row.
- **S4-A4** — Skipping a primary that has open pre-tasks aborts those pre-tasks with the same reason (cascade documented in `api/tasks/[id]/+server.ts` header).
- **S4-A5** — Inspector session PATCHing a task gets 403 "inspector role is read-only"; a **helper** session succeeds (complete and abort).
- **S4-A6** — Week strip: an event 40 days out appears in Month + Season views but not Week; all items within the 84-day horizon only (`today/+page.svelte:94-96`).
- **S4-A7** — Recommendations "+ Schedule task" on the Nth card promotes exactly that event (POST `/api/tasks` with `pluginTemplateKey: derived:{kind}:{blockId}:{startMs}`), and the promoted item stops appearing as a bare suggestion after reload.
- **S4-A8** — Farm with no block geometry → no weather strip, no error; farm with geometry but NWS down → same silent hide (`today/+page.server.ts:169-183`).
- **S4-A9** — Stock item under reorder threshold + a lot expiring in <30 days → two wheat banners on /today; each item link lands on `/inventory/[type]/[id]` directly (no 308).
- **S4-A10** — **Helper on /today sees the identical alert set** (low stock, expiring, dirty sprayer, decon banner) as the owner — no card is hidden by role; clicking a stock link renders the inventory detail without a 403 (invariant 8).
- **S4-A11** — Spray a chemistry, skip decon → rust "needs decontamination" banner on **every** route with "Run decon wizard →" pre-targeting the dirty sprayer; run the decon wizard → banner clears (`+layout.server.ts:18-31` predicate: `lastDeconAt >= lastSprayedAt`).
- **S4-A12** — `/scout` spots `[4,3,2,5]` (avg 3.5 ≥ 3) → SPRAY card, reason cites the average; the "Plan the spray for {block} →" CTA href carries `block=<id>&windowStage=<stage>&fromScout=1` and `/spray` opens with that block pre-selected and the herbicide list filtered to the stage.
- **S4-A13** — `/scout` spots `[1,1,0,2]` + tallest weed 2.5" → SPRAY via the height trigger; same spots with tallest 2.0" exactly → SKIP (evaluator uses strict `>`, `lib/safety/scout.ts:46-48`).
- **S4-A14** — Save observation → POST `/api/scout/record` with `value` = average and notes embedding `spots=[...] tallest_in=... decision=...`; the row appears in "Recent observations" for that block after `invalidateAll`, with an "over threshold" pill when ≥3 — and the insecticide IPM gate on `/spray/insecticide` now sees it.
- **S4-A15** — Deep-link `/scout?block=X&windowStage=V2-V3` from a /today spray-window CTA → block X pre-selected, window stage echoed under the block card (`scout/+page.server.ts:8`, `scout/+page.svelte:147-149`).
- **S4-A16** — Kill the network, confirm a spray → record lands in Dexie; layout flips to the rust offline banner; restore network → `watchOnline` auto-drains, wheat "N pending" banner clears without visiting `/records/pending`.
- **S4-A17** — Queue a record that the kernel now rejects (e.g. rule changed since queue time) → drain leaves it in the queue with `attempts` incremented and `lastError` shown on the row (`syncQueue.ts:133-141`); Discard prompts a confirm and only removes active-owner rows (`syncQueue.ts:92-99`).
- **S4-A18** — Two-farm helper: queue a record at Farm A, switch to Farm B, open `/records/pending` → A's row is **not** listed; badge reads "1 record queued from another farm — switch Owner to see it"; pressing Sync now returns `DrainResult.skippedOtherOwner = 1` and B's session never POSTs A's payload (`syncQueue.ts:124-127`) — **note: the on-screen drain summary currently doesn't render that count** (S4-G1).
- **S4-A19** — Switch back to Farm A → the queued row reappears and drains against A (Dexie intentionally survives the switch, `lib/client/tenantSwitch.ts` header comment).
- **S4-A20** — Layout banner count vs page list: banner uses cross-tenant `pendingCount()` while the page lists active-owner rows only — with a foreign-owner row queued, banner says "1 pending" but the list is empty except for the badge. Verify the badge explains the discrepancy.

### Gaps & drift hypotheses

- **S4-G1 — Drain summary drops `skippedOtherOwner`** — `routes/records/pending/+page.svelte:28` renders only `succeeded`/`failed` counts; `DrainResult.skippedOtherOwner` (`lib/client/syncQueue.ts:143`) is computed and returned but never shown. The pre-drain badge covers the state passively, but the drain action itself should say "skipped N from another farm" (CLAUDE.md Phase 18h says the drain "surfaces `skippedOtherOwner`").
- **S4-G2 — `cropcard.activeOwnerId` is only seeded on owner *switch*** — sole writer is `lib/client/tenantSwitch.ts:34`. A fresh tab/login that never switches has a null key, so: (a) `enqueueSprayRecord` falls back to hardcoded `'owner_home_farm'` (`lib/client/syncQueue.ts:44`) — wrong owner tag for any non-home-farm tenant; (b) `listPendingForActiveOwner()` returns `[]` (`:87`) so `/records/pending` shows an empty queue while the layout banner counts rows; (c) `drainQueue` with null ownerId skips the tenant filter entirely and drains **all** owners' rows (`:125` guard is `ownerId && …`). The layout should seed the key from `data.activeOwner.id` on mount.
- **S4-G3 — Legacy abort has no reason capture** — the `<details>` schedule view hardcodes `reason: 'aborted from /today'` (`routes/today/+page.svelte:701`), so skips via the legacy path lose the "why" that the hero path (#104) records. Either wire the same inline reveal or drop the legacy Abort button.
- **S4-G4 — Full-page reloads after task mutations** — `patchTask` and `scheduleFromEvent` call `window.location.reload()` (`routes/today/+page.svelte:257,279`) instead of `invalidateAll()`; on a rural connection this re-fetches the weather call and whole loader, and loses scroll position mid-morning-review.
- **S4-G5 — `/records/pending` chrome predates Phase 25** — hardcoded hex colors, no Card/Kicker/Banner primitives (`routes/records/pending/+page.svelte:100-216`), and the route is still reachable only via the banner or direct URL (use-cases.md F-N). The one queue surface an offline-heavy operator must trust looks like a debug page.
- **S4-G6 — UC-23 loss boundary undocumented in UI** — the lede (`routes/records/pending/+page.svelte:50-54`) explains mechanics but not that device loss destroys unsynced rows; the proposed "force-sync before tractor work" nudge (docs/use-cases.md UC-23) has a natural home next to the existing Sync-now button.
- **S4-G7 — use-cases.md UC-05 block is stale** — "Success: Decision recorded mentally" and the F-F placeholder finding (`scout:72`) both predate Sprint 4: observations now persist via `/api/scout/record`, and the tallest-weed input uses a persistent `hint` not a placeholder (`routes/scout/+page.svelte:172-179`). Doc drift, not code drift.
- **S4-G8 — Scout SPRAY prefill carries context, not evidence** — the `/spray` deep-link passes `block`/`windowStage`/`fromScout=1` but not the observation id or counts (`routes/scout/+page.svelte:51-57`); `/spray` treats `fromScout` as a UI hint only (`routes/spray/+page.server.ts:10`). The spray record therefore has no FK back to the scout walk that justified it — weakens the FR-07 audit story.
- **S4-G9 — Harvest-ready has no dedicated /today alert** — low stock, expiring lots, and dirty sprayers get banners, but "planting entered its harvest window today" only surfaces if it wins the hero slot or the operator reads the events list (`routes/today/+page.svelte:789-805`). A ready-count chip (mirroring /harvest's "N ready today" stat, Sprint 13) would close the loop.
- **S4-G10 — Recommendations id→index coupling** — `onSchedule` maps the clicked card back to `data.upcoming[idx]` by array position (`routes/today/+page.svelte:377-379`); correct today because items are a straight `slice(0,8)` map, but any future filter/sort on `recommendationItems` silently schedules the wrong event. Carry the event key in the item id instead.

---

## S5 — In-season spray operations

The safety-critical core of the year: plan → kernel check → apply → record → decon. Everything in this stage is dual-enforced — the UI gates for usability, the server re-runs the same kernel and refuses to persist on `ok === false`, so no client tampering, offline queue replay, or helper-role mischief can write an unsafe record. `RULES_VERSION` (currently `0.5.2-sprint19`, `apps/web/src/lib/safety/version.ts:11`) is stamped on every event row alongside plugin hashes so past decisions replay under the rules that made them.

### Desired outcome

An operator (owner or helper, gloved, one-handed, possibly offline) can take a spray decision from trigger (calendar window, scout SPRAY verdict, or ad hoc) to a persisted, immutable, stock-decremented record in ≈5 taps — and **cannot** take it anywhere the kernel forbids. Concretely:

- **Herbicide (UC-02/UC-03, `/spray`)**: block → product(s) → sprayer → tank size; kernel re-evaluates on every selection change via `POST /api/spray/evaluate`. Pass → tank-mix order + dilution table (scaled by the sprayer's *calibrated* GPA, not the plugin default) → confirm. Fail → ⛔ STOP card with per-violation codes, expandable kernel JSON, and — when `requiresDecon` — a single CTA into the decon wizard. There is no "proceed anyway" control; bypass is resolved by changing the plan, not overriding it.
- **Insecticide (UC-32, `/spray/insecticide`)**: same chassis plus IPM threshold gate (recent scout observations must cross the plugin's threshold before Record enables; server re-checks via `checkIpmThreshold`) and pollinator-bloom gate (high-risk product × crop in bloom window → block). REI/PHI clear-at timestamps computed server-side and surfaced on `/today` until they clear.
- **Fungicide (`/spray/fungicide`)**: FRAC rotation gate against the block's prior fungicide events + the pair-specific copper (M01) × sulfur (M02) phytotoxicity hard-gate (`RULES_VERSION 0.5.1`, kernel-level, runs *before* FRAC so the operator sees the precise chemistry reason).
- **Decon (UC-04/FR-05, `/spray/decon`)**: 8-step linear wizard (drain → 3× rinse → 30-min ammonia soak → boom flush → 2× final rinse → confirm), no skip between steps, timed soak. Completion POSTs `/api/sprayers/:id/decon`, clearing `lastChemistryClass` server-side so the cross-contamination gate opens.
- **After the fact**: record locks at 48h (FR-09) — server-stamped `lockedAt`, `RecordLockedError` on any mutation attempt; helpers can never force-delete locked records or apply custom-rate overrides (both owner-only at the API layer); stock auto-decrements FIFO from the dilution math with an audit `stock_movements` row per product, warn-don't-block on shortfall.

### Surface & UC map

| Surface | UC / FR | Client gate | Server gate |
|---|---|---|---|
| `/spray` (herbicide) | UC-02, FR-02/04/12 | 5-step form, kernel auto-re-eval, dilution table | `POST /api/spray/record` re-runs `evaluateSpray()` + stock augmenter → 422 (`api/spray/record/+server.ts:163-203`) |
| `/spray` STOP card | UC-03 | ⛔ card, violation `<li>`s, decon CTA (`spray/+page.svelte:1090-1112`) | Same 422 path; no bypass parameter exists in `requestSchema` |
| `/spray/insecticide` | UC-32 | 6-step `SprayStepper`, `ipmBlocked` disables Record (`insecticide/+page.svelte:92-93`) | env gate → IPM → pollinator → stock augmenter, each 422 (`api/insecticide/record/+server.ts:122-307`) |
| `/spray/fungicide` | Sprint 12 #194 | `tankMixBlocked` disables Record (`fungicide/+page.svelte:82,97`) | copper×sulfur hard-gate (`api/fungicide/record/+server.ts:140-161`) → FRAC → pollinator → augmenter |
| `/spray/decon` | UC-04, FR-05 | 8 steps, linear, 30-min timer | `POST /api/sprayers/:id/decon` stamps server time (`api/sprayers/[id]/decon/+server.ts:13-20`) |
| Record lock | FR-09 | /records shows lock badge | `LOCK_WINDOW_MS` + `evaluateLock`/`assertEditable` (`lib/db/sprayEvents.ts:24,150-166`); DELETE 422, force=owner-only (`api/spray/records/[id]/+server.ts:24-44`) |
| Role gates | Invariant 5, NFR-09 | UI hides override control | `customRateOverride` → 403 unless owner (`api/spray/record/+server.ts:139-141`); inspector read-only 403 (`:136-138`) |
| Stock decrement | UC-31 linkage | success card lists decrements | `decrementForUse()` per dilution line, FIFO, `stock_movements` audit row (`api/spray/record/+server.ts:239-272`) |
| Dilution / GPA | FR-02, FR-12 | table shows `gpaUsed` | `gpaUsed = calibratedGpa ?? plugin.gpaCalibration ?? 15` (`lib/dilution/calculator.ts:70`); evaluate endpoint prefers stored sprayer calibration (`api/spray/evaluate/+server.ts:187-188`) |

Kernel composition (`lib/safety/evaluate.ts:20-36`): cropCompatibility → chemistry → cropStage → tankMix → environment → crossContamination, with `requiresDecon` carried out of the contamination check (`lib/safety/crossContamination.ts:17-50`). The Phase-17 augmenter (`userAddedRestrictions.ts`) may only *tighten* the verdict (`augmented.ok ≤ base.ok`), never relax it.

### Playtest assertions

Setup: seeded dev tenant with ≥2 blocks, ≥2 herbicide plugins of differing chemistry classes, 1 insecticide + 2 fungicide plugins (one copper M01, one sulfur M02), one sprayer with `calibratedGpa` set (e.g. 18) and one uncalibrated, stock SKUs linked to each plugin.

- **S5-A1** — **Happy path**: `/spray` → block → herbicide → sprayer → tank quick-pick → Confirm lands on success card; a `spray_events` row exists with `rulesVersion = '0.5.2-sprint19'` and non-empty `pluginHashesJson`.
- **S5-A2** — **STOP card renders**: pick a herbicide incompatible with the block's crop family — ⛔ "STOP — do not spray" card appears with violation code, message, and expandable `<details>` kernel JSON; the Confirm/record CTA is not rendered anywhere on the page.
- **S5-A3** — **STOP is non-bypassable in UI**: with the STOP card showing, inspect the DOM — no button, hidden input, or query param re-enables submission; the only CTAs are decon (when `requiresDecon`) and back-out edits.
- **S5-A4** — **STOP is non-bypassable via API**: replay the same payload as a direct `POST /api/spray/record` (bypassing the UI) — response is 422 with `error: 'kernel rejected spray; refusing to persist'`, the violation list, and `ruleVersion`; no `spray_events` row is written.
- **S5-A5** — **No bypass field exists**: fuzz the record payload with `force: true`, `bypass: true`, `override: true` — Zod strips/ignores them; the 422 verdict is unchanged.
- **S5-A6** — **Contaminated-sprayer decon gate**: record spray A (chemistry X), then plan spray B (chemistry Y) on the same sprayer — kernel returns `CROSS_CONTAMINATION`, `requiresDecon: true`; STOP card shows the "Open decon wizard →" CTA and deep-links to `/spray/decon`.
- **S5-A7** — **Decon gate holds at the API**: direct `POST /api/spray/record` for spray B → 422 with the `CROSS_CONTAMINATION` violation; sprayer state untouched.
- **S5-A8** — **Decon wizard is linear**: on `/spray/decon`, the Next button on the ammonia step stays disabled until the 30-min timer completes or is explicitly skipped (`stepCanAdvance`, `decon/+page.svelte:89`); steps cannot be jumped by URL or DOM.
- **S5-A9** — **Decon clears the gate**: complete the wizard → `POST /api/sprayers/:id/decon` 200 → re-evaluate spray B → kernel passes (given clean env/stage inputs); top-bar contamination banner disappears.
- **S5-A10** — **Decon timestamp is server-authoritative**: the decon POST body carries no timestamp; `recordDecon(id, Date.now())` is server-side — attempt to POST a fabricated `deconAt` and confirm it is ignored.
- **S5-A11** — **48h lock — read side**: age a record past 48h (insert with `occurredAt = now - 49h` or clock-shift), then GET it — `lockedAt` is stamped exactly at `occurredAt + LOCK_WINDOW_MS` on first read (`sprayEvents.ts:150-160`).
- **S5-A12** — **48h lock — mutation rejected server-side**: `DELETE /api/spray/records/:id` on the aged record → 422 `RecordLockedError` message ("FR-09 48-hour immutability window"). A direct `PATCH` to the same URL → 405 (no handler exists — mutation surface is DELETE-only).
- **S5-A13** — **Locked force-delete is owner-only**: as helper, `DELETE ...?force=true` → 403 "force-delete of locked records requires owner role" (`records/[id]/+server.ts:31-33`); as owner, the same call succeeds and cascades the linked `stock_movements`.
- **S5-A14** — **Helper custom-rate override 403**: as helper, POST `/api/spray/record` with `customRateOverride: true` → 403 "custom rate override requires owner role" (`record/+server.ts:139-141`); as owner, the same payload persists with `customRateOverride: true` stamped on the row.
- **S5-A15** — **Inspector is read-only**: with an inspector-role session, all three record endpoints return 403 before any kernel work (`record/+server.ts:136`, `insecticide/record/+server.ts:77-79`, `fungicide/record/+server.ts:77-79`).
- **S5-A16** — **Stock decrement + audit row**: record a herbicide spray with `tankSizeGallons` set — response `stockDecrements[]` is non-empty; a `stock_movements` row exists with reason `spray-event` and `spray_event_id = persisted.id`; on-hand quantity dropped by the dilution line's `productAmount` in the correct unit.
- **S5-A17** — **Shortfall warns, never blocks**: drain the SKU below the needed amount, spray again — record still persists (200), `stockWarnings[]` carries the shortfall note, balance goes negative for `/inventory` reconciliation.
- **S5-A18** — **Untracked product warns**: spray a plugin with no stock SKU — 200 with warning "not tracked in stock — add a SKU ... to enable auto-decrement"; no movement row.
- **S5-A19** — **Dilution uses calibrated GPA**: with the 18-GPA sprayer selected and a plugin published at 15 GPA, the dilution table's `gpaUsed` is 18 and `acresCovered = tank/18`; product amount is ~20% higher than the plugin-default preview. Swap to the uncalibrated sprayer — `gpaUsed` falls back to the plugin's `gpaCalibration` (never a silent hard-coded 15 when the plugin declares one) (`api/spray/evaluate/+server.ts:187-188`, `calculator.ts:70`).
- **S5-A20** — **Decrement math matches the table**: the `stock_movements` amount for S5-A16 equals the evaluate endpoint's dilution line for the same sprayer/tank — i.e. server decrement also used `stored.calibratedGpa` (`record/+server.ts:245-246`).
- **S5-A21** — **Insecticide IPM gate — UI**: on `/spray/insecticide` with no recent scout observation crossing the threshold, the Record button is disabled and the "IPM threshold not met" banner names the pest + threshold (`insecticide/+page.svelte:92,250-255`).
- **S5-A22** — **Insecticide IPM gate — API**: direct `POST /api/insecticide/record` with no qualifying scout data → 422 `safety-kernel gate(s) failed` with the IPM violation; add a `scout` payload at/over threshold in the same request → passes.
- **S5-A23** — **Pollinator-bloom gate**: high-`pollinatorRisk` product on a block whose crop is inside its `bloomWindow` → 422 from both insecticide and fungicide endpoints; out-of-bloom or low-risk → passes.
- **S5-A24** — **REI/PHI stamped worst-case**: tank-mix two insecticides with different REI/PHI — persisted row's `reEntryClearAt`/`preHarvestClearAt` reflect the max across products (`insecticide/record/+server.ts:310-313`); `/today` shows the re-entry banner until clear.
- **S5-A25** — **Copper × sulfur hard block**: select the M01 and M02 fungicides together — UI Record disables (`tankMixBlocked`) and direct `POST /api/fungicide/record` → 422 `tank-mix incompatibility` with code `COPPER_SULFUR_PHYTOTOXIC`, before any FRAC verdict (`fungicide/record/+server.ts:140-161`).
- **S5-A26** — **FRAC rotation gate**: record fungicide with FRAC 11, then immediately record another FRAC-11 product on the same block → 422 FRAC violation; a different FRAC group passes.
- **S5-A27** — **Dry-run is off**: assert `KERNEL_DRY_RUN` is unset in the environment under test — otherwise IPM/pollinator/FRAC verdicts log to `kernel_dry_run_log` and return `[]` instead of blocking (`lib/safety/dryRunRunner.ts:34-44`). This assertion guards the whole gate suite above.
- **S5-A28** — **Offline queue replays through the kernel**: queue a spray offline (Dexie), then drain — the queued POST hits the same `/api/spray/record` gate; a payload that became unsafe while queued (e.g. sprayer contaminated in the meantime) is rejected 422 on drain, not silently persisted.
- **S5-A29** — **Augmenter only tightens**: attach a stock item whose operator-confirmed `activeIngredientsJson` declares a chemistry the plugin doesn't list — record → 422 `product-not-on-crop` restriction; removing the stock linkage never turns a kernel STOP into a pass.
- **S5-A30** — **Aria-live STOP announcement**: the STOP card region announces via `aria-live="polite"` and all decon/step CTAs meet the ≥48dp tap target (FR-05 CTAs are 56px, `decon/+page.svelte` styles).

### Gaps & drift hypotheses

Known open issues, referenced not re-derived: **#124** (spray flows epic umbrella), **#130** (pollinator gate copy is a text stub), **#132** (fungicide leaf-wet dial deferred pending NEWA hourly feed), **#218** (GPA preview cosmetic clarification).

- **S5-G1 — Insecticide/fungicide stock decrement ignores the sprayer's calibrated GPA** — both use `computeRatedDilution` with `gpaCalibration: p.gpaCalibration ?? 15` (`apps/web/src/routes/api/insecticide/record/+server.ts:348`, `apps/web/src/routes/api/fungicide/record/+server.ts:320`), while the herbicide path passes `stored.calibratedGpa` (`apps/web/src/routes/api/spray/record/+server.ts:245-246`). An 18-GPA rig under-decrements insecticide stock by ~20%. Playtest assertion S5-A20 will pass for herbicide and should be expected to *fail* if extended to the other two flows.
- **S5-G2 — Insecticide/fungicide endpoints never run the cross-contamination gate and never update sprayer chemistry state** — neither imports `getSprayer`/`recordSpray`/`checkCrossContamination`; `sprayerId` is optional and stored as an opaque string (`api/insecticide/record/+server.ts:55,320`, `api/fungicide/record/+server.ts:54,294`). UC-32 step 4 claims a "sprayer chemistry compatibility" gate. Consequence: an insecticide load leaves `lastChemistryClass` stale, and a herbicide-after-insecticide sequence sails past the decon gate. UC-32's "Decon (UC-04) is shared" is aspirational at the enforcement layer.
- **S5-G3 — Decon endpoint has no auth/role gate** — `POST /api/sprayers/:id/decon` checks neither `currentUser` nor `canMutate` (`apps/web/src/routes/api/sprayers/[id]/decon/+server.ts:13-20`). An inspector (read-only role) or any unauthenticated caller inside the session boundary can clear contamination state, which *opens* a safety gate. Contrast with the record endpoints' 403s.
- **S5-G4 — "Mark sprayer clean now" one-click bypass of FR-05** — the decon page ships a `<details>` escape hatch that records a decon timestamp without walking any step (`apps/web/src/routes/spray/decon/+page.svelte:167-182`), and the ammonia timer is skippable (`timerSkipped`, `:88`). Deliberate operator affordance, but it means the 8-step wizard is procedurally advisory; the audit trail cannot distinguish a real decon from a click.
- **S5-G5 — PATCH edit path is documented but does not exist** — `findRecentEditableEventForBlock` says /spray decides "whether a multi-block record should PATCH an existing row or POST a new one" (`apps/web/src/lib/db/sprayEvents.ts:170-178`), and `assertEditable` exists to guard it (`:162-166`), but no PATCH handler is registered under `api/spray/` — the loader consumes it at `apps/web/src/routes/spray/+page.server.ts:64` yet edits are impossible. Immutability is *stronger* than spec'd (fine), but the comment and the dead guard are drift; S5-A12's "PATCH → 405" pins the current truth.
- **S5-G6 — Environmental conditions are synthetic defaults, not observations** — `windMph = 5`, `tempF = 70` hardcoded UI state (`apps/web/src/routes/spray/+page.svelte:83-84`), persisted onto the record as if measured (UC-02 step 6 acknowledges the removed steppers). The environment gate is therefore only exercised by defaults on the herbicide path; a real 20-mph day records as 5 mph. Wiring live weather (or restoring inputs) is the fix; until then the record's `conditionsJson` is provenance-ambiguous.
- **S5-G7 — UI IPM gate checks only `scoutingThresholds[0]`** while the server checks all products' full threshold lists (`apps/web/src/routes/spray/insecticide/+page.svelte:35,92` vs `checkIpmThreshold` in `api/insecticide/record/+server.ts:182-200`). A product whose second threshold is the crossed one shows a disabled Record button the server would accept (fail-closed, but a UX dead-end mirroring the pre-Sprint-12 pattern).
- **S5-G8 — STOP card contrast fails the HCD stop-screen bar** — `#b00020` on `#fce8e8` ≈ 4.8:1 meets WCAG AA but not HCD §2.2's 7:1 (docs/use-cases.md UC-03 audit note, finding F-A; card at `apps/web/src/routes/spray/+page.svelte:1090`). Also the card sits below the 5-step form and requires scroll.
- **S5-G9 — Unauthenticated fallback performer** — all three record endpoints persist as `ensureSystemUser()` when `auth` is null (`api/spray/record/+server.ts:206`), relying entirely on `hooks.server.ts` to prevent unauthenticated reach; the endpoint itself is fail-open on identity. Worth one integration test at the hooks layer.
- **S5-G10 — Copper×sulfur gate is tank-mix-only** — `checkFungicideTankMixCompat` fires only when both products are in the *same* request (`apps/web/src/lib/safety/fungicideTankMix.ts:19-43`); the message says "apply separately at least 7 days apart," but sequential same-block copper-then-sulfur applications inside 7 days are not checked against prior `fungicide_events` (the FRAC rotation check keys on identical codes, not this pair).

---

## S6 — In-season harvest & forage

### Desired outcome

Every planting that reaches its readiness window is visible, correctly staged, and recordable on `/harvest` through an archetype-appropriate form — one renderer per canonical archetype, all committing through the same `POST /api/harvest/record` so the audit trail is uniform. Harvest readiness is DTM-derived for annuals, cut-interval-derived for forage after the first cut (#230), and cure-countdown-enriched (FR-08) after commit. Where storage moisture matters (small grain, row grain, dry legume, forage, squash cure), the operator records moisture at commit and the Phase 26A safety kernel (RULES_VERSION 0.5.2) blocks storage-unsafe commits with a 422 the UI translates into a plain-language STOP. Haymaking runs on its own diary at `/hay`: NOAA-forecast mow gate (FR-19/FR-22, pop>30% in the plugin's weather window → STOP), immutable captured forecast on the cutting row, step logging Mow→Ted→Rake→Bale→Store (UC-14), and a bale-moisture fire-risk gate (>22% for gated bale types → refused, FR-21). In-season fertility applications remain visible per block/year on `/fertility` so N/P/K actuals track the plan. Spraying close to harvest should be caught: a product's PHI (`preHarvestIntervalDays`) should make a too-soon harvest at minimum warn — today it only informs planning, never the harvest commit (see S6-G5).

### Surface & UC map

| Surface | UC / FR | Implementation locus |
|---|---|---|
| /harvest list: ready/upcoming/past staging, header stat line, Export YTD CSV | UC-06 | `apps/web/src/routes/harvest/+page.server.ts` (window math 94–120, sort 152–161), `+page.svelte` (stats 141, export 108–126) |
| Upcoming-windows panel (next 8 too-early plantings) | UC-06 (Sprint 13) | `harvest/+page.svelte:289–306` |
| 10 archetype renderers, dispatched via `resolveArchetype()` (override > archetype > legacy harvestStyle > family) | UC-06, Phase 27A | `lib/components/harvest/HarvestRouter.svelte`, `lib/components/harvest/renderers/*` |
| Harvest commit + moisture kernel gate | UC-06 + UC-16, Phase 26A | `routes/api/harvest/record/+server.ts:48–70`, `lib/safety/harvestMoisture.ts` |
| Moisture thresholds: small-grain 13.5 / row-grain 15.0 / dry-legume 15.0 / forage 18.0 (squash-cure ungated since RULES_VERSION 0.5.7: flesh is 80 to 90% water); warn band = within 1.0% | UC-16 | `lib/safety/harvestMoisture.ts:44–54` |
| Curing countdown (in-progress / ready / overdue) on recorded harvests | FR-08 | `harvest/+page.server.ts:163–203` |
| Forage cut window re-keys on last pick + cutIntervalDays | #230 | `lib/harvest/forageWindow.ts`, consumed at `+page.server.ts:94–107` |
| Hay mow gate: NOAA 3-day forecast, pop>30 wet-day STOP, captured forecast frozen | UC-13, FR-19/22 | `lib/hay/engine.ts:35–79`, `routes/api/hay/cuttings/+server.ts:94–116`, `routes/hay/+page.svelte:57, 256–277` |
| Hay step logging + bale moisture gate (danger/warn above and below) | UC-14, FR-21 | `lib/hay/engine.ts:84–150`, `routes/api/hay/cuttings/[id]/+server.ts:113–128` |
| In-season fertility: per-block/year budget, applications, credits, soil tests | Phase 21b | `routes/fertility/+page.server.ts` |
| PHI conflict detection (plan-side only today) | gap — see S6-G5 | `lib/schedule/timeline.ts:10 detectPhiConflict()`, consumed by `routes/plan/+page.svelte` |

Archetype seed coverage (plugins/crops/*.json, all 10 represented): winter-squash-cure ×90, continuous-harvest-fruit ×86, cut-and-come-again-leafy ×74, perennial-vine-quality ×30, tree-fruit-multi-pick ×25, cover-crop.termination ×22, small-grain.zadoks ×17, row-grain.pollination ×17, dry-seed-legume ×10, forage-cutting-cycle ×5.

### Playtest assertions

**Staging & chrome**

- **S6-A1** — `/harvest` header reads "Harvest · {year} season" with the stat line `N ready today · N upcoming windows · N events YTD`; counts reconcile with the lists below.
- **S6-A2** — A planting whose DTM window has opened shows `in-window` and sorts above `past`, `too-early`, `unknown`.
- **S6-A3** — The Upcoming-windows panel lists at most 8 `too-early` plantings with a "+N more" overflow line; it disappears when none are upcoming.
- **S6-A4** — "Export YTD ↓" is disabled at 0 YTD events; with events it downloads `harvest-ytd-{year}.csv` whose row count matches the YTD stat.
- **S6-A5** — `?crop=<plantingId>` (and `?planting=`) deep-links scroll to and open that planting's record form.
- **S6-A6** — Too-early and past plantings still render the record form (jump-the-gun + backfill paths) with state-distinct banner copy; `unknown` (no DTM/date) does not.

**Per-archetype recording (one committed harvest per family available in seed data)**

- **S6-A7** — Small-grain (small-grain.zadoks, e.g. wheat): renderer highlights the current expected Zadoks stage from days-since-planting and lists the plugin's `moistureGates`; a commit lands in Recorded harvests and in `/records` unified list.
- **S6-A8** — Row grain (row-grain.pollination, corn): bushels / moisture % / test weight / ear count inputs pack into `quantity` + lot tag; commit succeeds.
- **S6-A9** — Dry legume (dry-seed-legume): entering storage moisture 15.5% shows the client-side ">15% — beans will heat and rot" warn banner (`DrySeedLegume.svelte:64–67`); commit is still accepted (see S6-G1 — kernel never sees it).
- **S6-A10** — Winter squash (winter-squash-cure): after commit, the recorded-harvest row shows the FR-08 curing chip cycling in-progress → ready → overdue with days-remaining derived from `postHarvestCuring.durationWeeks`.
- **S6-A11** — Continuous fruit, cut-and-come-again leafy, tree-fruit multi-pick: after a first recorded pick the form stays available (re-harvest set, `+page.svelte:81–87`) and the renderer shows "pick/cut N" from `priorPickCount`.
- **S6-A12** — Single-event archetypes (dry-seed-legume, winter-squash-cure, small-grain): after one commit the form hides and the planting shows harvested state.
- **S6-A13** — Cover crop (cover-crop.termination): method (roller-crimp/mow/…) + residue % + biomass fields commit as a harvest event.
- **S6-A14** — Perennial vine (perennial-vine-quality): Brix/pH/TA capture packs into the lot tag (pending #180 schema lift) and commits.
- **S6-A15** — Forage (forage-cutting-cycle): before first cut, window is DTM-based; after a recorded cut, the next window starts at lastPick + `hayOperations.cutIntervalDays` (#230).
- **S6-A16** — Recording a harvest with a `taskId` closes the matching task (`related_event_table='harvest_event'`).

**Moisture kernel (Phase 26A — exercise via API; see S6-G1 for UI reachability)**

- **S6-A17** — `POST /api/harvest/record` with a wheat plugin + `moisturePct: 16` → 422 `{error: 'HARVEST_MOISTURE_OVER_THRESHOLD', thresholdPct: 13.5}`; no event row is written.
- **S6-A18** — Same POST at `moisturePct: 13.0` (within the 1.0% warn band) → 200 with the event committed; at 12.0 → 200 safe.
- **S6-A19** — Threshold equality (exactly 13.5) commits (block is strictly `>` threshold, `harvestMoisture.ts:89`).
- **S6-A20** — Winter squash at 71% → 422; at 65% → 200 (cure-band gate).
- **S6-A21** — Omitting `moisturePct` always commits — missing moisture is informational, never a kernel violation.
- **S6-A22** — An archetype with no gate (e.g. continuous-harvest-fruit) commits at any moisture value.
- **S6-A23** — UI surfacing: driving the small-grain form to a blocking commit must show the operator the human-readable threshold reason — today the page renders the raw error code and, worse, never sends moisture at all (S6-G1/S6-G3); this assertion is expected to FAIL until wired.

**Hay diary (UC-13/14)**

- **S6-A24** — `/hay` → pick a hay-eligible block → Fetch forecast renders 3 day-summary chips; any day with `popPct > 30` renders with the wet highlight (`hay/+page.svelte:244`).
- **S6-A25** — With a wet day inside the plugin's `weatherWindowDays`, "Record cutting now" → server 422 with `WET_WEATHER_IN_WINDOW`-class violation; the UI shows the red STOP banner naming the wet days.
- **S6-A26** — "Override + record anyway" posts `overrideMowGate: true`, creates the `hay_cuttings` row with the captured forecast frozen in `weather_forecast_json` (FR-22) and `status='mowing'`.
- **S6-A27** — Advancing steps out of order (e.g. bale before ted/rake when the plugin declares those steps) → 409 `cannot advance`.
- **S6-A28** — Bale step at 23% moisture on a gated bale type (danger >22%) → 422 with `MOISTURE_TOO_HIGH … fire risk in storage`; the row does not advance.
- **S6-A29** — Bale at 19–22% (warn band per plugin) → advances with a heating-risk warning attached; below `dangerBelowPct` → leaf-shatter danger violation.
- **S6-A30** — Store step stamps `stored_at`, sets `status='complete'`, and materializes the storage-monitoring task via the UC-11 task plumbing.

**Cross-cutting**

- **S6-A31** — `/fertility?block=…&year=…` lists in-season applications, cover-crop credits, and soil tests for the selected block; totals reconcile with the budget panel.
- **S6-A32** — PHI probe: record a herbicide spray with a non-zero `preHarvestIntervalDays` product on a block, then immediately record a harvest for that block's planting — expected (desired) behavior is at minimum a warn; observed behavior today is silent acceptance (`/api/harvest/record` never consults spray events — S6-G5). Treat silence as a confirmed gap, not a pass.
- **S6-A33** — Helper-role session can view `/harvest` and `/hay` without a 403 (Invariant 8 read-widening).

### Gaps & drift hypotheses

- **S6-G1 (P1) — Phase 26A kernel is unreachable from the shipping UI.** No renderer sends structured moisture: the commit contract is `{quantity?, lotNumber?}` (`apps/web/src/lib/components/harvest/renderers/types.ts:21`), the page's POST body omits `moisturePct` (`apps/web/src/routes/harvest/+page.svelte:44–53`), and `RowGrainPollinated.svelte:18–23` / `DrySeedLegume.svelte:23` pack moisture into the lot-tag string instead. The 422 gate (`api/harvest/record/+server.ts:51–69`) only fires for direct API callers (Phase 24 agents). Related to but not covered by #142 (renderer field gaps — fields exist; the wiring doesn't).
- **S6-G2 (P1) — FR-21 bale fire-risk gate is server-side overridable.** UC-14 says the >22% STOP "cannot be bypassed regardless of UI" (`docs/use-cases.md:205–214`), but `overrideBaleGate: true` skips even danger-severity violations (`apps/web/src/routes/api/hay/cuttings/[id]/+server.ts:120–128`; UI button at `routes/hay/+page.svelte:339`). Either the kernel should hard-refuse danger (allowing override only for warns), or the UC text is stale — one of them must move.
- **S6-G3 (P2) — 422 surfaces as a raw error code.** `harvest/+page.svelte:56` assigns `lastError = out.error` (`HARVEST_MOISTURE_OVER_THRESHOLD`), discarding the API's human `message` + `thresholdPct`. Glove-operability copy rule says the operator should see the threshold sentence.
- **S6-G4 (P2) — `docs/use-cases.md` UC-16 is stale.** Line 229 still reads "spec-defined, NOT implemented" and line 105 says "No moisture-at-harvest field", but Sprint 19 shipped the kernel + `moisturePct` API field. Doc update required per the update-UC-docs working agreement.
- **S6-G5 (P1, gap hypothesis) — no PHI enforcement at harvest time.** `detectPhiConflict()` exists only for plan-timeline rendering (`apps/web/src/lib/schedule/timeline.ts:10`, consumed by `routes/plan/+page.svelte`). Neither `/api/harvest/record` nor the `/harvest` loader checks recent `spray_events` / `insecticide_events` / `fungicide_events` against the applied products' `preHarvestIntervalDays`. Spraying then immediately harvesting produces no warning anywhere. Candidate design: loader-computed PHI chip per planting + a warn (not block — residue timing is label-legal territory, so arguably kernel-block-worthy) on the record endpoint.
- **S6-G6 (P2) — re-harvest set keyed on legacy `harvestStyle` only.** `RE_HARVEST_ARCHETYPES` (`routes/harvest/+page.svelte:81–87`) matches `'cut-and-come-again' | 'continuous-fruit' | 'tree-fruit-multi-pick'` legacy strings, ignoring `archetype`/`archetypeOverride`. An archetype-only plugin (or an operator override to a multi-pick archetype) loses the re-harvest form; `forage-cutting-cycle` is also absent, so a second cut can't be recorded on `/harvest` even though the loader reopens its window (forage cuts route via `/hay`, but the /harvest form still renders for forage plantings pre-first-cut — inconsistent).
- **S6-G7 (P2) — moisture is never persisted on the harvest event.** Even when `moisturePct` passes the gate, `insertHarvestEvent` drops it (`api/harvest/record/+server.ts:71–79` — no moisture arg), so the UC-16 success criterion "export shows moisture column for inspector" (`docs/use-cases.md:241`) is unmet; the YTD CSV (`harvest/+page.svelte:108–126`) has no moisture column. Needs a `moisture_pct` column on `harvest_events` (or the #180-style schema lift).

Pre-verified against the open-issue list: #142/#196 (harvest epics), #201 (stale /stock/add validation), #215 (/calibrate epic) remain open — the entries above are scoped to post-Sprint-19 drift not enumerated in those epics; cite them when filing.

---

## S7 — Post-season compliance & exports

The season's field work is done; what remains is proving it. S7 is the audit-binder stage: the operator (P1 Sherry) assembles the year's records for whoever asks — a VDACS Office of Pesticide Services inspector, a USDA/NRCS cost-share reviewer (EQIP/CSP CPS-595), a CSA member, or her own future self two years from now. The receiving persona is P4 (Dale, UC-22) — the only persona who never touches the app, only its exports, and whose acceptance is the real success criterion.

### Desired outcome

**For the operator:** one visit to `/records` shows the entire year as a unified ledger — every spray, insecticide, fungicide, scout, harvest, fertility, planting, and decon event in one chronological table with kind chips, lock pills, and a retention line ("Retained through {date}"). Filters (sprayer, block, kind, date range — UC-19) narrow it; every export button honors the *currently visible* filter set, so "export what I'm looking at" is the mental model. Records older than the 48-hour FR-09 window are visibly LOCKED in the UI and immutable at the API regardless of UI. A retention alert surfaces records approaching the 2-year VDACS horizon 30 days out so nothing is deleted prematurely.

**For the receiver (UC-22 acceptance criteria — Dale reads it once, accepts, no callback):**

- **VDACS (2 VAC 5-685 / federal RUP recordkeeping, 7 CFR 110):** date of application, product brand name, **EPA registration number**, rate + total amount applied, **crop/commodity treated**, location/site (block), size of area treated (acres), **applicator name + certification number**, target pest. Retention ≥ 2 years. The VDACS PDF (`/api/records/export.vdacs.pdf`) must carry farm identity on every page, be chronological across all three pesticide flows, and be self-describing (no ID-only columns that require a second sheet to decode).
- **USDA/NRCS (CPS-595 pest management, cost-share audit):** the same core fields plus weather at application (wind mph, temp °F) for drift documentation, and an explicit `warning` flag on any row missing an EPA reg number — missing EPA reg is a cost-share eligibility failure, so the export must surface it rather than silently omit the row.
- **Both:** a provenance/integrity footer — who exported, when, from what app version, under what filter, plus a SHA-256 integrity hash (NFR-10) — so the document is attributable and tamper-evident.
- **Read-only inspector access:** an `inspector` session role exists (`session.ts:27` — "read-only across EVERYTHING incl. records, exports"), invitable from `/settings/helpers` (role dropdown includes Inspector, `helpers/+page.svelte:111`). An inspector walking `/records` sees the same ledger with **zero mutation affordances** and every mutating API returns 403 "inspector role is read-only" (`auth.ts:68`).

### Surface & UC map

| Surface | Path | UC / FR |
|---|---|---|
| Unified ledger (8 kinds) | `apps/web/src/routes/records/+page.svelte` + `+page.server.ts`; kinds enum `lib/db/recordKinds.ts:15` | UC-09, UC-19; UC-24 (search — still proposed) |
| Record detail + lock banner | `apps/web/src/routes/records/[kind]/[id]/+page.svelte` (lock banner L68–91, edit CTA L85–89) | FR-09, #195 |
| Lock enforcement (server) | `lib/db/sprayEvents.ts:150` `evaluateLock` (idempotent lock-stamp), `:163` `assertEditable` → `RecordLockedError`; DELETE guard `api/spray/records/[id]/+server.ts:24–44` | Invariant 4, FR-09 |
| Spray CSV | `api/spray/records/export.csv/+server.ts` — 16 cols incl. blockName/sprayerName (B-04 T1/T2), rulesVersion, pluginHashes, locked, signature row (T9) | UC-09, NFR-05 |
| Spray PDF | `api/spray/records/export.pdf/+server.ts` — farm header (T5), integrity hash, signature footer (T9) | UC-09, NFR-10 |
| USDA/NRCS CSV | `api/spray/records/export.usda.csv/+server.ts` — 13 NRCS-template cols, `MISSING_EPA_REG` warning col; #204 fix: applicator email (not UUID), target_pest fallback, fungicide EPA | UC-09, UC-22 |
| VDACS audit-pack PDF | `api/records/export.vdacs.pdf/+server.ts` — spray+insecticide+fungicide unified, cover integrity hash, per-page header/footer, LOCKED column | UC-22, #161 |
| Account JSON (GDPR) | `api/account/export.json/+server.ts` — full tenant dump, schemaVersion 1.0.0 | #205 |
| Retention config + hash-chain card | `apps/web/src/routes/settings/records/` (owner-only, `+page.server.ts:21`) | FR-07, NFR-05 |
| Export-all menu | `apps/web/src/routes/settings/advanced/+page.svelte:17–27` | UC-34 |
| Retention alert | `lib/db/sprayEvents.ts:245` `recordsApproachingRetention` (2 yr − 30 d), rendered `records/+page.svelte:297–301` | NFR-05 |
| Tenant isolation of exports | `lib/db/exports.crossTenant.test.ts` | Phase 18i, Invariant 6 |

### Playtest assertions

Seed a full season (S1–S6 data: sprays across ≥2 sprayers/blocks, ≥1 insecticide + fungicide + harvest + decon + fertility + planting + scout event, ≥1 record backdated >48 h, ≥1 backdated ~23 months).

- **S7-A1** — `/records` loads with all 8 kind chips (`spray insecticide fungicide scout harvest fertility planting decon`) and the summary line shows total / locked / YTD counts matching the seeded data.
- **S7-A2** — Toggling a kind chip filters the table and the chip counts stay accurate (loader filters over the fetched superset, `records/+page.server.ts:45`).
- **S7-A3** — Sprayer filter + block filter each narrow the table (UC-19); URL query params round-trip on reload.
- **S7-A4** — Date-range from/to inputs narrow the table; `to` is end-of-day inclusive (`+page.server.ts:28`).
- **S7-A5** — Each row links to `/records/{kind}/{id}`; unknown kind or foreign-tenant id 404s (`[kind]/[id]/+page.server.ts:46–48`).
- **S7-A6** — Detail page for a <48 h record shows the "Editable until {t}" banner + "Edit in {kind}" CTA; for a >48 h record shows the LOCKED banner with lock timestamp and **no** edit CTA.
- **S7-A7** — API lock: `PATCH`/update on a locked spray row throws `RecordLockedError` (`sprayEvents.ts:226`) regardless of role; `DELETE /api/spray/records/{id}` on a locked row returns 422 without `?force=true`, and `?force=true` is owner-only (403 for helper).
- **S7-A8** — Helper session: can read `/records` and every detail page; any mutation on a locked record is refused server-side (Invariant 5).
- **S7-A9** — Inspector session (invite via `/settings/helpers` role=Inspector): `/records` renders read-only; every `POST/PATCH/DELETE` under `/api/**` returns 403 "inspector role is read-only".
- **S7-A10** — **CSV export** after a season: downloads non-empty, `Content-Type: text/csv`, `Content-Disposition` filename `cropcard-spray-records-*.csv`, header row 1 has all 16 columns, `blockName`/`sprayerName` are human labels, `locked` column reads true for the backdated row, final line is the `# Generated by CropCard v… exported by {email}` signature.
- **S7-A11** — **PDF export**: non-empty `application/pdf`, page-1 farm-context header (farm name + date + email + filter line), integrity hash present, signature footer on every page.
- **S7-A12** — **USDA CSV**: 13 columns exactly per the header contract (`export.usda.csv/+server.ts:18–22`); `applicator` is an email, not a UUID; fungicide rows carry EPA reg; a product whose plugin lacks EPA reg renders with `warning=MISSING_EPA_REG` and still appears; rows sort by `date_iso`.
- **S7-A13** — **VDACS PDF**: covers spray + insecticide + fungicide rows in one chronological table; `X-CropCard-Integrity-Hash` header matches the cover-page hash; LOCKED/editable column present; per-page header carries farm + date + page number.
- **S7-A14** — **Account JSON**: non-empty `application/json`, `schemaVersion`, operator + activeOwner blocks, unified records summary, blocks + plantings; contains **zero** rows from a second seeded tenant (run under both tenants — Phase 18i property test is the automated twin).
- **S7-A15** — Filtered export honors filters: apply sprayer+block+date filters on `/records`, download VDACS PDF — cover page filter line names the sprayer/block and row count shrinks accordingly.
- **S7-A16** — Date-range regression (see S7-G2): CSV and PDF exports with `?from/&to` in the URL must return only in-range rows — currently they will NOT; this assertion is expected-fail until S7-G2 is fixed.
- **S7-A17** — Retention alert: with the ~23-month-old record seeded, `/records` renders the "⚠ N record(s) approaching the 2-year retention horizon" status strip; without it, the strip is absent.
- **S7-A18** — `/settings/records` (owner-only; helper gets 403 `+page.server.ts:21`) shows live counts for sprays/insecticides/fungicides/harvests and in-retention vs older split.
- **S7-A19** — `/settings/advanced` bulk-export cards each download the same bytes as their `/records` counterparts (no divergent code path).
- **S7-A20** — Cross-tenant: signed in to tenant A with tenant B data present, every export (CSV/PDF/USDA/VDACS/JSON) contains only tenant-A rows under arbitrary filter combinations (`exports.crossTenant.test.ts`).
- **S7-A21** — Bearer-token agent (Phase 24) can GET every export endpoint from an arbitrary origin; cookie session from a foreign origin cannot (CSRF bridge).
- **S7-A22** — Receiver dry-run (UC-22, manual): hand the USDA CSV + VDACS PDF to someone who has never seen the app; they must be able to answer "what was sprayed on block X on date Y, at what rate, by whom, was it windy" without asking a single question.

### Gaps & drift hypotheses

- **S7-G1 — /settings/records is largely decorative.** Retention tiles hardcode "7 yr / 3 yr / 1 yr" (`settings/records/+page.svelte:9–14`) contradicting both the loader's 2-year constant (`+page.server.ts:16`) and the section's own sub-copy ("VDACS expects 2 years", `:31`). The lock-window input is a dead control — `value={data.retention.sprayYears * 0 + 48}` (`:50`), never persisted, no settings key. Hash-chain stats are fabricated (`:16–23` comment admits "we don't have a real hash chain yet (Phase 26 work)"; "Last verified: today" is a string literal). "Re-verify chain" is a permanently disabled button (`:78`).
- **S7-G2 — CSV + PDF exports silently drop the date-range filter.** `/records` appends `from`/`to` to all four export links (`records/+page.svelte:39–47,123–137`) but `export.csv/+server.ts:29–31` and `export.pdf/+server.ts` read only `sprayerId`/`blockId`. An operator who filters to June and clicks Export CSV gets the full 2-year set with no warning. VDACS + USDA honor from/to; USDA additionally ignores `sprayerId` (`export.usda.csv/+server.ts:68–70`).
- **S7-G3 — "Download VDACS audit pack" links to the wrong endpoint.** `settings/records/+page.svelte:79–81` points at `/api/spray/records/export.usda.csv` (the USDA CSV), not `/api/records/export.vdacs.pdf`.
- **S7-G4 — Hash-chain claims exceed reality.** `/records` reassurance card says "Every record signs the previous record's hash … the VDACS export bundle includes the full chain + a verification command" (`records/+page.svelte:306–313`), and the VDACS PDF instructs `run \`cropcard verify --hash=…\`` (`export.vdacs.pdf/+server.ts:297`) — no such CLI exists anywhere in the repo. What actually exists: per-record plugin hashes + a per-export SHA-256 of the canonical row set. An inspector following the PDF's own instructions hits a dead end.
- **S7-G5 — "Create inspector link" mis-sold twice.** `/records` card promises "time-boxed link … read-only … No login required" but links to `/settings/api-tokens` (Bearer agent tokens — wrong feature, `records/+page.svelte:315–323`); `/settings/records:82` links to `/settings/helpers`, which is closer (inspector role invite exists) but is neither time-boxed nor login-free.
- **S7-G6 — 8 kinds, not 9: hay is missing from the ledger.** `recordKinds.ts:15` enumerates 8 kinds; hay cuttings (`lib/db/hayCuttings.ts`, UC-13/14, FR-19..23) never surface in `listUnifiedRecords` (`recordsUnified.ts` — no hay branch) nor in any export. A forage operation's mow/bale history is invisible to an inspector.
- **S7-G7 — Harvest/decon/fertility absent from every inspector-grade export.** CSV/PDF are spray-only; VDACS covers the three pesticide flows; only the GDPR JSON (not an inspector format) carries the rest. UC-16's success criterion — "export shows moisture column for inspector" — is unmet even though moisture is now captured (Sprint 19): no `moisture` string in `export.usda.csv/+server.ts` or `export.vdacs.pdf/+server.ts`.
- **S7-G8 — USDA CSV misses VDACS/NRCS-required fields.** No crop/commodity-treated column, no applicator certification number, no total-amount-applied (only rate/acre × separate acres), no REI/PHI. `rate_per_acre` is also mislabeled — it emits `p.rate.amount` in whatever unit the product carries.
- **S7-G9 — Trailing signature row breaks strict CSV ingest.** Both CSVs append `# Generated by …` after the data rows (`export.csv/+server.ts:64–66`, `export.usda.csv/+server.ts:204–206`); Excel renders it as a data row and schema-validating ingestors reject the file. A header comment convention or a separate metadata column would be receiver-safer.
- **S7-G10 — `?force=true` owner delete vs Invariant 4.** `api/spray/records/[id]/+server.ts:30–33` lets an owner hard-delete a *locked* record — arguably an intentional escape hatch, but it contradicts "immutable after the lock window … regardless of UI" and leaves no tombstone in the ledger; a VDACS gap-in-sequence question has no answer. At minimum it should write a superadmin_audit-style row.
- **S7-G11 — Detail-page edit affordance ignores role.** `records/[kind]/[id]/+page.svelte:85–89` renders "Edit in {kind}" for any session incl. inspector/helper (server still refuses, but the UI promise is wrong for the read-only walk in S7-A9).
- **S7-G12 — Retention alert is count-only.** `+page.server.ts:53` ships `approachingRetention` ids but the page renders only an aggregate strip (`+page.svelte:297–301`) — no per-row badge, so the operator can't tell *which* records are near the horizon.
- **S7-G13 — `/settings/advanced:18` labels the spray CSV "CSV + signed JSON"** — no signed-JSON artifact exists; the VDACS PDF and account JSON are the closest analogues.

**Status note:** #204 (USDA export malformed) is genuinely fixed in-file (applicator email map `export.usda.csv/+server.ts:38–48`, target-pest fallback `:50–63`, fungicide EPA `:169–195`) — the fix is complete for the three filed defects, but S7-G8 shows the column contract itself still falls short of the receiver's checklist. Sprint D' (B-04 T1/T2/T5/T9) shipped in the CSV/PDF headers; the open remainder of D' is exactly S7-G1–S7-G13's receiver-POV audit (UC-22 "proposed — nobody has audited it from the receiver's POV", docs/use-cases.md:299–311).

---

## S8 — Post-season close-out & winterization

> **Status: mostly does not exist.** CropCard today ends the season by simply… stopping. There is no close-out surface, no winterization state, no year-end summary, and only a six-enum philosophy carry-forward. A repo-wide grep for `winteriz|closeout|season.close` returns zero code hits. This section documents the four fragments that do exist, the exact dead-ends an operator hits in October, and the normative behavior UC-44..47 must deliver.

### Desired outcome

It is late October in Loudoun County. First hard frost has ended the tomatoes and squash; the winter wheat is in the ground; the last dry-bean lots are below 15 % moisture and in storage. Between now and February the operator should be able to close the season deliberately rather than let it trail off:

1. **Confirm the season is really done (UC-44).** From `/today` (or `/settings/season`), a "Close {year} season" flow walks a checklist: every planting is harvested, terminated, or explicitly marked overwintering (the winter wheat and garlic stay live into next year); the offline pending queue (`/records/pending`) is drained to zero for the active Owner; open tasks are completed or rolled forward; any spray/harvest events still inside the 48-hour lock window are flagged to wait. On confirm, the year is marked closed — records for the closed year become read-only beyond the existing FR-09 lock (a hard, whole-year lock), and `/today` flips to a dormant-season mode that surfaces winterization and planning instead of spray recommendations. Close-out is reversible only by the Owner, with an audit entry.
2. **Winterize equipment with per-chemistry storage SOPs (UC-45).** The close-out checklist links into a winterization pass per sprayer: triple-rinse, run RV antifreeze through pump and lines, remove and store nozzles/screens, note storage location. Crucially this is *chemistry-aware* — a sprayer whose `last_chemistry_class` was paraquat gets the 1 % bleach + 1 % TSP protocol; glufosinate gets detergent rinse; copper fungicide history gets the vinegar rinse (the three class-specific SOPs already listed as CLAUDE.md known follow-ups). Completing the pass stamps a `winterized_at` on `equipment_state` and appends a `'winterize'` `equipment_log` row. In spring, calibration age + winterized status drive a "de-winterize & recalibrate" task before the first spray is allowed to record without a warning.
3. **Generate the year-end summary (UC-46).** One click produces the season in review: totals by category (sprays, insecticide/fungicide events, harvests by crop with yield vs. plan), input spend from stock movements, AI-call usage, compliance posture (all records locked, hash chain intact, VDACS 2-year window status), and per-block crop history. Exportable as PDF/CSV alongside the existing VDACS audit pack. Any AI-written narrative is `provenance: ai` and optional — the deterministic tabular summary is the product (Invariant 7).
4. **Carry the whole operation forward, rotation-aware (UC-47).** "Start {year+1}" copies more than philosophy: blocks persist (they already do), but closed-year plantings become *rotation history* that the Phase 20 allocation wizard consumes — solanaceae don't return to Block 3 for 3 years, the vetch cover crop's N-credit pre-populates the fertility plan, overwintering plantings appear on the new season's Gantt from day one. The existing six-enum carry-forward becomes one step of this flow, not the whole flow.

By February the operator opens `/plan`, and last year is an asset — not 400 orphaned rows.

### What exists today

| Capability | Route / code | What happens when the farmer tries | Evidence |
|---|---|---|---|
| Between-spray decon wizard | `/spray/decon` | Works, but semantics are strictly *between-spray* (FR-05/UC-04): pick sprayer → rinse steps → 30-min dwell timer ("timer is cosmetic") → confirm. No storage, antifreeze, or winterization branch. | `apps/web/src/routes/spray/decon/+page.svelte:107` (POST), `:215` (dwell copy); `apps/web/src/routes/spray/decon/+page.server.ts:5-13` |
| Decon persistence | `POST /api/sprayers/[id]/decon` → `recordDecon()` | Sets `lastDeconAt`, nulls `lastChemistryClass`, appends `equipment_log` kind `'decon'`. Nothing distinguishes an October storage decon from a July between-spray one. | `apps/web/src/routes/api/sprayers/[id]/decon/+server.ts:19`; `apps/web/src/lib/db/sprayers.ts:70-76` |
| Season carry-forward | `POST /api/season/setup/carry-forward` → `carryForward()` | Copies exactly the six philosophy enums + `transitioningStartedYear` from `season_setup.<fromYear>.*` settings keys into `<toYear>`. No plan data, plantings, rotation, stock, or equipment state. Refuses to overwrite an already-started target year. | `apps/web/src/lib/season/setup.server.ts:156-170`; `apps/web/src/routes/api/season/setup/carry-forward/+server.ts:24-33` |
| Records retention page | `/settings/records` | Informational only. Loader computes counts + a 2-year retention split (`sprayInRetention` / `sprayOlder`); page shows VDACS copy ("expects 2 years… retains hash chain 7 years") and export links. No purge, archive, or year-lock action exists anywhere on the page. | `apps/web/src/routes/settings/records/+page.server.ts:16,29-31,40-44`; `+page.svelte:31,79-80` |
| Equipment state | `equipment_state` table + `/equipment` | Tracks `hour_meter`, `last_chemistry_class`, `last_used_at`, `last_decon_at`, `calibrated_gpa`, `calibration_date`. No `winterized_at`, no storage location, no storage checklist. | `apps/web/src/lib/db/schema.ts:669-688` |
| Equipment history | `equipment_log` | Append-only log with `kind` values incl. `'decon'`; a natural home for a `'winterize'` kind, but none exists. | `apps/web/src/lib/db/schema.ts:690+` |
| Pending-queue drain | `/records/pending` (UC-12) | Owner can drain/discard the offline queue for the active Owner, but nothing ties "queue is empty" to any season milestone. | `apps/web/src/routes/records/pending/` (Sprint 10 #240) |
| Per-year settings substrate | `app_settings` composite `(owner_id, key)` | Generic per-Owner key/value store the season-setup keys already live in — the cheapest place for UC-44 close-out state to land without a migration. | `apps/web/src/lib/db/settings.ts:15-37` |
| Use-case numbering | `docs/use-cases.md` | Ends at UC-43 (External Agent API). UC-44..47 are unclaimed. | `docs/use-cases.md` summary table tail |

### Dead-end inventory (playtest assertions)

Click-paths a farmer would actually try in October, and where each stops:

- **S8-A1** — **`/today` → look for "end of season" anything.** Dormant-season /today still renders hero/week-strip/recommendations tuned to an active season. No close-out CTA exists anywhere in the nav or page body. *Assert: no element matching /close|winteriz/i on /today.*
- **S8-A2** — **`/spray/decon` → run the wizard hoping it covers storage prep.** The wizard completes a between-spray decon and stamps `lastDeconAt`; there is no antifreeze/nozzle-removal/storage step and no way to record that the sprayer is now *stored* rather than *clean for the next class*. The 30-minute dwell framing (`+page.svelte:215`) confirms the between-spray intent. *Assert: wizard final step has no storage/winterize option.*
- **S8-A3** — **`/equipment` → open a sprayer detail → look for "Winterize".** Detail shows last-used / last-decon / calibration chips. No winterize action, no storage checklist, no off-season status. Come April, nothing warns that antifreeze may still be in the lines. *Assert: no winterize control on equipment detail.*
- **S8-A4** — **`/settings/records` → try to archive or lock the year.** Page is a read-only retention explainer plus export buttons (`export.usda.csv`, VDACS audit pack). No "close year", no purge of >7-year data, no archival workflow. *Assert: page contains zero mutating forms besides export GETs.*
- **S8-A5** — **`/settings/season` → pick next year → "Use last year's answers".** Works — but copies only the six philosophy enums (`setup.server.ts:161-169`). The farmer's blocks-worth of plantings, rotation history, cover-crop N-credits, and stock levels are not consulted or carried. *Assert: POST /api/season/setup/carry-forward response contains only SeasonSetup fields.*
- **S8-A6** — **`/plan` in January → start next season's allocation.** The wizard allocates as if the farm has no history: no rotation constraint from last year's solanaceae placement, no cover-crop credit auto-populated (UC-47 gap; `nCreditForIntent()` exists but keys off the *setup enum*, not actual terminated cover-crop plantings). *Assert: allocator prompt contains no prior-year planting data.*
- **S8-A7** — **`/harvest` → after the last pick, look for "season complete".** Individual harvest events record fine; there is no aggregate "all plantings resolved" state, so half-harvested plantings silently persist into forever. *Assert: no season-completion affordance on /harvest.*
- **S8-A8** — **Anywhere → look for a year-end summary.** `/records` filters and CSV/PDF exports exist per-record-type, but no aggregated season report exists on any route. *Assert: grep UI for "year in review"/"season summary" → nothing.*

### Feature-gap register

| Gap ID | Gap | UC | Builds on / touches |
|---|---|---|---|
| **S8-G1** | Season close-out state machine: checklist (plantings resolved, pending queue drained, tasks closed), year hard-lock, dormant-mode /today, audit trail, reopen path | **UC-44** | `app_settings` keys `season_close.<year>.*` (or a small `season_state` table); `plantings` + `tasks` + `harvest_events` for checklist predicates; `syncQueue`/`listPendingForActiveOwner()` for queue-drained gate; lock enforcement beside the FR-09 48-h check in the spray/harvest record endpoints; `superadmin_audit`-style audit row; new `/api/season/close` + step on `/settings/season`. New UC doc + `docs/use-cases.md` row. |
| **S8-G2** | Equipment winterization: chemistry-aware storage SOP wizard, `winterized_at` flag, spring de-winterize task | **UC-45** | `equipment_state` migration adding `winterized_at` (+ optional `storage_location`); `equipment_log` `kind: 'winterize'`; branch or fork of `/spray/decon` wizard; class-specific SOP data promoted from CLAUDE.md known follow-ups into `lib/safety/crossContamination.ts` (or sibling `lib/safety/winterization.ts` — RULES_VERSION bump + exhaustive tests per Invariant 1); `tasks` row for spring recalibration; `/equipment` detail CTA. |
| **S8-G3** | Year-end summary: deterministic aggregate report + optional AI narrative, PDF/CSV export | **UC-46** | Read-only over `spray_events`, `insecticide_events`, `fungicide_events`, `harvest_events`, `stock_movements`, `plantings`, `owner_usage_counters`; reuse `/api/spray/records/export.*` PDF/CSV pipeline; AI narrative only via `aiTry()` with `provenance: ai` (Invariant 7); surface on `/settings/records` or `/records?year=`. |
| **S8-G4** | Full-data carry-forward + rotation advisor: plantings → rotation history, cover-crop N-credit from actual terminations, overwintering plantings survive the year boundary, allocator consumes prior-year placement | **UC-47** | Extends `carryForward()` in `lib/season/setup.server.ts`; `plantings` (per-block, per-family history + `cover-crop.termination` archetype events); `lib/plan/inputsPlan.ts` `nCreditForIntent()` re-keyed onto actual terminated cover crops; allocator prompt + validator in `lib/server/aiAllocation.ts` gain rotation constraints (same carry-forward pattern as the Phase 19 `PollinationConstraint[]`); `lib/schedule/scheduleCandidacy.ts` `existingCrops` already models block occupancy — feed it overwintering plantings. |

Sequencing note: UC-44 is the keystone — UC-45 hangs off its checklist, UC-46 reads its closed-year boundary, UC-47 fires from its "start next season" exit. But each is independently shippable; only the year hard-lock (UC-44) touches a safety-adjacent enforcement path and needs kernel-grade tests.

---

## Rectification roadmap

The 2026-07-04 season-lifecycle audit filed **8 stage epics** (#299–306), a **Phase 28 feature epic** (#307), **46 defect issues** (#308–348, #353–357), and **4 new-feature UCs** (#349–352 / UC-44..47), and left dedup comments on 9 existing open issues (#130, #132, #147, #204, #217, #228, #240, #255, #298). Severity mix of the new defects: **1 P0 · 22 P1 · 23 P2**. Every claim in this document's stage sections traces to one of those issues or to a confirmed dead-end backing a Phase 28 UC.

The sequence below orders remediation by risk, not by stage number. Safety-kernel reachability and audit-immutability come first; cosmetic and copy drift last. Issue numbers are clickable in the GitHub tracker.

### Sprint R1 — Audit integrity & safety-gate reachability (must-fix)
The findings that break a safety guarantee the product claims to provide.
- **#308 (P0)** FR-09 lock bypass — insecticide + harvest DELETE ignore the 48h immutability window. Add `locked_at` + `evaluateLock` to both delete paths; migration.
- **#322 (P1)** Harvest moisture kernel unreachable from the UI — wire a structured `moisturePct` field into the moisture-bearing renderers' commit contract (depends on **#339**, the `moisture_pct` column).
- **#323 (P1)** Bale fire-risk danger-STOP is server-overridable — make `severity:'danger'` non-overridable; `overrideBaleGate` may bypass `warn` only.
- **#324 (P1)** No PHI enforcement at harvest — loader PHI chip + record-endpoint check against recent applications' `preHarvestIntervalDays`.
- **#329 (P1)** Owner `?force` delete of a locked record leaves no tombstone — write a `superadmin_audit`-style tombstone on any force-delete.

### Sprint R2 — Authorization & multi-tenant hardening
API-layer authz holes (all fail closed today, but breach Invariant 8) + the offline tenant-tagging hazard.
- **#318 (P1)** `/api/sprayers/[id]/decon` has no role gate — add `requireOwner`.
- **#311 · #313 (P1)** Fertility soil-tests / applications / credits POSTs missing owner gate — audit the whole `/api/fertility/**` family in one pass.
- **#314 (P1)** Offline queue tenant-blind (drain-all-owners when `activeOwnerId` null) — seed the key on layout mount.
- **#317 (P1)** Bearer (Phase 24) mutation path dead — `currentUser` must prefer `event.locals.user`.

### Sprint R3 — Compliance & export correctness (inspector-receiver POV, UC-22)
The exports an inspector actually receives must be complete and honest.
- **#325 (P1)** CSV + PDF exports silently drop the date-range filter; USDA ignores `sprayerId`.
- **#326 (P1)** Inspector exports omit hay/harvest/decon/fertility, moisture, and required VDACS/NRCS columns (needs **#339** first).
- **#327 (P1)** VDACS PDF instructs a nonexistent `cropcard verify` CLI; `/records` + `/settings/records` claim a hash chain that doesn't exist — describe the real per-export SHA-256 or build the chain.
- **#328 (P1)** GDPR account JSON omits planting/decon/hay/api_tokens.
- Cross-ref existing **#204** (USDA — 3 defects fixed; this is the column-contract remainder).

### Sprint R4 — In-season correctness & durability
- **#319 (P1)** Insecticide/fungicide decrement ignores calibrated GPA (~20% under) — pass stored `calibratedGpa`.
- **#321 (P1)** Insecticide/fungicide skip the cross-contamination gate & sprayer-state update — thread the herbicide-path state machine in.
- **#320 (P1)** Synthetic 5 mph/70 °F conditions persisted as measured — wire live weather + a provenance flag.
- **#316 (P1)** Non-herbicide flows unqueueable offline (NFR-02) — generalize the Dexie queue.
- **#315 (P1)** Drain summary drops `skippedOtherOwner`.
- **#309 (P1)** Farm lat/lon + frost inputs unwired (server path exists — UI-only fix).
- **#312 (P1)** No-key mode hides AI add-method chips instead of degrading (one-line fix — the recovery state is already built).
- **#310 (P1)** "Seed a sample plan with Claude" CTA performs no seeding.

### Sprint R5 — Phase 28 post-season features (net-new)
Sequence within the epic: **UC-44 is the keystone** (only safety-adjacent piece — its year hard-lock needs kernel-grade tests); the other three hang off its boundary and are independently shippable.
- **#349 (UC-44)** Season close-out state machine → **#350 (UC-45)** Equipment winterization → **#351 (UC-46)** Year-end summary → **#352 (UC-47)** Full-data carry-forward + rotation advisor. Tracked under epic **#307**.

### Sprint R6 — Polish, copy, and a11y (P2 sweep)
Onboarding decoys (#330 `/setup` 404, #331 CSV strip, #332 superadmin redirect, #333 invite hint), contract/copy drift (#334 409 body, #338 `/stock` link, #340 cure copy, #341 raw error code, #343 VDACS link, #344 inspector link, #347 signed-JSON label), decorative surfaces (#342 `/settings/records`, #345 retention scope, #346 edit affordance), defense-in-depth (#335 seed-without-pluginId), robustness (#337 unknown-task 500), doc drift (#336 calibration queue), and test infra (#348 seed an inspector fixture). Batch by file to minimize churn.

**Accessibility & glove-operability sweep** (folded in from the a11y static audit): **#353 (P1)** hay STOP banner lacks `role=alert` (safety gate not announced to assistive tech) — fix alongside R1; **#354** hay low-contrast error cards + missing `aria-live`; **#355** EditBlockModal (and sibling custom dialogs) no focus trap; **#356** Banner dismiss button below the 44/48dp tap-target minimum; **#357** async mutations (calibrate save, hay steps) lack a visible in-flight state (double-submit risk). Verified already-fixed and NOT refiled: provenance-badge aria-labels (#153) and the helper-invite focus (#206).

> Note on `.claude/launch.json`: added during the audit to run the seeded test server on :5283 (host Node 26 breaks the `better-sqlite3` ABI; a standalone Node 22 toolchain was used). Keep or drop per repo convention.
