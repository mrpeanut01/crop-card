# Usability evaluation report — CropCard

ISO 9241-210 deliverable: **Usability Evaluation Report**.

This is a static audit — every finding cites a route file and line. No browser, no axe-core, no real user testing. Where this audit calls for one of those, it says so explicitly. Findings are prioritized P0 / P1 / P2 (definitions in §1.4).

The audit framework, personas, and use cases are documented separately:

- [personas.md](./personas.md) — ISO 9241-210 *Context of Use* (5 personas, P1–P5)
- [use-cases.md](./use-cases.md) — UC-01..UC-24 with route refs
- [hcd-review-prompt.md](./hcd-review-prompt.md) — reusable Claude Code prompt template

---

## 1. Method

### 1.1 Governing standard — ISO 9241-210:2019

ISO 9241-210 produces four artifacts: *Context of Use*, *User Requirements*, *Design Solutions*, and this *Usability Evaluation Report*. The first two are in `personas.md` and `use-cases.md`. CropCard's existing routes are the *Design Solutions* under audit.

The six ISO 9241-210 principles function as the audit lens:

1. Design based on explicit understanding of users, tasks, environments
2. Users involved throughout design and development
3. Driven and refined by user-centered evaluation
4. Iterative process
5. Addresses the whole user experience
6. Multi-disciplinary perspectives

### 1.2 Field-context overlay (HCD Guide §2)

Layered on ISO. Every UC walk applied:

1. **One-handed glove operability** — primary CTAs ≥60dp; ≥48dp absolute floor; ≥8dp inter-target gap
2. **Sunlight readability** — WCAG AAA (7:1) on field-facing screens; AA (4.5:1) on planning-only
3. **No swipe / no long-press** for safety-critical actions
4. **Layer-0 visibility** for safety messages — never collapsed
5. **Stepper buttons over keyboard** for numeric field input
6. **Bottom-nav with ≤5 items** on mobile
7. **"Today" must be the mobile landing screen**
8. **Offline-first** — every screen must function with no network
9. **Body text ≥16px; primary data ≥20px; dilution amounts ≥28px** (HCD Guide §2.7)
10. **Persistent dilution-reference panel on desktop** (320px right column)

### 1.3 Secondary heuristics

Nielsen 10 and Norman 7 are used to *label* findings within the ISO frame (e.g., "violates Nielsen #4 — consistency"). They are not the headline framework.

### 1.4 Severity scale

- **P0** — Blocks a documented persona's core task, or violates a hard invariant (safety, AAA contrast on STOP screen, missing FR for a documented persona).
- **P1** — Measurably slows or confuses a task; clear fix path.
- **P2** — Cosmetic, future polish, or ambiguous trade-off.

---

## 2. Hypothesis verdicts

20 hypotheses formed during exploration. Each has a verdict + evidence.

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | Home is a dead-end for first-run users | **PARTIALLY CONFIRMED** | `/` ([+page.svelte](../apps/web/src/routes/+page.svelte)) is 11 tiles, no guidance. `/today` empty-state at least directs to `/plan` ([today:78](../apps/web/src/routes/today/+page.svelte#L78)). The dead-end is on `/`, not `/today`. → F-L |
| H2 | Spray flow click-count is high | **CONFIRMED** | 11 clicks no-prefill; 8 clicks with deep-link. Tank size and conditions don't pre-fill from sprayer profile ([spray:19-24](../apps/web/src/routes/spray/+page.svelte#L19)). → F-R |
| H3 | Today→Scout→Spray deep-links may not propagate `?block=` | **REFUTED** | Block param consumed: scout reads `data.preselectedBlockId` ([scout:6](../apps/web/src/routes/scout/+page.svelte#L6)); spray reads `data.preselect.blockId` ([spray:8-11](../apps/web/src/routes/spray/+page.svelte#L8)); `?windowStage=` filters herbicide list ([spray:25](../apps/web/src/routes/spray/+page.svelte#L25)). |
| H4 | Bypass-error inline card may scroll off-screen | **CONFIRMED** | Result section ([spray:399](../apps/web/src/routes/spray/+page.svelte#L399)) is below 5 steps + sticky CTA. No `scrollIntoView` after evaluation. Aria-live announces but visual focus is missed. → F-J |
| H5 | Decon completion is unconfirmed | **REFUTED** | Success page exists ([decon:207-217](../apps/web/src/routes/spray/decon/+page.svelte#L207)) with explicit confirmation. Global banner disappearance is *additionally* silent, but the in-flow positive feedback is fine. |
| H6 | `/records/pending` is hard to discover | **CONFIRMED** | Only surfaces via the transient banner ([+layout.svelte:75-90](../apps/web/src/routes/+layout.svelte#L75)). Not in nav. → F-N |
| H7 | Calibration's owner-only save is a dead-end for helpers | **CONFIRMED** | Helper sees "Owner role required to save calibration." with no follow-up affordance ([calibrate:154](../apps/web/src/routes/calibrate/+page.svelte#L154)). → F-M |
| H8 | Plugin upload rejection messages may not map to authoring UI | **NOT VERIFIED** | Would need to read `/plugins` upload flow + `lib/plugins/registry`. Out of scope for this static pass. Recommend follow-up. |
| H9 | `/today` Sprayers panel duplicates `/spray` step 3 | **CONFIRMED** | Both surface the same sprayer list ([today:107-125](../apps/web/src/routes/today/+page.svelte#L107) vs [spray:282-304](../apps/web/src/routes/spray/+page.svelte#L282)). Different layouts. → F-P (consistency, Nielsen #4) |
| H10 | Calendar split from Plan | **CONFIRMED** | Two routes: [plan/+page.svelte](../apps/web/src/routes/plan/+page.svelte) and [plan/calendar/+page.svelte](../apps/web/src/routes/plan/calendar/+page.svelte). Both linked from home tiles + nav inconsistently. → F-O |
| H11 | Field-screen contrast may be WCAG AA only | **CONFIRMED** | STOP card text `#b00020` on `#fce8e8` ≈ 4.8:1 ([spray:773-776](../apps/web/src/routes/spray/+page.svelte#L773)). Decon-banner `#b35900` on `#fff3cd` ≈ 4.6:1 ([+layout.svelte:262-264](../apps/web/src/routes/+layout.svelte#L262)). Both are AA, **fail HCD §2.2 AAA (7:1) for safety/field screens**. → F-A |
| H12 | Primary spray CTA is 56px not 60dp | **CONFIRMED, marginal** | `min-height: 56px` on primary buttons across [spray:755](../apps/web/src/routes/spray/+page.svelte#L755), [calibrate:271](../apps/web/src/routes/calibrate/+page.svelte#L271), [decon:325](../apps/web/src/routes/spray/decon/+page.svelte#L325). HCD §2.3 recommends 60dp. 7% short. → F-I |
| H13 | Top-nav has too many items | **CONFIRMED** | Top-nav has **9 items** (Today / Plan / Spray / Scout / Harvest / Calibrate / Equipment / Records / Plugins) ([+layout.svelte:62-72](../apps/web/src/routes/+layout.svelte#L62)). HCD §2.5: ≤5 items, bottom-nav for mobile field. Almost double. → F-D |
| H14 | Landing screen is `/` not `/today` | **CONFIRMED** | Brand link goes to `/` ([+layout.svelte:47](../apps/web/src/routes/+layout.svelte#L47)). `/+page.svelte` renders an 11-tile menu, not the daily action card. HCD §2.5: "Today" tab is the mobile landing screen. → F-E |
| H15 | Hay + small-grain workflows entirely absent | **CONFIRMED** | No `/hay` route. No `lib/hay/`. No moisture gates in `lib/safety/`. No `zadoksStages` field in plugin schema. P3 (Hay Operator) cannot use the app. → F-B |
| H16 | Body / dilution font sizes below HCD floors | **PARTIALLY CONFIRMED** | Dilution-table amount `font-size: 1.2rem` ≈ 19.2px ([spray:799](../apps/web/src/routes/spray/+page.svelte#L799)) — under HCD §2.7's 28px floor for "primary data". Body text default at 1rem (16px) ✓. Stepper output 1.6rem ✓. GPA result 3rem ✓. The dilution table is the violation. → F-K |
| H17 | Placeholder text inside inputs | **CONFIRMED on harvest + scout** | [harvest:133](../apps/web/src/routes/harvest/+page.svelte#L133) `placeholder="e.g. 14 bushels"`, [harvest:137](../apps/web/src/routes/harvest/+page.svelte#L137) `placeholder="e.g. 2026-A-7"`, [scout:72](../apps/web/src/routes/scout/+page.svelte#L72) `placeholder="e.g. 1.5"`. HCD §2.7 forbids — placeholder disappears on type, unusable with gloves. Spray flow uses steppers exclusively ✓. → F-F |
| H18 | No persistent dilution-reference panel on desktop | **CONFIRMED** | `main` is `max-width: 960px` single-column on all viewports ([+layout.svelte:256-260](../apps/web/src/routes/+layout.svelte#L256)). No 3-column desktop layout. HCD §2.1 specs `grid-template-columns: 260px 1fr 320px` at ≥1200px. → F-S |
| H19 | Per-route offline degradation not verified | **NOT VERIFIED** | Service-worker / Workbox config not read in this pass. CLAUDE.md known follow-up ("Workbox precache only takes effect on `pnpm build`"). Recommend live verification. |
| H20 | Plugin schema is v1.0 only | **CONFIRMED** | No `cropOperationModel`, `hayOperations`, `zadoksStages`, `moistureGates` fields. v1.1 is required for FR-19/20/21. → F-C |

---

## 3. Findings — prioritized fix list

Each finding has: ID, severity, persona affected, ISO/Nielsen labels, evidence, fix proposal. Refactoring proposals are **only** included where required to satisfy a documented FR; field-name renames are explicitly avoided.

### P0 — Blocks core task or violates a hard invariant

#### F-A — STOP-card contrast fails HCD §2.2 (AAA)

- **Severity:** P0
- **Personas:** P1, P2 (and P3 once UC-13/14 ship)
- **ISO principle:** #1 (understand environment — sunlight)
- **Nielsen:** #9 (help users recognize errors)
- **Evidence:** `.result.stop` style at [spray/+page.svelte:773-776](../apps/web/src/routes/spray/+page.svelte#L773) sets `background: #fce8e8; border: 2px solid #b00020;`. Heading at [spray:777-782](../apps/web/src/routes/spray/+page.svelte#L777) uses `color: #b00020`. Computed contrast ≈ 4.8:1 — meets WCAG AA, **fails AAA (7:1)**. The decon banner ([+layout.svelte:262-264](../apps/web/src/routes/+layout.svelte#L262)) shares the issue: `#b35900` on `#fff3cd` ≈ 4.6:1.
- **Why it matters:** Safety-critical screens are read in direct sunlight by a glove-handed user. HCD §2.2 mandates 7:1+ on field-facing safety content; 10:1+ on STOP messages.
- **Fix proposal (no code yet):** Move STOP heading to `color: #FFFFFF` on `background: #B71C1C` per HCD §2.2 example palette (≈10:1). Keep the lighter pink only for the violation list rows. Update `+layout.svelte` decon banner the same way.
- **Loci:** [spray/+page.svelte:773-782](../apps/web/src/routes/spray/+page.svelte#L773), [+layout.svelte:262-291](../apps/web/src/routes/+layout.svelte#L262).

#### F-B — UC-13..UC-16 entirely absent (Hay Operator persona unsupported)

- **Severity:** P0
- **Persona:** P3
- **ISO principle:** #1 (explicit understanding of users), #5 (whole user experience)
- **Evidence:** No `/hay` route. No `apps/web/src/lib/hay/`. No moisture gates in [apps/web/src/lib/safety/](../apps/web/src/lib/safety/). No weather adapter. P3 cannot use the app for its primary tasks.
- **Why it matters:** A documented persona has zero path through the product. Functional requirements FR-19 through FR-23 are unimplemented.
- **Fix proposal (refactor justified — required by FR-19/20/21/22/23):**
  - **FR-19 (hay multi-step engine):** new `apps/web/src/lib/hay/` module with state machine modeled on the spray-flow's `$state` step pattern. New `/hay` route as the cutting-decision dashboard; `/hay/log/<cuttingId>` as the step-logging UI.
  - **FR-20 (Zadoks calculator):** extend [apps/web/src/lib/calendar/](../apps/web/src/lib/calendar/) with stage-from-planting-date math; consume new plugin field `zadoksStages`.
  - **FR-21 (moisture gate):** new rule type in [apps/web/src/lib/safety/](../apps/web/src/lib/safety/) parallel to existing herbicide gates. Bump `RULES_VERSION` per CLAUDE.md invariant #1. Plugin declares thresholds; kernel enforces. Property tests with fast-check parallel to existing safety tests.
  - **FR-22 (weather window):** new `apps/web/src/lib/weather/` adapter. Provider needs user decision (NOAA NWS API is free, no key, JSON; OpenWeatherMap requires a key but better historical). Treat the adapter as a kernel-style boundary so it can be swapped.
  - **FR-23 (multi-cutting record):** new `cutting` table in [apps/web/src/lib/db/schema.ts](../apps/web/src/lib/db/schema.ts); Drizzle migration; repo + endpoints. Existing harvest table is not refactored — `cutting` is a sibling concept.
- **Plugin schema bump (additive):** see F-C.

#### F-C — Plugin schema is v1.0; v1.1 required for FR-19/20/21

- **Severity:** P0 (blocks F-B remediation)
- **Persona:** P1 (plugin author), P3 (data consumer)
- **Evidence:** Plugin loader at [apps/web/src/lib/plugins/](../apps/web/src/lib/plugins/) currently expects v1.0. HCD Guide §4 specifies v1.1 with optional fields: `cropOperationModel: "single-event" | "multi-step" | "perennial-multi-cut"`, `hayOperations`, `zadoksStages`, `moistureGates`.
- **Fix proposal (refactor justified — additive, backward compatible):**
  - Extend Zod validators in `lib/plugins/` to accept either `schemaVersion: "1.0"` or `"1.1"`. v1.1 fields are all optional — existing v1.0 plugins remain valid; `validateFile()` returns success on both.
  - Per CLAUDE.md invariant #1, **moisture-gate logic stays in TypeScript**, not in plugin JSON. The plugin declares thresholds; the kernel reads them and enforces. This mirrors the existing herbicide-class-vs-rule split.
  - Per CLAUDE.md invariant #2, plugins remain data-only. No executable hooks added.
  - Sample plugin files (HCD Guide §3.8, §3.9) become fixtures in `plugins/crops/`.

### P1 — Measurably slows or confuses a task

#### F-D — Top-nav has 9 items; HCD §2.5 specifies ≤5 bottom-nav for mobile field use

- **Severity:** P1
- **Personas:** P2 (most affected — gloved one-handed phone use)
- **ISO principle:** #1 (environment); HCD §2.5
- **Evidence:** [+layout.svelte:62-72](../apps/web/src/routes/+layout.svelte#L62) renders 9 top-nav links (Today / Plan / Spray / Scout / Harvest / Calibrate / Equipment / Records / Plugins). At 375px viewport these wrap to 2 rows. HCD §2.5 specifies bottom-nav with ≤5 items for mobile.
- **Fix proposal:** On mobile (<768px), use bottom-nav with the 5 highest-frequency items: **Today / Plan / Spray / Scout / Records**. Move Harvest, Calibrate, Equipment, Plugins under a "More" sheet. Desktop keeps the existing top-nav unchanged or uses the left-sidebar layout from HCD §2.5. CSS-only via media queries; no route changes.

#### F-E — Mobile landing screen is `/`, not `/today`

- **Severity:** P1
- **Personas:** P1, P2
- **HCD §2.5:** "The Today tab is always the landing screen on app open."
- **Evidence:** `/+page.svelte` renders an 11-tile menu hero. `/today/+page.svelte` is reachable via tile or top-nav. The two screens overlap conceptually.
- **Fix proposal:** Two options. (a) Server-side redirect `/` → `/today` for authenticated sessions only — preserves `/` for unauthenticated landing. (b) Convert `/+page.svelte` to render the today card directly when authenticated, falling back to the tile grid for first-run. Option (a) is smaller and reversible. UC-20 (onboarding) interleaves with this — a first-run user skips the redirect.

#### F-F — Placeholder text used as label in harvest + scout inputs

- **Severity:** P1
- **Personas:** P2 (gloved field use), P1
- **HCD §2.7:** "Avoid text input in the field; placeholder text disappears when user starts typing — unusable with gloves."
- **Nielsen:** #6 (recognition over recall)
- **Evidence:**
  - [harvest:133](../apps/web/src/routes/harvest/+page.svelte#L133) `<input type="text" placeholder="e.g. 14 bushels" bind:value={quantity} />`
  - [harvest:137](../apps/web/src/routes/harvest/+page.svelte#L137) `<input type="text" placeholder="e.g. 2026-A-7" bind:value={lotNumber} />`
  - [scout:72](../apps/web/src/routes/scout/+page.svelte#L72) `<input type="number" min="0" step="0.5" bind:value={maxHeight} placeholder="e.g. 1.5" />`
- **Fix proposal:** Replace each placeholder with a visible `<small>` hint *outside* the input, persisting across keystrokes. The harvest label is already above the input ("Quantity") — adding "(e.g. 14 bushels)" to the label string is a one-line change per input. Scout's `<small>Leave blank if you didn't measure.</small>` already exists; just append the example.

#### F-G — Sign-in/Sign-out buttons under the 48px floor

- **Severity:** P1
- **ISO principle:** #1 (environment — gloves); WCAG 2.5.5 (target size)
- **Evidence:** [+layout.svelte:228-229](../apps/web/src/routes/+layout.svelte#L228) `min-height: 36px; min-width: 36px;` — explicitly overrides the global 48px rule on lines 128-131. Sign-in/out is not safety-critical, but it's a hard rule violation visible on every page.
- **Fix proposal:** Remove the 36px override. Let the global rule apply. Header layout already uses flex-wrap; one extra row of header height is acceptable.

#### F-H — Today CTA buttons are 44px

- **Severity:** P1
- **Personas:** P1, P2
- **Evidence:** [today:241](../apps/web/src/routes/today/+page.svelte#L241) `min-height: 44px` on `.cta`. Under the 48px global rule and HCD §2.3 60dp recommendation. Today is the most-used screen of the entire app.
- **Fix proposal:** Set `.cta { min-height: 60px; padding: 0.9rem 1.25rem; }`. The CTA is the primary action of UC-11 — it deserves the field-grade target size.

#### F-I — Primary CTAs are 56px not 60dp

- **Severity:** P1 (marginal)
- **Evidence:** [spray/+page.svelte:755](../apps/web/src/routes/spray/+page.svelte#L755), [calibrate/+page.svelte:271](../apps/web/src/routes/calibrate/+page.svelte#L271), [decon/+page.svelte:325](../apps/web/src/routes/spray/decon/+page.svelte#L325) all set `min-height: 56px`. HCD §2.3 recommends 60dp for primary field actions. 7% short.
- **Fix proposal:** Bump to 60px as a constant. Three single-line CSS changes.

#### F-J — Bypass-error card not auto-scrolled into view

- **Severity:** P1
- **Personas:** P1, P2
- **Nielsen:** #1 (visibility of system status)
- **Evidence:** Result section ([spray:399](../apps/web/src/routes/spray/+page.svelte#L399)) renders below 5 form steps + sticky CTA. Aria-live `polite` + `aria-atomic="true"` ([spray:404-405](../apps/web/src/routes/spray/+page.svelte#L404)) announce to screen readers. Visual users on a phone must scroll up after tapping "Check safety". On a 375×667 viewport with the 5 steps expanded, the result is 600+px below the fold.
- **Fix proposal:** After `evaluate()` returns, call `document.querySelector('.result')?.scrollIntoView({behavior: 'smooth', block: 'center'})`. Five lines added to the existing `evaluate()` `finally` block. Critical for the STOP path; harmless for the OK path.

#### F-K — Dilution-amount font under HCD §2.7 floor

- **Severity:** P1
- **Personas:** P1, P2 — this is the *primary data* of UC-02
- **HCD §2.7:** "Dilution amounts ≥28px"
- **Evidence:** [spray:798-801](../apps/web/src/routes/spray/+page.svelte#L798) `.dilution td strong { font-size: 1.2rem; color: #1f5e3a; }` — 1.2rem ≈ 19.2px. Under 28px floor.
- **Fix proposal:** Bump to `font-size: 1.75rem` (≈28px) or `2rem` (32px). One CSS line. Fields most likely to be misread at arm's length on a phone in sun.

#### F-L — First-run users on `/` get 11 tiles with zero guidance (UC-20 gap)

- **Severity:** P1
- **Persona:** P5 (First-Run Sherry)
- **Evidence:** [+page.svelte](../apps/web/src/routes/+page.svelte) renders 11 tiles with one-line subtitles. No empty-database detection. New user has no block, no sprayer, no idea what order to do things in.
- **Fix proposal:** New `OnboardingCard.svelte` (small component) that:
  1. Reads `data.counts` (already loaded in [today/+page.server](../apps/web/src/routes/today/+page.server.ts) — refactor or duplicate-load on `/`)
  2. If `counts.blocks === 0`: render a 3-step guide — *(1) Add your first block & planting → (2) Register a sprayer → (3) Calibrate it*
  3. Each step's CTA deep-links to the right page
  4. Card auto-hides once all 3 steps are complete
- **Acceptance:** A first-run user reaches "first calendar event visible on /today" in under 10 minutes.

#### F-M — Helper completes calibration, can't save, no escape hatch

- **Severity:** P1
- **Persona:** P2
- **Evidence:** [calibrate:153-155](../apps/web/src/routes/calibrate/+page.svelte#L153) renders "Owner role required to save calibration." for helpers. No "send result to owner" affordance. Marco walks the wizard, gets the GPA, then has no way to give the number to Sherry.
- **Fix proposal:** Add a "Send to owner" button next to the lock-msg. Behavior options: (a) write the calibration to a `pending_calibrations` table for owner review (preferred, durable); (b) compose an email with the values pre-filled (lightweight, no schema change); (c) show a printable receipt the helper hands over (lowest effort). Pick (a) for parity with the spray-record server-validation pattern.

### P2 — Cosmetic / future polish

#### F-N — `/records/pending` discoverability

- **Severity:** P2
- **Persona:** P1, P2
- **Evidence:** Reachable via banner ([+layout.svelte:75-90](../apps/web/src/routes/+layout.svelte#L75)) or direct URL only. Not a top-nav item. Not in home tiles.
- **Fix proposal:** When `pendingCount > 0` on `/records`, render a "View pending queue (N)" CTA at the top of the records page. Persistent until queue is empty.

#### F-O — `/plan` and `/plan/calendar` split

- **Severity:** P2
- **Persona:** P1
- **Evidence:** Two routes; planner often needs both. Calendar deep-link present in home tiles ([+page.svelte:8](../apps/web/src/routes/+page.svelte#L8)) but not in primary nav.
- **Fix proposal:** Add a tab strip at the top of `/plan` that toggles between "Blocks" and "Calendar" views — same data, two presentations. Or simply add an in-page calendar widget below the block list. No URL changes; preserve `/plan/calendar` as a deep-link target.

#### F-P — `/today` Sprayers panel duplicates `/spray` step 3

- **Severity:** P2
- **Persona:** P1, P2
- **Nielsen:** #4 (consistency and standards)
- **Evidence:** Sprayers list rendered in two places with different layouts ([today:107-125](../apps/web/src/routes/today/+page.svelte#L107) vs [spray:282-304](../apps/web/src/routes/spray/+page.svelte#L282)). Different status badges, different decon CTA placement.
- **Fix proposal:** Extract a shared `SprayerCard.svelte` component used by both routes. Same status badges, same warn/ok colors, same decon link.

#### F-Q — Harvest readiness indicators in collapsed `<details>` (Layer 2)

- **Severity:** P2
- **Persona:** P1, P2
- **HCD §2.4:** "Avoid placing important information inside Progressive Disclosure patterns such as Accordions or Tabs."
- **Evidence:** [harvest:114-121](../apps/web/src/routes/harvest/+page.svelte#L114) wraps readiness indicators in `<details>`. For a planting in-window, the indicators are the *primary decision data* — should be Layer 0.
- **Fix proposal:** When `status === 'in-window'`, render indicators inline (not collapsed). Other statuses (too-early, past, harvested) can keep the collapsed default.

#### F-R — Spray flow doesn't pre-fill from sprayer profile

- **Severity:** P2
- **Persona:** P2
- **Evidence:** Tank size hard-defaults to 50 ([spray:24](../apps/web/src/routes/spray/+page.svelte#L24)); conditions hard-default to wind 5, temp 70, rain 0, corn 6 ([spray:20-23](../apps/web/src/routes/spray/+page.svelte#L20)). Sprayer profile holds calibration but not preferred tank size or "last conditions used".
- **Fix proposal:** Add `defaultTankGallons` to the sprayer table; persist last-used conditions per-sprayer to `localStorage`. On sprayer select, hydrate the form. Saves Marco 2-3 stepper interactions per spray. Defer until F-D / F-E land.

#### F-S — No persistent dilution-reference panel on desktop

- **Severity:** P2
- **Persona:** P1
- **HCD §2.1:** Desktop layout `grid-template-columns: 260px 1fr 320px` with right column for "dilution reference, crop notes, weather"
- **Evidence:** [+layout.svelte:256-260](../apps/web/src/routes/+layout.svelte#L256) `main { padding: 1rem; max-width: 960px; margin: 0 auto; }` — single-column on every viewport.
- **Fix proposal:** At `min-width: 1200px`, switch `main` to a 3-column grid; populate the right 320px column from a per-route `<svelte:fragment slot="aside">` slot. Default the slot to a no-op so unaffected pages don't change. Dilution-table reference (last spray's amounts) is the natural slot consumer for `/spray` and `/today`. Larger refactor; defer.

---

## 4. UC-by-UC walkthrough — click counts and friction

| UC | From | To | Click count | Notes |
|---|---|---|---|---|
| UC-01 | `/` | block + planting saved | 5 | OK once user finds Plan tile |
| UC-02 | `/today` (deep-linked) | spray recorded | 8 | F-J makes step 7→8 require a scroll |
| UC-02 | `/today` (no deep-link) | spray recorded | 11 | F-R could shave 2-3 |
| UC-03 | inside UC-02 step 7 | bypass acknowledged | 1-2 | F-J + F-A |
| UC-04 | banner | decon recorded | 8 + 30min | OK |
| UC-05 | `/today` deep-link | SPRAY decision | 5–8 | depends on spot count |
| UC-06 | `/today` | harvest recorded | 4 | F-F on quantity + lot |
| UC-08 | `/` | plugin loaded | 3 (upload) / ~10 (authoring) | F-C limits to v1.0 |
| UC-09 | `/` | PDF downloaded | 3 | F-T (audit absent — see UC-22) |
| UC-10 | `/` | GPA saved (owner) | 6 | F-M for helper |
| UC-10 | `/` | GPA seen (helper) | 5 | dead-end (F-M) |
| UC-11 | `/` | first action chosen | 2 | should be 1 (F-E) |
| UC-12 | banner | queue drained | 1 + N | F-N |
| UC-13..16 | n/a | n/a | n/a | F-B — not implementable |
| UC-17 | `/signin` | session active | 2 | OK |
| UC-18 | `/` | calendar visible | 1–2 | F-O |
| UC-19 | `/` → `/records` | filtered | 3 | OK |
| UC-20 | `/` (empty DB) | first event on `/today` | unbounded | F-L — there is no path |
| UC-21 | n/a | helper invited | n/a | not implemented |
| UC-22 | (Dale's PDF inbox) | answer | n/a | F-T audit pending |
| UC-23 | (broken phone) | records intact | n/a | F-U documentation gap |
| UC-24 | `/records` | "last spray of X" | unbounded — not supported | UC-24 proposed |

---

## 5. Recommended remediation roadmap

Ordered by user-impact / effort ratio.

### Sprint A — quick wins (≤1 day each, no schema change)

1. **F-J** — auto-scroll bypass card into view (5 LOC)
2. **F-F** — replace placeholders with persistent labels (3 inputs, ~10 LOC)
3. **F-G** — remove 36px sign-in override (delete 4 lines)
4. **F-H** — bump today CTA to 60px (1 LOC)
5. **F-I** — bump primary CTAs from 56→60px (3 files, 1 LOC each)
6. **F-K** — bump dilution font to 1.75rem (1 LOC)

Effort: ½ day total. Resolves 6 P1 findings.

### Sprint B — visual + a11y rework (1–2 days)

1. **F-A** — STOP card and decon banner palette to white-on-#B71C1C (≥10:1)
2. **F-D** — bottom-nav at <768px with 5 items + More sheet
3. **F-E** — `/` → `/today` redirect for authenticated users
4. **F-Q** — readiness indicators inline for in-window plantings

Effort: 1–2 days. Resolves 1 P0 + 3 P1.

### Sprint C — onboarding + helper continuity (2–3 days)

1. **F-L (UC-20)** — `OnboardingCard.svelte` wired to `data.counts`
2. **F-M (UC-10)** — helper "Send to owner" via new `pending_calibrations` table

Effort: 2–3 days. Resolves 2 P1; closes UC-20 gap.

### Sprint D — UC-22 export audit (½ day, audit only)

Read the existing PDF/CSV export endpoint. Apply the inspector lens. Output: a UC-22-specific finding list. No code in this sprint.

### Sprint E — FR-19..FR-23 hay & small grain (multi-week)

Major net-new functionality. See F-B and F-C for the full proposal. Order:

1. Plugin schema v1.1 validator (additive) + sample fixtures (alfalfa, spring barley) — 1 day
2. Zadoks calculator in `lib/calendar/` — 1 day
3. Moisture-gate kernel rule type + property tests + `RULES_VERSION` bump — 2 days
4. `cutting` table + Drizzle migration + repo + endpoints — 1 day
5. Weather adapter (NOAA NWS as default) — 1 day
6. `/hay` route + state machine + UC-13/14 UI — 3 days
7. UC-15/16 extensions to existing `harvest/` + calendar — 2 days
8. End-to-end tests (Playwright) for the new flows — 1 day

Estimate: 10–12 days. Discuss the weather provider choice with the user before starting.

### Deferred / discuss

- **F-B sub-decision:** weather provider — needs user input
- **UC-21** — Auth.js wire-up; CLAUDE.md flags this as known follow-up; defer until UC-20 lands
- **UC-23** — durability story; document loss boundary in CLAUDE.md before deciding code path
- **UC-24** — text search on records; defer until 2-year history actually accumulates
- **F-S** — desktop 3-column layout; defer until at least one consumer route exists

---

## 6. What this audit did *not* cover

- Live PWA boot. No browser screenshots. No axe / Lighthouse. Several findings (F-A contrast values, font sizes) are based on CSS values; live measurement is recommended before fixing.
- Service-worker / Workbox per-route offline behavior (H19 unverified). CLAUDE.md flags this.
- The `/equipment` route — visible in nav and home tiles but not walked here.
- The `/api/spray/evaluate` endpoint — the kernel itself. Out of scope (this is UX, not safety).
- The PDF/CSV export rendering — flagged as UC-22 audit pending.
- Plugin authoring rejection-message round-trip (H8 unverified).
- Performance / load-time / bundle-size.
- Internationalization — the app is single-locale.

A follow-up live-PWA audit pass is warranted after Sprint A and B land.
