# CropCard: Phase 37 herb garden research (local agent)

You are working in a local checkout of `mrpeanut01/crop-card` (SvelteKit + TypeScript, pnpm, Node 22). Phase 37 (the herb garden: the garden brief, annual or perennial here, the harvest schedule and pantry, the herb calendar, watering that knows the plant, and pruning steps on the photo) shipped its schema, gates, UI and "not known" paths, and the six clusters filled every value an open extension page stated on 2026-10-17. This brief lists only what is still empty, the candidate pages the clusters found, and the exact gate rule each quote must pass. A value with no qualifying quote stays empty: "not known" is a product state, never an error (rulings R-25 and R-30 in `docs/design/PHASE_37_HERB_GARDEN_PLAN.md`).

Read `CLAUDE.md` first. Invariants 2 (plugins are data only), 7 (AI assists, never gates) and 9 (bilingual) matter most here, and the "Crop agronomy gaps" follow-up describes the overlap rule (#551) these tasks reuse.

## Status after the Phase 37 close-out (2026-10-21)

The close-out is integrated and #867 is closed: every Phase 37 herb field is filled or recorded, the vinegar infusion rows (CO-4) and the optional `sunNeed` (CO-5) ship, and a gap reopens only through a new issue when a qualifying page appears. Cluster D2's additions to the block below: `preserving.infuse` rows need a `medium` (`oil` or `vinegar`) and a safety quote under `preserving.infuse.<medium>.safety` (the oil quote states botulism, refrigeration and a time limit; the vinegar quote states commercially produced vinegar, discard on mold or fermentation and cool storage), each row's quote names its own medium; `sunNeed` needs a phrase from `SUN_NEED_PHRASES` in a passage naming the herb on an allowed host, and the sunniest reading across sources is stored (per-herb table in [`docs/design/phase-37-followups/close-out-d2.md`](../design/phase-37-followups/close-out-d2.md)); bee balm, chervil, hyssop and calendula carry `sunNeed.notRecorded`.

### Cluster D1 (gates and data)

Close-out rulings CO-1 to CO-9 are in `docs/design/PHASE_37_HERB_GARDEN_PLAN.md`; the per-herb outcome is in [`docs/design/phase-37-followups/close-out-d1.md`](../design/phase-37-followups/close-out-d1.md). Read this block before the older ones below.

- **Every Phase 37 herb field is now either filled or recorded.** A recorded field carries `<field>.notRecorded: { reason, checked: [url...], date }` in `crop-data-sources.json`, enforced by `apps/web/src/lib/plugins/herbData.coverage.test.ts` (CO-7). The fields are lifecycle, perennial zone, each preserving method, harvestCadence, waterNeed and harvestTiming. To fill a recorded value, delete its `notRecorded` entry in the same change; the gates refuse a value beside one. A gap reopens only through a new issue, once a qualifying page appears.
- **Gate changes a new quote must meet (CO-9, CO-6):**
  - `waterNeed`: a range reads as every need it spans; a negated phrase is refused; one passage only (no "..." or separate quoted pieces, save the ruled hyssop title); the stored value is the one need every counted source allows. Disagreeing quotes go in `waterNeed.notRecorded.quotes`, never in `waterNeed.2`.
  - Crop names: a whole word, never inside a longer herb name ("mountain mint" never names spearmint).
  - `preserving`: a `good` quote carries no fair or poor words in its crop sentence; a bare "do not" or "less" never qualifies.
  - `harvestTiming`: "before the flowers fade" and similar are not before bloom.
  - `harvestCadence`: needs a cut or harvest verb; pinching and pruning never count.
- **Filled in this pass:**
  - Preserving: basil and Greek oregano `dry: fair`, chervil `dry` and `freeze: poor` (CO-1); `fresh: good` on sage, rosemary, French tarragon, tulsi, dill, sweet marjoram and lovage; cilantro `dry: good`.
  - waterNeed: Greek oregano low and calendula high (CO-3); sage medium.
- **Recorded, still empty:**
  - `waterNeed` on rosemary, thyme and marjoram (both quotes kept).
  - Thyme `harvestTiming`, with the split recounted over the quotes that name drying (CO-2).
  - Florence fennel `freeze`.
  - Every herb's `freeze-dry`.
  - Vinegar `infuse`, which waits on CO-4 (cluster D2).
- **Hosts that did not load from the cloud container on 2026-10-21:** `extension.umd.edu`, `www.pubs.ext.vt.edu` and `extension.purdue.edu` (certificate error), and `marylandgrows.umd.edu` (403). Re-read them from a local checkout when one of their values is in doubt.

## Status after the #867 pass (2026-10-20)

A second pass fetched and checked pages for every item below. The herb-by-field table, the pages read and rulings F867-1 to F867-5 are in [`docs/design/phase-37-followups/867.md`](../design/phase-37-followups/867.md). Each task's "Still missing" table below keeps its original text; read it with this status.

- **Task 1:**
  - Filled: East Indian lemongrass `lifecycle` (perennial, Purdue NewCROP names Cymbopogon flexuosus).
  - Empty with reason: its `winterHardyToZone`. Pages that name C. flexuosus give no zone, and the zone pages cover C. citratus only.
  - Not re-checked: the "worth a second source" rows.
- **Task 2:**
  - `preserving` filled on 14 more herbs: marjoram, chervil, lovage, anise hyssop, catnip, lemon verbena, lemongrass, stevia, tulsi, both Florence fennels, chamomile, calendula and nasturtium.
  - Extra methods: oregano fresh and freeze, chives fresh, sage freeze, cilantro fresh and summer savory fresh.
  - Empty with reason:
    - bee balm (the only page reprints industry copy, F867-5);
    - hyssop, mountain mint and perilla (no page names them with a method);
    - lavender freeze and fresh;
    - chervil dry and freeze, and Florence fennel freeze (sources disagree, recorded as `notRecorded`);
    - freeze-dry (no page names a herb);
    - vinegar infusions (found in OSU SP 50-736, but the infuse safety line is written for oil and needs a ruling).
  - Basil and oregano drying stay empty: no panel ruling was made.
  - `harvestCadence` filled on sage only (42 to 56 days). Every other herb is empty with the reason in the follow-up table (F867-1).
  - The per-method drying hint is built for basil, rosemary and spearmint (`harvestTiming`, rulings DH-1 to DH-8 in `docs/design/phase-37-followups/drying-hint.md`). Thyme stays empty because its sources disagree. More herbs need a quote that names the herb, the method and the stage.
- **Task 3:** seasonal rows filled for every herb the issue listed:
  - anise hyssop, bee balm (2), hyssop, mountain mint, perilla, stevia (2), tulsi and lovage (2);
  - both Florence fennels (2 each), chamomile and calendula (2);
  - rosemary pruning after bloom.

  Not attempted: the mint mid-season cut-back and the cilantro heat rows, which are outside #867.

- **Task 4:**
  - `waterNeed` filled on 6 more herbs: anise hyssop low, bee balm high, hyssop low, mountain mint high, tarragon low and chervil high.
  - Disagreements recorded with both sources: oregano, rosemary, thyme, marjoram and calendula.
  - Empty with reason: chives, sage, lemon verbena, lemongrass, perilla, stevia, summer savory, tulsi, cilantro, chamomile and nasturtium.
- **Task 5:** thyme harvest timing stays empty. Seven more pages were read:
  - Penn State, the NC State Plant Toolbox and Iowa State side with Illinois (before flowering).
  - WSU, MU, Montana State and Purdue NewCROP side with UMD (at or in bloom).

  Other care tasks are outside #867.

- **Task 6:** not built. Candidate pages are listed in the follow-up doc.

## Ground rules (every task)

- **Allowed sources only.** A value goes in only with a quote from a page on an `.edu` or `.gov` host (or `journals.flvc.org`); `isAllowedSpacingSource` in `apps/web/src/lib/plugins/sourceCoverage.ts` encodes the list. Seed-company, nursery and blog pages, page summaries and search snippets never count.
- **Verbatim quotes.** Copy the page text exactly. The weekly source-drift job (`apps/web/scripts/check-source-drift.mjs`) re-reads each quote word for word (letters and digits only, pieces split on " | ", "..." and quoted strings). A quote fetched through a page summarizer must be re-read on the page itself.
- **Provenance.** Every value gets an entry in `apps/web/scripts/crop-data-sources.json`, keyed by plugin id and then by the field key named in the task: `{ url, publisher, date, quote, note? }`, with `date` the page date or `accessed YYYY-MM-DD`.
- **Disagreement.** One source is enough when nothing disagrees. When counted sources disagree under the #551 overlap rule, leave the value empty and record both quotes in a `note` (or the task's `notRecorded` entry), unless the task names a different rule (zones, R-5).
- **Minimal diffs.** Insert only the field you fill, never reformat plugin JSON, and bump the plugin's patch version. Delete any `notRecorded` entry for a value you fill.
- **Spanish.** Any plugin text a user reads (seasonal rows, care tasks) needs its English and Spanish catalog entries in the same commit (named in Tasks 3 and 5).
- **No app code** except where a task says so. No migrations, no safety-rule changes, no `RULES_VERSION` bump.

## Verification (run before every commit)

```sh
pnpm install --frozen-lockfile
cd apps/web
pnpm exec vitest run src/lib/garden/lifecycle.sources.gate.test.ts src/lib/garden/lifecycleSources.test.ts \
  src/lib/plugins/herbHarvest.sources.gate.test.ts src/lib/plugins/herbSeasonalRows.gate.test.ts \
  src/lib/calendar/herbEvents.sources.gate.test.ts src/lib/i18n/seasonalTaskText.test.ts \
  src/lib/plugins/waterNeed.sources.gate.test.ts src/lib/journal/cropCareTasks.gate.test.ts \
  src/lib/plugins tests/integration/seedLibrary.test.ts
pnpm check && pnpm lint && pnpm i18n:check
pnpm test:unit
```

Commit each task separately and open one PR per task (or one PR with a commit per task) against `main`; the `test` gate in `ci.yml` must be green.

---

## Task 1: herb lifecycle and winter zone (37B)

Cluster 37B shipped a quoted `agronomy.lifecycle` for 31 of the 32 herbs in `HERB_PLUGIN_IDS` (`apps/web/src/lib/garden/herbs.ts`) and a quoted `winterHardyToZone` for every perennial among them except one. The pages it read on 2026-10-17 were VCE 426-420 "Herbs" (Herb Culture and Use tables), Illinois Extension "Herb Gardening" pages, the NC State Extension Gardener Plant Toolbox and Wisconsin Horticulture's rosemary article. This section lists what is left and the values worth a second source.

### Task rules

- A value goes in only with a verbatim quote from a page on an `.edu` or `.gov` host (or `journals.flvc.org`), stored in `apps/web/scripts/crop-data-sources.json` under the plugin id with `url`, `publisher`, `date` and `quote` (and `note` for anything a reader needs). Quote the page text exactly: the weekly source-drift job re-reads each quote word for word (letters and digits only, pieces split on " | ", "..." and quoted strings).
- When you fill a value, delete its `lifecycle.notRecorded` or `winterHardyToZone.notRecorded` entry, add the value to `SOURCED_LIFECYCLES` in `apps/web/src/lib/garden/lifecycleSources.ts`, bump the plugin's patch version and insert only the field you fill.
- Zones (ruling R-5): store the coldest zone the source says the plant survives, as the source prints it (`7` or `7a`). When sources disagree, store the warmest and name the others in the note. A whole zone compares as its colder half.

### The gates the quote must pass

`lifecycleQuoteGaps` and `winterHardyToZoneQuoteGaps` in `apps/web/src/lib/plugins/sourceCoverage.ts`, run by `apps/web/src/lib/garden/lifecycle.sources.gate.test.ts`:

- `lifecycle`: the host passes `isAllowedSpacingSource`; the quote names the crop by one of its names in `LIFECYCLE_QUOTE_NAMES` (`lifecycleSources.ts`); the quote states the stored word (`annual`, `biennial`, `perennial`, or the plural as a table heading). A herb with no lifecycle source needs a `lifecycle.notRecorded` reason, and a sourced herb must not keep one.
- `winterHardyToZone`: only on a perennial; the host passes `isAllowedSpacingSource`; the quote names the crop, says "zone" and states the stored number (and the letter when one is stored). A perennial herb with no zone needs a `winterHardyToZone.notRecorded` reason.
- `SOURCED_LIFECYCLES` must equal the herbs with a `lifecycle` source and, where present, their sourced zone (the gate test checks it).

### Still missing

| Plugin                                          | Field                                                                        | Why it is empty                                                                                                                                                                                                                              | Candidate pages                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lemongrass-east-indian` (Cymbopogon flexuosus) | `agronomy.lifecycle` (stored `perennial`, unsourced) and `winterHardyToZone` | Illinois Extension (`/herbs/lemon-grass`) and the NC State Plant Toolbox (`/plants/cymbopogon-citratus/`) cover West Indian lemongrass, Cymbopogon citratus, only ("Tender Perennial", zones 8b to 11b). No fetched page names C. flexuosus. | UF/IFAS EDIS herb pages (edis.ifas.ufl.edu, search "lemongrass"), UMD Extension herb pages (extension.umd.edu), Clemson HGIC (hgic.clemson.edu). A page that names Cymbopogon flexuosus or "East Indian lemongrass" counts; a C. citratus page does not (record it in the note instead). |

### Worth a second source

| Plugin                                                                          | Stored    | Why                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tarragon-french`                                                               | zone `3a` | From the NC State Plant Toolbox page for the species, which says the species is wild tarragon and French tarragon is A. dracunculus 'Sativa'. A page giving French tarragon its own zone replaces it if it is warmer (R-5). Candidates: extension.umn.edu, hort.extension.wisc.edu, yardandgarden.extension.iastate.edu. |
| `oregano-greek`                                                                 | zone `5`  | Illinois Extension ("True oregano is marginally hardy in zone 5") is warmer than the NC State Plant Toolbox (4a), so 5 is stored.                                                                                                                                                                                        |
| `fennel-bulb-perfection`, `fennel-florence-zefa-fino`                           | `annual`  | Illinois Extension calls Florence fennel annual; the NC State Plant Toolbox lists Foeniculum vulgare, with Florence fennel among its names, as a perennial. Kept as annual on the bulb-fennel text. A source on bulb fennel that says perennial would need a panel ruling.                                               |
| `basil-genovese`, `marjoram-sweet`, `stevia-sweetleaf`, `tulsi-holy-basil-rama` | as stored | The NC State Plant Toolbox lists "Annual / Perennial" for each; the stored value is the one the in-region source or the page description names.                                                                                                                                                                          |

---

## Task 2: preserving and harvest cadence (37C)

Cluster 37C filled what the open extension pages stated on 2026-10-17; this task lists only what is still empty. Every value needs a verbatim quote in `apps/web/scripts/crop-data-sources.json` with `url`, `publisher`, `date` and `quote`, and must pass the gates below (`apps/web/src/lib/plugins/herbHarvest.sources.gate.test.ts` runs them over the shipped library). One source is enough when nothing disagrees; when counted sources disagree, leave the value empty and record a `preserving.<method>.notRecorded` entry whose `note` says "disagree" and names the sources. Never guess a value. Bump the plugin's patch version when you add one.

### What already ships (do not redo)

`preserving` on 14 herbs from OSU HYG-5360, NC State's herb leaflet, Penn State "Freezing Herbs", NCHFP "Drying Herbs", UGA Extension C1334 (infused oils), UMN "Growing basil" and Illinois Extension herb pages: basil (fresh, freeze, infuse), chives (freeze), spearmint (fresh, dry fair, freeze), Greek oregano (infuse), rosemary (dry, freeze, infuse), sage (dry), thyme (fresh, dry, freeze), lavender (dry), lemon balm (fresh, dry fair, freeze), summer savory (dry), tarragon (dry fair, freeze), parsley (fresh, dry, freeze), cilantro (freeze), dill (dry, freeze).

Left empty on purpose because sources disagree (see the `notRecorded` notes): basil `dry` (Illinois "easily dried"; NCHFP and NC State "will/may mold if not dried quickly"; UMN "leaves turn an unpleasant brown color when air-dried") and Greek oregano `dry` (OSU "Best Herbs for Drying"; NCHFP tender-leaf herb that "will mold"). A third source only helps if the panel rules on how good and fair are weighed; otherwise they stay empty.

### Gate rules

`preservingQuoteGaps` (key `preserving.<method>`, methods `fresh | dry | freeze | freeze-dry | infuse`):

- The source is an extension or government page (`.edu`, `.gov`, or `journals.flvc.org`); seed-company and blog pages never count.
- The quote names the method: `fresh`; `dry`/`dried`/`drying`; `freeze`/`frozen`/`freezing`; `freeze-dried`/`freeze-dry` (which never counts as dry or freeze); `infuse`/`infused`/`infusion`, "in oil", "herb vinegar".
- The quote names the herb with the ruled words in `apps/web/src/lib/garden/herbQuoteNames.ts` (for example "lemon balm", never "lemon"; "cilantro" or "coriander"; "savory").
- `fair` needs the source's own qualifying words (fairly, moderately, somewhat, less, not as well, loses some, acceptable, "will/may mold"); `poor` needs poor, does not, not recommended, loses most, best fresh, turns black or brown. `good` needs none.
- `infuse` also needs a `note` (the English-only safety line the app shows) and a `preserving.infuse.safety` quote from a `.edu` food-safety page that names botulism (NCHFP or a land-grant food-safety publication; UGA C1334 is used now).

`harvestCadenceQuoteGaps` (key `harvestCadence`, field `harvestCadence: { everyDays: { min, max }, from: "first-cut" }`):

- Extension or government page; the quote names the herb.
- It states both ends as days ("14 to 21 days") or whole weeks ("every 2 to 3 weeks"); one end alone is stored as min = max only if the source gives one figure.
- It says the figure is the time between cuts ("every", "between cuttings", "apart", "intervals", "again in").
- "A few weeks", "several weeks", "every few weeks" never count.

### Still missing

| plugin ids                                                                                                                                                                                                                                                                                                                                                              | field and key                           | candidate pages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every herb in `HERB_PLUGIN_IDS`                                                                                                                                                                                                                                                                                                                                         | `harvestCadence` (`harvestCadence`)     | None of the pages read states an interval between cuts (Illinois says "Harvesting can begin in about 4 to 5 weeks" for windowsill basil, which is time to first harvest, not between cuts). Look in extension.umd.edu herb pages, extension.umn.edu/planting-and-growing-guides/growing-herbs, hgic.clemson.edu factsheets (the basil page loaded; most other herb URLs returned a not-found page), extension.usu.edu, extension.oregonstate.edu, extension.colostate.edu, yardandgarden.extension.iastate.edu, publications.ca.uky.edu and edis.ifas.ufl.edu, especially for basil, chives, parsley, mint, cilantro and oregano. |
| `basil-genovese`, `oregano-greek`                                                                                                                                                                                                                                                                                                                                       | `preserving.dry`                        | Disagreement noted above; needs a panel ruling, not more pages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `oregano-greek`, `chives-common`, `sage-broadleaf`, `cilantro-santo`, `lavender-english-munstead`, `summer-savory`, `marjoram-sweet`                                                                                                                                                                                                                                    | `preserving.freeze`, `preserving.fresh` | OSU HYG-5360 and Penn State name only the herbs listed above; try UMD, UMN, Clemson HGIC 3086 "Drying Herbs, Seeds & Nuts" and freezing pages, VCE 426-420 "Herbs" at pubs.ext.vt.edu.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `marjoram-sweet`, `chervil`, `lovage`, `anise-hyssop`, `bergamot-monarda`, `catnip-common`, `hyssop-officinalis`, `lemon-verbena`, `lemongrass-east-indian`, `mountain-mint`, `perilla-shiso-green`, `stevia-sweetleaf`, `tulsi-holy-basil-rama`, `fennel-bulb-perfection`, `fennel-florence-zefa-fino`, `chamomile-german`, `calendula-resina`, `nasturtium-companion` | any `preserving.<method>`               | Illinois chervil ("Air dry and store leaves in sealed containers") and lovage ("Leaves can be dried for later use") state drying but the quoted sentence does not name the herb; a sentence that does is needed. Illinois marjoram, savory and tarragon URLs loaded without herb text. Penn State "Freezing Herbs" names lemongrass only for chopping ("Chop chives and lemon grass before freezing"), which could support `lemongrass-east-indian` freeze if the panel agrees it says freezing works.                                                                                                                            |
| any herb                                                                                                                                                                                                                                                                                                                                                                | `preserving.freeze-dry`                 | No page read mentions freeze-drying herbs. NCHFP and land-grant pages on home freeze-dryers (for example extension.usu.edu) are the candidates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| herbs beyond basil, oregano and rosemary                                                                                                                                                                                                                                                                                                                                | `preserving.infuse`                     | UGA C1334 names only garlic, basil, oregano and rosemary for its tested acidification method; another tested method naming the herb is needed, plus the safety quote. Herb vinegars: NCHFP "Flavored Vinegars" and land-grant vinegar publications.                                                                                                                                                                                                                                                                                                                                                                               |

The per-method timing hint is built as the plugin field `harvestTiming` (rulings DH-1 to DH-8 in `docs/design/phase-37-followups/drying-hint.md`). A row ships only from a quote that names the herb, the method and the stage, and states no other stage. The general "most herbs" lines in NCHFP ("The best time to harvest most herbs for drying is just before the flowers first open when they are in the bursting bud stage."), OSU HYG-5360 and Penn State never count for a herb (DH-5). Shipped: basil, rosemary and spearmint (drying). Candidates for a later pass need their own sentence: Illinois's oregano line names no method and its sage line states no stage.

---

## Task 3: when to do what, the herb calendar (37D)

Rulings R-8 and R-18 in the plan apply. Most of 37D's data shipped with the code on 2026-10-17; this task lists only what is still missing.

### What already shipped (do not redo)

- **Bring-indoors lead.** `BRING_INDOORS_LEAD_DAYS = 14` in `apps/web/src/lib/calendar/herbEvents.ts` is tagged `data`. It is the low end of UW-Madison Extension's rosemary page, "dig plants 2 to 3 weeks before the expected first fall frost". The quote is under `entries.bringIndoorsLead` in `apps/web/scripts/calendar-sources.json`. The gate is `herbEvents.sources.gate.test.ts`: the quote must state `2 to 3 weeks before` and `first fall frost`, and the constant must equal the low end in days.
- **20 herb seasonal rows** on 16 plugins, each quoted from University of Illinois Extension's herb pages (`https://extension.illinois.edu/herbs/<slug>`, accessed 2026-10-17) under `seasonalTasks.<rowKey>` in `apps/web/scripts/crop-data-sources.json`:
  - basil-genovese `pinch-flower-buds`
  - mint-spearmint `remove-flower-spikes` and `divide`
  - chives-common `divide` and `remove-flowers`
  - cilantro-santo, dill-mammoth and chervil `sow-again`
  - oregano-greek `winter-mulch`
  - lavender-english-munstead `spring-prune`
  - thyme-german-winter `renew-cut-back`
  - lemon-balm `cut-back` and `thin-midsummer`
  - sage-broadleaf `spring-prune`
  - parsley-italian-flat-leaf `pot-for-winter`
  - catnip-common `spring-cut-back`
  - tarragon-french `spring-cut-back` and `divide`
  - marjoram-sweet `prune-back`
  - nasturtium-companion `summer-cut-back`

### The gate every new row must pass

A row on any `HERB_PLUGIN_IDS` plugin (`apps/web/src/lib/garden/herbs.ts`) ships only when all of these pass:

1. `herbSeasonalRowSourceGaps` (`apps/web/src/lib/plugins/sourceCoverage.ts`, test `herbSeasonalRows.gate.test.ts`). The row needs a source entry `{ url, publisher, date, quote, note? }` at `crop-data-sources.json` → `<pluginId>` → `seasonalTasks.<rowKey>`. The url must be on an `.edu` or `.gov` host. The quote must contain a word that starts with the first four letters of the row title's first word: "Pinch" matches "pinching" and "Divide" matches "divided". The quote must also name the herb by a word of four or more letters from its display name (a trailing "s" is dropped, and words in parentheses count).
2. `seasonalTaskNumberGaps`: every digit in the title or body must appear in the quote. "3 to 4" is satisfied by "3-4".
3. `seasonalTaskWordingProblems`: no spray kind or category, and no pesticide, oil or "label" wording.
4. `seasonalTaskText.test.ts`: the row's English goes in `apps/web/src/lib/i18n/catalogs/en/seasonal.ts` under `seasonal.<pluginId>.<rowKey>.<title|body>`, with Spanish in `es/seasonal.ts` (tú form, crop names as in `cropNames.es.ts`).
5. The plugin's patch version is bumped. A brand-new row needs no text-refresh migration.

Every quote must be copied word for word from the page text: the weekly source-drift job re-checks them. A frost-keyed action (bring indoors before frost) is never a row (R-18). It is the `bring-indoors` engine event, fed by 37B's `tender-perennial` verdict.

### Still missing

| Plugin                                                                                                                                                                                                                         | Wanted row                                             | Why it is not shipped                                                                                                                                                                                                                                                        | Candidate pages                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| mint-spearmint                                                                                                                                                                                                                 | Cut mint back mid-season                               | Illinois only says "the more frequently the stems are cut the more new growth is produced", which is a harvest note, not a seasonal action                                                                                                                                   | extension.umn.edu herb or mint pages; extension.umd.edu mint page; VCE 426-420 "Herbs" at pubs.ext.vt.edu                            |
| cilantro-santo                                                                                                                                                                                                                 | Sow cilantro in cooler weather or in shade during heat | Illinois's row ships, but no page read says what to do in heat                                                                                                                                                                                                               | extension.umn.edu/planting-and-growing-guides/gardening-hot-weather; extension.umd.edu cilantro page                                 |
| rosemary-tuscan-blue                                                                                                                                                                                                           | Light pruning or pinching for shape                    | UW-Madison and Illinois say pruning shapes the plant but give no season                                                                                                                                                                                                      | hgic.clemson.edu rosemary; extension.oregonstate.edu                                                                                 |
| lemon-verbena, lemongrass-east-indian, sweet marjoram, summer-savory                                                                                                                                                           | Bring indoors before frost                             | These are frost-keyed, so they are 37B data: a `winterHardyToZone` (or the `tender-perennial` verdict) makes the engine emit `bring-indoors`. Illinois states "Move the plant indoors before frost" (lemon verbena) and "Before frost, move the plant indoors" (lemon grass) | extension.illinois.edu/herbs/lemon-verbena, /lemon-grass, /marjoram-sweet, /savory-summer                                            |
| anise-hyssop, bergamot-monarda, hyssop-officinalis, mountain-mint, perilla-shiso-green, stevia-sweetleaf, tulsi-holy-basil-rama, lovage, fennel-bulb-perfection, fennel-florence-zefa-fino, chamomile-german, calendula-resina | Any pinch, cut-back, divide or succession row          | No page read states a seasonal action for the crop (Illinois's lovage and fennel pages give culture only)                                                                                                                                                                    | content.ces.ncsu.edu; extension.umd.edu; hgic.clemson.edu; extension.usu.edu; njaes.rutgers.edu; yardandgarden.extension.iastate.edu |
| every row above                                                                                                                                                                                                                | A sourced placement (month or growth stage)            | The pages give "early spring", "mid-summer" or "November or December". `dayOfYear` and `daysAfterPlanting` are typical placements, so the calendar shows them as "Typical timing. Adjust to your farm." (OP-22). A day-level source would not change that label.             | none needed unless OP-22 changes                                                                                                     |

### Shipped with a weak second source

- `bringIndoorsLead` rests on one page, about rosemary. A second agreeing .edu page, giving a lead for tender herbs in general, would strengthen it. Candidates: extension.umn.edu herb pages; hgic.clemson.edu "Growing herbs indoors". Keep the low end of any range. If two sources disagree, record both in the entry's `note` and keep the stricter (longer) lead.

---

## Task 4: herb water need (37E, `waterNeed`)

The field is `waterNeed: 'low' | 'medium' | 'high'` on crop plugins. It only adds words beside the watering verdict ("Check the soil first: thyme likes it dry", a mixed-needs line in a shared bed); it never changes the verdict and never scales the weekly target (ruling R-10). The pots-in-heat thresholds (`potHeatHighF` 90, `potHeatLowF` 70) are sourced and shipped (UMN Extension, "Gardening in hot weather"), so nothing is open there.

**Already shipped (2026-10-17, fetched and checked word for word):** basil-genovese (high; Illinois and UMD agree), catnip-common, dill-mammoth, lemon-balm, parsley-italian-flat-leaf, lovage, fennel-bulb-perfection, fennel-florence-zefa-fino (high; Illinois), mint-spearmint (medium; UMD), lavender-english-munstead (low; Illinois and UMD agree).

**The gate the quote must meet** (`waterNeedQuoteGaps` in `apps/web/src/lib/plugins/sourceCoverage.ts`, run by `waterNeed.sources.gate.test.ts`):

- The source goes under `waterNeed` in `apps/web/scripts/crop-data-sources.json` for that pluginId; a second source goes under `waterNeed.2` (then `.3`). Each entry is `{ url, publisher, date, quote, note? }` and the URL must be a `.edu` or `.gov` page (or an allowed extension host).
- The quote is verbatim page text (the weekly source-drift job re-checks it word for word). It must name the crop by its name before the variety, its first two words, a first word that is not generic (not "summer", "sweet", "common", "lemon" and the like), its variety after "—", or its binomial in parentheses.
- The quote must contain exactly one need from the fixed phrase list `WATER_NEED_PHRASES` (longest match first): low is "dry soil", "drier soil", "dry side", "dry conditions", "dry, rocky", "rocky, dry", "drought tolerant/-tolerant", "tolerates drought", "tolerant of drought", "allow the soil to dry", "let the soil dry"; medium is "moderate moisture", "moderate water", "moderately moist", "somewhat moist", "average moisture", "medium moisture"; high is "moist soil", "moist but well-drained/drained", "moist, well-drained", "moist, but well-drained", "evenly/consistently/constantly/uniformly moist", "uniform soil moisture", "keep (the) soil moist", "well-watered", "well watered", "plenty of water", "abundant moisture", "wet soil". Do not widen the list to fit a quote; a list change is a ruling.
- If two counted sources map to different values, the field stays empty: remove `waterNeed` from the plugin, keep both entries, and say so in a `note`. One source is enough when nothing disagrees.
- Prefer quotes about the plant in the garden. A quote about pots indoors, seed germination or flavor does not describe the crop's water need and should not be used.

**Still empty, with what was checked:**

| Plugin ids                                                                                                                                    | Why it is empty                                                                                                                                                                                                                                                                            | Candidate pages                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thyme-german-winter`, `rosemary-tuscan-blue`, `tarragon-french`                                                                              | Illinois says "keep the soil on the dry side" only under indoor or pot culture; the garden paragraphs and UMD and VCE 426-420 say only "well-drained", which maps to nothing.                                                                                                              | extension.illinois.edu/herbs/thyme, /rosemary, /tarragon-french; hort.extension.wisc.edu/articles/rosemary; extension.umd.edu/resource/thyme and /rosemary; extension.colostate.edu herb fact sheets; yardandgarden.extension.iastate.edu |
| `chives-common`                                                                                                                               | Illinois calls chives "a hardy, drought-tolerant perennial" in the garden but says "Water to maintain uniform soil moisture" for pots; "drought-tolerant" is a tolerance, not a stated preference, so it was not shipped alone. Needs a garden-context quote that says what chives prefer. | extension.illinois.edu/herbs/chives; extension.umd.edu/resource/chives; extension.usu.edu; njaes.rutgers.edu                                                                                                                              |
| `sage-broadleaf`, `oregano-greek`, `marjoram-sweet`                                                                                           | Illinois and UMD speak only of drainage ("very well-drained soil"), which maps to nothing.                                                                                                                                                                                                 | extension.illinois.edu/herbs/sage, /oregano, /marjoram-sweet; extension.umd.edu/resource/sage, /oregano; www.pubs.ext.vt.edu/426/426-420                                                                                                  |
| `summer-savory`                                                                                                                               | Illinois: "It prefers ... soil that is moist, but well-drained" with the crop named only in the previous paragraph, so no single passage names it.                                                                                                                                         | extension.illinois.edu/herbs/savory-summer                                                                                                                                                                                                |
| `lemongrass-east-indian`                                                                                                                      | Illinois writes "lemon grass" (no name match) and speaks of a container: "water as needed to keep soil moist".                                                                                                                                                                             | extension.illinois.edu/herbs/lemon-grass; extension.umd.edu; hgic.clemson.edu (answered 403 to curl)                                                                                                                                      |
| `lemon-verbena`                                                                                                                               | Illinois quotes are about potting media indoors.                                                                                                                                                                                                                                           | extension.illinois.edu/herbs/lemon-verbena                                                                                                                                                                                                |
| `nasturtium-companion`                                                                                                                        | Illinois "keep plants well watered" is about leaf flavor, and the crop is named only in an earlier sentence; other guides call nasturtium a poor-soil plant, so expect disagreement.                                                                                                       | extension.illinois.edu/herbs/nasturtium                                                                                                                                                                                                   |
| `cilantro-santo`, `chervil`                                                                                                                   | Illinois pages state no water need (chervil only for seed germination); VCE 426-420 gives sun and sowing only.                                                                                                                                                                             | extension.illinois.edu/herbs/cilantro, /chervil; extension.umn.edu/planting-and-growing-guides/gardening-hot-weather (cilantro in heat)                                                                                                   |
| `chamomile-german`, `calendula-resina`                                                                                                        | VCE 426-420 gives "sandy, well-drained soil" for German chamomile, which maps to nothing; no calendula page found.                                                                                                                                                                         | www.pubs.ext.vt.edu/426/426-420; extension.illinois.edu                                                                                                                                                                                   |
| `anise-hyssop`, `bergamot-monarda`, `hyssop-officinalis`, `mountain-mint`, `perilla-shiso-green`, `stevia-sweetleaf`, `tulsi-holy-basil-rama` | Not looked up in this pass.                                                                                                                                                                                                                                                                | extension.illinois.edu/herbs; extension.umd.edu; njaes.rutgers.edu; publications.ca.uky.edu                                                                                                                                               |

Run before committing: `pnpm --filter @cropcard/web exec vitest run src/lib/plugins/waterNeed.test.ts src/lib/plugins/waterNeed.sources.gate.test.ts` (plus the full verification above).

---

## Task 5: herb pruning and harvest steps (37F)

Phase 37F shows a crop's own pruning and harvest steps in the Care Guide, in "Ask about a photo" with no Claude key, and as the caption under the growth-habit line drawing. They live on the crop plugin as `careTasks` (`{ key, topic: 'prune' | 'harvest', title, body? }`, schema in `packages/plugin-validation/src/schemas.ts`, block marked `// Phase 37F`). Invariant 9 (Spanish) and the crop data rules apply.

### What already shipped (2026-10-17)

Every herb below carries steps quoted word for word from University of Illinois Extension "Herbs" pages (`https://extension.illinois.edu/herbs/<herb>`), cross-checked against the University of Maryland Extension pages (`https://extension.umd.edu/resource/<herb>`) for the first eleven; nothing they disagree on was shipped. Basil also keeps `pinch-stems` from the UMD basil page (moved from the family tip `herb-culinary.prune.0`, ruling R-20).

`basil-genovese`, `rosemary-tuscan-blue`, `parsley-italian-flat-leaf`, `mint-spearmint`, `thyme-german-winter` (prune only), `oregano-greek`, `sage-broadleaf`, `chives-common`, `dill-mammoth`, `lavender-english-munstead`, `catnip-common`, `chervil`, `fennel-bulb-perfection`, `fennel-florence-zefa-fino`, `lemon-balm`, `lemon-verbena`, `lovage`, `marjoram-sweet`, `summer-savory`, `tarragon-french`.

### What is still missing

| Plugin                                                                                                               | Field                                 | Why it is empty                                                                                                                                                                                                                                        | Candidate pages                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `thyme-german-winter`                                                                                                | `careTasks` harvest                   | Sources disagree: Illinois "best cut just before the plant starts to flower"; UMD "Cut leafy tops and flower clusters when first blossoms open".                                                                                                       | VCE 426-420 "Herbs" (pubs.ext.vt.edu), hort.extension.wisc.edu, NC State "harvesting-and-preserving-herbs-for-the-home-gardener"                 |
| `cilantro-santo`                                                                                                     | `careTasks` prune and harvest         | The Illinois sentence reads "Entire plants of individual leaves can be cut when plants get to be about six inches tall" (a typo for "or"), which a grower cannot follow word for word; the UMD cilantro page has no text.                              | VCE 426-420, extension.umn.edu, NC State, hgic.clemson.edu                                                                                       |
| `rosemary-tuscan-blue`                                                                                               | a second prune step                   | Only "Pruning the plants will encourage a tight compact habit." shipped.                                                                                                                                                                               | https://hort.extension.wisc.edu/articles/rosemary/, VCE 426-420                                                                                  |
| `lemongrass-east-indian`                                                                                             | `careTasks`                           | The Illinois page covers lemon grass in general and a grocery-store stem, which is West Indian (_Cymbopogon citratus_); the plugin is East Indian (_C. flexuosus_).                                                                                    | A page naming East Indian lemongrass                                                                                                             |
| `tulsi-holy-basil-rama`                                                                                              | `careTasks`                           | Pages found are for sweet basil (_Ocimum basilicum_), not holy basil.                                                                                                                                                                                  | A page naming holy basil or tulsi                                                                                                                |
| `anise-hyssop`, `bergamot-monarda`, `hyssop-officinalis`, `mountain-mint`, `perilla-shiso-green`, `stevia-sweetleaf` | `careTasks`                           | No Illinois herb page; not looked for elsewhere yet.                                                                                                                                                                                                   | extension.umn.edu, hgic.clemson.edu, extension.psu.edu, extension.usu.edu, extension.oregonstate.edu, extension.colostate.edu, njaes.rutgers.edu |
| `chamomile-german`, `calendula-resina`                                                                               | `careTasks` harvest                   | Not looked for yet (the flowers are the crop).                                                                                                                                                                                                         | Same hosts                                                                                                                                       |
| `lavender-english-munstead`, `hyssop-officinalis`, `oregano-greek` and the other herbs                               | `growthHabit` (`woody` or `clumping`) | Shipped only where an Illinois page says it: thyme, sage and rosemary `woody`, chives `clumping`. Every other herb shows the cut-and-come-again leafy drawing (its archetype). Illinois calls lavender "bushy" and UMD a "sub-shrub", neither "woody". | The same hosts                                                                                                                                   |

### Gate rules a value must pass

- **Source entry.** `apps/web/scripts/crop-data-sources.json`, under the plugin id, key `careTasks.<key>` for each care task and `growthHabit` for the habit: `url` (https), `publisher`, `date` (page date, or `accessed YYYY-MM-DD`), `quote`. Checked by `checkSources` over `cropFactPaths` and by `cropCareQuoteGaps` (`apps/web/src/lib/plugins/sourceCoverage.ts`), run in `apps/web/src/lib/journal/cropCareTasks.gate.test.ts`.
- **Allowed host.** The URL is a `.edu` or `.gov` page (`isAllowedSpacingSource`). Seed company and nursery pages never count.
- **Word for word.** The care task's `title` (and `body`, if any) must each appear inside the quote exactly, ignoring only runs of spaces and curly versus straight quote marks. Rewording, shortening or fixing a typo fails the gate; pick a sentence a grower can follow as written. The weekly source-drift job re-reads quotes word for word, so the quote must be the page text, never a summary.
- **Growth habit.** The quote must name it: "woody" for `woody`, "clump", "clumps" or "clumping" for `clumping`.
- **No spray advice.** No product, rate, mix or spray timing (`isSprayAdvice` in `apps/web/src/lib/journal/photoHelp.ts`); the gate test fails on one.
- **Spanish.** Each title (and body) needs `herbsf.care.<pluginId>.<key>.title` (and `.body`) in `apps/web/src/lib/i18n/catalogs/en/herbsf.ts` equal to the plugin text, and a Spanish value in `es/herbsf.ts`. The gate test fails on a missing one and on a catalog key with no shipped task.
- **Disagreement.** One source is enough when nothing disagrees. When two allowed sources disagree on timing or method, leave the step out and add a row to the table above.
- **Plugin version.** Bump the plugin's patch version when its `careTasks` change.

Family care tips (`apps/web/src/lib/cards/build/careTips.ts`, sourced in `apps/web/scripts/care-tips-sources.json`) are a separate path: since Phase 37F a new tip needs verdict `supported` and a `.edu` or `.gov` URL; the 34 tips that shipped on `partly` are grandfathered by id in `PARTLY_GRANDFATHERED_TIP_IDS` (`careTipsSources.ts`), a list that can only shrink.

---

## Task 6 (optional): sun need for the garden brief (37A)

The garden brief (`/plan/brief`, Phase 37A) asks a beginner how much sun the herb spot gets (full sun, about half a day, mostly shade). Per ruling R-19 the answer filters nothing today: no crop plugin says how much sun it needs, so the page only shows "No herb in the library says how much sun it needs yet, so this list is not sorted by sun". The cuisine and goal tables in `apps/web/src/lib/garden/brief/shortlist.ts` are editorial product rulings, not agronomy, and need no source. Nothing else in 37A carries a number, a zone or a timing.

This task is optional. Do it only after Tasks 1 to 5.

**What would be filled.** A new optional crop field `sunNeed: 'full' | 'part' | 'shade'` (one value per crop, the most shade the source says the crop takes) on the herb plugins in `HERB_PLUGIN_IDS` (`apps/web/src/lib/garden/herbs.ts`, 32 ids). The schema block, the gate and the shortlist change are not built yet; when the data exists, add them in one PR:

1. `packages/plugin-validation/src/schemas.ts`: an optional `sunNeed` enum in its own block, then `pnpm gen:schemas`.
2. `apps/web/scripts/crop-data-sources.json`: one entry per plugin under the key `sunNeed` (`{ url, publisher, date, quote }`).
3. `apps/web/src/lib/plugins/sourceCoverage.ts`: one `cropFactPaths` line for `sunNeed`, and a `sunNeedQuoteGaps` check.
4. `deterministicShortlist` may then rank herbs that take the owner's sun answer higher, still tagged `fallback`; it must never remove a herb the owner typed.

**Plugin ids.** Every id in `HERB_PLUGIN_IDS`: `basil-genovese`, `chives-common`, `mint-spearmint`, `oregano-greek`, `rosemary-tuscan-blue`, `sage-broadleaf`, `thyme-german-winter`, `anise-hyssop`, `bergamot-monarda`, `catnip-common`, `hyssop-officinalis`, `lavender-english-munstead`, `lemon-balm`, `lemon-verbena`, `lemongrass-east-indian`, `marjoram-sweet`, `mountain-mint`, `perilla-shiso-green`, `stevia-sweetleaf`, `summer-savory`, `tarragon-french`, `tulsi-holy-basil-rama`, `parsley-italian-flat-leaf`, `cilantro-santo`, `dill-mammoth`, `chervil`, `fennel-bulb-perfection`, `fennel-florence-zefa-fino`, `lovage`, `chamomile-german`, `calendula-resina`, `nasturtium-companion`.

**Candidate pages** (the Phase 37 panel found these; this environment could not open any of them):

- VCE 426-420 "Herbs" at pubs.ext.vt.edu (one table covering most culinary herbs).
- extension.illinois.edu/herbs/<herb> (one page per herb).
- hort.extension.wisc.edu/articles/rosemary and the other Wisconsin herb articles.
- ohioline.osu.edu HYG-5360.
- extension.umd.edu herb pages.

**Gate rule the quote must meet** (`sunNeedQuoteGaps`):

- The host is .edu or .gov (`isAllowedSpacingSource` already encodes this list).
- The quote names the crop (common or Latin name) and states its light need in the source's own words: "full sun" maps to `full`; "partial shade", "part shade", "light shade" or "tolerates some shade" maps to `part`; "shade" or "full shade" maps to `shade`.
- When two counted sources disagree, store the sunnier value and put the other quote in the entry's `note`, as the crop spacing rules do (#600). A page summary or a search snippet is not a quote.
- A crop with no qualifying quote stays empty, and the page keeps saying the list is not sorted by sun.
