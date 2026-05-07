# Phase 9 — resume notes

Tracks what was deferred from the Phase 9 plugin-library expansion and the design decisions behind them, so future-you can pick up where this left off without re-deriving context.

Plan that drove this work: `~/.claude/plans/rippling-gathering-allen.md`. Two commits landed:

- `feat(phase-9): refine herbicide kill matrix + cover new vegetable families` — kernel-matrix relaxations to align with industry label-tolerance + parametric tests for the 13 new families
- `feat(phase-9): comprehensive 233-plugin starter library + new plugin types` — 211 new plugin JSON files, `agronomy/resistance.ts`, `server/equipmentTemplates.ts`

All 21 test files / 139 tests green at commit time. `seedLibrary` integration test loads every plugin without validation errors.

---

## Outstanding work

### 1. Public JSON Schemas under `/schemas/` (low priority — docs only)

The `/schemas/*.schema.json` files are author-facing documentation derived from the Zod schemas in [`apps/web/src/lib/plugins/schemas.ts`](../apps/web/src/lib/plugins/schemas.ts). They're not code-loaded; the runtime validates against Zod directly. They're stale wrt the new plugin types + fields:

- Add `schemas/fungicide.schema.json` — derive from `fungicidePluginSchema`
- Add `schemas/fertilizer.schema.json` — derive from `fertilizerPluginSchema`
- Update `schemas/crop.schema.json` — add `seasonalTasks` field
- Update `schemas/insecticide.schema.json` — add `iracGroup`, `preHarvestIntervalDays`, `targetPests`, `pollinatorRisk`, `ratePerAcre`, `dilutionTable`, `labelClaims` fields

Easiest path: add a one-shot script `pnpm gen:schemas` using `zod-to-json-schema` that walks the discriminated union and writes all six files. Drop into `apps/web/scripts/`.

### 2. `/equipment/new` UI route (medium priority — user-facing)

`SEED_EQUIPMENT_TEMPLATES` in [`apps/web/src/lib/server/equipmentTemplates.ts`](../apps/web/src/lib/server/equipmentTemplates.ts) ships 30 templates across tractors / sprayers / tillage / planters / mowers / hay / irrigation, but no UI consumes them yet.

Expected shape:
- `GET /equipment/new` — load templates server-side, render a category-grouped picker
- POST handler — instantiate via existing `createEquipment()` at [`apps/web/src/lib/db/equipment.ts:184`](../apps/web/src/lib/db/equipment.ts#L184), persist `spec` JSON, redirect to detail page
- Backed by hcd-required ≥48dp tap targets per CLAUDE.md "field UI must be one-handed-glove operable"

Existing equipment list view: [`apps/web/src/routes/equipment/`](../apps/web/src/routes/equipment/) — model the new route after it.

### 3. `/spray/fungicide` UI route (medium priority — user-facing)

Fungicide plugins ship via [`apps/web/src/lib/plugins/schemas.ts`](../apps/web/src/lib/plugins/schemas.ts) (`fungicidePluginSchema`) but no spray UI consumes them. The existing `/spray` route is herbicide-only.

Approach:
- Mirror `/spray/+page.svelte` structure but replace herbicide registry lookup with `registry.fungicides()` (registry helper TBD)
- Reuse the dilution math — class-agnostic
- Skip the cross-contamination kernel call (fungicides don't share the herbicide kill-matrix decon path); use FRAC rotation hints from [`apps/web/src/lib/agronomy/resistance.ts`](../apps/web/src/lib/agronomy/resistance.ts) instead
- Reuse `/spray/decon` only for fungicide plugins that set `deconRequired: true` (rare — copper after Bordeaux mix)

### 4. Genetic-trait crop override (high value — currently blocking 3 brand plugins)

Three brand-name herbicides drop their `labelClaims.safeForCropPluginIds` until trait support exists, with notes acknowledging the workaround:

- [`plugins/herbicides/engenia.json`](../plugins/herbicides/engenia.json) — Xtend-traited soybean only
- [`plugins/herbicides/xtendimax.json`](../plugins/herbicides/xtendimax.json) — same
- [`plugins/herbicides/halex-gt.json`](../plugins/herbicides/halex-gt.json) — RR-traited corn

Same pattern blocks the strawberry claim on [`plugins/herbicides/stinger.json`](../plugins/herbicides/stinger.json) (clopyralid IS labeled for strawberry establishment but synthetic-auxin family-kill includes `small-fruit`) and the tomato claim on [`plugins/herbicides/sandea.json`](../plugins/herbicides/sandea.json) (halosulfuron IS labeled for tomato but sulfonylurea kills solanaceae).

Design sketch:
- Add `traits?: string[]` on `cropPluginSchema` — values like `'glyphosate-tolerant-rr2'`, `'dicamba-tolerant-xtend'`, `'glufosinate-tolerant-llink'`, `'imi-tolerant-clearfield'`
- Add `requiresTraits?: string[]` on herbicide plugins — when present + matched on the planted cultivar, the bypass check skips the family-kill check
- When user creates a planting, surface the trait selector in `/plan` so the registry knows
- Update `bypassCheck` in [`apps/web/src/lib/plugins/bypassCheck.ts`](../apps/web/src/lib/plugins/bypassCheck.ts) to honor trait matches (Layer 0, before family-kill check)

### 5. UI badges for HRAC / IRAC / FRAC group codes (low priority — polish)

All data is ready:
- HRAC group on `ChemistryProfile.hracGroup` in [`cropFamilyLethality.ts`](../apps/web/src/lib/safety/cropFamilyLethality.ts)
- IRAC group on insecticide `activeIngredients[].iracGroup`
- FRAC code on fungicide `activeIngredients[].fracCode`
- Display labels in [`agronomy/resistance.ts`](../apps/web/src/lib/agronomy/resistance.ts) — `FRAC_LABELS`, `IRAC_LABELS`

Render small color-coded badges next to each product option in the `/spray` herbicide list, the `/spray/fungicide` list (when built), and the plugin manager. Could use the same color palette as the kernel decon banner for consistency.

### 6. Class-specific decon protocols (kernel design question)

The cross-contamination check ([`apps/web/src/lib/safety/crossContamination.ts:18`](../apps/web/src/lib/safety/crossContamination.ts#L18)) uses generic "previous class differs from current class → decon required" semantics. Some new chemistries have specific decon needs the standard SOP doesn't cover:

- **Paraquat** — bipyridyl ion irreversibly binds soil and tank surfaces; standard ammonia rinse is insufficient. Specific protocol: 1% household bleach + 1% TSP + 3 water rinses
- **Glufosinate (Liberty)** — adsorbs to tank fittings; needs detergent + water rinse, not just water
- **Copper-based fungicides** — leaves residue on filter screens that can damage non-target crops next pass; needs vinegar rinse

Decision needed: bake these per-class protocols into the decon kernel + wizard, or document only and let users follow product label decon SOPs?

### 7. International / Canadian product equivalents (low priority — scope question)

Library is US-label-anchored. EU / CA growers using the same active ingredients see different brand names (e.g., Liberty 200 SL vs 280 SL formulation; Roundup Transorb HC in Canada). Not a blocker for the project's Loudoun VA primary persona but flagged for completeness.

---

## Files NOT touched in this work

Two files in working tree are modified but unrelated to phase 9 — likely from a parallel session. Do not include them in any phase-9 follow-up commit:

- `apps/web/src/lib/server/pendingCalibrations.ts` — single-line type-narrowing fix for `submittedAt`
- `docs/usability-audit.md` — audit-finding status updates

---

## Quick verification

```sh
pnpm --filter web test:unit   # 21 files, 139 tests green
git log --oneline -3          # the two phase-9 commits sit on top
ls plugins/*/ | wc -l         # 233 plugin files
```

Plugin counts by category:

| crops | herbicides | insecticides | fungicides | fertilizers | companions |
|------:|-----------:|-------------:|-----------:|------------:|-----------:|
| 102 | 46 | 31 | 27 | 20 | 7 |
