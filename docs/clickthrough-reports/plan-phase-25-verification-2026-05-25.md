# Clickthrough report — /plan Phase 25 Almanac verification — 2026-05-25

**Tester:** playwright-clickthrough subagent
**Build:** ca8cb96
**Seed:** dev DB (port 5173); 1 block + 1 planting created via API during test run
**Viewport:** default (1280×720 headless Chromium)
**Auth:** demo owner (role=owner, farm "Test Farm 2")

## Summary
- Checks: 12 | Pass: 8 | Fail: 4 | Blocked: 0 | Skipped: 0
- New findings: P0=0, P1=2, P2=2

---

## Findings

### CT-P25-PLAN-001 — Workflow strip step buttons are disabled / not deep-linkable [P2]
- **Spec:** `direction-almanac-plan-v2.jsx` lines 476–515 (`APlanWorkflowStrip`). Each step bubble is a `<button>` whose click "opens that wizard step (in this prototype, just a hover hint)". The mockup implies step-scoped wizard launch is the intended affordance.
- **Route:** `apps/web/src/lib/components/plan/WorkflowStrip.svelte:103` — `disabled={!onSelectStep}`.
- **Expected:** Each step button (Season setup, Allocation, Schedule, Inputs plan, Commit) is interactive; clicking it opens the AllocationWizard anchored to that step.
- **Observed:** All 5 step buttons render with `disabled` attribute and `cursor: default`. The plan page passes `onOpenWizard` but not `onSelectStep` (per the inline comment on line 2367: "onSelectStep wiring lands when the wizard accepts an initial-step prop (follow-up)"). Hovering any step shows no tooltip. "Open wizard" CTA works and mounts the wizard at step 0 correctly.
- **Console:** No errors.
- **Network:** No failures.
- **Screenshot:** `./screenshots/2026-05-25-plan-populated.png`
- **Recommendation:** Wire `onSelectStep` once the wizard's `AllocationWizard` accepts an `initialStep` prop. Until then, consider showing a tooltip on hover (the `title` attribute is already set but invisible on a disabled button) or rendering steps as enabled anchors that launch the wizard at step 0 with a visual callout.

---

### CT-P25-PLAN-002 — PlantingCard missing variety italic subtitle and Role/Stage metadata [P1]
- **Spec:** `direction-almanac-plan-v2.jsx` lines 141–158 — each card shows `{p.crop}` (serif, 17px) + `{p.variety} · {p.role}` (italic, 12px, muted) and a 2-col metadata grid with fields Role, Stage, Planted, Harvest, Area.
- **Route:** `apps/web/src/lib/components/plan/PlantingCard.svelte:137–168` + `PlanV2Shell.svelte:248–254`.
- **Expected:** Planting card renders "Bloody Butcher Dent Corn" title + italic variety sub-line (e.g., `{varietyDisplayName} · primary`) + 5-field metadata grid including Role and Stage.
- **Observed:** Variety sub-line is absent (`.pc-sub` element count = 0). The PlantingCard renders only Planted / Harvest / Area (3 cells, not 5) because `role` and `stage` props are `undefined`. `PlanV2Shell.svelte` calls `<PlantingCard planting={p} daysToMaturity=… companions=… />` without passing `role` or `stage`. The `PlantingRecord` type does not carry these fields; they are intentionally optional props, but no derivation path from the DB data fills them.
- **Console:** No errors.
- **Network:** No failures.
- **Screenshot:** `./screenshots/2026-05-25-plan-populated.png`
- **Recommendation:** Either (a) derive `role` from the planting's `groupRole` field if present (the DB stores `groupRole` on `PlantingRecord`), or (b) derive a synthetic "primary / companion" label from whether the planting is the first in the block. `stage` can be derived from `eventsForPlanting()` once the PlanV2Shell's `blockEvents` derivation is completed (currently it returns `[]` because it iterates plantings but breaks before calling the engine). At minimum, populate `role` from `planting.groupRole ?? 'primary'` so the field renders on seeded blocks.

---

### CT-P25-PLAN-003 — ScheduledTasksCard "Add Task" button not wired [P2]
- **Spec:** `direction-almanac-plan-v2.jsx` line 294 — `<button>+ Task</button>` in the scheduled-tasks card header. Implies task creation from this surface.
- **Route:** `apps/web/src/lib/components/plan/ScheduledTasksCard.svelte:51–55` — `{#if onAddTask}` guard. `PlanV2Shell.svelte:272–277` — calls `<ScheduledTasksCard rows={scheduledRows} titleSuffix=… />` without `onAddTask`.
- **Expected:** A "+ Task" ghost button appears in the card header and opens a task-creation flow.
- **Observed:** No "+ Task" button in the rendered ScheduledTasksCard header; the `onAddTask` prop is never passed from PlanV2Shell, so the conditional block is always false. The card renders "Nothing scheduled in this window." with no way to add tasks from this surface.
- **Console:** No errors.
- **Network:** No failures.
- **Screenshot:** `./screenshots/2026-05-25-plan-populated.png`
- **Recommendation:** Wire `onAddTask` from PlanV2Shell to the parent's existing task-creation flow (or navigate to `/today?addTask=1`). Until wired, the spec affordance is invisible to the user.

---

### CT-P25-PLAN-004 — Block header missing geometry-status badge [P1]
- **Spec:** `direction-almanac-plan-v2.jsx` line 94 — the pill stack includes a "Harvest window {block.harvest}" pill and a status pill. The mockup description in the issue brief states "geometry status (badge if missing GeoJSON)". The block header kicker line reads "Block · {acres} ac · {polyLabel}" with no explicit geometry indicator, but the item scope says "geometry status badge."
- **Route:** `apps/web/src/lib/components/plan/PlanBlockHeader.svelte:79–87`.
- **Expected:** When `block.geometryGeojson` is null/undefined, a "No geometry" or "Map TBD" pill renders in the pills row so the operator knows to draw the block on the layout editor.
- **Observed:** The pill set renders only "0.5 ac" (the acres pill). The `harvestWindowLabel` and `statusLabel` props are not passed from PlanV2Shell — they are optional and left undefined. No geometry indicator exists anywhere in the block header. `Block A` in the test has `geometryGeojson: null` but no visual cue distinguishes it from a geo-complete block.
- **Console:** No errors.
- **Network:** No failures.
- **Screenshot:** `./screenshots/2026-05-25-plan-with-block.png`
- **Recommendation:** In PlanBlockHeader, add a `{#if !block.geometryGeojson}` branch that renders a "No map geometry" pill with `tone="neutral"` and a MapPin icon, linking or calling `onOpenMap`. This is consistent with the geometry-missing banner pattern already used in the pollination panel.

---

## Pass items

| Check | Result | Notes |
|---|---|---|
| **Shell structure** — top nav 7 items, Plan active with `aria-current="page"`, brand + farm chip | PASS | All 7 nav links present; "Plan" link has `aria-current="page"` and `class="active"`; brand shows "CropCard" + "Test Farm 2" chip |
| **Workflow strip** — renders above PlanV2Shell, all 5 steps visible (Season setup, Allocation, Schedule, Inputs plan, Commit) with correct state | PASS | Strip present as `[role="group"]` with aria-label "Season 2026 workflow"; populated state shows "Allocation ✓ 1 planting" and "Schedule ✓ 1/1 dated" reflecting the seeded planting |
| **Workflow strip "Open wizard" CTA** | PASS | Button mounts AllocationWizard in a dialog with title "Season 2026 plan · wizard 0. Season"; steps 0–6 visible; Exit button closes correctly |
| **Block left rail** — lists blocks with name + acres + planting count, filter input, "New block" button | PASS | PlanLeftRail renders correctly: "Blocks · 1" kicker, filter textbox, "Block A 0.5 ac Bloody Butcher Dent Corn" button with color bar |
| **Block header** — kicker, serif h1, 4 action buttons (View on map / Refine with AI / Edit block / Add planting) | PASS | All 4 buttons present and interactive; kicker "Block · 0.5 ac · single planting" matches spec pattern |
| **PlantingCard core** — crop name, status pill, Planted/Harvest/Area metadata, provenance footer | PASS | Card renders with serif title, "active" pill, Planted "May 1, 2026", Harvest "Aug 4", Area "—", "Manual entry" source footer |
| **Season Gantt (SeasonTimelineCard)** — 7-month axis Apr→Oct, TODAY pin, per-planting rows with colored windows | PASS | Timeline renders with Apr/May/Jun/Jul/Aug/Sep/Oct axis labels; TODAY pin visible; "planting → fruit set" + "harvest" windows rendered via DTM fallback; today-line at correct position |
| **Map overlay** — click "View on map" opens dialog with pictorial block map, close button works, "Open full layout editor" link correct | PASS | Overlay renders as `dialog "Home Field · Block A highlighted"`; block shown as clickable button; compass indicator; footer hint + "Open full layout editor" → `/plan?tab=layout`; close button returns URL to `/plan` |
| **Legacy `<details>` editor** — disclosure summary text, opens on click, contains 4 tab nav links | PASS | `details.legacy-detail` present; summary "Full plan editor — fields · layout · crops · calendar · schedule"; click opens to reveal `nav[aria-label="Plan tabs"]` with Overview / Layout / Crops / Calendar links; no errors on open |
| **Console + network** | PASS | Only Google Fonts CDN 404s (network isolation); no app-code errors; no 4xx/5xx on any plan-page navigation or API call |
| **Tenant isolation** | PASS | Owner chip shows "Home Farm owner / Test Farm 2 owner"; current session active on "Test Farm 2"; block created in session belongs to the active owner; UI reflects the correct tenant scoping |
| **Block switch** (single-block env) | PASS | Block A auto-selected on load; left rail shows `class="selected"` with forest-green left border as per spec; URL updates to `?block={id}` |

---

## Skipped
- Plantings tabs/grid polyculture view — insufficient test data (only 1 planting per block). The `PlantingsTabStrip` renders only for `isPoly` (plantings.length > 1); no seed data with a multi-planting block was available in the dev DB session.
- Tenant block-list switch — only one owner had a block in scope; the other owner ("Home Farm") had 0 blocks so no contrast was observable.
