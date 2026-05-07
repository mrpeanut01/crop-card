# Use cases — CropCard

Catalogues all 24 use cases CropCard supports or should support. Status is one of:

- **Implemented** — runs in the current build.
- **Spec-defined, NOT implemented** — described in the upstream HCD Guide but no CropCard code exists. UC-13..UC-16 fall here. See FR-19..FR-23 in [usability-audit.md](./usability-audit.md) for proposed implementation loci.
- **Proposed** — implied by the persona but not in any spec. Audit recommends implementing.

UC IDs UC-04, UC-05, UC-06, UC-10 are normative from [CLAUDE.md](../CLAUDE.md). UC-13..UC-16 are normative from the HCD Guide §3.6. The remaining IDs are assigned in this catalog.

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
- **Audit notes:** Both inputs use placeholder text ([harvest:133, harvest:137](../apps/web/src/routes/harvest/+page.svelte#L133)) — see F-F. No moisture-at-harvest field — adequate for vegetables, **insufficient for small grains** (UC-16, FR-21).

## UC-07 — Companion-system advisor

- **Persona:** P1
- **Status:** Implemented at [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte)
- **Trigger:** Inside UC-01, after planting a crop that has a registered companion-system plugin (e.g., corn → Three Sisters).
- **Preconditions:** Companion plugin loaded.
- **Primary path:** Inline suggestion below planting form → **Accept** batch-adds companion plantings with offset dates.
- **Success:** Companion plantings appear with their own DTM-driven calendar events.

## UC-08 — Author or upload a plugin

- **Persona:** P1
- **Status:** Implemented at [plugins/new/+page.svelte](../apps/web/src/routes/plugins/new/+page.svelte) and [plugins/+page.svelte](../apps/web/src/routes/plugins/+page.svelte)
- **Trigger:** New crop variety, new herbicide, new companion system, new insecticide.
- **Preconditions:** `owner` role.
- **Primary path:**
  - **Authoring:** `/plugins/new` → form-driven crop-or-herbicide builder → save → registry validates Zod schema + bypass check → loaded.
  - **Upload:** `/plugins` → upload JSON file → registry validates → loaded or rejection with structured error.
- **Success:** New plugin appears in `/spray` herbicide list or `/plan` crop list.
- **Audit notes:** Plugin schema is **v1.0**; HCD Guide §4 specifies v1.1 (cropOperationModel, hayOperations, zadoksStages, moistureGates). FR-19..FR-23 cannot register without v1.1 support. See F-C.

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
- **Status:** Implemented at [today/+page.svelte](../apps/web/src/routes/today/+page.svelte)
- **Trigger:** App open. Per HCD Guide §2.5, this **should be** the mobile landing screen — currently it isn't (`/` is). See finding F-E.
- **Preconditions:** None for UI; ≥1 block + planting for non-empty content.
- **Primary path:**
  1. Land on `/today` (currently 1 click from `/`)
  2. Read today's actions, each with a deep-link CTA (Scout / Harvest / Plan / Decon)
  3. Pick the first one and execute it (UC-02, UC-05, UC-06, UC-04)
- **Success:** User leaves `/today` with the next task already pre-filled in the right page.
- **Audit notes:** CTA buttons are 44px ([today:241](../apps/web/src/routes/today/+page.svelte#L241)) — under the 48px global rule and 60dp HCD recommendation. See F-H.

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

## UC-13 — Hay cutting decision (weather-windowed) *(spec-defined, NOT implemented)*

- **Persona:** P3
- **Status:** **Gap.** No `/hay` route. No weather adapter. FR-19, FR-22 unimplemented.
- **Trigger:** Forage species reaches late-boot or 28+ days since last cutting.
- **Preconditions (proposed):** Hay-type crop plugin v1.1 (alfalfa, orchardgrass, timothy, fescue) registered with `hayOperations`. Weather forecast available.
- **Primary path (proposed, per HCD Guide §3.6 UC-13):**
  1. Plugin signals trigger via Zadoks-equivalent stage or days-since-last-cut
  2. App checks 72-hour forecast → window OPEN / MARGINAL / CLOSED
  3. If OPEN: unlock **Begin Cut** with equipment checklist
  4. Log mow start time, field block, estimated acres
  5. App auto-schedules tedding reminder (2–4h)
  6. Show baling-window countdown
- **Implementation locus (proposed):** New `apps/web/src/lib/hay/` module + `/hay` route. Reuse the spray-flow's step-state pattern from [spray/+page.svelte](../apps/web/src/routes/spray/+page.svelte). FR-22 weather adapter at new `apps/web/src/lib/weather/` — provider needs user decision (NOAA NWS API is free, no auth; OpenWeatherMap requires key).
- **Success criteria (proposed):** Cut/no-cut decision shown in <5 seconds with current forecast.

## UC-14 — Hay step logging (Mow → Ted → Rake → Bale) *(spec-defined, NOT implemented)*

- **Persona:** P3
- **Status:** **Gap.** FR-19, FR-21 unimplemented.
- **Trigger:** User completes a haymaking step.
- **Primary path (proposed, per HCD Guide §3.6 UC-14):**
  1. Active cut shows current expected step
  2. User confirms completion; logs time, weather, optional moisture, equipment notes
  3. **Baling moisture gate (FR-21)** — hard kernel rule:
     - Enter measured moisture %
     - `>22%`: STOP, fire-risk warning, baling locked
     - `18–22%`: warning + acknowledgment + auto-schedule monitoring reminder
     - `<12%`: leaf-loss warning (soft)
     - `13–18%`: green
  4. Log bale count + bale type (small square / large round / large square)
  5. Auto-schedule storage-monitoring reminder for 3–4 weeks
- **Implementation locus (proposed):** Multi-step UI under `/hay/log/<cutting-id>`. Moisture gate lives in [apps/web/src/lib/safety/](../apps/web/src/lib/safety/) parallel to existing herbicide gates — bump `RULES_VERSION` per CLAUDE.md invariant #1.
- **Success criteria (proposed):** Each step logged with timestamp, weather, moisture (where relevant). Moisture-gate STOP cannot be bypassed.

## UC-15 — Small grain planting + Zadoks tracking *(spec-defined, NOT implemented)*

- **Persona:** P1, P3
- **Status:** **Gap.** FR-20 unimplemented.
- **Trigger:** Fall or spring planting of wheat / barley / oats.
- **Primary path (proposed, per HCD Guide §3.6 UC-15):**
  1. Add small-grain variety via UC-08 (plugin manager) — requires v1.1 schema with `zadoksStages`
  2. Soil temp confirmed
  3. App computes Zadoks stage progression from planting date + DTM
  4. Stage-gated reminders auto-fire:
     - Tillering (Z2x): stand-count prompt
     - Jointing (Z3x): cover-crop termination if underseeded; fungicide window opens
     - Heading/Flowering (Z6x, wheat): Fusarium head-blight alert
     - Dough (Z83): begin harvest watch (UC-16)
- **Implementation locus (proposed):** Extend [apps/web/src/lib/calendar/](../apps/web/src/lib/calendar/) to compute Zadoks alongside existing window-stage logic. Plugin schema v1.1 adds `zadoksStages: { stage, daysFromPlanting: { min, max } }[]`.
- **Success criteria (proposed):** Today's calendar shows current stage and next decision point for every active small-grain planting.

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
- **Status:** Implemented at [plan/calendar/+page.svelte](../apps/web/src/routes/plan/calendar/+page.svelte)
- **Trigger:** Planning, "what's coming up", or post-season review.
- **Primary path:** Tile **Calendar** on `/`, or top-nav (currently no direct link — only via `/plan` body). Month-grid view.
- **Audit notes:** `/plan/calendar` is split from `/plan` — the planner often needs both at once. See F-O.

## UC-19 — Filter records by sprayer / block

- **Persona:** P1
- **Status:** Implemented at [records/+page.svelte](../apps/web/src/routes/records/+page.svelte)
- **Trigger:** Looking for a specific spray.
- **Primary path:** Open `/records` → choose sprayer or block filter → list updates.
- **Audit notes:** No text search; with 2-year retention, a brand search ("when did I last spray Roundup") becomes the dominant query — see UC-24.

## UC-20 — First-run onboarding *(proposed)*

- **Persona:** P5
- **Status:** **Gap.** No guided empty-state journey.
- **Trigger:** New user signs in for the first time. Database has no blocks, no plantings, no sprayers, only stock plugins.
- **Current behavior:** `/` renders 11 tiles with one-line subtitles. None of them explain order or dependencies. `/today` empty-state at least directs to `/plan` ([today:78](../apps/web/src/routes/today/+page.svelte#L78)).
- **Proposed primary path:**
  1. First-time landing detects empty database (no blocks, no sprayers)
  2. Show a 3-step bootstrap card: **(1) Add your first block & planting → (2) Register a sprayer → (3) Calibrate it (UC-10)**
  3. Each step's CTA deep-links to the right page; the bootstrap card persists until all 3 are done
- **Implementation locus (proposed):** New `OnboardingCard.svelte` consumed by `/+page.svelte` and `/today/+page.svelte`; checks `data.counts` from existing today loader.
- **Success criteria:** A new user reaches "first calendar event visible on `/today`" in under 10 minutes.

## UC-21 — Invite/provision a Helper *(proposed)*

- **Persona:** P1
- **Status:** **Gap.** Demo signin exists; no real helper-add flow.
- **Trigger:** Sherry hires Marco; needs him to log in.
- **Current behavior:** Helper role exists in [auth.ts](../apps/web/src/lib/server/auth.ts), but only via demo button on `/signin`.
- **Proposed primary path:**
  1. Owner opens `/admin/helpers` (new)
  2. Enters helper email → magic link sent (Auth.js — already installed per CLAUDE.md follow-up)
  3. Helper clicks link → session created with `helper` role
- **Implementation locus (proposed):** Wire the existing `@auth/sveltekit` per CLAUDE.md known-follow-up; new `/admin/helpers` route with owner-gated loader.
- **Success criteria:** Owner can add a helper without dev intervention.

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
- **Implementation locus (proposed):** Audit pass in [usability-audit.md](./usability-audit.md). PDF generator location: search [records/](../apps/web/src/routes/records/) for the export endpoint.
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
| UC-13 | **Spec-defined, NOT implemented** | P3 | New `/hay` route + FR-19, FR-22 |
| UC-14 | **Spec-defined, NOT implemented** | P3 | New `/hay/log/...` + FR-19, FR-21 |
| UC-15 | **Spec-defined, NOT implemented** | P1, P3 | Extend `lib/calendar/` + FR-20 |
| UC-16 | **Spec-defined, NOT implemented** | P1, P3 | Extend `harvest/+page.svelte` + FR-21 |
| UC-17 | Implemented | All | [signin/+page.svelte](../apps/web/src/routes/signin/+page.svelte) |
| UC-18 | Implemented | P1 | [plan/calendar/+page.svelte](../apps/web/src/routes/plan/calendar/+page.svelte) |
| UC-19 | Implemented | P1 | [records/+page.svelte](../apps/web/src/routes/records/+page.svelte) |
| UC-20 | **Proposed** | P5 | New `OnboardingCard.svelte` |
| UC-21 | **Proposed** | P1 | Wire `@auth/sveltekit`; new `/admin/helpers` |
| UC-22 | **Proposed (audit only)** | P4 | Audit pass on existing PDF/CSV exports |
| UC-23 | **Proposed (mitigation)** | P1 | Document loss boundary; force-sync button |
| UC-24 | **Proposed** | P1 | Extend records filter |
