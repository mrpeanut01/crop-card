# Clickthrough report — /today Phase 25 Almanac verification — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** apps/web/scripts/seed-test-data.mjs (dev DB, port 5173)
**Viewport:** default (1280×720 headless Chromium)
**Auth:** demo owner (role=owner, farm "Home Farm")

## Summary
- Checks: 10 (all spec items) | Pass: 7 | Fail: 3 | Blocked: 0
- New findings: P0=0, P1=3, P2=1

---

## Findings

### CT-P25-001 — Week strip missing Week/Month/Season segmented control [P1]
- **Spec:** `direction-almanac-today.jsx` lines 315–323 — the "This week" heading row includes a right-side segmented control with three pill-shaped buttons: "Week", "Month", "Season". The active button ("Week") has forest-green fill; inactive buttons are outline-only.
- **Route:** `apps/web/src/lib/components/today/WeekStrip.svelte`
- **Expected:** Three toggle buttons labeled "Week", "Month", "Season" in the `<div class="head">` row alongside the "This week" heading.
- **Observed:** The `.head` element renders only `<h3 class="serif">This week</h3>` — no segmented control whatsoever. `document.querySelectorAll('button')` on the week-strip card returns zero results. The strip is always a fixed 7-day view with no period switching.
- **Console:** No errors relating to this component.
- **Network:** No relevant failures.
- **Screenshot:** `./screenshots/2026-05-25-today-topbar-hero.png`
- **Recommendation:** Add the three-button segmented control to `WeekStrip.svelte` and wire a `period` prop (`'week' | 'month' | 'season'`). For Month the grid should expand to a 5-row calendar; for Season it should render the existing Gantt logic currently buried in the legacy `<details>`. This is the primary divergence from the Almanac spec on this screen.

---

### CT-P25-002 — "Skip — note why" ghost button is a dead no-op [P1]
- **Spec:** `direction-almanac-today.jsx` line 255 — `<button style={ghostBtnA}>Skip — note why</button>`. The mockup implies this records a skip reason (the label "note why" suggests a modal or inline text input should follow).
- **Route:** `apps/web/src/lib/components/today/TodayHero.svelte` line 78.
- **Expected:** Clicking the button opens a skip-reason flow (modal, popover, or inline input) that records the skip against the priority action so the task can be rescheduled or dismissed with a note.
- **Observed:** The button renders with `type="button"` and no `onclick` handler, no Svelte event binding, and no form wrapper. Clicking it produces no DOM change, no network request, and no navigation. The button is purely cosmetic.
- **Console:** No errors.
- **Network:** No `/api/tasks` or similar call after click.
- **Screenshot:** `./screenshots/2026-05-25-today-initial.png`
- **Recommendation:** Either (a) wire an `onclick` that opens an inline reason textarea and POSTs `PATCH /api/tasks/:id` with `{ action: 'abort', reason }`, or (b) if the skip flow is intentionally deferred, convert the button to `disabled` with a `title="Coming soon"` so it doesn't mislead users. Currently it implies interactivity that does not exist.

---

### CT-P25-003 — Recommendations "+Schedule task" button is a dead no-op [P1]
- **Spec:** `direction-almanac-today.jsx` line 372 — `<button ...>+ Schedule task</button>`. The label implies the calendar-engine suggestion is committed to the task list.
- **Route:** `apps/web/src/lib/components/today/Recommendations.svelte` line 74.
- **Expected:** Clicking "+Schedule task" calls `POST /api/tasks` (the same `scheduleFromEvent()` function that exists in the legacy `<details>` section of `+page.svelte`), creating a task from the recommendation and reloading the page.
- **Observed:** `button.schedule` has no `onclick`, no Svelte event binding, and no `type="submit"` form wrapper. Two instances of the button are present; clicking either produces no side-effect. The `scheduleFromEvent()` function on the parent page is not wired to this component.
- **Console:** No errors.
- **Network:** No `/api/tasks` POST recorded after click.
- **Screenshot:** `./screenshots/2026-05-25-today-initial.png`
- **Recommendation:** Accept a `onSchedule: (item: RecommendationItem) => void` callback prop in `Recommendations.svelte` and wire the button's `onclick` to it. The parent `+page.svelte` can pass a closure that calls `scheduleFromEvent()` using the underlying `CalendarEvent`. Until wired, the button misleads the user.

---

### CT-P25-004 — Decon banner link text diverges from mockup wording [P2]
- **Spec:** `direction-almanac-today.jsx` line 208 — the call-to-action anchor reads `"Run decon wizard →"` styled with forest weight on the far right.
- **Route:** `apps/web/src/routes/+layout.svelte` (banner rendered in layout).
- **Expected:** Link text "Run decon wizard →" anchored to `/spray/decon?sprayer=<id>`.
- **Observed:** Link text is the sprayer's label and chemistry class: `"Corn-dedicated sprayer (hppd-inhibitor)"` — the sprayer name acts as the link rather than a dedicated CTA phrase. The href `/spray/decon?sprayer=CORN` is correct.
- **Console:** No errors.
- **Network:** No failures. Clicking the link loads `/spray/decon?sprayer=CORN` correctly.
- **Screenshot:** `./screenshots/2026-05-25-today-initial.png`
- **Recommendation:** Append or replace with the action phrase, e.g. `"[Sprayer name] — Run decon wizard →"`, to match the mockup's affordance cue. The current text makes it less clear the link opens the wizard.

---

## Pass items (no findings)

| Check | Result | Notes |
|---|---|---|
| Top nav — 7 items in correct order (Today, Plan, Spray, Scout, Harvest, Stock, Records) | PASS | All 7 present, correct hrefs, Today highlighted with `aria-current="page"` |
| Top nav — Brand mark + farm name visible | PASS | Leaf icon + "CropCard" serif + "Home Farm" mono chip rendered |
| Top nav — Search, Bell, Settings, Avatar on right | PASS | All 4 present; Settings links to `/settings` |
| Decon banner — visible with rust-tinted background | PASS | `background: rgb(241,217,206)`, links to correct `/spray/decon?sprayer=CORN` |
| Greeting + weather strip | PASS | "Good morning." h1, date "Monday, May 25", subtitle "One thing to do today. · 7 items this week.", weather shows 76°F · 6 mph · rain mon→wed |
| Hero card — pills, overdue pill, provenance, scope band | PASS | "Today · do this first" + "Task" + "Overdue · 13d" pills; provenance badge; scope band shows Block/Scheduled |
| Hero card — primary CTA navigates correctly | PASS | Current priority action is a generic task (`relatedEventTable=null`) so `ctaHref='/today'` and `ctaLabel='Mark done'` is correct per `priorityAction.ts:74`. No bug here — would be a bug only if the task had a relatedEventTable. |
| Quick Actions — Spray → /spray, Record harvest → /harvest, Log scout note → /scout | PASS | All three links navigate to correct routes without errors |
| Recommendations — "See all 8 →" links to /plan | PASS | Navigates correctly |
| Legacy `<details>` — tabs and view toggles | PASS | Opens on click; Today/Next 7 days/Next 30 days/Season tabs + List/Calendar toggles all render with correct `?tab=&view=` hrefs |
| ProvenanceLegend tail | PASS | Shows Plugin, Your data, Fallback, You typed (AI-off variant) |
| Season at a glance | PASS | 12 active plantings, 0 sprays YTD, 60 days to next harvest, 691 plugins loaded — all numerically plausible |
| Console errors | PASS | Only Google Fonts CDN 404s (network isolation in test env); no app errors |
| Network 4xx/5xx | PASS | None on page load or any navigation |
