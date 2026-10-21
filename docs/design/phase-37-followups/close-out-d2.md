# Phase 37 close-out, cluster D2: sun need, vinegar infusions, unknown-zone perennials, card wiring (2026-10-21)

Rulings CO-4, CO-5, CO-8 and CO-10 in [`PHASE_37_HERB_GARDEN_PLAN.md`](../PHASE_37_HERB_GARDEN_PLAN.md) ("Close-out rulings"). No safety-rule change; `RULES_VERSION` stays 0.7.11. No migration. `FARM_SNAPSHOT_VERSION` stays 9 (new optional plugin fields, DH-8 precedent).

Every page was fetched with `curl` on 2026-10-21 and turned into text locally. Each quote was then checked as a substring after normalising whitespace and quote marks, and with `quoteFound` from `apps/web/scripts/lib/sourceDrift.mjs` (50 quotes, 0 missing). VCE's server sends a chain to emSign Root CA G1, which is in the Mozilla bundle (`certifi`) but not in this container's store, so VCE 426-420 was fetched with `--cacert` pointing at that bundle.

## Code

- **Schema** (`packages/plugin-validation/src/schemas.ts`): `INFUSE_MEDIA`, `medium` on `preserving` rows (required on `infuse`, refused elsewhere, one row per method and medium, at most six rows); `SUN_NEEDS` and optional `sunNeed`. `schemas/crop.schema.json` is not regenerated here: the integrator runs `pnpm gen:schemas`, so `publishedSchemas.drift.test.ts` fails on this branch until then.
- **Gates** (appended to `sourceCoverage.ts` under `// Close-out D2`): `preservingSourceKey` (`preserving.infuse.<medium>`), `infuseRowGaps` (the row quote names its own medium and never the other; `INFUSE_SAFETY_RULES` per medium, .edu host), `SUN_NEED_PHRASES`, `sunNeedOfQuote` (longest first, blanked, negation within three words refused, full plus part reads part), `sunNeedQuoteGaps` (host, `quoteNamesCrop`, reading, the stored value is the `sunNeed` quote's reading and the sunniest across `sunNeed.<n>`, herbs without a value need `sunNeed.notRecorded: { reason, checked, date }`), `SUN_NEED_NOT_RECORDED_KEY`. Edits to existing functions are one line each: `cropFactPaths` asks for `sunNeed`; `herbHarvestFactPaths` and `preservingQuoteGaps` use `preservingSourceKey`; the old infuse block in `preservingQuoteGaps` is replaced by a call to `infuseRowGaps`. The old `preserving.infuse` / `preserving.infuse.safety` keys are gone, not accepted; the infuse note is no longer required, because the app owns the safety line.
- **Infuse** (`lib/garden/infuse.ts`): `INFUSE_OIL_DISCARD_DAYS` (4, pinned against every oil safety quote), `infuseMethodLabel`, `infuseSafetyLine`, `infuseMediaOf`. Catalog pair `herbinfuse` (new area files, wired in `en.ts` and `es.ts`).
- **Schedule** (`lib/garden/harvestSchedule.ts`): `PreservingRow.medium`, `bestPreservingRow` (better rating wins, vinegar on a tie), used by `rowFor`; `infuseGoalMedia` (the on-track row's medium, else every medium a planted herb infuses in, else both).
- **Pantry and panel**: the infuse goal line shows each medium's safety line whenever it shows (CO-10); a herb's infuse chips read "Infused in oil" / "Infused in vinegar" with the medium's line (the English plugin note is no longer rendered). `harvestScheduleApi` carries `medium`.
- **Cards**: `plantingGoalLines(pantry, id, name, locale, preserving)` shows only the goals the herb's own good or fair rows meet, plus the safety line of each medium under an infuse goal. `toCropPlugin` (the snapshot's crop plugin builder) and `SnapshotCropPlugin` carry `preserving` (method, suitability, medium; no note), `waterNeed` and `sunNeed`. The Care Guide gains a `Sun` fact tagged `plugin` (`cards.fact.sun.*`). Not on the Planting card or the designer.
- **Brief** (`lib/garden/brief/sun.ts`): `sunFit`, `sunIsLimited`, `orderBySun` (match, unknown, mismatch, stable, only when the spot gets half a day or shade; never adds or removes a row), `sunLine`, `SUN_NEED_PROMPT_WORDS`. `deterministicShortlist(answers, known, sunNeedOf?)`; `briefSunNeedOf(registry)` in `briefStore.ts`; `BriefHerbOption.sunNeed`; the page orders stored rows (Claude's too) and shows `brief-sun-unknown` ("Not every herb says how much sun it needs") when a row has no value; `BriefShortlist` takes `sun` and shows `sun-line` with `data-fit`. The chat context adds "wants full sun" etc. and "infuse in oil / vinegar". `herbsa.result.sunWarning` and the `shortlist.ts` header now say rows are ordered by sun.
- **CO-8**: `lifecycleHere` checks the crop zone before the farm zone, so a perennial with no sourced zone reads `no-crop-zone` with `winterUnknown: true` whatever the farm zone; `herbsb.line.noCropZone` reads "Not known whether it survives winter here; plan to bring it indoors before frost." `HerbEventContext.winterUnknown` (set by `herbContextFor`) gives `bringIndoorsEvents` the event with `provenance: 'fallback'`, `typicalTiming: true`; the frost push sets `bringIn`. `herbEngine.golden.test.ts` did not change: it passes no herb context, so lemongrass's engine output is the same.

## Data

### Infusions (CO-4)

| Herb                                                                               | Oil              | Vinegar                                                                              |
| ---------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| basil-genovese                                                                     | good (UGA C1334) | good (OSU SP 50-736)                                                                 |
| oregano-greek                                                                      | good (UGA C1334) | good (OSU SP 50-736)                                                                 |
| rosemary-tuscan-blue                                                               | good (UGA C1334) | none (OSU names rosemary only under "Using Flavored Vinegars", not in its herb list) |
| mint-spearmint, tarragon-french, dill-mammoth, chives-common, nasturtium-companion | none             | good (OSU SP 50-736)                                                                 |

The oil safety quote (`preserving.infuse.oil.safety`, UGA C1334) is now two verbatim pieces: "Clostridium botulinum specifically is of concern in infused oils. ... Since acidification is not used to prevent bacteria from growing, infused oils made with this method must be kept in the refrigerator and discarded 4 days after being made." The vinegar safety quote (`preserving.infuse.vinegar.safety`, OSU SP 50-736 catalog page, revised December 2025, quoting So Easy to Preserve) states commercially produced vinegar, discarding on mold or fermentation, and refrigerator or cool places. Mountain mint and tulsi are not given a vinegar row: OSU's "mint" and "basil" mean the culinary herbs.

### Sun need (CO-5)

Sources were counted from the four the brief names first (VCE 426-420, Illinois herb pages, UMD, NC State Plant Toolbox); another extension page was used only where none of the four has a passage that names the herb (bee balm, calendula). The `sunNeed` quote is the one whose reading is stored; a disagreeing source is `sunNeed.2`.

| Herb                                              | Value | Source                                          | Other sources                                                    |
| ------------------------------------------------- | ----- | ----------------------------------------------- | ---------------------------------------------------------------- |
| basil-genovese                                    | full  | UMD                                             | NC State agrees (not stored)                                     |
| chives-common                                     | full  | Illinois                                        | NC State reads part (`sunNeed.2`)                                |
| mint-spearmint                                    | part  | UMD ("full sun to part shade")                  | Illinois agrees                                                  |
| oregano-greek                                     | full  | Illinois                                        | NC State agrees                                                  |
| rosemary-tuscan-blue                              | full  | Illinois                                        | NC State reads part, "tolerates ... partial shade" (`sunNeed.2`) |
| sage-broadleaf                                    | full  | Illinois                                        | UMD and NC State agree                                           |
| thyme-german-winter                               | full  | Illinois                                        |                                                                  |
| anise-hyssop                                      | part  | NC State ("full or partial sun")                |                                                                  |
| bergamot-monarda                                  | full  | Iowa State                                      | NC State's sentence does not name the plant                      |
| catnip-common                                     | part  | Illinois ("It will also tolerate light shade.") |                                                                  |
| lavender-english-munstead                         | full  | Illinois                                        |                                                                  |
| lemon-balm                                        | part  | Illinois                                        |                                                                  |
| lemon-verbena                                     | full  | NC State                                        |                                                                  |
| marjoram-sweet                                    | full  | Illinois                                        |                                                                  |
| mountain-mint                                     | part  | NC State                                        |                                                                  |
| perilla-shiso-green                               | part  | NC State                                        | the passage names the plant through its genus sentence           |
| summer-savory                                     | full  | NC State                                        |                                                                  |
| tarragon-french                                   | part  | Illinois                                        | UMD's "semishade" is not a ruled phrase, not counted             |
| tulsi-holy-basil-rama                             | full  | NC State                                        |                                                                  |
| parsley-italian-flat-leaf                         | part  | NC State ("full sun or light shade")            | Illinois "partially shaded area" is not a ruled phrase           |
| cilantro-santo                                    | full  | Illinois                                        |                                                                  |
| dill-mammoth                                      | full  | Illinois                                        |                                                                  |
| fennel-bulb-perfection, fennel-florence-zefa-fino | full  | NC State (Florence fennel page)                 | Illinois agrees for both forms                                   |
| lovage                                            | part  | NC State                                        | Illinois agrees                                                  |
| chamomile-german                                  | full  | NC State                                        |                                                                  |
| calendula-resina                                  | full  | Wisconsin Horticulture                          | NC State says it of "Marigolds"                                  |
| nasturtium-companion                              | part  | Illinois                                        | UMD's "semi-shade" is not a ruled phrase                         |

Recorded as `sunNeed.notRecorded`:

- **hyssop-officinalis**: the NC State Toolbox gives Light only as a field; Illinois has no hyssop page; VCE and UMD do not cover it.
- **lemongrass-east-indian**: Illinois covers C. citratus in containers; Purdue NewCROP's "The plants need a warm, humid climate in full sun." does not name the crop; the Toolbox has no C. flexuosus page.
- **stevia-sweetleaf**: NC State names it only as "Sweet leaf", which is not a ruled name; UF/IFAS's sun sentence says "This shrub" and "It".
- **chervil**: NC State's "partial to full sun" is not a ruled phrase and the sentence says "This plant"; VCE gives "Partial shade." only in a table cell.

## Quotes that did not pass

- VCE 426-420's table cells ("Sun.", "Sun or partial shade.") name no herb in the passage and "Sun." is not a ruled phrase; VCE is listed in the notes and `checked` lists only.
- UMD tarragon and nasturtium ("will grow in full sun but seems to do better in semishade"): the ruled list would read "full sun" alone and miss the preference, so the pages are not counted.
- NC State Toolbox sentences that start "This plant" or "It" (bee balm, calendula's "Marigolds", stevia's "Sweet leaf", chervil).

## Tests

`sunNeed.sources.gate.test.ts`, `infuseMedium.sources.gate.test.ts`, `lib/garden/infuse.test.ts`, `lib/garden/brief/sun.test.ts` (fast-check: the set never changes, order is match, unknown, mismatch), `lib/server/cardSnapshot.herbFields.test.ts`; updated `herbHarvest.sources.gate.test.ts` (infuse case), `lifecycleHere.test.ts`, `cards/build/lifecycle.test.ts`, `herbEvents.test.ts`, `herbCalendarContext.test.ts`, `brief.svelte.test.ts` and `harvestSchedule.endpoint.test.ts`. e2e: `garden-brief.spec.ts` (sun lines in a shady spot) and `pantry.spec.ts` (the infuse safety lines).
