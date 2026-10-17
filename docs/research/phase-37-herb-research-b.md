## Phase 37B: herb lifecycle and winter zone (what is still missing)

Cluster 37B shipped a quoted `agronomy.lifecycle` for 31 of the 32 herbs in `HERB_PLUGIN_IDS` (`apps/web/src/lib/garden/herbs.ts`) and a quoted `winterHardyToZone` for every perennial among them except one. The pages it read on 2026-10-17 were VCE 426-420 "Herbs" (Herb Culture and Use tables), Illinois Extension "Herb Gardening" pages, the NC State Extension Gardener Plant Toolbox and Wisconsin Horticulture's rosemary article. This section lists what is left and the values worth a second source.

### Ground rules

- A value goes in only with a verbatim quote from a page on an `.edu` or `.gov` host (or `journals.flvc.org`), stored in `apps/web/scripts/crop-data-sources.json` under the plugin id with `url`, `publisher`, `date` and `quote` (and `note` for anything a reader needs). Quote the page text exactly: the weekly source-drift job re-reads each quote word for word (letters and digits only, pieces split on " | ", "..." and quoted strings).
- When you fill a value, delete its `lifecycle.notRecorded` or `winterHardyToZone.notRecorded` entry, add the value to `SOURCED_LIFECYCLES` in `apps/web/src/lib/garden/lifecycleSources.ts`, bump the plugin's patch version and insert only the field you fill.
- Zones (ruling R-5): store the coldest zone the source says the plant survives, as the source prints it (`7` or `7a`). When sources disagree, store the warmest and name the others in the note. A whole zone compares as its colder half.

### The gates the quote must pass

`lifecycleQuoteGaps` and `winterHardyToZoneQuoteGaps` in `apps/web/src/lib/plugins/sourceCoverage.ts`, run by `apps/web/src/lib/garden/lifecycle.sources.gate.test.ts`:

- `lifecycle`: the host passes `isAllowedSpacingSource`; the quote names the crop by one of its names in `LIFECYCLE_QUOTE_NAMES` (`lifecycleSources.ts`); the quote states the stored word (`annual`, `biennial`, `perennial`, or the plural as a table heading). A herb with no lifecycle source needs a `lifecycle.notRecorded` reason, and a sourced herb must not keep one.
- `winterHardyToZone`: only on a perennial; the host passes `isAllowedSpacingSource`; the quote names the crop, says "zone" and states the stored number (and the letter when one is stored). A perennial herb with no zone needs a `winterHardyToZone.notRecorded` reason.
- `SOURCED_LIFECYCLES` must equal the herbs with a `lifecycle` source and, where present, their sourced zone (the gate test checks it).

### Still missing

| Plugin | Field | Why it is empty | Candidate pages |
| --- | --- | --- | --- |
| `lemongrass-east-indian` (Cymbopogon flexuosus) | `agronomy.lifecycle` (stored `perennial`, unsourced) and `winterHardyToZone` | Illinois Extension (`/herbs/lemon-grass`) and the NC State Plant Toolbox (`/plants/cymbopogon-citratus/`) cover West Indian lemongrass, Cymbopogon citratus, only ("Tender Perennial", zones 8b to 11b). No fetched page names C. flexuosus. | UF/IFAS EDIS herb pages (edis.ifas.ufl.edu, search "lemongrass"), UMD Extension herb pages (extension.umd.edu), Clemson HGIC (hgic.clemson.edu). A page that names Cymbopogon flexuosus or "East Indian lemongrass" counts; a C. citratus page does not (record it in the note instead). |

### Worth a second source

| Plugin | Stored | Why |
| --- | --- | --- |
| `tarragon-french` | zone `3a` | From the NC State Plant Toolbox page for the species, which says the species is wild tarragon and French tarragon is A. dracunculus 'Sativa'. A page giving French tarragon its own zone replaces it if it is warmer (R-5). Candidates: extension.umn.edu, hort.extension.wisc.edu, yardandgarden.extension.iastate.edu. |
| `oregano-greek` | zone `5` | Illinois Extension ("True oregano is marginally hardy in zone 5") is warmer than the NC State Plant Toolbox (4a), so 5 is stored. |
| `fennel-bulb-perfection`, `fennel-florence-zefa-fino` | `annual` | Illinois Extension calls Florence fennel annual; the NC State Plant Toolbox lists Foeniculum vulgare, with Florence fennel among its names, as a perennial. Kept as annual on the bulb-fennel text. A source on bulb fennel that says perennial would need a panel ruling. |
| `basil-genovese`, `marjoram-sweet`, `stevia-sweetleaf`, `tulsi-holy-basil-rama` | as stored | The NC State Plant Toolbox lists "Annual / Perennial" for each; the stored value is the one the in-region source or the page description names. |
