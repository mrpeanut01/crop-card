# Use cases — CropCard

Catalogues all use cases CropCard supports or should support (currently 35).
Status is one of:

- **Implemented** — runs in the current build.
- **Spec-defined, NOT implemented** — described in the upstream HCD Guide but no CropCard code exists. UC-15 and UC-16 fall here. See FR-19..FR-23 in [feature-backlog.md](./feature-backlog.md) for current status and implementation loci.
- **Proposed** — implied by the persona but not in any spec. Audit recommends implementing.

UC IDs UC-04, UC-05, UC-06, UC-10 are normative from [CLAUDE.md](../CLAUDE.md). UC-13..UC-16 are normative from the HCD Guide §3.6 — UC-13 and UC-14 shipped in Sprint E. The remaining IDs are assigned in this catalog.

Persona keys (P1–P5) are defined in [personas.md](./personas.md).

---

## UC-01 — Set up a block & planting

- **Persona:** P1 (Sherry)
- **Status:** Implemented at [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte)
- **Trigger:** Pre-season planning, or mid-season replanting after a crop failure.
- **Preconditions:** Signed in as `owner`. At least one crop plugin loaded.
- **Primary path:**
  1. From `/` → tile **Plan**, or top-nav → **Plan**
  2. Type a block label and acres → **Add block**
  3. Pick a date and a crop variety from the registered list → **Add planting**
  4. (If applicable) Companion-system advisor proposes a layout — accept to batch-add (this is UC-07)
- **Success:** Block appears on `/today` upcoming-events list and is selectable on `/spray`, `/scout`, `/harvest`.
- **Click count from `/`:** 5 clicks for a block + planting + companion accept.

## UC-02 — Plan & record a spray

- **Persona:** P1, P2
- **Status:** Implemented at [spray/+page.svelte](../apps/web/src/routes/spray/+page.svelte)
- **Trigger:** Calendar event "spray window" on `/today`, or a scout result of `SPRAY` (UC-05), or ad hoc.
- **Preconditions:** ≥1 block with plantings; ≥1 sprayer; ≥1 herbicide plugin; helper or owner role.
- **Primary path:**
  1. Land on `/spray` (often pre-filled with `?block=<id>` from `/today` or `/scout`)
  2. Select block (1)
  3. Select herbicide(s) (window-stage filtered when deep-linked) (2)
  4. Select sprayer (3)
  5. Pick tank size from quick-picks (4)
  6. Adjust conditions via steppers — wind, temp, rain, optional corn height (5)
  7. **Check safety** (sticky CTA at bottom)
  8. If OK: review tank-mix order + dilution table → **Confirm — record this spray**
  9. Land on success card with next-actions: Today / Records / Plan another
- **Alt paths:**
  - Offline: record is queued via Dexie ([spray:142-198](../apps/web/src/routes/spray/+page.svelte#L142)) and confirmed with "queued" banner.
  - Bypass: jump to UC-03.
- **Success:** Spray record persisted (server or queue) within 48-hour lock window.
- **Click count from `/today`:** ≈11 distinct clicks (block + ≥1 herbicide + sprayer + tank + 4 stepper interactions + check + confirm). With pre-fill: ≈8 clicks.

## UC-03 — Resolve a safety bypass (STOP card)

- **Persona:** P1, P2
- **Status:** Implemented at [spray/+page.svelte:473-496](../apps/web/src/routes/spray/+page.svelte#L473)
- **Trigger:** Kernel returns `ok: false` from `/api/spray/evaluate` — incompatible chemistry, wrong crop stage, contaminated sprayer, or environmental gate.
- **Preconditions:** Inside UC-02 step 7 (safety check returned violations).
- **Primary path:**
  1. Read the **⛔ STOP — do not spray** card
  2. If `requiresDecon`: tap **Open decon wizard →** (UC-04)
  3. Otherwise: read each violation `<li>`; expand `<details>` for the JSON kernel evaluation; back-out and adjust (different herbicide, wait for stage, change conditions)
- **Success:** User changes the spray plan or runs decon. Bypass not actionable as-is; this is by design.
- **Audit notes:** Bypass card sits below the 5-step form; user must scroll. Aria-live `polite` announces it. Contrast `#b00020` on `#fce8e8` ≈ 4.8:1 — meets WCAG AA, **fails HCD Guide §2.2 stop-screen requirement of 7:1+**. See audit finding F-A.
- **Phase 17 (Track 2.3) — data-augmented safety hook:** Per CLAUDE.md invariant #1, the kernel stays hard-coded. The module [apps/web/src/lib/safety/userAddedRestrictions.ts](../apps/web/src/lib/safety/userAddedRestrictions.ts) lets user-added stock and plugin metadata STACK additional restrictions on top of a kernel verdict — never relax it. Hard invariant: `augmented.ok ≤ base.ok`, every base violation preserved, `requiresDecon` monotonically grows. Verified by 3 fast-check property tests across the cartesian input space (200 runs each). Restrictions can match by chemistry class, plugin id, or active-ingredient name; an empty `blocksWhenCropFamily` is a universal block (e.g., expired-lot lockout).
- **Phase 17 (Track 2.4) — augmenter wired into the spray endpoints:** The augmenter now runs at [`/api/spray/evaluate`](../apps/web/src/routes/api/spray/evaluate/+server.ts), [`/api/spray/record`](../apps/web/src/routes/api/spray/record/+server.ts), and [`/api/insecticide/record`](../apps/web/src/routes/api/insecticide/record/+server.ts). Restrictions are built by [userAddedRestrictionsFromStock.ts](../apps/web/src/lib/safety/userAddedRestrictionsFromStock.ts), which compares the operator-confirmed `stockItems.activeIngredientsJson` (Track 2) against the plugin's declared `activeIngredients` and emits a `product-not-on-crop` restriction for any extra ingredient name or chemistry the plugin doesn't list. Endpoints accept an optional `stockItemIds[]` parallel to `productPluginIds[]`; when omitted, the server falls back to `getStockItemByPluginId(pluginId)` so existing callers keep working. The record endpoint refuses to persist when the augmented `ok` is false (422); the insecticide flow surfaces the violation list in its error banner.

## UC-04 — Sprayer decontamination wizard

- **Persona:** P1, P2 (`helper+`)
- **Status:** Implemented at [spray/decon/+page.svelte](../apps/web/src/routes/spray/decon/+page.svelte) — FR-05 compliant
- **Trigger:** Bypass-card decon CTA (UC-03), top-bar decon banner (when sprayer is contaminated), or `/spray/decon` direct link.
- **Preconditions:** Sprayer with `lastChemistryClass` set on the server.
- **Primary path:** 8 steps — drain → 3× water rinse → ammonia 30-min timer → boom flush → 2× final rinse → confirm.
- **Success:** `/api/sprayers/:id/decon` POST clears the chemistry flag; success card shown ([decon:207](../apps/web/src/routes/spray/decon/+page.svelte#L207)); top-bar banner disappears.
- **Audit notes:** Timer is cosmetic; user can close the tab. Step list is linear with **no skip**. Each step's primary CTA is `min-height: 56px` ([decon:325](../apps/web/src/routes/spray/decon/+page.svelte#L325)).

## UC-05 — Scout-and-spray decision

- **Persona:** P1, P2
- **Status:** Implemented at [scout/+page.svelte](../apps/web/src/routes/scout/+page.svelte)
- **Trigger:** Calendar event "spray window" on `/today` (CTA "Scout this block →" deep-links with `?block=<id>&windowStage=<stage>`).
- **Preconditions:** ≥1 block with plantings.
- **Primary path:**
  1. Block pre-selected from query param ([scout:6](../apps/web/src/routes/scout/+page.svelte#L6))
  2. Enter weeds-per-10-sq-ft for 4 spots; add more spots as needed (steppers absent — uses native number input)
  3. Optional: enter tallest-weed inches
  4. Decision card renders live (FR-07: ≥3/10sqft avg → SPRAY)
  5. If SPRAY → "Plan the spray for {block} →" deep-links into UC-02 with `?block=...&windowStage=...&fromScout=1`
- **Success:** Decision recorded mentally; if SPRAY, user advances to UC-02 with form pre-filled.
- **Audit notes:** Tallest-weed input uses placeholder text `placeholder="e.g. 1.5"` ([scout:72](../apps/web/src/routes/scout/+page.svelte#L72)) — violates HCD §2.6 (placeholders disappear on type, unusable with gloves). See finding F-F.

## UC-06 — Record a harvest event

- **Persona:** P1, P2
- **Status:** Implemented at [harvest/+page.svelte](../apps/web/src/routes/harvest/+page.svelte)
- **Trigger:** Calendar event "harvest window" on `/today`, or routine end-of-day check.
- **Preconditions:** ≥1 planting whose DTM window has opened.
- **Primary path:**
  1. From `/today` → CTA "Open harvest →" or top-nav → **Harvest**
  2. Find the planting with `⛏ ready now` badge
  3. Optionally expand "Readiness indicators" `<details>` (Layer 2 disclosure — see audit F-Q)
  4. Tap **Record harvest**
  5. Inline form: quantity (free text), lot number (free text)
  6. Submit
- **Success:** `/api/harvest/record` persists; planting marked `harvested`.
- **Audit notes:** Both inputs use placeholder text ([harvest:133, harvest:137](../apps/web/src/routes/harvest/+page.svelte#L133)) — see F-F. No moisture-at-harvest field on the harvest record — adequate for vegetables. Small-grain harvest (UC-16, FR-21) still requires the moisture extension; the readiness panel surfaces moisture *guidance* from the plugin but does not persist it on the event row.

## UC-07 — Companion-system advisor

- **Persona:** P1
- **Status:** Implemented at [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte)
- **Trigger:** Inside UC-01, after planting a crop that has a registered companion-system plugin (e.g., corn → Three Sisters).
- **Preconditions:** Companion plugin loaded.
- **Primary path:** Inline suggestion below planting form → **Accept** batch-adds companion plantings with offset dates.
- **Success:** Companion plantings appear with their own DTM-driven calendar events.
- **Implementation locus (Phase 17, Track 1, B8):** Companion systems are now data-driven via the `companion` plugin shape's `primaryFamily` + `members[]` fields ([plugins/companions/three-sisters.json](../plugins/companions/three-sisters.json), schema in [apps/web/src/lib/plugins/schemas.ts](../apps/web/src/lib/plugins/schemas.ts)). Adding a new system (Wheat-clover, sunflower-bee-strip) is a JSON edit, not a TypeScript change. The calendar engine consumes companion plugins via `EventContext.companionSystems` ([calendar/engine.ts](../apps/web/src/lib/calendar/engine.ts)); a hardcoded Three Sisters fallback fires only when the registry isn't threaded through (legacy callers + unit tests).

## UC-08 — Author or upload a plugin

- **Persona:** P1
- **Status:** Implemented at [plugins/new/+page.svelte](../apps/web/src/routes/plugins/new/+page.svelte) and [plugins/+page.svelte](../apps/web/src/routes/plugins/+page.svelte)
- **Trigger:** New crop variety, new herbicide, new companion system, new insecticide.
- **Preconditions:** `owner` role.
- **Primary path:**
  - **Authoring:** `/plugins/new` → form-driven crop-or-herbicide builder → save → registry validates Zod schema + bypass check → loaded.
  - **Upload:** `/plugins` → upload JSON file → registry validates → loaded or rejection with structured error.
- **Success:** New plugin appears in `/spray` herbicide list or `/plan` crop list.
- **Audit notes:** Plugin schema is **v1.1** as of Phase 22 (T-08 / #40 closed). The Zod source declares `pluginSchemaVersion` ([schemas.ts:32](../apps/web/src/lib/plugins/schemas.ts)); v1.1 fields (`complianceFlags`, sprayWindow `purpose` + `*Gate` tags, `cropOperationModel`, `hayOperations`, `zadoksStages`, `moistureGates`) are all optional + additive, so v1.0 plugins remain valid. The Phase 21 deferred data backfill (38 crop `sprayWindows[]` got a `purpose`; 102 input plugins got `complianceFlags`) ran via [apps/web/scripts/plugin-data-backfill.mjs](../apps/web/scripts/plugin-data-backfill.mjs).

## UC-09 — Review & export records (CSV/PDF)

- **Persona:** P1
- **Status:** Implemented at [records/+page.svelte](../apps/web/src/routes/records/+page.svelte)
- **Trigger:** Inspector requests records (UC-22), end-of-season summary, internal audit.
- **Preconditions:** ≥1 spray record persisted.
- **Primary path:** `/records` → optional sprayer/block filter (UC-19) → **Export CSV** or **Export PDF**.
- **Success:** File downloads; PDF/CSV is what Dale (P4) reads.

## UC-10 — 1/128-acre GPA calibration

- **Persona:** P2 (entry) / P1 (save)
- **Status:** Implemented at [calibrate/+page.svelte](../apps/web/src/routes/calibrate/+page.svelte) — FR-12
- **Trigger:** New sprayer; nozzle change; pre-season verification.
- **Preconditions:** ≥1 sprayer registered.
- **Primary path:**
  1. Pick sprayer
  2. Enter spread width (in) and stride (ft)
  3. App computes walk distance ([calibrate:108](../apps/web/src/routes/calibrate/+page.svelte#L108))
  4. Walk the distance, collect output, enter ounces
  5. App computes GPA; flags outside 5–60 sanity band
  6. **Save to {sprayer}** (owner only)
- **Success:** `/api/sprayers/:id/calibration` POST updates the sprayer's `calibratedGpa`.
- **Audit notes:** A `helper` completing the wizard cannot save and gets "Owner role required" with no "send result to owner" affordance ([calibrate:154](../apps/web/src/routes/calibrate/+page.svelte#L154)) — see finding F-M.

## UC-11 — Today dashboard / daily actions

- **Persona:** P1, P2
- **Status:** Implemented at [today/+page.svelte](../apps/web/src/routes/today/+page.svelte). Phase 12 promoted `/today` to the primary workflow hub (first tile on `/`, task-centered UI), but the HTTP root `/` still renders the tile grid rather than redirecting; see finding F-E.
- **Trigger:** App open.
- **Preconditions:** None for UI; ≥1 block + crop for non-empty content.
- **Primary path:**
  1. Land on `/today` (currently 1 click from `/`)
  2. Read today's primary tasks; each carries an optional pre-task list and a deep-link CTA (Scout / Spray / Decon / Harvest / Mow / Bale)
  3. Promote a calendar-engine derived event into a real Task with **[+ Schedule]**, or open an existing primary task to start it
  4. Execute the action — closure stamps `tasks.completed_at` from the matching event endpoint
- **Success:** User leaves `/today` with the next task already pre-filled in the right page; completed events close their parent task automatically.
- **Audit notes:** Primary CTA buttons are 44px ([today:241](../apps/web/src/routes/today/+page.svelte#L241)) — under the 48px global rule and 60dp HCD recommendation. See F-H. Pre/post-task chips materialize from plugin templates (`cropPlugin.preTasks`, `equipment.preTasks`) and from a calendar-event promotion path; user-overridden tasks carry `staleAnchor=true` when the source planting date moves.

## UC-12 — Drain offline sync queue

- **Persona:** P1, P2
- **Status:** Implemented at [records/pending/+page.svelte](../apps/web/src/routes/records/pending/+page.svelte)
- **Trigger:** Banner "N pending records queued" appears in the global status bar ([+layout.svelte:75-90](../apps/web/src/routes/+layout.svelte#L75)).
- **Preconditions:** Was offline; spray records were queued via Dexie.
- **Primary path:**
  1. Notice banner OR open `/records/pending` directly
  2. Manual sync or discard each row
- **Success:** Queue empties; banner disappears.
- **Audit notes:** Queue is reachable only via banner or direct URL — not in main nav. Easy to overlook. See F-N.

## UC-13 — Hay cutting decision (weather-windowed)

- **Persona:** P3
- **Status:** Implemented at [hay/+page.svelte](../apps/web/src/routes/hay/+page.svelte) (Sprint E) — FR-19, FR-22.
- **Trigger:** Forage block reaches late-boot or 28+ days since last cutting; user opens `/hay`.
- **Preconditions:** Hay-type crop plugin (alfalfa, orchardgrass, timothy, fescue, etc.) registered with `hayOperations` (steps + weather window + moisture gate). NOAA NWS forecast reachable.
- **Primary path:**
  1. Pick block (hay-eligible blocks listed); plugin auto-selects from `hayPlanting`
  2. Tap **Fetch forecast** — `/api/hay/forecast?blockId=...` calls NOAA NWS, caches for 1h ([weather_forecast_cache](../apps/web/src/lib/db/schema.ts) per the migration)
  3. Forecast view: 3-day day-summary chips (high/low, popPct, conditions)
  4. App evaluates mow gate locally for instant feedback: any forecast day inside the plugin's `weatherWindowDays` with `popPct > 30` becomes a `HayViolation`
  5. If clear: tap **Begin cutting** — server posts to `POST /api/hay/cuttings` with the captured forecast (immutable on the row); `hay_cuttings.status` starts at `mowing`
  6. Banner confirms cutting #N recorded; flow continues into UC-14
- **Alt paths:**
  - Violations present: STOP card lists wet days; user can override only if plugin's gate allows soft-warn (most don't).
  - Forecast fetch fails: error message; user retries or proceeds with manual judgment (gate skipped server-side, recorded in row).
- **Success:** A `hay_cuttings` row exists with the captured 3-day forecast (immutable per FR-22), `status='mowing'`, and the operator on the floor.
- **Audit notes:** Forecast cache TTL is 1h (`weather_forecast_cache.expires_at`) to respect NWS rate-limit guidance. Lat/lon rounds to 4 decimals (~11 m). The captured forecast is frozen in `weather_forecast_json` for audit (FR-22).

## UC-14 — Hay step logging (Mow → Ted → Rake → Bale → Store)

- **Persona:** P3
- **Status:** Implemented at [hay/+page.svelte](../apps/web/src/routes/hay/+page.svelte) (Sprint E) — FR-19, FR-21. Status states match the schema's `hay_cuttings.status` enum: `mowing → tedding → raking → baling → storing → complete`.
- **Trigger:** Operator completes a haymaking step (mow timestamp written by UC-13; subsequent steps advanced from `/hay`).
- **Preconditions:** An active cutting row in non-terminal status.
- **Primary path:**
  1. Active cutting card shows current step (e.g. "tedding due since {time}")
  2. Operator taps the step's CTA — `POST /api/hay/cuttings/[id]` with `{ action: 'advance', step: 'ted' | 'rake' | 'bale' | 'store' }`
  3. **Bale step gate (FR-21)** — hard kernel rule from `apps/web/src/lib/safety/`:
     - User enters bale type (small-square / large-round / large-square), bale count, and measured moisture %
     - Plugin's `baleMoistureGate` evaluates: `>22%` → STOP fire-risk (baling refused server-side); soft warnings outside the green band per the plugin
     - Pass: row records `baleType`, `balesQuantity`, `baleMoistureHundredths`; `bale_at` stamped
  4. **Store step:** `stored_at` stamped; status becomes `complete`. Storage-monitoring task auto-scheduled per plugin's post-tasks template (UC-11 task system materializes it).
- **Success:** Each step writes its timestamp on the `hay_cuttings` row; the bale moisture gate cannot be bypassed regardless of UI; `status='complete'` once stored.
- **Audit notes:** `rules_version` is stamped on the row for replay parity. Moisture stored as hundredths (17.5% → 1750) to match stock-management precision. Storage reminder leans on the same Tasks plumbing (UC-11) — no separate scheduler.

## UC-15 — Small grain planting + Zadoks tracking *(stage projection implemented; observation capture deferred)*

- **Persona:** P1, P3
- **Status:** **Partially implemented.** Stage projection landed in v1.3 — `growthStageTable` schema generalizes `zadoksStages` and the calendar engine emits `stage-window` events for every planted variety. Observed-stage capture (operator records "saw Z65 anthesis on May 14") is still gap, deferred to the inspection-card slice with a future `crop_observations` table.
- **Trigger:** Fall or spring planting of wheat / barley / oats.
- **Primary path:**
  1. Add small-grain variety via UC-08 (plugin manager). Variety inherits the cereal-grain family Zadoks template by default; per-variety overrides via `growthStageTable`.
  2. Soil temp confirmed.
  3. Calendar engine projects Zadoks progression from planting date + DTM. The Plan→Schedule swim-lane bar shows the current expected stage badge (e.g., "Z30 jointing") plus inspect copy on hover.
  4. Stage-gated reminders **(still gap)** would auto-fire from `stage-window` events into the task table — implementation locus is `lib/tasks/` consuming engine events. Manually-scheduled fungicide / N-topdress tasks work today.
- **Implementation locus:** [apps/web/src/lib/plugins/growthStageTemplates.ts](../apps/web/src/lib/plugins/growthStageTemplates.ts) carries the cereal-grain Zadoks template; [apps/web/src/lib/calendar/stageProjection.ts](../apps/web/src/lib/calendar/stageProjection.ts) does the math; [apps/web/src/lib/calendar/engine.ts](../apps/web/src/lib/calendar/engine.ts) emits `stage-window` events.
- **Success criteria:** Plan→Schedule shows current stage and next decision point for every active small-grain planting (✓). Stage-gated task auto-firing remains gap.

## UC-16 — Small grain harvest readiness *(spec-defined, NOT implemented)*

- **Persona:** P1, P3
- **Status:** **Gap.** Extends existing UC-06; needs moisture gate.
- **Trigger:** Small grain enters Z83+ (dough → ripe).
- **Primary path (proposed, per HCD Guide §3.6 UC-16):**
  1. App shows variety-specific harvest indicators from plugin
  2. User logs daily moisture readings during ripening
  3. App plots moisture trend; alerts when target hit (wheat 13–14 %, barley 12–14 %, oats 14 %)
  4. Log harvest: date, variety, block, yield, moisture-at-harvest
  5. Plugin emits post-harvest notes (storage temp, aeration, test-weight target)
- **Implementation locus (proposed):** Extend [harvest/+page.svelte](../apps/web/src/routes/harvest/+page.svelte) record-form with `moisturePercent` field when crop has `moistureGates`. Add moisture-trend chart (or table) to readiness panel.
- **Success criteria (proposed):** Harvest record carries moisture; export shows moisture column for inspector (UC-22).

## UC-17 — Sign in / role assumption

- **Persona:** All
- **Status:** Implemented at [signin/+page.svelte](../apps/web/src/routes/signin/+page.svelte)
- **Trigger:** App open with no valid HMAC cookie session.
- **Primary path:** Demo (owner / helper) or email entry. HMAC cookie issued; redirect to `/`.
- **Success:** Session cookie set; nav shows email + role badge.
- **Audit notes:** Auth.js magic-link is installed but not wired (CLAUDE.md known follow-up). UC-21 (helper invite) is the natural extension.

## UC-18 — Browse season calendar

- **Persona:** P1
- **Status:** Implemented as the **Calendar tab** of [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) (Phase 12 consolidated `/plan/calendar/+page.svelte` into a tab; the old route's `+page.server.ts` still loads but the page component is gone).
- **Trigger:** Planning, "what's coming up", or post-season review.
- **Primary path:** `/plan?tab=calendar` (also reachable via the **Calendar** tab pill at the top of `/plan`). Month-grid view with Prev / Next month, optional field/block filter.
- **Audit notes:** Splitting `/plan/calendar` away as a separate route was the original audit complaint (F-O — "planner often needs both at once"). Phase 12 fixed this by moving Calendar inline as one of five tabs (Overview / Layout / Crops / Schedule / Calendar), so the planner switches tabs without losing context.
- **Implementation locus (Phase 17, Track 1):** Calendar engine behavior is now plugin-authored. Per-crop spray windows live in `cropPlugin.sprayWindows[]` (corn V2/V3 + V4/V6, cucurbit Clethodim were previously hardcoded engine branches — they remain as legacy fallbacks until each variety carries its own). Lifecycle (annual/perennial), rotation lookback, emergence window, cover-crop termination lead, density reference, and shade-casting flag flow through `resolveCropAgronomy()` ([apps/web/src/lib/plugins/familyDefaults.ts](../apps/web/src/lib/plugins/familyDefaults.ts)) which merges plugin-declared values with a single family-default registry. The engine no longer holds its own family-keyed lookup tables.

## UC-19 — Filter records by sprayer / block

- **Persona:** P1
- **Status:** Implemented at [records/+page.svelte](../apps/web/src/routes/records/+page.svelte)
- **Trigger:** Looking for a specific spray.
- **Primary path:** Open `/records` → choose sprayer or block filter → list updates.
- **Audit notes:** No text search; with 2-year retention, a brand search ("when did I last spray Roundup") becomes the dominant query — see UC-24.

## UC-20 — First-run onboarding

- **Persona:** P5
- **Status:** Implemented (Phase 18f). [`/onboarding`](../apps/web/src/routes/onboarding/+page.svelte) creates an `owners` row + Home Field on first sign-in; new users land there automatically via `hooks.server.ts`. Subsequent home-screen guidance is covered by the empty-state CTAs.
- **Trigger:** New user signs in for the first time. `hooks.server.ts` detects no `helper_assignments` row for the session user and redirects to `/onboarding`.
- **Primary path:**
  1. New user signs in via the demo button on `/signin` (or magic-link when B-03 lands).
  2. `/onboarding` form collects farm name + optional location.
  3. Server action creates `owners` row, mints `helper_assignments(role='owner')`, creates an `owner_subscriptions(planCode='free', status='trial')` row, and seeds a Home Field.
  4. Session cookie carries `activeOwnerId`; user lands on `/today`.
  5. New: a one-line "Want to set up your season now?" link points to `/plan` for UC-42 Season Setup (Phase 21).
- **Implementation locus:** [`/onboarding/+page.svelte`](../apps/web/src/routes/onboarding/+page.svelte) + `+page.server.ts`; hooks at [`hooks.server.ts`](../apps/web/src/hooks.server.ts).
- **Success criteria:** A new user reaches "first farm context established" in under a minute and lands on `/today` with a usable empty-state.

## UC-21 — Invite/provision a Helper

- **Persona:** P1
- **Status:** Implemented (Phase 18e). [`/settings/helpers`](../apps/web/src/routes/settings/helpers/+page.svelte) issues SHA-256-hashed invite tokens stored in `helper_invites`; lifecycle managed via [`lib/server/invites.ts`](../apps/web/src/lib/server/invites.ts) (`issue` / `list` / `revoke` / `redeem`). Helper accepts via `/invite/[token]` which calls back through UC-17.
- **Trigger:** Sherry hires Marco; needs him to log in.
- **Preconditions:** Owner role; helper not already assigned.
- **Primary path:**
  1. Owner opens `/settings/helpers` and clicks "Invite a helper".
  2. Enters helper email → `POST /api/invites` mints a single-use invite token (SHA-256 hashed at rest in `helper_invites`).
  3. Email is delivered via [`lib/server/email.ts`](../apps/web/src/lib/server/email.ts) — currently a stdout stub; replace with Resend / Postmark before production (tracked as B-03).
  4. Helper opens the magic link → `/invite/[token]` validates + redeems → server creates `helper_assignments(role='helper')` row + signs in via UC-17.
- **Implementation locus:** [`/settings/helpers/+page.svelte`](../apps/web/src/routes/settings/helpers/+page.svelte) + [`/api/invites`](../apps/web/src/routes/api/invites/) endpoint + [`/invite/[token]/+page.svelte`](../apps/web/src/routes/invite/) acceptance route.
- **Open follow-up:** real email transport (B-03). Until then, owners share the invite URL out-of-band.
- **Success criteria:** Owner adds a helper without dev intervention; helper signs in via the magic link and lands on `/today` with helper role.
- **Cross-reference:** UC-17 (sign-in / role assumption).

## UC-22 — Inspector record review *(proposed; documents the export-receiver journey)*

- **Persona:** P4 (Dale)
- **Status:** **Gap in audit coverage** — the export feature exists; nobody has audited it from the receiver's POV.
- **Trigger:** VDACS / USDA organic certifier / CSA member / crop-insurance adjuster requests records.
- **Current behavior:** Owner exports CSV or PDF from `/records`; emails the file to Dale.
- **Proposed primary path (audit-only, no code):**
  1. Define what every export field means in plain English (chemistry class, decon timestamp, kernel rule version, plugin hash)
  2. Audit the PDF rendering: fonts, page breaks, header/footer with farm name + export date, legend
  3. Audit the CSV column order for spreadsheet usability
  4. Add a one-line "if anything looks wrong, contact …" footer
- **Implementation locus (proposed):** Audit pass scoped under [B-04 in feature-backlog.md](./feature-backlog.md) (Sprint D' polish — quick wins T1/T2/T5/T9). PDF generator location: search [records/](../apps/web/src/routes/records/) for the export endpoint.
- **Success criteria:** Dale reads the export once, accepts the answer, no callback.

## UC-23 — Restore from device loss *(proposed)*

- **Persona:** P1
- **Status:** **Gap.** Litestream replicates the server DB, but Dexie's offline queue is on the client device. If Marco's phone breaks before sync, those records are lost.
- **Trigger:** Phone breaks. New phone. New browser. Same sign-in.
- **Current behavior:** Server records are intact (Litestream → Azure Blob). Client-queued unsynced records are gone.
- **Proposed mitigation (audit-only, no code):**
  1. Document the loss boundary in CLAUDE.md and in `/records/pending` UI
  2. Add a "force-sync now" button on `/records/pending` and recommend it before tractor work
  3. Long-term: server-side draft-spray endpoint so offline records are durable from creation
- **Success criteria:** User understands which records are durable and which aren't, before they trust the queue.

## UC-24 — Search records *(proposed)*

- **Persona:** P1
- **Status:** **Gap.** `/records` filters by sprayer or block only.
- **Trigger:** "When did I last spray Roundup on block 2?", "Show me everything with chemistry class XYZ in 2026."
- **Proposed primary path:**
  1. Add a brand / chemistry-class / date-range filter row above the records table
  2. Prefer client-side filtering (records are already loaded for the current owner) over a new endpoint
- **Implementation locus (proposed):** Extend [records/+page.svelte](../apps/web/src/routes/records/+page.svelte) `data.records` filter logic; ~30 LOC.
- **Success criteria:** A two-year-history brand search returns in <1 second with no extra round-trip.

## UC-25 — Edit fields & blocks in Plan Overview

- **Persona:** P1
- **Status:** Implemented at [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) — Field rename / acreage / notes inline-edit (`editingFieldId` state); Block re-assignment via `editBlockFieldId` bound to a `<select>` of available Fields ([plan/+page.svelte:164,1038](../apps/web/src/routes/plan/+page.svelte#L164)). Field delete is owner-only and guarded server-side.
- **Trigger:** Farmer needs to correct a field name, split a block into a new field, or re-assign a block after a layout change at the start of a new season.
- **Primary path:**
  1. From the Overview tab, tap the edit affordance on a Field card → inline panel opens for name / acreage / notes; save closes panel.
  2. Block row within the Field shows a Field `<select>` — picking a different Field issues `PATCH /api/blocks/:id` with the new `fieldId`. Block keeps all its planting / spray / scout / harvest records (only the FK changes).
  3. Field delete is only allowed when it has no Blocks; the API returns 409 with a structured message otherwise.
- **Constraints:**
  - Block re-assignment cascades correctly: spray/scout/harvest records keep their `blockId`; the Block's `fieldId` is the only FK that moves.
  - `axesLocked` blocks: `inferBlockAxes` will not overwrite a manually-positioned block's east-west / north-south indices when the block is re-assigned.
- **Audit notes:** Comprehensive deletes (planting, sprayer, plugin, etc.) are covered in UC-35 (Phase 12e). Field rename does not regenerate any swim-lane indices — those are centroid-derived from `geometryGeojson` and only move when geometry changes.

## UC-26 — Sidebar navigation + header identity strip + app footer *(proposed)*

- **Persona:** P1, P2, P5
- **Status:** **Design change request.** Current nav is a fixed bottom-tab bar on mobile (7 primary items + "More" overflow) and a horizontal in-header row on desktop. All items are flat; there is no hierarchy.
- **Trigger:** Navigation grows past the 7-item bottom-bar limit; users lose context about which workflow group they are in; inspector/helper cannot quickly orient to their role.

### Proposed changes

#### 1. Sidebar navigation (desktop ≥768 px; drawer on mobile)

Replace the horizontal nav with a persistent left sidebar on desktop and a hamburger-drawer on mobile. Items are grouped into collapsible sections; each section can expand to show sub-items (nested routes / workflow steps).

Proposed section grouping (hierarchical):

| Section | Items |
|---|---|
| **Plan** | Overview, Calendar, Map |
| **Today** | *(leaf — no sub-items)* |
| **Operations** | Spray, Decon, Scout, Harvest |
| **Field & Crop** | Crops, Equipment, Hay, Stock |
| **Admin** | Records, Calibrate, Insecticides, Fertility, Plugins, Settings |

- Each section header is a disclosure button (≥48 dp) that toggles its children.
- The active route's ancestor section auto-expands on page load.
- On mobile the drawer opens via a `☰` hamburger in the header left; backdrop tap or swipe-left closes it.
- On desktop the sidebar is always visible at ≈200 px wide; `<main>` shifts right (`margin-left: 200px`).
- The existing fixed bottom-tab bar is **removed**; `main` padding-bottom reverts to normal.

#### 2. Header identity strip (right-aligned)

The `.top` row already places `.user-area` on the right. Ensure it is always visible in the new layout (not hidden inside the drawer). Contents remain: email, role badge, Sign in / Sign out. No structural change to this data — only ensure the header stays a single slim bar (`~48–56 px` tall) dedicated to brand + identity.

#### 3. App footer

Add a `<footer>` below `<main>` with app name and version. Thin, low-contrast, centered. Version string read from a build-time environment variable (e.g., `PUBLIC_APP_VERSION` via SvelteKit's `$env/static/public`). Version can be set to the git short SHA or semver tag in the CI/CD pipeline.

Example visual:

```text
  CropCard  ·  v0.8.0
```

- Font size `0.75rem`, color `#888` (≈3.5:1 on `#f5f7f4` background — adequate for non-critical info).
- `padding: 0.5rem 1rem`, `text-align: center`.
- Not fixed; scrolls with page content.

### Constraints

- **One-handed operability** — sidebar section toggles and all leaf links must be ≥48 dp tall.
- **HCD overlay #8 (offline-first)** — drawer open/close state is client-side only; no server round-trip.
- **Bottom nav removal** — the decon-banner and status-bar must continue to appear above `<main>` regardless of sidebar state; z-index audit required.
- **Accessibility** — drawer must trap focus when open on mobile; `aria-expanded` on section buttons; `aria-current="page"` on active link.

### Implementation locus (proposed)

All changes are confined to [+layout.svelte](../apps/web/src/routes/+layout.svelte):

- Add `sidebarOpen` reactive state for mobile drawer.
- Replace `.primary-nav` with a `<nav class="sidebar">` containing `<details>` section groups.
- Add `<footer class="app-footer">` after `</main>`.
- Adjust `main` margin/padding for sidebar offset (desktop) and remove bottom-tab padding.
- `PUBLIC_APP_VERSION` env var injected in [Dockerfile](../infra/Dockerfile) and [GitHub Actions workflow](../.github/workflows/).

### Success criteria

- All existing routes reachable from the sidebar within ≤2 taps/clicks.
- Desktop: sidebar always visible; no bottom bar.
- Mobile: hamburger opens drawer; backdrop closes it; focus trapped while open.
- Header shows name + role badge + sign-out on every page.
- Footer shows app name and version on every page.
- Existing a11y invariants (skip-link, `aria-live` banners, focus-visible) pass unchanged.

## UC-27 — Bulk / multi-field entry in Plan Overview *(proposed)*

- **Persona:** P1
- **Status:** **Gap.** The "Add a field" form ([plan/+page.svelte:496](../apps/web/src/routes/plan/+page.svelte#L496)) accepts one field at a time; after each save the form resets and the user must fill it again. Farms with multiple named fields (e.g. Home Field, River Bottom, Leased Parcel) must repeat the cycle.
- **Trigger:** First-run or start-of-season setup where the farmer knows all field names up front.
- **Proposed primary path:**
  1. "Add a field" form gains an **Add another** secondary button that saves the current row and immediately opens a fresh row below, keeping the user in a flow without modal interruption.
  2. Alternatively (or additionally): a tabular "bulk entry" panel with a fixed set of rows (e.g. 5 rows of Name / Acres / Notes) and a single **Save all** button — empty rows are ignored.
  3. On save, all non-empty rows POST sequentially to `POST /api/fields`; success shows each field card in the list below.
- **Constraints:**
  - Each field name must still be unique (server enforces); if one row fails, report the error inline for that row without losing the others.
  - Empty rows must never POST.
- **Implementation locus (proposed):** Extend the "Add a field" section in [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) with a reactive array of draft rows; no new API endpoint needed — `POST /api/fields` is called once per row.
- **Success criteria:** A farmer can name and optionally acreage-stamp five fields in a single form session with one final confirm action.

## UC-28 — Acreage hint text on block & field entry forms *(micro-improvement, proposed)*

- **Persona:** P1
- **Status:** **Gap.** The acres inputs in the "Add block" inline form ([plan/+page.svelte:643](../apps/web/src/routes/plan/+page.svelte#L643)) and the "Add a field" form ([plan/+page.svelte:505](../apps/web/src/routes/plan/+page.svelte#L505)) show only a bare number input with `placeholder="acres"`. There is no affordance pointing users to the Layout tab where acreage can be computed from a drawn polygon.
- **Trigger:** User sees the acres box and doesn't know whether to type a number or whether the app can derive it from the map.
- **Proposed change:**
  - Block acres input: add a `<small>` hint below the input reading: *"Enter acreage, or draw the block on the Layout tab to compute it from the polygon."*
  - Field acres input (the `grid2` label): same pattern — *"Optional. Block polygons on the Layout tab compute acreage automatically."*
  - Hint text: `font-size: 0.75rem; color: #666;` to keep it visually subordinate.
- **Implementation locus (proposed):** Two-line change inside the Overview section of [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) — one `<small>` element after each acres `<input>`.
- **Success criteria:** A user who has never opened the Layout tab can read the hint and understand that acreage can come from either manual entry or map-derived computation.

## UC-29 — Crops dashboard & per-crop history

- **Persona:** P1
- **Status:** Implemented at [crops/+page.svelte](../apps/web/src/routes/crops/+page.svelte) and [crops/[id]/+page.svelte](../apps/web/src/routes/crops/[id]/+page.svelte) (Phase 12d).
- **Trigger:** Owner wants to see "what's growing where" or open the timeline for one crop.
- **Preconditions:** ≥1 crop row.
- **Primary path:**
  1. Open `/crops`. Status tabs (Active / Harvested / Planned / Failed / Archived) filter the list; optional `blockId` and `year` query params narrow further.
  2. Each card shows variety, block, planting date, status. Tap it to open `/crops/[id]`.
  3. Per-crop detail page consolidates the full timeline tied by `crop_id`: spray events, harvest events, insecticide events, fertility applications, hay cuttings, tasks, stock movements.
- **Success:** Owner sees the per-crop "Brewfather batch" view with every event scoped to that planting.
- **Audit notes:** A Crop is one planting on one block. Per CLAUDE.md Phase 12d, every event table now FK's `crop_id`, and the Phase 13 backfill populated `stock_movements.crop_id` from source events. Pre/post-task templates (UC-11) are anchored on the Crop, so the dashboard surfaces them in chronological order.

## UC-30 — Equipment management & maintenance log

- **Persona:** P1, P2
- **Status:** Implemented at [equipment/+page.svelte](../apps/web/src/routes/equipment/+page.svelte) and [equipment/[id]/+page.svelte](../apps/web/src/routes/equipment/[id]/+page.svelte) (Phase 8a unified table; legacy `sprayers` table is vestigial).
- **Trigger:** Register a new tool, log usage, schedule maintenance, or check calibration state.
- **Preconditions:** Owner role to add or retire equipment; helper can log usage entries.
- **Primary path:**
  1. `/equipment` lists all equipment with type filter (sprayer / planter / drill / rake / baler / tractor / mower / irrigation / other) plus retired toggle.
  2. **Add equipment** form sets type + label + free-form `specJson` (capacity, working width, hp, nozzle count).
  3. Sprayer-typed equipment carries chemistry-history + decon + GPA-calibration state in `equipment_state`; the safety kernel reads these on every spray.
  4. `/equipment/[id]` shows usage history (`equipment_log`) with kinds: `use`, `maintenance`, `calibration`, `decon`, `inspection`, `note`.
- **Success:** Equipment row exists with current state surfaced wherever the kernel needs it (`/spray`, `/calibrate`, `/spray/decon`).
- **Audit notes:** `pendingCalibrations` (UC-10 / FR-12) targets the unified `equipment` table; helpers stage calibration here and owners approve from `/equipment/[id]`. Equipment-anchored pre/post-task templates (`equipment.preTasks`) materialize on Crops via UC-11.

## UC-31 — Stock inventory, lots, and low-stock alerts

- **Persona:** P1
- **Status:** Implemented at [stock/+page.svelte](../apps/web/src/routes/stock/+page.svelte) and [stock/[id]/+page.svelte](../apps/web/src/routes/stock/[id]/+page.svelte) (Phase 8b).
- **Trigger:** Receive new product, audit on-hand, or reorder before next field operation.
- **Preconditions:** Owner role for create/receive; spray/insecticide/fertility events auto-decrement.
- **Primary path:**
  1. `/stock` groups items by category — herbicide / insecticide / fungicide / fertilizer / seed / adjuvant / fuel / part — each with a sub-category accordion (driven by taxonomy terms; UC-34).
  2. Add a SKU with default unit + reorder threshold; optional barcode (scanned via [BarcodeScanner.svelte](../apps/web/src/lib/components/BarcodeScanner.svelte)), label capture (Anthropic-extracted metadata for seed packets, etc.), or **Add From URL** — paste a seed-company / chemical-supply product page URL and the server fetches the page, strips HTML, and asks Claude to pre-fill the Add card (handler: [scan-url/+server.ts](../apps/web/src/routes/api/scan-url/+server.ts), reuses the same `SYSTEM_PROMPT` and `ScanResult` shape as label scan; `source: 'claude-url'`).
  3. Receive inventory as a lot (`stock_lots`) with `lotNumber`, `expiresAt`, received quantity, supplier, cost.
  4. On-hand per lot = `received_quantity_hundredths` + Σ `stock_movements.delta_hundredths`. Spray / insecticide / fertility events post negative movements via FIFO oldest non-expired lot.
- **Success:** On-hand totals reflect every event; expired lots and below-reorder-threshold SKUs surface via the top-bar banner.
- **Audit notes:** Quantities stored as integer hundredths to preserve 2-decimal precision (e.g., 1.50 fl-oz → 150). Per-crop attribution on `stock_movements.crop_id` powers per-crop "what did this crop consume?" rollups (UC-29).
- **Phase 17 (Track 2):** AI label scan now captures **active ingredients + concentration** (chem products) and **N-P-K + formulation type + product class** (fertilizers) into two new columns: `stockItems.activeIngredientsJson` and `stockItems.formulationJson`. Migration `0019_phase17_track2_stock_formulation.sql`. The Claude Sonnet 4.6 vision prompt in [scan-label/+server.ts](../apps/web/src/routes/api/scan-label/+server.ts) returns `activeIngredients[]` (name, concentrationPct, chemistryClass, iracGroup, fracCode) and a `formulation` block; the inventory-add UI surfaces an editable read-only summary with discard before save. Active-ingredient chemistry classes feed the new data-augmented safety hook (UC-03 augment).

## UC-32 — Insecticide scout-and-spray

- **Persona:** P1, P2
- **Status:** Implemented at [insecticides/+page.svelte](../apps/web/src/routes/insecticides/+page.svelte) (Phase 10). Distinct from the herbicide flow (UC-02 / UC-05) so REI / PHI logic stays first-class and herbicide cross-contam queries stay fast.
- **Trigger:** Pest threshold reached during scouting; calendar event "insecticide window"; or ad-hoc.
- **Preconditions:** ≥1 block with crop; ≥1 insecticide plugin loaded; owner or helper role.
- **Primary path:**
  1. Pick block (pre-fillable via `?blockId=`), insecticide plugin, target pest.
  2. Choose scout metric — `count-per-plant`, `pct-defoliation`, or `pct-infested-plants` — and enter the reading.
  3. Adjust environmental conditions (wind, temp, rain) and tank size.
  4. **Check safety** — kernel evaluates plugin gates (target-pest fit, REI/PHI vs. neighboring activities, environmental thresholds, sprayer chemistry compatibility).
  5. Pass: confirm to record. Row written to `insecticide_events` with `scoutObservationJson`, computed `reEntryClearAt` and `preHarvestClearAt`, plus `rules_version` and `plugin_hashes_json` for replay.
- **Success:** Insecticide event recorded; REI/PHI windows surfaced on `/today` until they clear; stock auto-decrements via FIFO (UC-31).
- **Audit notes:** Reuses the same safety kernel as UC-02 with insecticide-specific gates. Decon (UC-04) is shared — sprayers contaminated by an insecticide go through the same wizard.
- **Phase 17 (Track 2.4) — user-added stock check:** After the environmental gate clears, the endpoint runs the safety augmenter against any stock items whose `activeIngredientsJson` was operator-confirmed during the Phase 17 (Track 2) label scan. If the stock declares an ingredient or chemistry class the plugin doesn't list, the request returns 422 with the violation list before any `insecticide_events` row is written. The UI surfaces the violations under the error banner with a `stock label` badge so the operator can see the specific mismatch. See UC-03 Track 2.4 for the wider wiring.

## UC-33 — Soil fertility tracking & N/P/K budget

- **Persona:** P1
- **Status:** Implemented at [fertility/+page.svelte](../apps/web/src/routes/fertility/+page.svelte) (Phase 10). Schema: `soil_tests`, `fertility_applications`, `fertility_credits`.
- **Trigger:** Lab results back; cover-crop terminated; manure/compost spread; pre-plant nutrient plan check.
- **Preconditions:** ≥1 block; owner role.
- **Primary path:**
  1. `/fertility` block + year filter narrows the view.
  2. **Soil test** entry: pH, CEC, organic matter, NO₃, P, K (lab + report PDF link optional).
  3. **Fertility application** entry: source ('10-10-10' / 'composted chicken manure' / 'urea 46-0-0'), rate per acre + unit, plus computed N / P₂O₅ / K₂O delivered (auto-derived from source if known).
  4. **Cover-crop / legume credit** entry: source ('cover-crop:crimson-clover-cover'), applies-to year, plugin-anchored N/P/K credits (defaults from the crop plugin).
  5. Per-block budget rollup = Σ credits + Σ applied − crop demand (display-only).
- **Success:** Each block carries a defensible nutrient ledger; values feed the `/records` USDA export (UC-09).
- **Audit notes:** Quantities stored as hundredths of pounds-per-acre to match stock-management precision. `fertility_applications` can FK to a `stock_item` for auto-decrement; bare-source rows (e.g. on-farm manure) skip stock attribution.

## UC-34 — Settings & taxonomy management

- **Persona:** P1
- **Status:** Implemented at [settings/+page.svelte](../apps/web/src/routes/settings/+page.svelte). Schema: `app_settings` (key-value, owner-managed) and `taxonomy_terms` (domain-scoped). Page uses an Apple-style two-pane layout — left sidebar of section labels, right detail pane.
- **Trigger:** Operator wants to add a new sub-category (a custom seed type, a new equipment class), set an operator-controlled secret (Anthropic API key), tune AI guardrails (monthly USD cap, per-endpoint daily call quota), update farm coordinates / frost dates, or rename a default.
- **Preconditions:** `owner` role (server-enforced on `/api/settings` and `/api/taxonomy`).
- **Primary path:**
  1. Open `/settings`. Default landing pane is **Overview** — read-only counts (blocks, crops, equipment, stock SKUs).
  2. **AI** pane (owner-only): paste/clear the Anthropic API key; set the monthly USD cap (the AI guard returns 402 once spend reaches it); set per-endpoint daily call quotas (`suggest`, `succession`, `optimize`, `allocate` — guard returns 429 once a quota is hit). A live spend widget shows month-to-date USD vs cap and a percent-used bar that turns warn-orange at 80%.
  3. **Location & Climate** pane (owner-only): set farm latitude / longitude (drives the NOAA NWS forecast cache key) and last spring / first fall frost dates as `MM-DD` (anchors the season calendar engine). Defaults are Loudoun County, VA — `(39.09, -77.6)`, `04-15` / `10-15`.
  4. **Types** pane (owner-only): terms grouped by domain — `inventory:seed`, `inventory:herbicide`, `inventory:insecticide`, …, `equipment`. Add / rename / delete custom terms; system defaults (`isDefault=true`) can be renamed but not deleted.
  5. **Danger Zone** pane (owner-only): the `WIPE-EVERYTHING` confirmation flow with optional "keep equipment" / "keep weather cache" toggles.
- **Success:** New taxonomy term appears as a sub-category option in `/stock` and `/equipment`; settings keys are honored on the next request (frost dates by `frostDatesForYear`, lat/lon by `getFarmLatLon`, AI guardrails by `checkGuard` in [aiGuard.ts](../apps/web/src/lib/server/aiGuard.ts)).
- **Audit notes:** Owner-only reads and writes (helpers see nothing). `/api/settings` validates per-key shapes (number for the USD cap, JSON object for the daily quotas, JSON `{lat, lon}` for coordinates, `MM-DD` regex for frost dates). DELETE removes the override and the getters fall back to the constants in [`schedule/constants.ts`](../apps/web/src/lib/schedule/constants.ts).

## UC-36 — Seed-to-block auto-assign on Schedule

- **Persona:** P1
- **Status:** Implemented (Phase 14a) — Schedule tab gains seed-aware block assignment on top of the existing swim-lane.
- **Trigger:** Owner has seed inventory on hand and wants to allocate it to blocks before picking planting dates.
- **Preconditions:** ≥1 block defined (UC-25); ≥1 seed stock item with `category='seed'` and `onHand > 0` (UC-31). Owner role; helpers see the rail read-only.
- **Primary path:**
  1. Open `/plan?tab=schedule`. The right rail shows a new **Seed Stock** section above the existing "To schedule" tray and Catalog. Only seeds with on-hand > 0 surface; only seed entries with a registered `pluginId` are clickable.
  2. Click a seed entry → `SeedQuantityModal` opens with on-hand line, +/- steppers (≥48dp), and a plant-equivalent estimate from `plantingGuide` row × in-row spacing.
  3. Confirm → seed appears in a **Pending placements** card and the system POSTs the full pending set to `POST /api/crops/plan` (preview, no DB write). The deterministic two-pass greedy engine (`apps/web/src/lib/layout/engine.ts`) scores every (seed × block) using companion-good/bad, sun match, shade impact, rotation lookback, capacity fit, fragmentation, narrow-block penalty, and Three-Sisters bonus, then returns assignments + unplaced + diagnostics.
  4. The card shows per-seed assignments (`→ block <id> · N plants · score`) and any unplaced seeds with a reason.
  5. Adding more seeds re-runs the engine across the entire pending set (free re-shuffle): previous placements may move to optimize the whole layout.
  6. **Commit** → `POST /api/crops/commit` re-runs the engine server-side and inserts `crops` rows with `status='planned'`, `plantingDate=null`, `quantity_planted_hundredths` + `quantity_unit` set. Committed crops appear in the existing "To schedule" tray for swim-lane drag-drop date assignment.
- **Tray gating refinement:** The "To schedule" tray hides any planned crop whose `cropPluginId` has no matching seed stock with `onHand > 0` — a tray entry the operator can't act on is noise.
- **Success:** A few clicks turn an inventory list into a deterministic block-by-block plan; committing populates the unscheduled tray. The operator then drags each tray card onto the swim-lane to assign a planting date (existing UC-18 / drag flow).
- **Audit notes:** Engine is pure and deterministic — same input produces identical output, validated by `apps/web/src/lib/layout/engine.test.ts`. Stock is **not** decremented at commit; existing FIFO `decrementForUse({cropId})` runs at planting (status flip). All mutating endpoints `requireOwner()`. Schema migration `0015_warm_silvermane.sql` adds two nullable columns to `crops`; legacy rows stay NULL and the UI treats NULL as "unknown qty," preserving prior behavior.
- **Phase 17 (Track 3) — cross-endpoint AI context reuse (applies to UC-36 + UC-37 + the /api/plan/{suggest,optimize,allocate,groups} endpoints):**
  - **Track 3.1 — farm-context cache:** [aiContextCache.ts](../apps/web/src/lib/server/aiContextCache.ts) is a content-addressed in-process LRU keyed on a SHA-256 of the assembled FarmContext. [aiContext.ts:buildFarmContext](../apps/web/src/lib/server/aiContext.ts) is now a thin wrapper. A `suggest → optimize → allocate → groups` session reuses the same context bytes across all four calls (10-min TTL matching Anthropic's ephemeral cache).
  - **Track 3.2 — dual prompt-cache breakpoints:** The system prompt is now split into a small invariant header and a bulky block+catalog dump, each with its own `cache_control: 'ephemeral'` ([aiPlanning.ts:buildFarmSystemBlocks](../apps/web/src/lib/server/aiPlanning.ts)). Even when an endpoint adds task-specific framing to the header, the bulky catalog block stays cached. All three callers (`planWithAI`, `aiAllocation`, `aiGroupPlanning`) consume the new builder.
  - **Track 3.3 — derived-signal store:** [aiDerivedSignals.ts](../apps/web/src/lib/server/aiDerivedSignals.ts) caches expensive intermediate facts (density-per-draft, candidacy-matrix, viable-windows, rotation-history) keyed on the same `contextVersion` as Track 3.1. `getOrComputeDerivedSignal()` is the recommended accessor — invalidates automatically when the underlying farm state changes. **As of the Phase 17 wrap-up, `aiAllocation.ts` and `aiGroupPlanning.ts` both wrap their candidacy-matrix build with `getDerivedSignal`/`setDerivedSignal` keyed on the farm `contextVersion` + a hash of the seed/draft set, so a `suggest → allocate → groups` sequence on the same inputs avoids recomputing the matrix.**
  - **Track 3.4 — conversation threading (behind `CROPCARD_AI_THREAD=1` flag):** [aiPlanningSession.ts](../apps/web/src/lib/server/aiPlanningSession.ts) persists prior turns under a `planningSessionId` so subsequent endpoints can echo Claude's prior reasoning into the message history. Disabled by default; enable for "plan everything" flows where Claude shouldn't re-explain rotation logic it already worked out. **All three plan endpoints — `/api/plan/suggest`, `/api/plan/allocate`, `/api/plan/groups` — accept an optional `planningSessionId` in the request body and forward it through to `planWithAI`, `allocate`, and `proposeGroupPlans`. Each Anthropic call inside those modules now calls `appendTurn` so a multi-endpoint session sees the same conversation history.**
  - **Track 3.5 — telemetry:** [aiCallStats.ts](../apps/web/src/lib/server/aiCallStats.ts) records per-call cache_hit_ratio, derived_signal_hit, token counts, and USD estimate to a 200-entry ring buffer. `getAiCallStatsSummary()` rolls up the cross-endpoint totals; an admin endpoint can expose it. Without this measurement, "more context reuse" is faith-based — verification step in the Phase 17 plan calls for ≥30% input-token reduction across a typical planning session. **`recordAiCall` is now invoked from all four AI modules (`planWithAI`, `aiAllocation`, `aiGroupPlanning`, and the retry path inside each), tagged with the endpoint name so the telemetry summary attributes spend correctly. Telemetry under-counted ~2/3 of AI traffic before this wrap-up.**
  - **Verification:** [aiContextCache.test.ts](../apps/web/src/lib/server/aiContextCache.test.ts) (6 tests) and [aiDerivedSignals.test.ts](../apps/web/src/lib/server/aiDerivedSignals.test.ts) (6 tests) lock the contract. Manual: run a four-endpoint planning session, inspect `cache_read_input_tokens` per call — calls 2/3/4 should show ≥80% cached input on system+catalog blocks.

## UC-37 — AI seed allocation wizard (Crops tab)

- **Persona:** P1
- **Status:** Implemented (Phase 14e). Crops tab gains an AI-assisted multi-seed × multi-block allocation wizard layered on top of UC-36's deterministic engine.
- **Trigger:** Owner has multiple seed lots and several candidate blocks and isn't sure how to split them — e.g., 0.5 lb of Bloody Butcher corn (is that too much for one block?) plus 12 cucurbit varieties competing for 6 blocks.
- **Preconditions:** ≥1 block with `acres` or `geometryGeojson` set; ≥1 seed stock entry with on-hand > 0 and a registered crop plugin; owner role (server-enforced via `requireOwner()`); optionally an `ANTHROPIC_API_KEY` (engine-only fallback runs without one).
- **Primary path:**
  1. On `/plan?tab=crops` the seed-stock rail shows a **🤖 Suggest allocation** button. Click → fullscreen wizard opens.
  2. **Step 1 — Seeds.** Table of eligible seed lots with checkbox + per-row quantity input (default = on-hand). Plant-equivalents derived via `lib/seed/quantity.ts` from `plantingGuide.seedsPerAcre / recommendedLbsPerAcre`, with family-default fallbacks and a configurable germination % (default 0.85).
  3. **Step 2 — Blocks.** List of blocks with usable-area chip (geometry inset by 3 ft buffer when polygon present, otherwise `acres × 0.85`), sun exposure, and active-planting count. Multi-select.
  4. **Step 3 — Review.** `POST /api/plan/allocate` returns assignments + per-row sufficiency + AI rationale. The server pre-computes a candidacy matrix (per (seed, block) pair: `plantsFit`, sufficiency tri-state, sunMatch, rotationOk, companion conflicts, narrow-block flag, three-sisters candidate) and feeds it to Claude Sonnet alongside the cached farm context. AI output is **validated** against the same constraints (capacity, seed availability, no-bad-companion); on failure the server retries once with violations prepended, then falls back to the deterministic `planLayout()`. The review step now also runs an inline **chat refinement** panel — the seed message lists the AI's advisories + any cross-pollination findings; subsequent turns hit `POST /api/plan/allocate/refine` which rebuilds the same candidacy matrix and applies the operator's request as a JSON-validated revision (see UC-37b for chat protocol; failure rolls back to the previous plan with a friendly reply).
  5. **Step 4 — Schedule.** "Accept all → schedule" advances to the scheduling pane (see UC-37c) where Claude proposes planting dates. The same chat panel continues; refinement turns route to `POST /api/plan/schedule/refine`.
  6. **Step 5 — Commit.** Each scheduled planting posts to `POST /api/blocks/[id]/plantings` with `plantingDate` populated (stock decrement + planting creation already wired). Succession plantings commit as separate dated rows. Progress bar + per-row error reporting.
- **Decrement semantics:** the wizard apportions the **user's original seed quantity** (from step 1) across blocks by plant share, not the post-germination plant count. Example: 25 seeds → 21 plants (one assignment) decrements 25 seeds from stock, not 21. Integer-required units (`seeds`, `count`, `packets`) use largest-remainder rounding so the per-block values sum back to the original quantity exactly. Logic lives in `AllocationWizard.svelte:buildCommitQuantities`.
- **Bucket merge:** when an assignment lands on a block that already has a planned (null-date) row for the same `cropPluginId` + `quantityUnit`, `addPlanting` increments the existing row instead of creating a duplicate (covers both the wizard commit and manual seed → block drag-drop).
- **Sufficiency UI:** chips render `match · 99%`, `surplus · +123 plants`, `deficit · 55% used` based on `lib/layout/sufficiency.ts:sufficiencyOf` (10% tolerance band).
- **Geometry inset:** `usableSqft` insets convex polygons by a uniform 3 ft buffer; concave polygons fall back to `acres × 0.85` (concavity detected via cross-product sign changes); over-collapse cases (e.g. a 4 ft × 100 ft block at a 3 ft buffer) report 0 usable area. Per-block editable buffer is intentionally out of scope for v1.
- **Cost guard:** routed through `aiGuard.checkGuard('allocate')` (default 5 calls/day, shared monthly USD cap with the other AI tasks); model is Claude Sonnet 4.6 with the prompt-cached farm-context system block. Per-call cost surfaced in the wizard footer.
- **Success:** Owner picks N seed lots and N blocks, accepts the proposed plan, and lands N planted-status crops on the swimlane in seconds — with sufficiency feedback that calls out under/oversized seed buys and AI rationale that explains why the cucurbits ended up where they did.
- **Audit notes:** Engine path is deterministic and unit-tested (`engine.test.ts`, new `sufficiency.test.ts`, new `quantity.test.ts`, new `aiAllocation.test.ts`). AI path is grounded — Claude only chooses among matrix rows; it cannot invent placements. Stock decrement is FIFO via the existing planting endpoint; no new commit endpoint introduced. Cross-references UC-36 (deterministic two-pass auto-assign).
- **Phase 19 — cross-pollination spatial advisor:** the allocator now emits a `pollinationConstraints[]` payload describing crossing pairs in the selection (Zea mays varieties, B. oleracea brassicas, same-species Cucurbita squashes). Plugin metadata: optional `crossesWith[]` (pluginIds or `family:<name>` tags), `isolationFeet`, `isolationStaggerDays` ([schemas.ts](../apps/web/src/lib/plugins/schemas.ts)). Family defaults live in [lib/plan/pollination.ts](../apps/web/src/lib/plan/pollination.ts) (home-scale 250 ft + 14 d stagger for corn and brassica; cucurbit species peers via the C. pepo / moschata / maxima table). Pairwise block-distance computed by Haversine over `geometryGeojson` centroids ([lib/blocks/distance.ts](../apps/web/src/lib/blocks/distance.ts)); blocks missing geometry surface a banner ("📐 Pollination check skipped for N blocks — add field geometry to enable") and produce `kind: 'geometry-missing'` entries the chat carries through to the scheduler. The allocator prompt receives a labeled `CROSS-POLLINATION` section listing crossing pairs + a sorted block-pair distance grid + a "maximize spacing up to the isolation ceiling" instruction. Post-hoc the validator computes `isolated-spatially` (distance ≥ isolation) vs `must-stagger` (distance < isolation → open temporal constraint, carried into the scheduler) constraints from the final assignments. Review-step rows render a single compact summary chip `⚠ {days}d stagger from {partner1} · {partner2} +{N} more` (full list in tooltip).
- **Chat refinement (Phase 19):** the review step has a dialogue panel under the table — the assistant opens with pollination findings + advisories; the operator types natural-language change requests ("move the corn off the narrow block"); each turn POSTs the full transcript + current plan to `/api/plan/allocate/refine`. The server threads it as `user[0]=matrix prompt`, `assistant[0]=stringified current plan`, alternating chat turns, and `user[final]=new request + refinement schema reminder`. Responses revalidate against the candidacy matrix; invalid plans roll back to the previous plan with a friendly chat reply. Same chat continues into the schedule step (UC-37c) via the shared `chatPanel` snippet.
- **shortName preference:** Phase 19 propagated `entry.shortName ?? entry.displayName` through `seedSelections` so Claude sees the marketing-stripped name everywhere (e.g., "Bloody Butcher" not "Bloody Butcher Ornamental Corn — Raw Untreated Non-GMO (1/2 lb)"). Reduces chat-bubble + rationale clutter substantially.

## UC-37c — Schedule pane + dated commit + succession sowing

- **Persona:** P1
- **Status:** Implemented (Phase 20). The seed-allocation wizard gains a 4th step that proposes planting dates honoring frost windows, DTM, cross-pollination staggers, companion offsets, and succession spacing. The chat panel from UC-37 continues here.
- **Trigger:** Operator clicks **Accept all → schedule** at the end of the Review step (UC-37). Spatial layout is now locked; the wizard transitions to the Schedule step.
- **Preconditions:** A finalized `AllocationResponse` with assignments, optional `pollinationConstraints[]` (UC-37 Phase 19), and optional `companionGroups[]` (3-sisters etc., detected by `lib/plan/companionOffsets.ts`). Owner role + `requireOwner()`. Optional `ANTHROPIC_API_KEY` — without it the deterministic fallback plants every assignment at its earliest feasible date.
- **Primary path:**
  1. **Step 4 — Schedule** opens. Wizard calls `POST /api/plan/schedule` with the accepted assignments + carry-forward constraints (pollinationConstraints + companionGroups). Loading spinner shows while the AI works.
  2. Server module [aiSchedule.ts](../apps/web/src/lib/server/aiSchedule.ts) builds two layers:
     - **`scheduleCandidacy()`** ([scheduleCandidacy.ts](../apps/web/src/lib/schedule/scheduleCandidacy.ts)) — per-assignment `{earliestMs, latestMs, hardiness, dtmDaysMax, freeSubWindows}`. Earliest = last-frost-relative anchor by hardiness class (tender +7d, half-hardy −14d, hardy −42d). Latest = `firstFallFrost − DTM − 14d` buffer. Free sub-windows account for `existingCrops` already occupying the block.
     - **`evaluateSuccessionFit()`** ([succession.ts](../apps/web/src/lib/schedule/succession.ts)) — `{eligible, maxPlantings, suggestedIntervalDays, reason}` per assignment, derived from family-keyed intervals (leafy-green/legume 14d, brassica/alliums 21d, cucurbit/solanaceae none). `maxPlantings = floor((windowDays − cycleDays) / intervalDays) + 1`, clamped to 6.
  3. Claude Sonnet 4.6 receives a prompt enumerating each assignment's window + hardiness + succession fit, plus must-stagger pollination pairs and companion-group anchor+offset rules. Returns one `scheduled[]` entry per dated planting — succession-eligible assignments may produce multiple rows with `successionIndex: {i, n}`.
  4. Server validates: each `plantingDate` is inside its candidacy window; per-stock plant totals match the original assignment ±2 plants for rounding; succession intervals respected; cross-pollination staggers respected (calendar gap ≥ `staggerDays` between any pair); companion offsets respected (anchor + N days, ±3d tolerance). Invalid → deterministic fallback (plant-at-earliest + linear-spaced successions when eligible) with `meta.fallback='deterministic'` and `meta.violations` populated.
  5. Wizard renders the dated table: Seed (with succession `1/3` chip when split), Block, Planting date, Plants, Why. Schedule advisories surface in an info banner. **Chat panel** (shared snippet) prepends an assistant transition message ("📅 Planting dates proposed above…") and routes subsequent turns to `POST /api/plan/schedule/refine`.
  6. **Step 5 — Commit.** Each `scheduled[]` row posts to `POST /api/blocks/[id]/plantings` with `plantingDate: <ms>` populated. Seed quantity per row is apportioned by plant-ratio: `(plants_i / total_plants_per_stock) × selectedSeeds[stockId]`, rounded for integer-required units. Successions land as separate dated rows on the swim-lane.
- **Cross-pollination carry-through:** open `must-stagger` constraints from UC-37 Phase 19 are enforced by the scheduler's validator — if Claude proposes two crossing varieties whose calendar gap is less than the required `staggerDays`, the validation fails and the deterministic fallback (or chat refinement reply) takes over. Spatially isolated pairs (`isolated-spatially`) require no action from the scheduler.
- **Companion-group inheritance:** [companionOffsets.ts:detectCompanionGroups](../apps/web/src/lib/plan/companionOffsets.ts) walks the accepted allocation looking for sets matching a registered companion system (e.g., corn + legume + cucurbit on one block ⇒ three-sisters). When found, the scheduler honors the anchor + offset pattern (`beans +14d`, `squash +35d` for three-sisters) by validating that companion plantings are within ±3 d of `anchorDate + daysFromAnchor`. Reuses the same `plantingOffsetDays` data that `PlantingGroupWizard` consumes — no duplicated table.
- **Succession sowing:** the scheduler may auto-split a single assignment into N successions when `evaluateSuccessionFit` flags eligibility. Quantity split is largest-remainder rounded ([splitQuantityForSuccession](../apps/web/src/lib/schedule/succession.ts)); the original seed quantity in stock is debited correctly across rows. Operator can override via chat ("just do one planting of the spinach"). Long-DTM fruiting crops (tomato, pepper, cucurbits, winter squash) never succession — family table sets `intervalDays: 0`.
- **Hardiness classification:** [hardinessOf()](../apps/web/src/lib/schedule/scheduleCandidacy.ts) maps `plantingGuide.soilTempMinF` → tender (≥65°F), half-hardy (50–64°F), hardy (<50°F). Falls back to family-keyed defaults when soil-temp is absent. Drives the earliest-plantable date relative to the last-frost mark.
- **Success:** A few clicks turn the spatial allocation into a dated plan with stock-decrement-correct successions; committing populates the existing swim-lane with already-dated crops so the operator never has to drag from the "To schedule" tray for these.
- **Audit notes:** All scheduling logic is pure + unit-tested ([scheduleCandidacy.test.ts](../apps/web/src/lib/schedule/scheduleCandidacy.test.ts) 12 tests, [succession.test.ts](../apps/web/src/lib/schedule/succession.test.ts) 12 tests, [companionOffsets.test.ts](../apps/web/src/lib/plan/companionOffsets.test.ts) 6 tests, [pollination.test.ts](../apps/web/src/lib/plan/pollination.test.ts) 16 tests, [pollinationLayer.test.ts](../apps/web/src/lib/plan/pollinationLayer.test.ts) 10 tests, [distance.test.ts](../apps/web/src/lib/blocks/distance.test.ts) 9 tests). AI path is grounded — Claude only picks dates within the matrix-defined windows; cannot invent assignments or move plants. AI calls share the existing `aiGuard.checkGuard('allocate')` daily quota + monthly USD cap; per-call cost surfaced in the wizard footer.

## UC-37d — AI Inputs Plan (5th wizard step)

- **Persona:** P1
- **Status:** Spec'd (Phase 21). 5th step of the seed-allocation wizard. Generates per-planting application timelines (weeds, pests, fertility, cover-crop terminate) from Season Setup answers (UC-42), crop plugin metadata (`sprayWindows[]`, `growthStageTable`, `agronomy`), soil tests (UC-33), and the existing safety kernel. Commits `tasks` rows pre-linked to `spray_event` / `insecticide_event` / `fertility_application`.
- **Trigger:** Operator clicks **Accept all → Inputs** at the end of the Schedule step (UC-37c). Plantings are dated and stock is debited; the wizard transitions to the Inputs step.
- **Preconditions:** A committed planting set (UC-37c step 5). Season Setup answered for the active year (UC-42) — if absent, the wizard routes back to UC-42 first. Owner role + `requireOwner()`. Optional `ANTHROPIC_API_KEY` — without it, the deterministic planner ships every recommendation directly.
- **Primary path:**
  1. **Step 5 — Inputs** opens. Wizard calls `POST /api/plan/inputs` with the committed plantings + active Season Setup ID. Loading spinner.
  2. Server module `aiInputsPlan.ts` builds the deterministic `InputsPlan` via `lib/plan/inputsPlan.ts` (pure), then optionally hands it to Claude for substitution + tank-mix consolidation. Validator re-runs `safety/chemistry.ts`, `safety/cropCompatibility.ts`, `safety/tankMixOrder.ts`, `philosophyFilter.ts`, and the date-window check; invalid → deterministic plan ships with `meta.fallback='deterministic'`.
  3. Wizard renders per-planting collapsible cards. Each card shows chronological `Application[]` rows: type (pre-plant fertility / burndown / PRE / POST / sidedress / scout / insecticide-prophylactic / fungicide / cover-terminate), date, product(s), rate, tank-mix grouping band. Inline product picker on each row filters by `philosophy` via `philosophyFilter.isProductAllowed()`.
  4. Right rail: **shopping list** aggregated by `pluginId` with `haveOnHand` (from `stock.ts`) and `needToBuy` columns; low-stock badges link to `/stock/[id]` (UC-31).
  5. Bottom: **warnings** — missing soil test (planner used generic removal-rate defaults), no philosophy-compliant product available for slot, geometry-missing pollination carry-over, etc. Each warning is dismissable but persists across reloads.
  6. **Chat panel** continues from the prior steps (shared `chatPanel` snippet). Refinement turns POST to `/api/plan/inputs/refine` and route through the same validator-then-fallback path as UC-37/UC-37c.
  7. **Step 6 — Commit.** "Accept all & schedule tasks" posts to `POST /api/plan/inputs/commit`. Server writes one `tasks` row per application with `relatedEventTable` pre-set, `pluginTemplateKey: 'inputs-plan'`, `scheduledFor: applicationDate`, `recurrenceJson` for IPM scout cadences, `cropId` + `blockId` from the planting. Idempotent: re-running the wizard replaces the prior plan's tasks (transactional delete + insert); modal confirm if any tasks are already completed.
- **Philosophy gating:** every product the planner emits is filtered by `lib/season/philosophyFilter.ts:isProductAllowed(product, philosophy)`. Allow-deny matrix:
  - `conventional` — all products allowed
  - `non-gmo` — requires `complianceFlags.nonGmoCompliant === true`
  - `organic-transitioning` — requires `transitioningAllowed === true` OR `omriListed === true`
  - `certified-organic` — requires `omriListed === true` AND `certifiedOrganicAllowed !== false`
  - Missing flags = "unknown" = excluded. Surfaces as a planner warning, never silently substituted.
- **Pest strategy semantics:**
  - `preventive` — emits scheduled insecticide applications from `sprayWindows[purpose='insecticide-prophylactic']`.
  - `ipm` — emits **no** insecticide applications at plan time; emits recurring scout tasks at family-typical cadence (cucurbits weekly during fruit-set, brassicas every 5d during head formation, etc.).
  - `minimal` — emits sparse scout tasks (only during high-pressure windows); no scheduled sprays.
- **Weed strategy semantics:** mirrors pest gating against `sprayWindows[].weedStrategyGate` per the schema in [phase-21-plan.md §B](./phase-21-plan.md). `cultivate-first` emits cultivation reminder tasks instead of herbicide applications.
- **Fertility approach semantics:**
  - `synthetic` — picks from synthetic NPK fertilizer plugins.
  - `compost-amendments` — picks from compost / manure / amendment fertilizer plugins (filtered to organic-compatible when philosophy demands).
  - `cover-crop-credits` — assumes prior cover crop; subtracts the `fertilityCredits` N contribution from required N before sizing; only emits supplemental fertility if deficit remains.
  - `mixed` — uses the best available product per slot regardless of source, gated only by philosophy.
- **Cover-crop terminate:** emitted only when `coverCropIntent !== 'none'` AND the block's prior-year history shows a cover crop that needs termination. Anchored to `crop.agronomy.terminationLeadDaysMin` before the main crop's `plantingDate`. Termination method follows philosophy (mechanical for organic, herbicide for conventional/non-GMO).
- **Sidedress-N:** anchored to `growthStageTable.stages[code='V6']` for corn or equivalent stage code per crop family. Falls back to `daysAfterPlanting: 35` when no stage table present.
- **Task closure semantics:** committed tasks carry `relatedEventTable` pointers so when the operator records the actual spray (UC-02), insecticide (UC-32), or fertility application (UC-33), the task closes automatically via the existing `tasks.relatedEventId` linkage. No new closure pathway needed.
- **Helper visibility:** helpers see the resulting tasks on `/today` and can execute them, but cannot run the Inputs step itself. Server `requireOwner()` on `/api/plan/inputs*`.
- **Cost guard:** routed through `aiGuard.checkGuard('inputs')`. Default quota 10 calls/day; shares the monthly USD cap with other AI tasks. Per-call cost surfaced in the wizard footer.
- **Success:** From a committed schedule the operator gets a complete season's worth of dated, philosophy-compliant input tasks + a consolidated shopping list, in seconds. Tasks slot into Today / Calendar / Tasks views without further setup. The shopping list flags items to order before the season starts.
- **Audit notes:** All planning logic lives in `lib/plan/inputsPlan.ts` (pure, 96-scenario test matrix per [phase-21-plan.md §C](./phase-21-plan.md#sub-task-c--deterministic-inputs-planner)). AI path is grounded — Claude only substitutes within the philosophy-allowed product set and consolidates same-day applications into tank-mix groups; cannot invent slots, change rates above ceiling, or break tank-mix compatibility. Falls back to deterministic plan on any validator failure. Safety kernel is untouched — it still gates the actual application at execution time. CLAUDE.md invariants honored: #1 (safety rules in TS, planner only proposes), #2 (plugins data-only, all gating via TS), #4 (planner cannot edit locked records), #5 (helper cannot commit), #6 (tenant isolation via existing helpers).

## UC-38 — Planting groups + companion wizard (Schedule tab v2)

- **Persona:** P1
- **Status:** Implemented (Phase 15a). Schedule tab gains first-class **planting groups** — sets of co-located crops that share an anchor date with member offsets — with two paths: AI-assisted via `PlantingGroupWizard.svelte` and manual multi-select on the swim-lane.
- **Trigger:** Owner has the seed for a known interplanting system (e.g., Three Sisters: corn + pole beans + winter squash) attached to one block on `/plan?tab=crops` and wants to schedule the trio together with proper offsets and materialized prep/maintenance tasks.
- **Preconditions:** ≥1 block with attached crops on `/plan?tab=crops`; for companion surfacing, the operator must have **seed stock on-hand** for every member family AND already have **attached the companion seed to the same block**. Owner role (server-enforced via `requireOwner()`).
- **Primary path:**
  1. On `/plan?tab=schedule` the right rail surfaces a **✨ Plant a group** button (replaces the old "To schedule" tray that was deleted in this slice).
  2. **Step 1 — Block.** Operator picks a block; only blocks with attached crops are listed.
  3. **Step 2 — Anchor crop.** Operator picks one of the attached crops as the anchor; the wizard tags corn anchors as "Three Sisters candidate".
  4. **Step 3 — Companions + date.** The wizard calls `suggestCompanions(family, registry)` then filters via the stock + block-attachment gate. Met systems render member checkboxes with offset chips (e.g., `+14d trellis + n-fixer`); partially-met systems render a soft hint card listing the missing families. Operator sets the anchor planting date with a soil-temp advisory if too early.
  5. **Step 4 — Preview & commit.** `POST /api/plantings/groups/preview` runs the full materialization inside a transaction that rolls back, returning the would-create roster (anchor + companions, planting dates, primary + pre + post + seasonal task counts, companion-check task per companion). Operator commits via `POST /api/plantings/groups`.
- **Manual path (multi-select):** With ≥2 bars selected on the swim-lane (shift-click), a floating toolbar offers **Group as planting** (or **Group as Three Sisters** when selection happens to match corn + legume + cucurbit on one block). Toolbar is disabled if the selection spans multiple blocks.
- **Companion timing — hybrid offset+advisory:** companion plantings pre-fill from anchor + offset (current Three Sisters: beans +14d, pumpkins +35d). For each companion the commit also seeds a **companion-check task** (`pluginTemplateKey='companion-check:<groupId>:<companionCropId>'`) scheduled 5 days before the companion's plantingDate. The operator confirms anchor stage in field and can nudge ±N days; the nudge updates the companion's plantingDate, shifts its primary "Plant" task, and runs `reanchorPluginPrePost` so dependent tasks follow (overridden ones flag `staleAnchor`).
- **Operational task lanes:** group commit auto-materializes plugin templates (`preTasks`, `postTasks`, `seasonalTasks`) via the existing `materializePluginPrePost` helper plus a new `materializeSeasonalTasks` helper. Tasks render as colored pips on the swim-lane (◆ till, ✚ fertilize, ✦ spray, ◉ scout, ⚑ companion-check) at their scheduled offsets. Operator-overridden tasks retain their dates and flag `staleAnchor` when the anchor moves.
- **Anchor-swap guard:** `PATCH /api/crops/[id] { action: 'change-plugin', cropPluginId }` returns 409 with `Cannot swap plugin on a group anchor. Disband the group first…` when the row is `groupRole='anchor'` with sibling members. Disband is a one-tap action in the Group Inspector (`DELETE /api/plantings/groups/[groupId]`); members keep their plantings, the group link clears.
- **Schema:** four nullable columns added to `crops` in migration `0016_dapper_night_nurse.sql` (`group_id`, `group_role`, `group_offset_days`, `group_system_kind`), plus `(block_id, group_id)` composite index and partial unique index on `group_id WHERE group_role='anchor'` (enforces "exactly one anchor per group" at the DB layer).
- **Success:** Owner picks an anchor + companions + date in <1 minute; commit creates 3 crops + ~15 tasks for a Three Sisters trio; schedule view shows a single bracketed group with task pips on each bar; companion-check task lands on `/today` 5 days before bean planting; nudging the bean planting +2 days shifts all dependent tasks atomically.
- **Audit notes:** companion advisor stays a pure registry function (`lib/calendar/companions.ts`); the stock + attachment gate runs in `PlantingGroupWizard.svelte` against payload computed server-side. Materialization stays out of `engine.ts` (engine remains side-effect-free). Materialization is idempotent on `pluginTemplateKey` so retries don't duplicate. The "To schedule" tray was removed (`CropPalette.svelte`); existing null-date crops still load in the wizard's input pool via `data.unscheduled`. Cross-references UC-01 (block + planting setup), UC-07 (Three Sisters companion advisor), UC-36/UC-37 (sibling AI flows on the Crops tab).

## UC-39 — Companion-check confirmation + nudge

- **Persona:** P2 (helper, in-field operation)
- **Status:** Implemented (Phase 15a) as part of UC-38's hybrid timing.
- **Trigger:** A companion-check task surfaces on `/today` 5 days before a companion crop's planned plantingDate (e.g., "Confirm corn stage — pole beans due in 5d"). Helper opens it before going to the field.
- **Preconditions:** A planting group exists with at least one companion; the operator has the companion seed in hand to plant.
- **Primary path:**
  1. Helper opens the task (or opens the GroupInspector right rail by clicking the bracket on the swim-lane).
  2. Inspector shows anchor + companions with their planted dates and the upcoming companion-check task highlighted (⚑ glyph, amber background).
  3. Helper enters a Δ days value (–30..+30) and clicks **Apply** in the per-companion nudge form.
  4. `POST /api/plantings/groups/[groupId]/nudge { companionCropId, deltaDays, completeCheckTaskId? }` updates the companion's `plantingDate`, shifts its primary "Plant" task by the same delta, and runs `reanchorPluginPrePost` to re-anchor materialized pre/post tasks. Operator-overridden tasks stay put with `staleAnchor=true` so the helper can resolve them on `/today`.
- **Success:** Helper confirms anchor stage in field, nudges companion ±N days, all dependent dates roll forward atomically; companion-check task closes; `/today` view stays consistent with field reality.
- **Audit notes:** uses the existing drift fields (`userOverridden`, `staleAnchor`) without introducing a new lifecycle. The companion-check task is `kind='primary'` with `relatedEventTable=null` (it's not closed by an event row but by the operator's tap). Idempotency key: `companion-check:<groupId>:<companionCropId>` — re-running materialization never duplicates the gate task.

## UC-40 — Crop card surfaces growth stage on Plan→Schedule

- **Persona:** P1, P2, P3
- **Status:** Implemented (v1.3 §growth-stages).
- **Trigger:** Operator opens `/plan?tab=schedule` for any block with at least one planted crop.
- **Preconditions:** Crop has a `plantingDate`; the variety's plugin (or its family default) provides a `growthStageTable`.
- **Primary path:**
  1. Server-side, [`+page.server.ts`](../apps/web/src/routes/plan/+page.server.ts) calls `resolveGrowthStageTable(plug)` for each scheduled planting and runs `projectStages` + `currentStage` + `projectHarvestTargets` against `Date.now()` and the variety's DTM.
  2. The swim-lane bar in [`BlockSwimlane.svelte`](../apps/web/src/lib/components/BlockSwimlane.svelte) renders a stage badge inline (color-coded by `bodyKind`: green vegetative / yellow reproductive / amber ripening / gray dormant / teal transition), a `cornType` chip when present (sweet / popcorn / dent / flour / flint / dual-purpose), and a harvest-target footer listing each window with use-case label.
  3. The bar's hover tooltip surfaces the current stage's `inspect` copy ("Silks emerge; critical pollination window"), days into stage, and the next-stage transition ETA.
  4. **Dual-purpose corn** (e.g., Bloody Butcher): the variety plugin lists both R3 (sweet eating) and R6 (dent / cornmeal) as `harvestTargets`. The card surfaces both windows; the operator (or future AI auto-schedule) picks at execution time.
  5. **Sweet corn** (e.g., Bantam): single R3 target → one harvest line at ~70 days.
  6. **Wheat / cereal grain:** Zadoks badge ("Z30 jointing"), single Z89 dry-storage target.
  7. **Perennials** (orchard, vine-fruit, small-fruit, bramble, stone-fruit) project against `dayOfYear` for the current calendar year — same UI shape, different anchoring.
- **Implementation locus:**
  - Stage taxonomy + Zod: [`schemas.ts`](../apps/web/src/lib/plugins/schemas.ts) (`growthStageSchema`, `harvestTargetSchema`, `growthStageTableSchema`, `cornTypeSchema`).
  - Family defaults + perennial templates + resolver: [`growthStageTemplates.ts`](../apps/web/src/lib/plugins/growthStageTemplates.ts).
  - Projection math: [`stageProjection.ts`](../apps/web/src/lib/calendar/stageProjection.ts).
  - Engine emission of `stage-window` and multi-target `harvest-window` events: [`engine.ts`](../apps/web/src/lib/calendar/engine.ts).
- **Success criteria:** Every Plan→Schedule swim-lane bar with a resolved stage table renders a current-stage badge and at least one harvest-target footer. Sweet corn shows R3 only; dual-purpose corn shows both R3 and R6 with R6 ~3 weeks later. Tooltip carries inspect copy. Cover crops, broadleaf companions, and other simple-system crops show their stage names ("canopy-close", "harvest-size") rather than codes.
- **Out of scope (deferred):** Per-record observed-stage capture (`crop_observations` table — lands with the inspection-card slice). GDD / heat-unit math. Weather-adjusted stage shifts. Stage-gated task auto-firing. Plugin authoring wizard fields for stage tables.

## UC-41 — Planter plate matching for seed stock

- **Persona:** P1 (Owner), P2 (Helper, view-only)
- **Status:** Implemented. Three integration surfaces: auto-pick during AI Refresh, manual override from the inventory modal, and a generic Tools route.
- **Trigger:** Owner planting from a seed lot (`stock_items.category = 'seed'`) needs a Lincoln Ag plate (John Deere "B" or IHC "C" series) for their mechanical planter.
- **Preconditions:** Authenticated session with an `activeOwnerId`. Save endpoint is owner-only (`requireOwner`); Helper role can browse the tool but cannot persist.
- **Primary paths:**
  1. **Auto-pick via AI Refresh** (preferred). When the Owner clicks "🔍 Refresh from web" in the inventory modal, the AI is asked for approximate kernel dimensions (`seedDimensionsMm`) and shape (`seedShape`, corn/soybean only) alongside the existing seed fields. The server then runs the deterministic matcher in `lib/planterPlate/match.ts` against the AI-supplied dims and produces a `planterPlateConfig` suggestion (top match from the Lincoln Ag catalog), with a `lowConfidence` flag set when results are weak (no dims, ties at top, or top Δ > 6). The suggestion lands in the existing pending-review diff panel as three checkbox rows: "Seed dimensions (mm)", "Seed shape", "Planter plate". Operator approves with the existing "Apply selected" affordance, which merges them into `stock_items.metadata_json`.
  2. **Manual override** from the inventory edit modal — the "Planter plate" row in the Growing Info section links to `/tools/planter-plate-selector?stockId=[id]`, which opens the tool pre-filled for this seed.
  3. **Generic Tools route** — `/tools/planter-plate-selector` (linked from `/tools`) is accessible without any stock context. Explore plates by series / seed type / shape / cell count / optional L-D-T dimensions (mm or 64ths in.). A "Save to seed lot…" dropdown lists all of the Owner's seed inventory; submitting writes the chosen plate via `?/saveToStock` which calls `updateStockItem` tenant-scoped.
- **Engine:** Pure functions in `apps/web/src/lib/planterPlate/match.ts` (`matchPlates`, `cellCountRecommendation`, `isLowConfidence`, `inferSeedTypeFromName`) with `getPlatesCatalog()` in `catalog.ts`. Plate data is a TypeScript-imported JSON at `lib/planterPlate/plates-data.json` (Vite-bundled — no static fetch). Tests in `match.test.ts` (18 cases: exact match, tolerance widening, ties, sparse vs typical density, type inference).
- **Cell-count helper (Corn):** Computes plants/acre from in-row + row spacing (default 30") and suggests 16-cell (≤22k) or 24-cell (≥22k) with sprocket-headroom rationale in the middle band. Auto-applies on first load when no saved config exists.
- **Persisted shape:** `stock_items.metadata_json.planterPlateConfig` = `{ plateNumber, series, brand, cells, color, dimensions, L, D, T, shape, seedType, gradeSize, seedDimensions?, density?, source: 'ai-suggested' | 'manual', lowConfidence?, confidenceReason?, savedAt }`. Sibling `metadata_json.seedDimensionsMm` and `metadata_json.seedShape` carry the AI-sourced dims for traceability.
- **Edge cases:**
  - Sugar Beet shows a warning banner; no catalog records.
  - Low-confidence plate pick (ambiguous heirloom seed) → "⚠️ low confidence" label in the review panel; the Owner can still approve, or uncheck the plate and accept dimensions only.
  - Cross-tenant: all reads/writes route through `getStockItem`/`updateStockItem` which are tenant-scoped via `withTenant`/`tenantValues`.
- **Out of scope:** Per-planting overrides on `crops` rows; sugar-beet catalog; offline save (Owner must be online — could later queue via `syncQueue`).

## UC-35 — Comprehensive delete + wipe-everything reset

- **Persona:** P1
- **Status:** Implemented (Phase 12e). Per-entity deletes are wired through each repo (`apps/web/src/lib/db/`); destructive reset is `POST /api/admin/wipe`.
- **Trigger:** End-of-season cleanup, mistaken planting, sprayer sold, plugin retired, or fresh-start before a new season.
- **Preconditions:** `owner` role (server-enforced). Wipe requires an explicit confirm token in the request body.
- **Primary path:**
  1. **Per-entity delete** — each domain page (`/plan`, `/equipment`, `/stock`, `/plugins`, `/records`) exposes a delete affordance on each row, gated server-side.
     - Delete blocked when referenced by a still-existing event (e.g., a sprayer that has a `spray_events` row); UI shows the constraint and a workaround (archive instead).
  2. **Wipe-everything** — owner posts to `/api/admin/wipe` with `{ confirm: "WIPE-EVERYTHING" }`. All event/state tables truncated; users and plugin library survive.
- **Success:** Targeted deletes succeed when constraints allow; wipe leaves a clean slate ready for re-seeding (UC-20 onboarding still applies).
- **Audit notes:** No UI affordance currently exposes the wipe endpoint — it's a hand-curl operation by design (matches CLAUDE.md invariant about safety-kernel destructive paths). Adding a guarded "Reset everything" button under `/settings` is reasonable future work; out of scope here.

---

## UC-42 — Season Setup ("This Planting Season" form)

- **Persona:** P1
- **Status:** Spec'd (Phase 21). First step of the Plan wizard. A short, persisted-per-year form that captures the operator's input philosophy. Without it, downstream AI input planning has no signal and falls back to conventional defaults. See [phase-21-plan.md §A](./phase-21-plan.md#sub-task-a--season-setup-foundational).
- **Trigger:** Operator opens `/plan` and either (a) hasn't set up the current planting year, or (b) explicitly clicks "Edit season" on the summary chip. Also reachable directly via `/settings/season`.
- **Preconditions:** Owner role + `requireOwner()`. Active tenant (Phase 18a). No other preconditions — this is intentionally the entry point to the planning year.
- **Primary path:**
  1. First visit to `/plan` in a new calendar year → wizard opens on Season Setup before the allocation step.
  2. If `loadSeasonSetup(lastYear)` returns a record, render a banner: **"Use last year's answers"** — one click invokes `carryForward(lastYear, currentYear)` and advances to allocation.
  3. Otherwise, render six labeled selects with ≥48dp tap targets:
     - **Input philosophy** — `conventional` / `non-gmo` / `organic-transitioning` (year 1–3) / `certified-organic`. Drives the planner's allow-deny matrix on every product.
     - **Weed strategy** — `cultivate-first` / `pre-emergence-ok` / `post-emergence-ok` (cumulative tiers; each includes the methods of the one above). Gates whether burndown / PRE / POST herbicide windows are emitted.
     - **Pest strategy** — `preventive` / `ipm` / `minimal`. IPM (renders to operator as "Scout-then-spray") emits scout cadences instead of prophylactic insecticide tasks; `minimal` emits sparse scout reminders only.
     - **Fertility approach** — `synthetic` / `compost-amendments` / `cover-crop-credits` / `mixed`. Picks the product pool for pre-plant and sidedress fertility.
     - **Cover crop intent** — `fall-cereal` / `vetch-clover` / `other` / `none`. Gates emission of post-harvest cover-seed tasks + spring termination.
     - **Spray application capacity** — `backpack-4gal` / `handheld-25gal` / `boom-25-plus` / `none`. Filters tank-mix sizing and dilution UI defaults; pairs with the existing sprayer registry (UC-10).
     - **Transitioning started** (conditional) — YYYY, shown only when `philosophy='organic-transitioning'`. Lets the UI surface "year 2 of 3" badges.
  4. Submit → `saveSeasonSetup(year, formValues)` writes one `settings` row per key under `season_setup.<year>.*`. Wizard advances to allocation. Setup is now a SeasonSetup prop on every subsequent wizard step.
  5. Subsequent wizard entries this year show a 1-line **summary chip** (e.g., `Organic · IPM · Compost-first · Backpack ≤4 gal · Cover: vetch · 2026`) + an **Edit** link. Click → re-opens the form.
- **Year rollover:** the first time the operator opens `/plan` after the calendar year flips, the wizard prompts: *"Carry forward 2026 settings to 2027?"* — neither silent copy nor silent empty. If declined, the operator gets the empty form for the new year.
- **Mid-season edits:** allowed any time via the chip's Edit link or `/settings/season`. Banner warning: *"Changing this won't re-write tasks already committed via UC-37d. Re-run the Inputs step to align."*
- **Helper visibility:** chip is rendered read-only on `/today` so helpers see the active philosophy (relevant for which products they'll pick up at the shed). Server `requireOwner()` rejects helper mutations.
- **Cross-tenant isolation:** each owner's setup is invisible to others by virtue of `settings.ts` tenant scoping (Phase 18b). Verified by `settings.crossTenant.test.ts` (extends the existing pattern).
- **Onboarding interaction:** `/onboarding` does **not** ask these questions inline — onboarding stays lightweight per the P5 first-run design constraint. After onboarding completes, a one-line link points new owners to `/plan` to set up their first season.
- **Defaults when never set:** the planner treats an absent setup as the default tuple `{ conventional, post-emergence-ok, ipm, mixed, none, backpack-4gal }`, but the Inputs endpoint (UC-37d) returns `409 { needsSeasonSetup: true }` so the UI routes the operator into the form rather than silently planning against a guess.
- **Success:** Operator answers six questions in under 60 seconds on first farm-year setup; one click on every subsequent year. The chip stays visible across the wizard so the operator always knows what philosophy their plan is being built against. Downstream UC-37d emits philosophy-compliant tasks without further confirmation.
- **Audit notes:** No new tables — all values stored in the existing `settings` table under the `season_setup.<year>.*` namespace. No migration. CLAUDE.md invariants honored: #2 (no executable plugin code touched), #5 (helper write rejected at server), #6 (tenant isolation via `settings.ts`). Round-trip + carry-forward + tenant-isolation tests live in `apps/web/src/lib/season/setup.test.ts`.

---

## UC-43 — External agent orchestration via API token

- **Persona:** P6 (Integrator / automation owner).
- **Status:** Spec'd (Phase 24). The CropCard JSON API is already coherent and safety-gated server-side; this UC opens it to external Claude agents (or future SaaS integrations like FarmOS sync, accounting bridges, scouting drone uploads) via Bearer-token auth. Safety invariants stay enforced — an agent with a valid token cannot violate the 48h spray lock, helper custom-rate restriction, tenant isolation, or kernel re-evaluation on POST. See `docs/phase-24-agent-api.md`.
- **Trigger:** Owner navigates to `/settings/api-tokens` and clicks **Mint token**. Alternatively `POST /api/auth/token` directly from another cookie-authed session (e.g., a setup script).
- **Preconditions:** Owner role + cookie session (helpers cannot mint; Bearer cannot mint another Bearer — closes the bootstrap loop on a leaked token). Active tenant.
- **Primary path:**
  1. Owner enters a human label (e.g., `scouting-drone-1`) and optionally marks the token as a **service account** (independent AI quota per UC-43 Sub-task D).
  2. Server mints `cck_<base64url-32-bytes>` plaintext + stores `sha256(plaintext)` in `api_tokens`. Plaintext is returned **once** in a copy-once modal — never recoverable from the DB.
  3. External script sets `Authorization: Bearer cck_…` on every request. `hooks.server.ts` resolves the Bearer header **before** cookie lookup, mints an `AuthenticatedUser` shaped record from the token's `(ownerId, userId, role)`, and wraps `resolve(event)` in `runWithTenantAsync(ownerId, …)`.
  4. Cookie-session CSRF Origin check is bypassed for Bearer requests (agents call from arbitrary origins by design); cookie sessions still enforce same-origin (UC-43 Sub-task B).
  5. Agent fetches `/api/openapi.json` (public, no auth) for tool-catalog discovery; reads `/api/today`, posts `/api/spray/record`, etc. (UC-43 Sub-task C).
  6. `aiGuard` keys rate-limit on `(tokenId, endpoint, UTC-day)` for service-account tokens so a runaway agent can't drain the human owner's daily AI quota (UC-43 Sub-task D).
- **Owner can:** list active + revoked tokens at `/settings/api-tokens`, see per-token `lastUsedAt` + `requestCount` (debounced 1/minute writes), revoke at any time. Revocation is immediate — next Bearer request → 401 JSON.
- **Token cannot:** mint another token (cookie-session-only surface), switch owners (owner-scoped at issuance; `POST /api/session/switch-owner` returns 403 for `authVia === 'bearer'`).
- **Cross-tenant isolation:** every endpoint reachable under the Bearer path runs inside `runWithTenantAsync(tokenOwnerId, …)`. Cross-tenant property test extended with a Bearer-authed code path at `apps/web/src/lib/db/tenant.crossTenant.test.ts`.
- **Service-account quota policy:** UI controls per-token `daily_quota_*` columns (defaults 100/100/100/50 — 10× the per-user defaults). Monthly USD cap stays global as the safety brake against a runaway agent.
- **Helper visibility:** none. Tokens are listed only to the issuing Owner via `requireOwner()`.
- **Audit notes:** New table `api_tokens` (migration 0029). Bearer middleware in `hooks.server.ts`. CSRF bypass in `svelte.config.js` + manual Origin guard in hooks. OpenAPI generator at `apps/web/scripts/gen-openapi.mjs` + served from `/api/openapi.json`. `is_service_account` + `daily_quota_*` columns wire `aiGuard.checkGuard()` to branch per-token. CLAUDE.md invariants honored: #2 (no plugin executable code touched), #5 (helper cannot mint), #6 (tenant isolation via composite `(owner_id, id)` keys on every write + cross-tenant test).

---

## Summary table

| ID | Status | Persona | Implementation locus |
|---|---|---|---|
| UC-01 | Implemented | P1 | [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) |
| UC-02 | Implemented | P1, P2 | [spray/+page.svelte](../apps/web/src/routes/spray/+page.svelte) |
| UC-03 | Implemented | P1, P2 | [spray/+page.svelte:473](../apps/web/src/routes/spray/+page.svelte#L473) |
| UC-04 | Implemented | P1, P2 | [spray/decon/+page.svelte](../apps/web/src/routes/spray/decon/+page.svelte) |
| UC-05 | Implemented | P1, P2 | [scout/+page.svelte](../apps/web/src/routes/scout/+page.svelte) |
| UC-06 | Implemented | P1, P2 | [harvest/+page.svelte](../apps/web/src/routes/harvest/+page.svelte) |
| UC-07 | Implemented | P1 | [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) |
| UC-08 | Implemented | P1 | [plugins/new/+page.svelte](../apps/web/src/routes/plugins/new/+page.svelte) |
| UC-09 | Implemented | P1 | [records/+page.svelte](../apps/web/src/routes/records/+page.svelte) |
| UC-10 | Implemented | P1, P2 | [calibrate/+page.svelte](../apps/web/src/routes/calibrate/+page.svelte) |
| UC-11 | Implemented | P1, P2 | [today/+page.svelte](../apps/web/src/routes/today/+page.svelte) |
| UC-12 | Implemented | P1, P2 | [records/pending/+page.svelte](../apps/web/src/routes/records/pending/+page.svelte) |
| UC-13 | Implemented | P3 | [hay/+page.svelte](../apps/web/src/routes/hay/+page.svelte) (Sprint E) |
| UC-14 | Implemented | P3 | [hay/+page.svelte](../apps/web/src/routes/hay/+page.svelte) (Sprint E) |
| UC-15 | **Partially implemented** (stage projection ✓; observation capture deferred) | P1, P3 | [growthStageTemplates.ts](../apps/web/src/lib/plugins/growthStageTemplates.ts) + [stageProjection.ts](../apps/web/src/lib/calendar/stageProjection.ts) |
| UC-16 | **Spec-defined, NOT implemented** | P1, P3 | Extend `harvest/+page.svelte` + FR-21 |
| UC-17 | Implemented | All | [signin/+page.svelte](../apps/web/src/routes/signin/+page.svelte) |
| UC-18 | Implemented | P1 | [plan/+page.svelte?tab=calendar](../apps/web/src/routes/plan/+page.svelte) |
| UC-19 | Implemented | P1 | [records/+page.svelte](../apps/web/src/routes/records/+page.svelte) |
| UC-20 | Implemented | P5 | [/onboarding/+page.svelte](../apps/web/src/routes/onboarding/+page.svelte) (Phase 18f) |
| UC-21 | Implemented | P1 | [/settings/helpers/+page.svelte](../apps/web/src/routes/settings/helpers/+page.svelte) + [lib/server/invites.ts](../apps/web/src/lib/server/invites.ts) (Phase 18e) |
| UC-22 | **Proposed (audit only)** | P4 | Audit pass on existing PDF/CSV exports |
| UC-23 | **Proposed (mitigation)** | P1 | Document loss boundary; force-sync button |
| UC-24 | **Proposed** | P1 | Extend records filter |
| UC-25 | Implemented | P1 | [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) (Phase 13) |
| UC-26 | **Proposed** | P1, P2, P5 | Sidebar nav + header identity strip + footer in [+layout.svelte](../apps/web/src/routes/+layout.svelte) |
| UC-27 | **Proposed** | P1 | Bulk multi-field entry in [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) |
| UC-28 | **Proposed (micro)** | P1 | Acreage hint `<small>` text in [plan/+page.svelte:505,643](../apps/web/src/routes/plan/+page.svelte#L505) |
| UC-29 | Implemented | P1 | [crops/+page.svelte](../apps/web/src/routes/crops/+page.svelte) (Phase 12d) |
| UC-30 | Implemented | P1, P2 | [equipment/+page.svelte](../apps/web/src/routes/equipment/+page.svelte) (Phase 8a) |
| UC-31 | Implemented | P1 | [stock/+page.svelte](../apps/web/src/routes/stock/+page.svelte) (Phase 8b) |
| UC-32 | Implemented | P1, P2 | [insecticides/+page.svelte](../apps/web/src/routes/insecticides/+page.svelte) (Phase 10) |
| UC-33 | Implemented | P1 | [fertility/+page.svelte](../apps/web/src/routes/fertility/+page.svelte) (Phase 10) |
| UC-34 | Implemented | P1 | [settings/+page.svelte](../apps/web/src/routes/settings/+page.svelte) |
| UC-35 | Implemented | P1 | Per-entity deletes through each repo + `POST /api/admin/wipe` + Danger Zone UI in [settings/+page.svelte](../apps/web/src/routes/settings/+page.svelte) (Phase 12e) |
| UC-36 | Implemented | P1 | [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) (Phase 14a) — Schedule tab + `lib/layout/engine.ts` |
| UC-37 | Implemented | P1 | [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) (Phase 14e) — Crops tab `🤖 Suggest allocation` → [`AllocationWizard.svelte`](../apps/web/src/lib/components/AllocationWizard.svelte) → [`/api/plan/allocate`](../apps/web/src/routes/api/plan/allocate/+server.ts) backed by [`aiAllocation.ts`](../apps/web/src/lib/server/aiAllocation.ts) + [`sufficiency.ts`](../apps/web/src/lib/layout/sufficiency.ts) |
| UC-40 | Implemented | P1, P2, P3 | [BlockSwimlane.svelte](../apps/web/src/lib/components/BlockSwimlane.svelte) (v1.3) — stage badges + harvest-target footer; backed by [`growthStageTemplates.ts`](../apps/web/src/lib/plugins/growthStageTemplates.ts) + [`stageProjection.ts`](../apps/web/src/lib/calendar/stageProjection.ts) |
| UC-41 | Implemented | P1, P2 | Engine + catalog in [lib/planterPlate/](../apps/web/src/lib/planterPlate/); tool at [tools/planter-plate-selector/+page.svelte](../apps/web/src/routes/tools/planter-plate-selector/+page.svelte); AI auto-pick wired into [aiRefreshStock.ts](../apps/web/src/lib/server/aiRefreshStock.ts). Persists `planterPlateConfig`, `seedDimensionsMm`, `seedShape` into `stock_items.metadata_json`. Phase 21 gates the UI behind the existing `display_planter_setup` setting (off by default for new owners). |
| UC-37d | **Spec'd** (Phase 21) | P1 | New `lib/plan/inputsPlan.ts` + `lib/server/aiInputsPlan.ts` + `/api/plan/inputs/*` + step in [AllocationWizard.svelte](../apps/web/src/lib/components/AllocationWizard.svelte). See [phase-21-plan.md](./phase-21-plan.md). |
| UC-42 | **Spec'd** (Phase 21) | P1 | New `lib/season/setup.ts` + `SeasonSetupStep.svelte` + `SeasonSetupChip.svelte` + `/settings/season/` route. Backed by `settings` table (no migration). See [phase-21-plan.md](./phase-21-plan.md). |
| UC-43 | **Spec'd** (Phase 24) | P6 | `api_tokens` table (migration 0029) + [apiTokens.ts](../apps/web/src/lib/server/apiTokens.ts) + Bearer middleware in [hooks.server.ts](../apps/web/src/hooks.server.ts) + `/settings/api-tokens/` route + `/api/auth/token/*` endpoints + CSRF Origin bridge + `/api/openapi.json` + per-token quota in [aiGuard.ts](../apps/web/src/lib/server/aiGuard.ts). See [phase-24-agent-api.md](./phase-24-agent-api.md). |
