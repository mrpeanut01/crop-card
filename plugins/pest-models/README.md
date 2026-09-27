# Pest-model plugins

One JSON file per degree-day pest model (squash vine borer, for example). Each file is validated with `pestModelPluginSchema` in `packages/plugin-validation/src/schemas.ts`; the author-facing JSON Schema is `schemas/pest-model.schema.json`.

This folder is empty on purpose. Models ship in sprint 32E, and only where extension sources agree.

Rules:

- Data only. `method` picks one of the degree-day methods the app implements (`simple-average` or `single-sine`). A model never carries a formula.
- Stage advice is about scouting, trapping or covering. The schema rejects any message that talks about spraying.
- `baseTempF`, `upperCutoffF`, `biofix.date` and every stage's `gddFrom` and `gddTo` need a quote in `apps/web/scripts/pest-model-sources.json`.
