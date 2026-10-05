# Orchard calendar plugins

One JSON file per tree fruit calendar edition (for example `pome-va-2026.json`). Each file is validated with `orchardCalendarPluginSchema` in `packages/plugin-validation/src/schemas.ts`; the author-facing JSON Schema is `schemas/orchard-calendar.schema.json` (regenerate with `pnpm gen:schemas`; a drift test fails if you forget). Rulings: `docs/design/ORCHARD_CALENDAR.md` (OC-1 to OC-8, and OP-1 to OP-29 from the second panel).

`pome-va-2026.json` (apple), `pear-va-2026.json` and `stone-fruit-va-2026.json` (peach) were sourced by a local agent on 2026-10-04 from VCE 456-419; see "Local agent pass" in `docs/design/ORCHARD_CALENDAR.md`. Nothing here may be written from memory. A calendar hosts only crops its guide chapter covers: pear has its own file because the bulletin gives pear its own stages and windows.

Rules:

- Data only. A calendar lists stages, how to recognise each one, and windows with a purpose (scout, cultural, sanitation, disease-risk, pest-risk, bloom, harvest-prep) and their disease, pest or weather targets.
- `audience` is `commercial` or `home` (OP-1). A home calendar carries only scout, cultural, sanitation, bloom and harvest-prep windows, and no cover stages (OP-2). `guide` names the publication (`publisher`, `title`, `publicationId`, an https `.edu` or `.gov` `url`) and is shown as a citation.
- At most one calendar per host crop and audience (OP-3). The loader keeps the newest edition and refuses two of the same edition.
- No product, product class, brand, active ingredient, rate, unit amount, PHI or REI, and no "spray", "safe", "recommended", "protect/protection", "label", bee or pollinator lines, or "no risk" claims (OC-2, OP-6, OP-8, OP-25). The app shows the bee line and "Check the label." itself. The schema's copy guard refuses them in English and Spanish.
- A window at pink, bloom, blossom, petal fall, white bud, balloon or popcorn must have `pollinatorSensitive: true`. Setting it more widely is fine.
- Crops opt in one by one through `hostCropPluginIds`; each must be a registered crop plugin in one of `hostCropFamilies` (`orchard` or `stone-fruit`). Pear is added only where the guide gives pear its own stages and windows (OC-6).
- Every stage description, window and degree-day estimate names a `sourceKey` with a word-for-word quote in `apps/web/scripts/orchard-calendar-sources.json`. Every window cites at least one source of the calendar's own edition. A degree-day estimate needs an entry marked `gateEligible`, which takes two agreeing free `.edu` or `.gov` sources from different hosts (OC-5 as amended by OP-23); otherwise leave it out and record why in a `gateEligible: false` entry.
- A table quote joins the heading and cells with " / " and says so in its note. A footnote that limits a target ("if present", "only if damage was severe") is quoted too and carried into the window note (OP-12).
- Every source key must be used by a calendar, unless it records an absence (`gateEligible: false` with a note). A target id keeps one kind across calendars.
- Run `pnpm --filter @cropcard/web exec vitest run src/lib/plugins/orchardCalendar` after adding or changing a file.

Checking quotes (OP-18). The guide PDFs are never committed. Download them, extract their text with a page marker line `=====PAGE N=====` before each PDF page (for example with Python `pypdf`, writing `page.extract_text()` after each marker), and write a `map.json` beside the text files:

```json
{ "<source url>": { "file": "ENTO-638.txt", "pageOffset": 8 } }
```

`pageOffset` turns a printed page number into the PDF page (VCE 456-419 prints page 1 on PDF page 9). Then run `node apps/web/scripts/check-orchard-quotes.mjs <textDir>`.

Each new edition (OP-28). The guides are re-issued every year. Replace each file with the new edition (new `pluginId`, `edition` and `guide`) instead of adding a second one, re-check every quote against the new guide, and update the source entries. The loader keeps an edition only through the end of the following year and then refuses it with "replace the file with the current edition", which also fails the gate test in CI.

Tests use a test-only fixture (`apps/web/src/lib/plugins/orchardCalendar.fixtures.ts`), never a file in this folder.
