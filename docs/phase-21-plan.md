# Phase 21 — Season Setup + AI Inputs Plan

Canonical tracker for Phase 21. Future sessions should read this first before working on anything in this scope so we don't re-derive context. Mirror format: [phase-9-resume.md](./phase-9-resume.md).

**Status (2026-05-16):** all six sub-tasks shipped. Sprint 1 (A + B + F) on `phase-21a-foundations` (merged); Sprint 2 (C + D + E + B-18 fungicide route) on `phase-21b-planner`. Plugin-data backfill (compliance flags + spray-window purpose tags on existing input/crop plugins) intentionally deferred to a follow-up content pass — the schema fields are all optional.

**Why this phase exists.** The Plan wizard currently decides *what + where + when to plant* (UC-37 allocation → UC-37c schedule). It does not decide *what to apply, when, and what to buy*. Phase 21 closes that gap with two coupled additions:

1. **Season Setup** — a 6-question form, first step of `/plan`, persisted per (owner, year), that captures the operator's input philosophy. Without it, AI input planning has no signal and falls back to conventional defaults.
2. **Inputs Plan (5th wizard step)** — generates per-planting application timelines (weeds + pests + fertility + cover-crop terminate) using crop plugin metadata (`sprayWindows[]`, `growthStageTable`), Season Setup answers, soil tests, and the existing safety kernel. Commits `tasks` rows pre-linked to `spray_event` / `insecticide_event` / `fertility_application`.

**Target persona.** P1 Sherry on a Loudoun small-plot diversified farm (`<100 ac`, 1–5 fields, 3–15 crop varieties, family-operated, direct-market-leaning). Hay path (P3) and inspector path (P4) are explicitly out of scope.

**New UCs.** [UC-42](./use-cases.md#uc-42--season-setup-this-planting-season-form) (Season Setup), [UC-37d](./use-cases.md#uc-37d--ai-inputs-plan-5th-wizard-step) (AI Inputs Plan).

**Explicitly deferred.** Enterprise budgets, forward contracts, crop insurance APH, variable-rate prescriptions, per-cutting hay spray planning (lives in Sprint E / FR-19..FR-23), tissue tests, micronutrient programs, cost rollups against a budget. None of these are appropriate for P1's farm scale.

---

## Sub-task A — Season Setup (foundational)

**Status:** ✓ shipped on `phase-21a-foundations` branch (commit `731a770`).
**Persona:** P1.
**Ships:** new first step of the Plan wizard; `settings.ts`-backed persistence per (owner, year); carry-forward across year boundaries; 1-line summary chip when set.

### Acceptance criteria

1. On first visit to `/plan` in a new calendar year, the wizard shows the 6-question Season Setup form before any other step.
2. If last year's setup exists, a "Use last year's answers" button copies them forward in one click.
3. Once set, the step collapses to a summary chip (e.g., `Organic · IPM · Compost-first · Backpack ≤4 gal · Cover: vetch · 2026`) with an "Edit" link.
4. The form is also reachable from `/settings/season` so it can be edited outside the wizard.
5. Helpers see the chip read-only; only owners can mutate.
6. Cross-tenant: an owner's Season Setup is invisible to other owners (covered by the existing settings cross-tenant test).

### The six fields

Persisted as `settings` rows keyed `season_setup.<year>.<field>`. Stored as JSON-encoded enum values.

| Key | Type | Values | Default |
|---|---|---|---|
| `philosophy` | enum | `'conventional' \| 'non-gmo' \| 'organic-transitioning' \| 'certified-organic'` | `'conventional'` |
| `weedStrategy` | enum | `'cultivate-first' \| 'pre-emergence-ok' \| 'post-emergence-ok'` (cumulative tiers; each includes the methods above) | `'post-emergence-ok'` |
| `pestStrategy` | enum | `'preventive' \| 'ipm' \| 'minimal'` | `'ipm'` |
| `fertilityApproach` | enum | `'synthetic' \| 'compost-amendments' \| 'cover-crop-credits' \| 'mixed'` | `'mixed'` |
| `coverCropIntent` | enum | `'fall-cereal' \| 'vetch-clover' \| 'other' \| 'none'` | `'none'` |
| `sprayCapacity` | enum | `'backpack-4gal' \| 'handheld-25gal' \| 'boom-25-plus' \| 'none'` | `'backpack-4gal'` |
| `transitioningStartedYear` | int (nullable) | YYYY when `philosophy='organic-transitioning'` | null |

`transitioningStartedYear` is the only conditional field — it shows when `philosophy='organic-transitioning'` so the system can compute "year 1/2/3 of 3" for UI surfaces.

### Files

- **New:** `apps/web/src/lib/season/setup.ts` — typed reader/writer:
  ```ts
  export interface SeasonSetup {
    philosophy: 'conventional' | 'non-gmo' | 'organic-transitioning' | 'certified-organic';
    weedStrategy: 'cultivate-first' | 'pre-emergence-ok' | 'post-emergence-ok';
    pestStrategy: 'preventive' | 'ipm' | 'minimal';
    fertilityApproach: 'synthetic' | 'compost-amendments' | 'cover-crop-credits' | 'mixed';
    coverCropIntent: 'fall-cereal' | 'vetch-clover' | 'other' | 'none';
    sprayCapacity: 'backpack-4gal' | 'handheld-25gal' | 'boom-25-plus' | 'none';
    transitioningStartedYear: number | null;
    year: number;
    setAt: number;
  }
  export function loadSeasonSetup(year: number): SeasonSetup | null;
  export function saveSeasonSetup(year: number, input: Partial<SeasonSetup>): SeasonSetup;
  export function carryForward(fromYear: number, toYear: number): SeasonSetup | null;
  export function isOrganicCompliant(s: SeasonSetup): boolean; // helper for planner gating
  export function allowsSynthetics(s: SeasonSetup): boolean;
  ```
  Wraps the existing `lib/db/settings.ts` get/set helpers (already tenant-scoped). No new tables, no migration.

- **New:** `apps/web/src/lib/season/setup.test.ts` — round-trip, carry-forward, default merging, cross-tenant isolation (parallel to `tenant.crossTenant.test.ts` pattern).

- **New:** `apps/web/src/lib/components/SeasonSetupStep.svelte` — wizard step component. Six labeled selects (≥48dp tap targets), conditional `transitioningStartedYear` input, "Use last year's answers" button if applicable, "Save & continue" submit.

- **New:** `apps/web/src/lib/components/SeasonSetupChip.svelte` — collapsed summary chip + "Edit" link. Used in wizard and on `/today`.

- **New:** `apps/web/src/routes/settings/season/+page.svelte` + `+page.server.ts` — standalone edit route.

- **Modified:** `apps/web/src/lib/components/AllocationWizard.svelte` — insert Season Setup as the very first step. Load existing setup in the wizard's `load()`; if present, render the chip and skip past unless user clicks "Edit". If absent, render the form. Pass `seasonSetup` down to all subsequent steps as a prop (alongside the existing assignment/schedule state).

- **Modified:** `apps/web/src/routes/plan/+page.server.ts` — load current year's setup before rendering.

- **Modified:** `apps/web/src/routes/onboarding/+page.svelte` — add a one-line "Want to set up your season now?" link to `/plan` after onboarding completes. Do **not** fold Season Setup into onboarding itself — keeps first-run lightweight (P5 design constraint).

### Edge cases to handle

- **Year rollover.** First time the user opens `/plan` after the new year starts, prompt with "Carry forward 2026 settings to 2027?" — don't silently copy and don't silently leave empty.
- **Mid-season philosophy change.** Allowed — but warn that any already-committed Inputs Plan tasks won't auto-rewrite. Suggest re-running the Inputs Plan step.
- **Helper attempting to edit.** Server rejects with 403; UI hides the edit affordance.
- **No setup yet, downstream AI step runs.** Inputs Plan endpoint must check for setup and 409 with `{ needsSeasonSetup: true }` so the UI can route the user to set it.

### Testing

- Round-trip persistence (set, reload, equal).
- Carry-forward (set 2026, request 2027 setup with carry-forward, equal except for `year` + `setAt`).
- Tenant isolation: owner A's setup invisible to owner B.
- Default merging: partial save fills missing keys with defaults on read.
- Helper writes rejected at server.
- Wizard renders chip when setup present, form when absent.

### Risk

Low. Pure additive. No migration. No safety-kernel touch. CLAUDE.md invariant #6 (tenant isolation) automatically honored via `settings.ts`.

---

## Sub-task B — Plugin schema additions for input planning

**Status:** ✓ shipped on `phase-21a-foundations` (pending commit). Schema + helper + tests + JSON-schema regen all landed. **Plugin-data backfill (tagging `complianceFlags` on input plugins + `purpose` on the 29 crop plugins that carry `sprayWindows[]`) is intentionally deferred to a follow-up commit** — the schema fields are all optional, B-26 (deterministic planner) uses hand-crafted fixtures in its tests, and untagged plugins simply surface as "no philosophy-compliant product" warnings in the UI. Backfill is content work that's separable from the schema change; it will be tracked as a new low-priority backlog item once the planner is live and the operator can see exactly which plugins need flagging.
**Persona:** P1 (data consumer); plugin authors are the producers.
**Ships:** additive plugin fields so the planner can filter by philosophy + know what slot each spray window fills. No breaking changes; v1 plugins remain valid.

### What the planner needs from plugins

The deterministic planner walks `(planting × crop × Season Setup)` and emits applications. To do that without re-deriving knowledge from product names, plugins must carry two things they don't today:

1. **Compliance flags on input plugins** (herbicide, insecticide, fertilizer, fungicide) so the planner can filter by `philosophy`.
2. **Purpose tags on crop `sprayWindows[]`** so the planner knows whether a window is a pre-emergence weed slot, a prophylactic insect slot, a sidedress-N slot, etc.

### Schema additions

#### B.1 — `complianceFlags` on input plugins

Add to `herbicidePluginSchema`, `insecticidePluginSchema`, `fertilizerPluginSchema`, `fungicidePluginSchema`:

```ts
complianceFlags: z.object({
  omriListed: z.boolean().optional(),         // OMRI-Listed for USDA-organic use
  nonGmoCompliant: z.boolean().optional(),    // No GMO-derived ingredients
  certifiedOrganicAllowed: z.boolean().optional(), // True if usable under NOP
  transitioningAllowed: z.boolean().optional(),    // True if usable during 3-year transition
  notes: z.string().optional()
}).optional()
```

Semantics: **missing flags mean "unknown"** — the planner treats unknown the same as "ask for confirmation," not "allowed." This is the safe default and avoids retroactively breaking existing plugins.

The planner's allow-deny matrix:

| Philosophy | Required flag |
|---|---|
| `conventional` | none — all products allowed |
| `non-gmo` | `nonGmoCompliant === true` |
| `organic-transitioning` | `transitioningAllowed === true` OR `omriListed === true` |
| `certified-organic` | `omriListed === true` AND `certifiedOrganicAllowed !== false` |

#### B.2 — `purpose` on crop `sprayWindows[]`

Extend the existing `sprayWindows[]` entry shape in `cropPluginSchema`:

```ts
sprayWindows: z.array(z.object({
  chemistryClass: chemistryClassSchema,
  stageCode: z.string().optional(),         // From growthStageTable.stages[].code
  offsetDaysMin: z.number().int().optional(),
  offsetDaysMax: z.number().int().optional(),
  anchor: z.enum(['planting', 'emergence', 'stage', 'first-harvest']),
  title: z.string(),
  // NEW:
  purpose: z.enum([
    'burndown',                  // pre-plant weed kill
    'pre-emergent',              // pre-emergence herbicide
    'post-emergent',             // post-emergence herbicide
    'insecticide-prophylactic',  // scheduled insect spray
    'insecticide-scouted',       // scout-triggered placeholder (planner emits scout task only)
    'fungicide',
    'sidedress-n',
    'sidedress-other',
    'cover-terminate'            // cover-crop kill before main crop plant
  ]).optional(),
  weedStrategyGate: z.enum(['cultivate-first', 'pre-emergence-ok', 'post-emergence-ok']).optional(),
  // Lowest Season Setup weedStrategy that should emit this window; absent = always emit
  pestStrategyGate: z.enum(['preventive', 'ipm']).optional(),
  // Lowest Season Setup pestStrategy that should emit this window
}))
```

The two `*Gate` fields let the plugin author say "this is a preventive-only window — don't emit it for IPM users." Absent = always emit (compatible with v1 behavior, since the planner is new).

#### B.3 — Plugin schema version bump

- `apps/web/src/lib/plugins/version.ts` — bump (v1.1 → v1.2 if Sprint E shipped 1.1; otherwise v1.0 → v1.1).
- `apps/web/src/lib/plugins/loader.ts` (or wherever validation surfaces a version warning) — confirm validator accepts older plugins without `complianceFlags` or `purpose` (the schema additions are all `.optional()`, so this should be free; verify with a test).

### Plugin backfill (triage approach)

We **do not** need to tag every existing plugin in one shot. Triage:

1. **Compliance flags — conservative.** Only mark `omriListed: true` when the product is *actually* OMRI-listed (verifiable from label / OMRI database). Leave unknowns null. The planner will warn "no OMRI-compliant herbicide available for crop X" rather than silently include the wrong product.
2. **`purpose` — pragmatic.** Walk the existing crop plugins (~30 in `plugins/crops/`) and tag every `sprayWindows[]` entry with its `purpose`. Most are inferrable from the `chemistryClass` + `title`. This is one focused pass, ~30–60 min.
3. **Gates — selective.** Add `pestStrategyGate: 'preventive'` only where a window is clearly prophylactic (e.g., calendar-based fungicide). Most insect windows should be `'insecticide-scouted'` purpose with no gate — the planner emits a scout task, not a spray.

### Files

- **Modified:** `apps/web/src/lib/plugins/schemas.ts` — add the two new schema blocks above.
- **Modified:** `apps/web/src/lib/plugins/version.ts` — bump.
- **Modified:** `plugins/{herbicides,insecticides,fertilizers,fungicides}/*.json` — selectively add `complianceFlags`.
- **Modified:** `plugins/crops/*.json` — add `purpose` to all `sprayWindows[]` entries; selectively add `*Gate` fields.
- **New:** `apps/web/src/lib/plugins/schemas.complianceFlags.test.ts` — schema validation tests + back-compat test (no flags → valid).
- **New:** `apps/web/src/lib/season/philosophyFilter.ts` — single pure function `isProductAllowed(plugin, philosophy): boolean` consuming the new flags. The Inputs Plan validator (sub-task D) imports this.
- **Modified:** `schemas/*.schema.json` (public docs) — regenerate if the gen script from phase-9-resume.md item 1 exists; otherwise note as new debt.

### Testing

- Existing plugins load without errors under the new schema (back-compat).
- New plugins with all fields populated round-trip correctly.
- `philosophyFilter.isProductAllowed()` covers the 4×3 matrix (philosophy × {OMRI, non-GMO, neither}).
- A plugin with `pestStrategyGate: 'preventive'` is included for `pestStrategy='preventive'` and excluded for `pestStrategy='ipm'` / `'minimal'`.

### Risk

Low. Additive Zod schema; tested validator. CLAUDE.md invariant #2 (plugins are data-only) honored — no executable code in plugins, all gating happens in TypeScript via `philosophyFilter.ts`.

### Out of scope for B

- Pulling OMRI flags from an external API (manual tagging only).
- Auto-detecting GMO-derived ingredients from active-ingredient text (manual tagging only).
- A plugin-author UI for setting flags (Plugin Manager already allows arbitrary JSON edits — sufficient for now).

---

## Sub-task C — Deterministic inputs planner

**Status:** ✓ shipped on `phase-21b-planner` branch (commit `2465c8f`). Pure function `planInputs()` in `lib/plan/inputsPlan.ts` (660 lines) + 111 tests covering the 96-scenario philosophy × fertility-approach × family matrix + 15 targeted edge-case tests. Family yield + N/P/K removal defaults hardcoded in `FAMILY_REMOVAL_DEFAULTS` (Penn State + UMD Extension small-plot guidelines) with a Phase 22 TODO to lift onto optional cropPlugin fields. `InputsPlanProvisionalPlanting` type extracted so the wizard and the planner share one duck-typed shape.
**Files:** `apps/web/src/lib/plan/inputsPlan.ts` (new), `inputsPlan.test.ts` (new).

Pure function. Signature:

```ts
export function planInputs(input: {
  plantings: PlantingRecord[];               // from Schedule step commit
  cropPlugins: Record<string, CropPlugin>;
  seasonSetup: SeasonSetup;
  soilTests: SoilTest[];                     // from fertility.ts
  fertilityCredits: FertilityCredit[];       // from prior cover crops
  productPlugins: {
    herbicides: HerbicidePlugin[];
    insecticides: InsecticidePlugin[];
    fertilizers: FertilizerPlugin[];
    fungicides: FungicidePlugin[];
  };
  existingStock: StockItem[];
  year: number;
}): InputsPlan;
```

`InputsPlan` shape and per-application decision logic spec'd in the parent plan (Phase 21 §C of the chat plan). Key points to lock in code:

- Cover-crop terminate emitted when `coverCropIntent !== 'none'` AND prior-year cover existed in block history.
- Sidedress-N anchored to `growthStageTable.stages[code='V6']` (or equivalent per crop family) when present; falls back to `daysAfterPlanting: 35` if no stage table.
- Pre-plant fertility sizing: `(yieldGoal × removalRatePerUnit) − soilTestCredit − fertilityCreditFromPriorCover`. Yield goal = crop plugin's referenced yield or family default.
- When `pestStrategy === 'ipm'`, **no** insecticide applications emitted at plan time — only recurring scout tasks at family-typical cadence (cucurbits weekly during fruit-set, brassicas every 5 days during head formation, etc.).
- When zero philosophy-compliant products exist for a needed slot, emit `PlannerWarning { kind: 'no-compliant-product', plantingId, slot, reason }` — never silently fail or substitute.

Test matrix: philosophy (4) × strategy (4) × representative crop families (corn, brassica, cucurbit, solanaceae, legume, leafy-green) = ~96 scenarios. Use parametric tests; don't write 96 separate `it()` blocks.

### Risk

Medium. Most of the agronomic judgment lives here. Catching errors requires fixture-based testing against realistic crop plugin shapes.

---

## Sub-task D — AI refinement layer

**Status:** ✓ shipped on `phase-21b-planner` branch (commit `cb3902c`). `lib/server/aiInputsPlan.ts` wraps `planInputs()` with a substitution-only AI pass: AI can swap `productPluginId` + tune rate but cannot add/remove slots, change dates, or bypass the validator pyramid (philosophyFilter → cropCompatibility → chemistry → rate ceiling). Deterministic fallback baked in for missing key, quota exhausted, JSON parse failure, or validator rejection. `/api/plan/inputs/refine` adds chat-style refinement. `aiGuard` endpoint enum + DEFAULT_AI_DAILY_QUOTA both gain `inputs: 10`; `ai_call_log.endpoint` schema enum widened (no migration needed — SQLite doesn't enforce text enums at runtime). InputsPlanStep surfaces `meta.fallback` as a banner. The exact AI prompt is deliberately minimal (substitution-only contract) and can be tuned in a follow-up iteration without changing the validator surface.
**Files:** `apps/web/src/lib/server/aiInputsPlan.ts` (new), `apps/web/src/routes/api/plan/inputs/+server.ts` (new), `apps/web/src/routes/api/plan/inputs/refine/+server.ts` (new), `apps/web/src/lib/server/aiGuard.ts` (modify — add `'inputs'` endpoint key + default quota 10/day).

Mirror `aiSchedule.ts` exactly. AI's job is **substitution and tank-mix consolidation**, not initial planning. Deterministic planner from sub-task C is the source of truth and the fallback.

Validator must call (in order, fail-fast):

1. `philosophyFilter.isProductAllowed()` for every product.
2. `safety/cropCompatibility.ts` for every product × crop pair.
3. `safety/chemistry.ts` for every tank-mix group.
4. `safety/tankMixOrder.ts` for tank-mix sequence.
5. `applicationDate` within `crop.sprayWindows[purpose=X].anchor + offsetDays` window.
6. Rate ≤ `productPlugin.ratePerAcre` ceiling.

Telemetry via `recordAllocateTelemetry` (or rename to `recordAiTelemetry` if it's already endpoint-agnostic). Endpoint name: `'inputs'`.

### Risk

Low. Established pattern; deterministic fallback means AI bugs can't break the wizard.

---

## Sub-task E — Wizard step 5 UI + commit

**Status:** ✓ shipped on `phase-21b-planner` branch (commit `7d1e0fa`). `InputsPlanStep.svelte` renders per-planting collapsible cards with accept-checkboxes (rejection is the affirmative gesture), FRAC-style category pills, sticky right-rail shopping list with shortfall badges, and a warnings panel keyed by `PlannerWarning.kind`. `/api/plan/inputs` + `/api/plan/inputs/commit` endpoints persist the operator's accepted subset as `tasks` rows tagged `pluginTemplateKey='inputs-plan'` with the right `relatedEventTable` per category. Idempotency: deletes OPEN inputs-plan tasks for affected blocks before re-insertion (completed/aborted survive). `AllocationWizard.svelte` rewired with `'inputs'` step between schedule and commit; planting commit + task commit run as one operator-visible action.

B-18 fungicide_events shipped on the same branch (commit `48e4f09`): full mirror of `insecticide_events` with FRAC-coded product snapshots; new `lib/db/fungicideEvents.ts` repo, migration `0025_phase21_fungicide_events.sql`, `/api/fungicide/record` endpoint, `/spray/fungicide` UI route with tank-mix FRAC-grouping + resistance warning, and the `tasks.related_event_table` enum + `RelatedEventTable` union both gain `'fungicide_event'` so inputs-plan commits can pre-set the link.
**Files:** `apps/web/src/lib/components/InputsPlanStep.svelte` (new), `apps/web/src/routes/api/plan/inputs/commit/+server.ts` (new), `AllocationWizard.svelte` (modify — wire step after Companion Groups).

Layout per parent plan §E. Key behavioral requirements:

- Commit writes one `tasks` row per application with:
  - `relatedEventTable` pre-set (`'spray_event'` / `'insecticide_event'` / `'fertility_application'`)
  - `pluginTemplateKey: 'inputs-plan'` (new template key — also add to constant list if one exists)
  - `scheduledFor: applicationDate`
  - `recurrenceJson` populated for IPM scout tasks
  - `cropId` and `blockId` set from the planting
- Idempotent re-commit: if `pluginTemplateKey: 'inputs-plan'` tasks already exist for this `(owner, year)`, the commit replaces them (delete-then-insert in a transaction). Confirmed via a modal before overwrite if the user has *completed* any of those tasks already.
- Helper role: cannot reach step 5 (server `requireOwner()`).
- Single-handed-glove guidance (CLAUDE.md): ≥48dp tap targets on substitute/skip/edit buttons; bottom-anchored Accept-all CTA on mobile.

### Shopping list contract

Aggregate by `pluginId`, sum `totalQuantity`. For each item:

```ts
{ pluginId, displayName, totalQuantity, unit,
  haveOnHand: number, needToBuy: number,
  lowStockBadge: boolean,                  // needToBuy > 0
  linkedStockItemId: string | null }
```

Render links to `/stock/[id]` (UC-31) so the operator can mark "ordered" without leaving the page.

### Risk

Medium. UI surface area is largest; risk is in glove-operable affordances and the idempotency UX.

---

## Sub-task F — Remediation (parallel; ships any time)

**Status:** ✓ shipped on `phase-21a-foundations` (F.1 in pending commit; F.2 no-op verified). F.1 added a `display_planter_setup` gate on `/tools` index + a redirect guard on `/tools/planter-plate-selector` (default off; opt-in via Settings → Display). F.2 was a no-op: the geometry-missing banner already uses `aw-banner info` (blue) not `aw-banner warn` (yellow), and the pollination panel already only renders when constraints exist — no code change needed.

### F.1 — Gate UC-41 planter-plate UI behind `display_planter_setup` setting

The setting exists at [apps/web/src/routes/settings/+page.svelte:784](../apps/web/src/routes/settings/+page.svelte#L784) (`display_planter_setup`) but the route at [apps/web/src/routes/tools/planter-plate-selector/+page.svelte](../apps/web/src/routes/tools/planter-plate-selector/+page.svelte) is reachable regardless.

Changes:
- Add a server-side check in `/tools/planter-plate-selector/+page.server.ts` (create if absent) — read the setting; redirect to `/` if false.
- Find the nav surface(s) that link to it (search for `planter-plate-selector` href) and gate the link the same way.
- Default: `display_planter_setup: false` for new owners (most won't need it).

### F.2 — Auto-hide pollination panel when no crossing pairs

Inspect [AllocationWizard.svelte:150](../apps/web/src/lib/components/AllocationWizard.svelte#L150) — verify the panel only renders when `pollinationConstraints.length > 0`. If it currently renders a permanent "no crossing risks" empty state, demote to silent skip. Demote the `geometry-missing` banner from a warning chrome (yellow) to a quiet info chip (gray) — it's informational, not actionable in the moment.

### Risk

Very low. UI-only.

---

## Cross-cutting

### Migration plan

None required for sub-tasks A–B (all changes are additive to existing tables or new files). Sub-task E may add a `pluginTemplateKey` index to `tasks` if query performance becomes an issue — defer until measured.

### Docs to update as we ship

- **`docs/use-cases.md`** — UC-42 + UC-37d entries added with this plan. Update Status line from "Spec'd" → "Implemented (Phase 21)" as each sub-task ships.
- **`CLAUDE.md`** — Phase 21 entry added with this plan. Add a `✓` and one-line summary as each sub-task ships, same pattern as Phases 18a–18i.
- **This file** — flip sub-task Status lines as work progresses. Add gotchas in a "Notes from implementation" trailing section.
- **`docs/personas.md`** — no changes; P1 already covers the planning context.

### Order of work

1. **A** (Season Setup) — must ship first; nothing else has signal without it.
2. **B** (plugin schema) — must ship before C; can ship in parallel with A.
3. **F.1, F.2** (remediation) — can ship any time; low coupling.
4. **C** (deterministic planner) — depends on A + B.
5. **D** (AI layer) — depends on C.
6. **E** (wizard UI + commit) — depends on C (works without D; AI is enhancement).

A reasonable ship sequence: **A → B → C → E (without AI) → D → F**. Phase 21 is "done" when E commits write idempotent task rows that close into events.

### Verification gates

After A: settings round-trip + carry-forward tests green; wizard renders form/chip correctly.
After B: every existing plugin still loads; new philosophy filter covers the 4×3 matrix.
After C: 96-scenario test matrix green.
After D: AI endpoint passes validator on stub responses; falls back to deterministic on broken JSON; quota guard enforced.
After E: commit creates correct task rows; tasks close into events when executed; idempotent re-commit warns before overwriting completed tasks.
After F: UC-41 hidden by default; pollination panel quiet when no constraints.

Final integration test: full Plan wizard cold-start to commit on a fresh owner with 3 plantings (corn, lettuce, tomato), under `philosophy='certified-organic'` + `pestStrategy='ipm'` + `fertilityApproach='compost-amendments'` + `coverCropIntent='vetch-clover'`. Inspect the resulting task list — should contain compost application + cover-crop terminate + scout tasks + zero conventional herbicides + zero prophylactic insecticides.

---

## Notes from implementation

(Append as sub-tasks ship.)
