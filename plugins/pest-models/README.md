# Pest-model plugins

One JSON file per degree-day pest model (squash vine borer, for example). Each file is validated with `pestModelPluginSchema` in `packages/plugin-validation/src/schemas.ts`; the author-facing JSON Schema is `schemas/pest-model.schema.json`.

This folder is empty on purpose. Models ship in sprint 32E, and only where extension sources agree.

Rules:

- Data only. `method` picks one of the degree-day methods the app implements (`simple-average` or `single-sine`). A model never carries a formula.
- Stage advice is about scouting, trapping or covering. The schema rejects any message that talks about spraying.
- `baseTempF`, `upperCutoffF`, `biofix.date` and every stage's `gddFrom` and `gddTo` need a quote in `apps/web/scripts/pest-model-sources.json`.

Status (Phase 32E): no model ships yet. Squash vine borer was tried first, but its extension pages could not be opened from the build environment and the search summaries did not state a calculation method, so ruling E5-6 leaves it out. The leads and what is still needed are in the `$research` block of `apps/web/scripts/pest-model-sources.json`. The app code ships and shows nothing until a sourced model lands here. Tests and e2e use a test-only fixture model (`apps/web/src/lib/ipm/pestModel.fixtures.ts`), never a file in this folder.
