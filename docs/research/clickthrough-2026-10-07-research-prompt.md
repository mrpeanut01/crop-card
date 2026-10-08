# CropCard: label and extension research for the 2026-10-07 clickthrough (local agent)

You are working in a local checkout of `mrpeanut01/crop-card` (SvelteKit + TypeScript, pnpm, Node 22) on a machine that can open EPA, eCFR, OMRI, registrant and land-grant extension sites. A cloud agent fixed the code side of every issue below, but its network policy blocked every label and extension host, so the facts are still missing. Your job is to read the primary sources, record word-for-word quotes, fill the data, and make whatever small code change each task names.

Read `CLAUDE.md` first. Invariants 1, 2, 6 and 9 matter most: safety rules live only in `apps/web/src/lib/safety/`, plugins are data only and must pass schema validation, tenant isolation is never weakened, and every new user-facing string ships in English and Spanish.

## Ground rules

- **Primary sources only.** A value goes in only if you read it on the EPA-stamped label (PPLS PDF at `www3.epa.gov/pesticides/chem_search/ppls/...`), the registrant's current label, the eCFR, the OMRI Products List, or a land-grant extension publication (.edu or .gov). Search snippets, distributor pages, seed-company pages and AI summaries never count. Open the document itself.
- **Quote word for word.** Every value needs a quote copied character for character from the document, with its URL, the document date and the page. If you paraphrase, the gate tests will refuse it, and a reviewer will revert it. If a fetch tool summarises pages, download the PDF and extract the text yourself (for example `pdftotext -layout`) before quoting.
- **If sources disagree, leave the field empty** and write down both values and both sources in the issue comment. For safety data (REI, PHI, intervals, bloom, lethality), when a label is ambiguous take the more protective reading.
- **Never invent a number.** If the label is silent, say so in the issue and leave the field empty. The app already shows "Not on file. Check the label." for missing values.
- **Minimal diffs.** Edit only the field you are filling. Don't reformat plugin JSON.
- **Kernel changes** (anything under `apps/web/src/lib/safety/`) go in their own PR, bump `RULES_VERSION` in `apps/web/src/lib/safety/version.ts`, and need vitest plus fast-check tests. Only tasks 7 and 8 below may need this.
- **Writing style for issue comments and PR bodies:** plain sentences, no em or en dashes, end GitHub posts with the Claude Code footer.

## Where provenance goes

`apps/web/scripts/epa-reg-sources.json` has dedicated sections, each with a `$comment` that states the exact entry shape. Read it before writing. The checks live in `apps/web/src/lib/plugins/pesticideLabelSources.ts` and `pesticideLabelSources.gate.test.ts`.

| Section     | Plugin field                                               | Entry shape (see `$comment`)                                                                                                             |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `rei`       | herbicide `reEntryIntervalHours`                           | `{ reEntryIntervalHours, sourceUrl, docDate, page, quote }`, the quote states the hours                                                  |
| `phiByCrop` | `preHarvestIntervalsByCrop`                                | list of `{ cropPluginId or cropFamily, preHarvestIntervalDays, sourceUrl, docDate, page, quote }`, the quote names the crop and the days |
| `rate`      | herbicide `ratePerAcre` with `rateProvenance: "label"`     | `{ ratePerAcre: { amount, unit }, sourceUrl, docDate, page, quote }`                                                                     |
| `entries`   | `epaRegistrationNumber`, organic `complianceFlags` changes | see existing entries such as `aza-direct` for the OMRI quote pattern                                                                     |

Crop agronomy goes in `apps/web/scripts/crop-data-sources.json` (pluginId, then field, then `{ url, publisher, date, quote }`). Look at existing `seedingRate.*` and `treeSizeClasses.*` entries and the CLAUDE.md "Crop agronomy gaps" rulings before adding one.

## Verification (run before every commit)

```sh
pnpm install --frozen-lockfile
pnpm --filter @cropcard/web audit:plugin-metadata
pnpm --filter @cropcard/web exec vitest run src/lib/plugins tests/integration/seedLibrary.test.ts
pnpm typecheck && pnpm lint
pnpm test:unit
pnpm --filter @cropcard/web i18n:check
```

Work on a branch per task group off `main`, open a PR against `main` that says `Closes #NNN` (or `Partly addresses #NNN` when something stays open), and merge once CI is green. Never use `--admin` or skip tests. When a task can't be finished, comment on its issue saying exactly what you checked and what is still missing, and leave the `needs-research` label on.

---

## Task 1: Herbicide re-entry intervals (#640)

Herbicide plugins (`plugins/herbicides/*.json`) can now carry `reEntryIntervalHours`, but none does. For every herbicide plugin with an `epaRegistrationNumber`, open its PPLS label (the URL is already in `entries`), find the Agricultural Use Requirements box, and record the REI under `rei`. Start with Dual II Magnum and Aatrex 4L, then the rest.

Atrazine's label also carries forage and grazing intervals for corn and sorghum. Record those as `grazingRestrictions` with quotes in `apps/web/scripts/grazing-sources.json`, following the existing entries there.

Once REIs exist, check whether herbicide sprays now appear in the active-REI banner on /today. If they don't, that wiring is a small code change in scope here.

## Task 2: PHI per crop for multi-crop labels (#661)

Plugins can carry `preHarvestIntervalsByCrop`; none does yet. Start with Warrior II (lambda-cyhalothrin), whose label lists different PHIs by crop (the plugin shows 1 day for everything, and corn is longer). Then work through the other insecticides and fungicides whose labels list more than one crop. Map label crop names to `cropPluginId` where one exists, otherwise to a `cropFamily`. Record each under `phiByCrop`.

## Task 3: Banvel rates and the remaining herbicide rates (#737)

All 68 shipped herbicide rates are tagged `rateProvenance: "fallback"` and shown as a typical rate. For each, read the label's rate for the crops the plugin lists. Where the label gives one rate that matches, set `rateProvenance: "label"` and add a `rate` entry. Where the label gives different rates by crop or stage, don't pick one: leave the plugin on fallback and list the per-crop rates in the issue.

Banvel (Dicamba DMA 4#, EPA 70506-461) specifically: record the wheat, barley and corn rates and the growth-stage limits word for word. The schema has no per-crop rate or stage cut-off yet. If the label gives them, add optional `ratePerAcreByCrop` and `stageLimitByCrop` fields to the herbicide schema (`lib/plugins/schemas.ts` and `pnpm gen:schemas`), use them in the spray mix, and keep "Check the label" for crops with no sourced rate.

## Task 4: Eptam and corn gluten meal herbicide class (#654)

Both carry an `unclassified` class that the kernel treats as lethal to every crop. Quote EPTC's herbicide group (HRAC/WSSA) from the Eptam label (EPA PPLS or Gowan). With that quote, add a real thiocarbamate class row. Note that this is a kernel change: class lethality lives in `apps/web/src/lib/safety/cropFamilyLethality.ts`, so it needs a `RULES_VERSION` bump, tests, and its own PR. Corn gluten meal is FIFRA 25(b) exempt and probably has no group. If no source assigns one, it stays `unclassified`. Say so on the issue.

## Task 5: DiPel DF active ingredient (#705)

Open the label for EPA Reg. No. 73049-39 and quote its active-ingredient line under `entries` for the DiPel DF plugin. Confirm the plugin's name matches the label.

## Task 6: OMRI status (#716, #779)

Entrust SC, DiPel DF, Surround WP and PyGanic 1.4 are now "not marked either way". Look each one up on the current OMRI Products List (omri.org). Where it is listed, quote the listing (product name, company, OMRI code, expiry), following the `aza-direct` entry, and set `omriListed` and `certifiedOrganicAllowed`.

For #779: about 60 plugins say "OMRI" in their name or notes and have unsourced `omriListed`, `certifiedOrganicAllowed` or `transitioningAllowed` set to true. Find them with `grep -il omri plugins/*/*.json`. For each, either quote the listing or clear the flags. Then add a gate in `pesticideLabelSources.gate.test.ts` that refuses an allowed organic flag with no OMRI or 7 CFR 205 quote. After the flags change, check that /records/organic and the certifier pack no longer start the 36-month clock for these products.

## Task 7: Bloom end for continuous bloomers (#676)

Continuous-bloom crops (cucurbits, tomatoes, alfalfa) read as in bloom forever from first flower, so alfalfa shows in bloom in April. Ending bloom narrows a pollinator stop, so it needs a sourced end per crop or per family: for example days of bloom from first flower, or a season window from a Virginia or mid-Atlantic extension source. Record quotes in `crop-data-sources.json`. Then the kernel change in `apps/web/src/lib/safety/pollinatorBloom.ts` (around the `continuous` branch) is a separate kernel-only PR with a `RULES_VERSION` bump and fast-check tests, including one proving that a crop with no sourced end still reads as in bloom.

## Task 8: Herbicide lethality by active ingredient (#768)

The kernel judges herbicides by class, so nicosulfuron (Accent Q) passes on grass hay and wheat because sulfonylureas as a class are non-lethal to `forage-grass` (kept that way so Chaparral works on pasture). Quote, from each label, which grasses each sulfonylurea plugin injures or is labelled for. Then add per-active-ingredient lethality in `apps/web/src/lib/safety/` with a `RULES_VERSION` bump and fast-check tests, including one proving Chaparral still passes on pasture and grass hay. Kernel-only PR.

## Task 9: Wheat head scab fungicides (#659)

Add plugins for Prosaro, Caramba, Miravis Ace and Sphaerex. Each needs its EPA registration number, REI, PHI (per crop where the label differs), rates, FRAC group, formulation, default unit and pollinator wording quoted from its label, following an existing fungicide plugin such as `miravis-pydiflumetofen.json`. Add an EPA-number entry under `entries` for each. Run the plugin coverage audit.

## Task 10: Harvest timing for stone fruit and other perennials (#686)

Peaches, other stone fruit, and berries or grapes with no harvest template now show no yearly harvest window instead of borrowing the apple table. Find a Virginia or mid-Atlantic extension source that gives a harvest period for each crop (for example a month range for peaches in Virginia). Record quotes in `crop-data-sources.json` and add the template where the existing harvest-window helper reads it (`apps/web/src/lib/calendar/harvestWindow.ts`). One source is enough when nothing disagrees.

## Task 11: Soybean seeding rate (#689)

`soybean-asgrow-roundup-ready-2-xtend` has no sourced seeding rate, so soybeans plan at the 12 in placeholder. Quote a seeds-per-acre or drilled lb/acre range from the VCE Agronomy Handbook soybean section (or another land-grant source) as `plantingGuide.seedingRate.seedsPerAcre` (and `drillRowSpacingIn` if stated), following the field corn entry and the seeding-rate rulings in CLAUDE.md. `seedingRateQuoteGaps` must pass.

## Task 12: Inputs plan for corn, soybeans and wheat (#720)

The inputs plan says plainly which crops get no herbicide or fertility. To fill it in, quote from extension or label sources: herbicide stage tables or day-anchored spray windows for field corn, sorghum and small grains, spray windows for soybeans and wheat, cereal-grain and forage nutrient-removal defaults, and the wheat nitrogen topdress split. Add them as crop `sprayWindows` (with `purpose` and stage) and nutrient defaults where `lib/plan/inputsPlan.ts` reads them. Every number needs a quote.

## Task 13: Crop nitrogen demand row (#739)

The fertility form is otherwise done. The missing piece is a crop nitrogen-demand budget row, which needs per-crop N demand quoted from an extension source (for example the VCE or Penn State nutrient recommendations). Record them in `crop-data-sources.json` and show the row on /fertility with `data` provenance. Add any new strings to `lib/i18n/catalogs/{en,es}/`.

---

## When you finish

For each issue, either close it through the merged PR or leave a comment saying what you checked, what you found, and what is still missing, with the `needs-research` label left on. Then reply with one table: issue, outcome (closed / partly / unchanged), PR, and any `RULES_VERSION` change.
