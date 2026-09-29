# Species plugins

One JSON file per animal species (chicken, goat, dog and so on). Each file is validated with `speciesPluginSchema` in `packages/plugin-validation/src/schemas.ts`; the author-facing JSON Schema is `schemas/species.schema.json`. Files here are loaded by their own registry pass (`apps/web/src/lib/plugins/registryDataKinds.ts`), not by the crop and pesticide library.

The ten starter species shipped in sprint 32B: chicken, duck, goat, sheep, cattle, pig, horse, rabbit, dog and cat. There is no "Other" species, because every 32C kernel rule keys on the species. Requests for more species (turkey, goose, alpaca, bees) are logged as follow-ups. If an "Other" is ever added, it defaults `foodProducingDefault` to `true` and carries no care defaults. Helpers that read these files live in `apps/web/src/lib/plugins/species.ts`.

Rules:

- Data only. No scripts, no expressions.
- `foodProducingDefault` and every care `intervalDays` need a quoted source in `apps/web/scripts/species-sources.json`, keyed by pluginId and field path. A value that cannot be sourced is left out.
- Names, the scientific name, product types, the group noun and the tile icon need no source.
- Care defaults are read in 32D. Dogs and cats ship rabies and core vaccine suggestions with no interval and a note to ask the vet; the owner types the dates. Any `intervalDays` added later needs a source.
- `housingSpace` (floor space per adult animal indoors and in a run, plus the `sourceName` shown beside the suggestion) drives the advisory coop or pen capacity. Each number needs a quote under `housingSpace.<field>` in `species-sources.json`; leave a figure out when no extension source gives one.
