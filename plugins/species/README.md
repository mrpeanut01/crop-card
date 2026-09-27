# Species plugins

One JSON file per animal species (chicken, goat, dog and so on). Each file is validated with `speciesPluginSchema` in `packages/plugin-validation/src/schemas.ts`; the author-facing JSON Schema is `schemas/species.schema.json`. Files here are loaded by their own registry pass (`apps/web/src/lib/plugins/registryDataKinds.ts`), not by the crop and pesticide library.

This folder is empty on purpose. Species plugins arrive in sprint 32B.

Rules:

- Data only. No scripts, no expressions.
- `foodProducingDefault` and every care `intervalDays` need a quoted source in `apps/web/scripts/species-sources.json`, keyed by pluginId and field path. A value that cannot be sourced is left out.
- Names, product types, the group noun and the tile icon need no source.
