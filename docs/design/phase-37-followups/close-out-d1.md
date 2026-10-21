# Phase 37 close-out, cluster D1: gates and data (2026-10-21)

This cluster applies close-out rulings CO-1, CO-2, CO-3, CO-6, CO-7 and CO-9 from [`PHASE_37_HERB_GARDEN_PLAN.md`](../PHASE_37_HERB_GARDEN_PLAN.md) ("Close-out rulings"). It changes no safety rule; `RULES_VERSION` stays 0.7.11. The calendar engine reads none of the changed fields, so `herbEngine.golden.test.ts` is unchanged.

Every page was fetched with `curl` on 2026-10-21 and turned into text locally, and every new quote was checked against that text. Three hosts did not load from this container: `extension.umd.edu`, `www.pubs.ext.vt.edu` and `extension.purdue.edu` (a certificate error), and `marylandgrows.umd.edu` answered 403. For those, the scan read the copies fetched earlier in Phase 37, and each entry that relies on one says so.

## Gate fixes (CO-9, CO-6)

All of them are in `apps/web/src/lib/plugins/sourceCoverage.ts` and `apps/web/src/lib/garden/herbQuoteNames.ts`. Each has a regression test built from the panel's examples.

- **`waterNeedsOfQuote`** replaces the single-value reading:
  - A range reads as every need it spans: "dry to medium moisture" is low and medium; "moist to dry" is all three.
  - A negated phrase returns `'negated'` and is refused. A negation counts within three words before the phrase, or right after it, in the same clause: "never let the soil dry out", "not drought tolerant", "dry soil is not tolerated".
  - `waterNeedOfQuote` still returns one need or null.
- **`waterNeedQuoteGaps`**:
  - The stored value must be the one need that every counted source allows. When the counted sources allow no need in common, or more than one, the field stays empty.
  - A quote stitched from pieces (`...`, `|` or separate quoted strings) is refused (F867-2). The one exception is the ruled hyssop page-title piece, `WATER_NEED_TITLE_PIECES`.
  - A crop with no value carries its quotes in `waterNeed.notRecorded.quotes`. A plain `waterNeed` key beside an empty field is refused. If the recorded quotes agree on one need, the gate says to ship it.
- **`quoteNamesCrop` and `quoteNamesCropName`**: both now need a word boundary after the name. They also ignore a base name inside a longer herb name: "mountain mint" is not spearmint, "holy basil" is not basil, "anise hyssop" is not hyssop, and "Russian sage" is not sage.
- **`preservingQuoteGaps`**:
  - A `good` row is refused when a sentence of its quote that names the crop carries fair or poor words (`preservingWarningOf`). "Best used fresh" is never a warning about fresh use.
  - A row on a method that has a `preserving.<method>.notRecorded` entry is refused, the DH-6 pattern.
  - The `poor` words no longer accept a bare "do not": the negative must be about the method working well ("does not dry well"). They now accept "turn an unpleasant brown color".
  - The `fair` words no longer accept a bare "less": it must be "less flavorful", "less aromatic", "less well" and the like.
  - The infuse logic and `PRESERVING_METHOD_WORDS.infuse` are untouched; CO-4 belongs to cluster D2.
- **Before bloom:** words after "before the flowers" that put the cut in or after bloom ("fade", "fully open", "open fully", "go to seed", "set seed") mean the quote is not before bloom. "Full flower", "full bloom" and "flowers fade" also count as other-stage words.
- **`harvestCadenceQuoteGaps`** (CO-6): the quote needs a cut or harvest verb, and a quote about pinching or pruning is refused. A cadence beside a `harvestCadence.notRecorded` entry is refused.

## One notRecorded shape (CO-7)

Every Phase 37 herb `<field>.notRecorded` entry in `apps/web/scripts/crop-data-sources.json` is `{ reason, checked: [url...], date, quotes? }`, validated by the strict `notRecordedEntrySchema`.

The existing entries were migrated in the same commit:

- `lifecycle`, `winterHardyToZone` and `harvestTiming` gained `checked` and `date`.
- The old single-source `preserving.*.notRecorded` entries became `reason` plus `quotes`.

`seedingRate.notRecorded` is a different, older contract and is untouched.

`herbData.coverage.test.ts` runs `herbDataCoverageGaps` over `HERB_PLUGIN_IDS` with `HERB_DATA_FIELDS`:

- `lifecycle`;
- `winterHardyToZone`, for perennials only;
- `preserving.<method>` for each of the five methods;
- `harvestCadence`;
- `waterNeed`;
- `harvestTiming`.

The test fails on a field that is neither filled nor recorded, on an entry beside a filled value, on an entry for a field that does not apply, and on an entry in the old shape. To add `sunNeed`, append `{ key: 'sunNeed', filled: (c) => !!c.sunNeed }` to `HERB_DATA_FIELDS` and add the field to the list the test pins.

The 161 new entries came from a scan. It fetched each herb's cited pages, the herb's Illinois Extension and NC State Plant Toolbox pages, and the general preservation pages (NCHFP, OSU HYG-5360, NC State, Penn State, UMass, CSU 9.335, UGA C1334, SDSU, NDSU, WSU C159, MU G6470, the USDA bulletin and Kentucky State). It then tested every sentence that names the herb against approximations of the gate rules. Every candidate sentence was read by hand: each one either shipped (below) or is named in its entry's reason. Illinois pages that answer 404 (anise hyssop, bee balm, calendula, chamomile, hyssop, perilla, stevia) are not listed as checked.

## Per-herb outcome

| Herb                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| basil                                | `dry: fair` from the NCHFP tender-leaf line, with NC State agreeing (CO-1). The note names Illinois "easily dried", UMN's air-dried browning and "Freezing is a better method" (a technique-tied failure and a comparison, so a note) and OSU.                                                                                                                                                                                         |
| Greek oregano                        | `dry: fair` from the same NCHFP line (CO-1). The note keeps "dry it quickly" and names OSU and UMass. `waterNeed: low` (CO-3): NC State's "dry to medium moisture" range overlaps Penn State's "drought-tolerant" at low.                                                                                                                                                                                                              |
| chervil                              | `dry: poor` and `freeze: poor` from CSU 9.335 ("best used fresh ... little flavor once dried or frozen"), the least favourable counted rating (CO-1). UMass, Kentucky State, Illinois and CSU's own Table 3 are in the notes.                                                                                                                                                                                                          |
| both Florence fennels                | `freeze` stays empty. Purdue FoodLink's texture caution carries no fair or poor words, and a good row from WSU would sit above it. The reason is rewritten.                                                                                                                                                                                                                                                                            |
| thyme                                | `harvestTiming` stays empty (CO-2). Only three quotes name drying: UMD ("when first blossoms open and dry", bloom-begins), the USDA bulletin (in bloom) and Montana State (at bloom). They disagree, and the field has no in-bloom stage. Illinois, Penn State, NC State, WSU C159 and MU G6470 name no method. Iowa State allows two stages and now answers 404. `waterNeed` stays empty with both quotes (UF/IFAS low, USDA medium). |
| calendula                            | `waterNeed: high` from UNH alone (CO-3). Iowa State's heading stitched to a list item is set aside (F867-2).                                                                                                                                                                                                                                                                                                                           |
| rosemary                             | `waterNeed` stays empty with both quotes (Penn State low, USDA medium). `fresh: good` (Wisconsin).                                                                                                                                                                                                                                                                                                                                     |
| sweet marjoram                       | `waterNeed` stays empty with both quotes: the NC State range (low to medium) does not overlap the USDA bulletin's "rich moist soil" (high). `fresh: good` (UMD; the USDA bulletin agrees).                                                                                                                                                                                                                                             |
| sage                                 | `waterNeed: medium`: NC State's "medium to dry soils" range overlaps the USDA bulletin's "moderately moist". MU G6470's table cell "Dry" is not a gate phrase, so it is not counted (see Open items). `fresh: good` (NC State).                                                                                                                                                                                                        |
| French tarragon, tulsi, dill, lovage | `fresh: good` (Illinois with USU agreeing, Maryland Grows, NDSU, the USDA bulletin).                                                                                                                                                                                                                                                                                                                                                   |
| cilantro                             | `dry: good` (USU, "stored either by freezing or drying").                                                                                                                                                                                                                                                                                                                                                                              |
| every herb                           | Each remaining empty field has a reason, the pages checked and the date. That covers freeze-dry on all 32 herbs, infuse on 29 and harvestCadence on 31 (sage ships one).                                                                                                                                                                                                                                                               |

Counts after this pass:

- `waterNeed`: 19 of 32 herbs.
- `preserving` rows: fresh 22, dry 26, freeze 15, infuse 3, freeze-dry 0. Bee balm, hyssop, mountain mint and perilla still have none.
- `harvestCadence`: 1 (sage).
- `harvestTiming`: 3 (basil, rosemary, spearmint).

## DH-6, corrected

[`drying-hint.md`](drying-hint.md) DH-6 says thyme splits four before flowering to five at or in bloom. CO-2 recounts only the quotes that name drying. That recount gives UMD at bloom-begins against the USDA bulletin and Montana State in or at bloom, and none before bloom. The value stays empty for the same reason, a disagreement with no in-bloom stage, but the split in DH-6 is wrong. `harvestTiming.notRecorded` on thyme holds the corrected split.

## Open items for the lead

- **Parsley and the CO-1 rule.** The CSU 9.335 sentence that makes chervil `poor` also names parsley ("best used fresh— such as burnet, chervil, and parsley"). Parsley ships `dry` and `freeze` good from other sources. Read literally, CO-1 would make both `poor`. CO-1 names only the existing `notRecorded` entries, so parsley is left as it was.
- **Sage `waterNeed: medium`.** This follows from CO-9's range reading. MU G6470 lists sage under Soil "Dry" in a table, which the gate cannot count. If the lead counts table cells, sage becomes a disagreement and should move to `waterNeed.notRecorded`.
- **Summer savory `waterNeed`** is recorded empty. Montana State's "tolerant of ... relatively dry conditions" reads low through the phrase list, while NC State asks for "plenty of moisture", which is not a listed phrase. The two point opposite ways, and CO-3 allows no drier tie-break. The entry names both but carries no `quotes`, because only Montana's counts under the gate.
- **Vinegar infusions (cluster D2).** `preserving.infuse.notRecorded` entries name the vinegar sources for spearmint, chives, dill, French tarragon, summer savory and nasturtium. If CO-4 ships a vinegar row on any of them, that entry must be dropped in the same change: the gate now refuses a row beside its `notRecorded` entry.
- **Kentucky State's flavored-oils list** names thirteen herbs with "Use within three weeks" in the refrigerator. That is longer than UGA C1334's tested 4 days, so it is recorded as not a tested method on every herb it names.
