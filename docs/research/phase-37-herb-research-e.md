## Task E: herb water need (Phase 37E, `waterNeed`)

The field is `waterNeed: 'low' | 'medium' | 'high'` on crop plugins. It only adds words beside the watering verdict ("Check the soil first: thyme likes it dry", a mixed-needs line in a shared bed); it never changes the verdict and never scales the weekly target (ruling R-10). The pots-in-heat thresholds (`potHeatHighF` 90, `potHeatLowF` 70) are sourced and shipped (UMN Extension, "Gardening in hot weather"), so nothing is open there.

**Already shipped (2026-10-17, fetched and checked word for word):** basil-genovese (high; Illinois and UMD agree), catnip-common, dill-mammoth, lemon-balm, parsley-italian-flat-leaf, lovage, fennel-bulb-perfection, fennel-florence-zefa-fino (high; Illinois), mint-spearmint (medium; UMD), lavender-english-munstead (low; Illinois and UMD agree).

**The gate the quote must meet** (`waterNeedQuoteGaps` in `apps/web/src/lib/plugins/sourceCoverage.ts`, run by `waterNeed.sources.gate.test.ts`):

- The source goes under `waterNeed` in `apps/web/scripts/crop-data-sources.json` for that pluginId; a second source goes under `waterNeed.2` (then `.3`). Each entry is `{ url, publisher, date, quote, note? }` and the URL must be a `.edu` or `.gov` page (or an allowed extension host).
- The quote is verbatim page text (the weekly source-drift job re-checks it word for word). It must name the crop by its name before the variety, its first two words, a first word that is not generic (not "summer", "sweet", "common", "lemon" and the like), its variety after "—", or its binomial in parentheses.
- The quote must contain exactly one need from the fixed phrase list `WATER_NEED_PHRASES` (longest match first): low is "dry soil", "drier soil", "dry side", "dry conditions", "dry, rocky", "rocky, dry", "drought tolerant/-tolerant", "tolerates drought", "tolerant of drought", "allow the soil to dry", "let the soil dry"; medium is "moderate moisture", "moderate water", "moderately moist", "somewhat moist", "average moisture", "medium moisture"; high is "moist soil", "moist but well-drained/drained", "moist, well-drained", "moist, but well-drained", "evenly/consistently/constantly/uniformly moist", "uniform soil moisture", "keep (the) soil moist", "well-watered", "well watered", "plenty of water", "abundant moisture", "wet soil". Do not widen the list to fit a quote; a list change is a ruling.
- If two counted sources map to different values, the field stays empty: remove `waterNeed` from the plugin, keep both entries, and say so in a `note`. One source is enough when nothing disagrees.
- Prefer quotes about the plant in the garden. A quote about pots indoors, seed germination or flavor does not describe the crop's water need and should not be used.

**Still empty, with what was checked:**

| Plugin ids | Why it is empty | Candidate pages |
| --- | --- | --- |
| `thyme-german-winter`, `rosemary-tuscan-blue`, `tarragon-french` | Illinois says "keep the soil on the dry side" only under indoor or pot culture; the garden paragraphs and UMD and VCE 426-420 say only "well-drained", which maps to nothing. | extension.illinois.edu/herbs/thyme, /rosemary, /tarragon-french; hort.extension.wisc.edu/articles/rosemary; extension.umd.edu/resource/thyme and /rosemary; extension.colostate.edu herb fact sheets; yardandgarden.extension.iastate.edu |
| `chives-common` | Illinois calls chives "a hardy, drought-tolerant perennial" in the garden but says "Water to maintain uniform soil moisture" for pots; "drought-tolerant" is a tolerance, not a stated preference, so it was not shipped alone. Needs a garden-context quote that says what chives prefer. | extension.illinois.edu/herbs/chives; extension.umd.edu/resource/chives; extension.usu.edu; njaes.rutgers.edu |
| `sage-broadleaf`, `oregano-greek`, `marjoram-sweet` | Illinois and UMD speak only of drainage ("very well-drained soil"), which maps to nothing. | extension.illinois.edu/herbs/sage, /oregano, /marjoram-sweet; extension.umd.edu/resource/sage, /oregano; www.pubs.ext.vt.edu/426/426-420 |
| `summer-savory` | Illinois: "It prefers ... soil that is moist, but well-drained" with the crop named only in the previous paragraph, so no single passage names it. | extension.illinois.edu/herbs/savory-summer |
| `lemongrass-east-indian` | Illinois writes "lemon grass" (no name match) and speaks of a container: "water as needed to keep soil moist". | extension.illinois.edu/herbs/lemon-grass; extension.umd.edu; hgic.clemson.edu (answered 403 to curl) |
| `lemon-verbena` | Illinois quotes are about potting media indoors. | extension.illinois.edu/herbs/lemon-verbena |
| `nasturtium-companion` | Illinois "keep plants well watered" is about leaf flavor, and the crop is named only in an earlier sentence; other guides call nasturtium a poor-soil plant, so expect disagreement. | extension.illinois.edu/herbs/nasturtium |
| `cilantro-santo`, `chervil` | Illinois pages state no water need (chervil only for seed germination); VCE 426-420 gives sun and sowing only. | extension.illinois.edu/herbs/cilantro, /chervil; extension.umn.edu/planting-and-growing-guides/gardening-hot-weather (cilantro in heat) |
| `chamomile-german`, `calendula-resina` | VCE 426-420 gives "sandy, well-drained soil" for German chamomile, which maps to nothing; no calendula page found. | www.pubs.ext.vt.edu/426/426-420; extension.illinois.edu |
| `anise-hyssop`, `bergamot-monarda`, `hyssop-officinalis`, `mountain-mint`, `perilla-shiso-green`, `stevia-sweetleaf`, `tulsi-holy-basil-rama` | Not looked up in this pass. | extension.illinois.edu/herbs; extension.umd.edu; njaes.rutgers.edu; publications.ca.uky.edu |

Run before committing: `pnpm --filter @cropcard/web exec vitest run src/lib/plugins/waterNeed.test.ts src/lib/plugins/waterNeed.sources.gate.test.ts`.
