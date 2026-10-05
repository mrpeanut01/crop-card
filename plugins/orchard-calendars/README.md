# Orchard calendar plugins

One JSON file per tree fruit calendar edition (for example `pome-va-2026.json`). Each file is validated with `orchardCalendarPluginSchema` in `packages/plugin-validation/src/schemas.ts`; the author-facing JSON Schema is `schemas/orchard-calendar.schema.json`. Rulings: `docs/design/ORCHARD_CALENDAR.md` (OC-1 to OC-8).

`pome-va-2026.json` (apple), `pear-va-2026.json` and `stone-fruit-va-2026.json` (peach) were sourced by a local agent on 2026-10-04; see "Local agent pass" in `docs/design/ORCHARD_CALENDAR.md`. Nothing here may be written from memory. A calendar hosts only crops its guide chapter covers: pear has its own file because the bulletin gives pear its own stages and windows.

Rules:

- Data only. A calendar lists stages, how to recognise each one, and windows with a purpose (scout, cultural, sanitation, disease-risk, pest-risk, bloom, harvest-prep) and their disease, pest or weather targets.
- No product, product class, brand, active ingredient, rate, unit amount, PHI or REI, and no "spray", "safe" or "recommended" (ruling OC-2). The schema's copy guard refuses them in English and Spanish.
- A window at pink, bloom or petal fall must have `pollinatorSensitive: true`.
- Crops opt in one by one through `hostCropPluginIds`; each must be a registered crop plugin in one of `hostCropFamilies` (`orchard` or `stone-fruit`). Pear is added only where the guide gives pear its own stages and windows (OC-6).
- `edition` is the guide's year. The loader refuses an edition that is not this year's or last year's.
- Every stage description, window and degree-day estimate names a `sourceKey` with a word-for-word quote in `apps/web/scripts/orchard-calendar-sources.json`. A degree-day estimate needs an entry marked `gateEligible`, which takes two agreeing sources (OC-5); otherwise leave it out.
- Run `pnpm --filter @cropcard/web exec vitest run src/lib/plugins/orchardCalendar.sources.gate.test.ts` after adding a file.

Tests use a test-only fixture (`apps/web/src/lib/plugins/orchardCalendar.fixtures.ts`), never a file in this folder.
