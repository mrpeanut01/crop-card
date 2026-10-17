## Task 37A: the garden brief (sun need, optional)

The garden brief (`/plan/brief`, Phase 37A) asks a beginner how much sun the herb spot gets (full sun, about half a day, mostly shade). Per ruling R-19 the answer filters nothing today: no crop plugin says how much sun it needs, so the page only shows "No herb in the library says how much sun it needs yet, so this list is not sorted by sun". The cuisine and goal tables in `apps/web/src/lib/garden/brief/shortlist.ts` are editorial product rulings, not agronomy, and need no source. Nothing else in 37A carries a number, a zone or a timing.

This task is optional. Do it only after the 37B to 37F data tasks.

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
