# Phase 37C research: what is still missing for preserving and harvest cadence

Part of the Phase 37 herb research prompt (the integrator stitches it into `docs/research/phase-37-herb-research-prompt.md`). Cluster 37C filled what the open extension pages state on 2026-10-17; this section lists only what is still empty. Work it in the style of `docs/research/label-research-prompt.md`: every value needs a verbatim quote in `apps/web/scripts/crop-data-sources.json` with `url`, `publisher`, `date` and `quote`, and must pass the gates below (`apps/web/src/lib/plugins/herbHarvest.sources.gate.test.ts` runs them over the shipped library). One source is enough when nothing disagrees; when counted sources disagree, leave the value empty and record a `preserving.<method>.notRecorded` entry whose `note` says "disagree" and names the sources. Never guess a value. Bump the plugin's patch version when you add one.

## What already ships (do not redo)

`preserving` on 14 herbs from OSU HYG-5360, NC State's herb leaflet, Penn State "Freezing Herbs", NCHFP "Drying Herbs", UGA Extension C1334 (infused oils), UMN "Growing basil" and Illinois Extension herb pages: basil (fresh, freeze, infuse), chives (freeze), spearmint (fresh, dry fair, freeze), Greek oregano (infuse), rosemary (dry, freeze, infuse), sage (dry), thyme (fresh, dry, freeze), lavender (dry), lemon balm (fresh, dry fair, freeze), summer savory (dry), tarragon (dry fair, freeze), parsley (fresh, dry, freeze), cilantro (freeze), dill (dry, freeze).

Left empty on purpose because sources disagree (see the `notRecorded` notes): basil `dry` (Illinois "easily dried"; NCHFP and NC State "will/may mold if not dried quickly"; UMN "leaves turn an unpleasant brown color when air-dried") and Greek oregano `dry` (OSU "Best Herbs for Drying"; NCHFP tender-leaf herb that "will mold"). A third source only helps if the panel rules on how good and fair are weighed; otherwise they stay empty.

## Gate rules

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

## Still missing

| plugin ids | field and key | candidate pages |
| --- | --- | --- |
| every herb in `HERB_PLUGIN_IDS` | `harvestCadence` (`harvestCadence`) | None of the pages read states an interval between cuts (Illinois says "Harvesting can begin in about 4 to 5 weeks" for windowsill basil, which is time to first harvest, not between cuts). Look in extension.umd.edu herb pages, extension.umn.edu/planting-and-growing-guides/growing-herbs, hgic.clemson.edu factsheets (the basil page loaded; most other herb URLs returned a not-found page), extension.usu.edu, extension.oregonstate.edu, extension.colostate.edu, yardandgarden.extension.iastate.edu, publications.ca.uky.edu and edis.ifas.ufl.edu, especially for basil, chives, parsley, mint, cilantro and oregano. |
| `basil-genovese`, `oregano-greek` | `preserving.dry` | Disagreement noted above; needs a panel ruling, not more pages. |
| `oregano-greek`, `chives-common`, `sage-broadleaf`, `cilantro-santo`, `lavender-english-munstead`, `summer-savory`, `marjoram-sweet` | `preserving.freeze`, `preserving.fresh` | OSU HYG-5360 and Penn State name only the herbs listed above; try UMD, UMN, Clemson HGIC 3086 "Drying Herbs, Seeds & Nuts" and freezing pages, VCE 426-420 "Herbs" at pubs.ext.vt.edu. |
| `marjoram-sweet`, `chervil`, `lovage`, `anise-hyssop`, `bergamot-monarda`, `catnip-common`, `hyssop-officinalis`, `lemon-verbena`, `lemongrass-east-indian`, `mountain-mint`, `perilla-shiso-green`, `stevia-sweetleaf`, `tulsi-holy-basil-rama`, `fennel-bulb-perfection`, `fennel-florence-zefa-fino`, `chamomile-german`, `calendula-resina`, `nasturtium-companion` | any `preserving.<method>` | Illinois chervil ("Air dry and store leaves in sealed containers") and lovage ("Leaves can be dried for later use") state drying but the quoted sentence does not name the herb; a sentence that does is needed. Illinois marjoram, savory and tarragon URLs loaded without herb text. Penn State "Freezing Herbs" names lemongrass only for chopping ("Chop chives and lemon grass before freezing"), which could support `lemongrass-east-indian` freeze if the panel agrees it says freezing works. |
| any herb | `preserving.freeze-dry` | No page read mentions freeze-drying herbs. NCHFP and land-grant pages on home freeze-dryers (for example extension.usu.edu) are the candidates. |
| herbs beyond basil, oregano and rosemary | `preserving.infuse` | UGA C1334 names only garlic, basil, oregano and rosemary for its tested acidification method; another tested method naming the herb is needed, plus the safety quote. Herb vinegars: NCHFP "Flavored Vinegars" and land-grant vinegar publications. |

The plan's per-method timing hint (for drying, cut before bloom, as a `CardFact.note` on the harvest task) is not built: NCHFP ("The best time to harvest most herbs for drying is just before the flowers first open when they are in the bursting bud stage."), OSU HYG-5360 and Penn State all state it for herbs in general, so the panel should rule whether a general line may show on every herb's harvest task before it ships.
