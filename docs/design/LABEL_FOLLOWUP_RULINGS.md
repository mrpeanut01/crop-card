# Label follow-up rulings (2026-10-08)

Three panelists (safety and regulatory, field use, engineering) ruled on the decisions left open by the 2026-10-08 label research pass (#737, #768, #640). Each panelist checked the facts in the repo on main 69ab585d before voting. Rulings LF-1 to LF-3 are binding for the implementation PRs; a later ruling may replace them.

| Id   | Decision                                                                  | Vote                | Ruling                                                                               |
| ---- | ------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| LF-1 | Chaparral on hay grass, Harmony SG on unlabelled cereals (#768 follow-up) | A, 3-0 (detail 2-1) | Kernel block by crop plugin. See LF-1 below.                                         |
| LF-2 | Banvel source and mix rate (#737 follow-up)                               | B, 3-0              | Keep the 2009 data with a derived "earlier registration" notice; low end in the mix. |
| LF-3 | REI on /today (#640 follow-up)                                            | A, 3-0              | Active re-entry card on /today built from rows already read; no new query.           |

## LF-1. Ingredient blocks by crop plugin

- `lib/safety/ingredientLethality.ts` gains a per-ingredient list of crop plugin ids, checked by `checkCropCompatibility` through `CropStage.cropPluginId`. Like the family additions, it can only add a stop, never lift one. Each entry quotes its label in `epa-reg-sources.json` under `ingredientLethality`. RULES_VERSION is bumped, with exhaustive vitest and fast-check tests showing a verdict only ever gets stricter.
- Metsulfuron (Chaparral) stops every shipped cool-season `forage-grass` crop plugin with archetype `forage-cutting-cycle` (today `timothy-climax` and `orchard-grass-potomac`), quoting "Do not use on Timothy hay or other cool-season grasses grown for hay." Pasture has no crop plugin, so Chaparral keeps its labelled pasture use and the earlier 3-0 pasture ruling stands. Warm-season forage grass is unchanged.
  - Dissent (field use, 1 vote): treat a block as grass hay unless its Area is a pasture marked "graze" with no hay cutting in the last 12 months. The majority chose the outright block because a farmer who grazes timothy with no hay cut is rare and the outright block is the protective reading. Revisit if owners report a blocked grazing-only timothy stand.
- Thifensulfuron (Harmony SG) is allowed only on the `cereal-grain` and `cover-grass` crop plugins its label names (wheat, barley, oats, triticale); every other plugin in those families is stopped (rye, sorghum, broomcorn, the millets, teff, spelt, einkorn, emmer and the cover grasses) until a label quote names it. Field corn and soybeans keep their labelled use through their own families.
- A drift test fails CI when a shipped cool-season `forage-grass` plugin with archetype `forage-cutting-cycle` is missing from the metsulfuron list, when a listed id is not a shipped plugin, or when a new `cereal-grain` or `cover-grass` plugin is added without being classified for thifensulfuron.
- Check that the metsulfuron family additions do not wrongly stop another metsulfuron product that is labelled for wheat.
- Known residual: a farm-uploaded hay plugin under a new id is judged by family only.

## LF-2. Banvel source and mix rate

- Banvel keeps the per-crop rates, stage limits and grazing data from the 2009-09-11 label of 66330-276, the newest label PPLS lists for registration 70506-461 (transferred to UPL NA on 2021-05-26; checked 2026-10-08, and UPL's site has no Banvel label).
- When the label behind a plugin's rates was filed under a registration number other than the plugin's `epaRegistrationNumber`, every place the rates or stage limits show adds: "From a <year> label of the earlier registration <number>. Check your current label." The notice is derived from the plugin's `epa-reg-sources.json` source (`sourceUrl` registration and `docDate`), never typed per plugin, ships in English and Spanish, and is covered by a test. Rate provenance stays `label`.
- The spray mix starts at the low end of a label range, the rate the label allows at every listed stage (Banvel corn ½ pt). The farmer is not made to pick a rate. Owners may enter a different rate as before, never above the range's top, and helpers cannot change it (Invariant 5).
- The notice goes away when a label filed under 70506-461 is found and its quotes are checked again.
- Follow-up (safety panelist, 1 vote): count a per-season cap such as Banvel's 1½ pt per crop year against earlier applications that season.

## LF-3. Active re-entry card on /today

- /today shows an active re-entry card to every role while any herbicide, insecticide or fungicide spray on the farm is inside its REI. It sits above the task deck and cannot be dismissed while an REI runs. It lists each block, the product and its clear time, soonest first, and goes away when the last one clears.
- It is built in memory from the spray, insecticide and fungicide rows the loader already reads for the year-to-date count. That read starts at the earlier of the start of the year and now minus the longest REI in the library, and the year-to-date count filters in memory. Herbicide REIs use `herbicideReEntryFor`; insecticide and fungicide REIs use the stored `reEntryClearAt`. /today adds no query and stays within the 68-query cap; the PR reports owner and helper query counts before and after, and a unit test covers an REI that crosses January 1.
- A spray whose products are not all on file with an REI reads "REI not known for every product. Check the label." and never shows a clear time.
- The REI wording, clear time and that sentence are English inside a `lang="en" data-english-only="safety"` element; the card heading and the link to the spray record ship in English and Spanish.
- The stale "drives the /today banner" doc comments on `activeReEntryRestrictions` are corrected.
