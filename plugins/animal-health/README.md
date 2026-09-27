# Animal-health plugins

One JSON file per animal-health product (a dewormer, an antibiotic, a vaccine). Each file is validated with `animalHealthPluginSchema` in `packages/plugin-validation/src/schemas.ts`; the author-facing JSON Schema is `schemas/animal-health.schema.json`. Every `labelUses[].speciesId` must name a species plugin in `plugins/species/`.

This folder is empty on purpose. Products ship in sprint 32C, and only once the label research in `docs/research/label-research-prompt.md` (Task 9) has a checked quote for each withdrawal.

Rules:

- Data only. The safety kernel in `apps/web/src/lib/safety/` decides what a withdrawal means, owns the FDA prohibited-drug list and sets the floors. A plugin cannot mark a drug as allowed or shorten a hold.
- Every `meatDays`, `milkHours`, `eggsDays` and `doNotUseFor` needs a quote in `apps/web/scripts/animal-health-sources.json` under `withdrawal.<speciesId>.<class>.<field>`.
- Every food species on the label needs a withdrawal. A missing withdrawal is treated as unknown, and unknown blocks food use.
- Withdrawal data never comes from a label scan or from AI.
