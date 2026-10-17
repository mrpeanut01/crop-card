## Task 37F: herb pruning and harvest steps (Care Guide and photo help)

Phase 37F shows a crop's own pruning and harvest steps in the Care Guide, in "Ask about a photo" with no Claude key, and as the caption under the growth-habit line drawing. They live on the crop plugin as `careTasks` (`{ key, topic: 'prune' | 'harvest', title, body? }`, schema in `packages/plugin-validation/src/schemas.ts`, block marked `// Phase 37F`). Read `CLAUDE.md` first; invariant 9 (Spanish) and the crop data rules apply.

### What already shipped (2026-10-17)

Every herb below carries steps quoted word for word from University of Illinois Extension "Herbs" pages (`https://extension.illinois.edu/herbs/<herb>`), cross-checked against the University of Maryland Extension pages (`https://extension.umd.edu/resource/<herb>`) for the first eleven; nothing they disagree on was shipped. Basil also keeps `pinch-stems` from the UMD basil page (moved from the family tip `herb-culinary.prune.0`, ruling R-20).

`basil-genovese`, `rosemary-tuscan-blue`, `parsley-italian-flat-leaf`, `mint-spearmint`, `thyme-german-winter` (prune only), `oregano-greek`, `sage-broadleaf`, `chives-common`, `dill-mammoth`, `lavender-english-munstead`, `catnip-common`, `chervil`, `fennel-bulb-perfection`, `fennel-florence-zefa-fino`, `lemon-balm`, `lemon-verbena`, `lovage`, `marjoram-sweet`, `summer-savory`, `tarragon-french`.

### What is still missing

| Plugin | Field | Why it is empty | Candidate pages |
| --- | --- | --- | --- |
| `thyme-german-winter` | `careTasks` harvest | Sources disagree: Illinois "best cut just before the plant starts to flower"; UMD "Cut leafy tops and flower clusters when first blossoms open". | VCE 426-420 "Herbs" (pubs.ext.vt.edu), hort.extension.wisc.edu, NC State "harvesting-and-preserving-herbs-for-the-home-gardener" |
| `cilantro-santo` | `careTasks` prune and harvest | The Illinois sentence reads "Entire plants of individual leaves can be cut when plants get to be about six inches tall" (a typo for "or"), which a grower cannot follow word for word; the UMD cilantro page has no text. | VCE 426-420, extension.umn.edu, NC State, hgic.clemson.edu |
| `rosemary-tuscan-blue` | a second prune step | Only "Pruning the plants will encourage a tight compact habit." shipped. | https://hort.extension.wisc.edu/articles/rosemary/, VCE 426-420 |
| `lemongrass-east-indian` | `careTasks` | The Illinois page covers lemon grass in general and a grocery-store stem, which is West Indian (*Cymbopogon citratus*); the plugin is East Indian (*C. flexuosus*). | A page naming East Indian lemongrass |
| `tulsi-holy-basil-rama` | `careTasks` | Pages found are for sweet basil (*Ocimum basilicum*), not holy basil. | A page naming holy basil or tulsi |
| `anise-hyssop`, `bergamot-monarda`, `hyssop-officinalis`, `mountain-mint`, `perilla-shiso-green`, `stevia-sweetleaf` | `careTasks` | No Illinois herb page; not looked for elsewhere yet. | extension.umn.edu, hgic.clemson.edu, extension.psu.edu, extension.usu.edu, extension.oregonstate.edu, extension.colostate.edu, njaes.rutgers.edu |
| `chamomile-german`, `calendula-resina` | `careTasks` harvest | Not looked for yet (the flowers are the crop). | Same hosts |
| `lavender-english-munstead`, `hyssop-officinalis`, `oregano-greek` and the other herbs | `growthHabit` (`woody` or `clumping`) | Shipped only where an Illinois page says it: thyme, sage and rosemary `woody`, chives `clumping`. Every other herb shows the cut-and-come-again leafy drawing (its archetype). Illinois calls lavender "bushy" and UMD a "sub-shrub", neither "woody". | The same hosts |

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
