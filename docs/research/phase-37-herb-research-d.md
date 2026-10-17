# Phase 37D research: when to do what (the herb calendar)

Section 37D of the Phase 37 herb research prompt. Read `CLAUDE.md` and `docs/design/PHASE_37_HERB_GARDEN_PLAN.md` (rulings R-8, R-18, R-25) first. The extension hosts were opened to this cluster on 2026-10-17, so most of 37D's data shipped with the code. This file lists only what is still missing.

## What already shipped (do not redo)

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

## The gate every new row must pass

A row on any `HERB_PLUGIN_IDS` plugin (`apps/web/src/lib/garden/herbs.ts`) ships only when all of these pass:

1. `herbSeasonalRowSourceGaps` (`apps/web/src/lib/plugins/sourceCoverage.ts`, test `herbSeasonalRows.gate.test.ts`). The row needs a source entry `{ url, publisher, date, quote, note? }` at `crop-data-sources.json` → `<pluginId>` → `seasonalTasks.<rowKey>`. The url must be on an `.edu` or `.gov` host. The quote must contain a word that starts with the first four letters of the row title's first word: "Pinch" matches "pinching" and "Divide" matches "divided". The quote must also name the herb by a word of four or more letters from its display name (a trailing "s" is dropped, and words in parentheses count).
2. `seasonalTaskNumberGaps`: every digit in the title or body must appear in the quote. "3 to 4" is satisfied by "3-4".
3. `seasonalTaskWordingProblems`: no spray kind or category, and no pesticide, oil or "label" wording.
4. `seasonalTaskText.test.ts`: the row's English goes in `apps/web/src/lib/i18n/catalogs/en/seasonal.ts` under `seasonal.<pluginId>.<rowKey>.<title|body>`, with Spanish in `es/seasonal.ts` (tú form, crop names as in `cropNames.es.ts`).
5. The plugin's patch version is bumped. A brand-new row needs no text-refresh migration.

Every quote must be copied word for word from the page text: the weekly source-drift job re-checks them. A frost-keyed action (bring indoors before frost) is never a row (R-18). It is the `bring-indoors` engine event, fed by 37B's `tender-perennial` verdict.

## Still missing

| Plugin | Wanted row | Why it is not shipped | Candidate pages |
| --- | --- | --- | --- |
| mint-spearmint | Cut mint back mid-season | Illinois only says "the more frequently the stems are cut the more new growth is produced", which is a harvest note, not a seasonal action | extension.umn.edu herb or mint pages; extension.umd.edu mint page; VCE 426-420 "Herbs" at pubs.ext.vt.edu |
| cilantro-santo | Sow cilantro in cooler weather or in shade during heat | Illinois's row ships, but no page read says what to do in heat | extension.umn.edu/planting-and-growing-guides/gardening-hot-weather; extension.umd.edu cilantro page |
| rosemary-tuscan-blue | Light pruning or pinching for shape | UW-Madison and Illinois say pruning shapes the plant but give no season | hgic.clemson.edu rosemary; extension.oregonstate.edu |
| lemon-verbena, lemongrass-east-indian, sweet marjoram, summer-savory | Bring indoors before frost | These are frost-keyed, so they are 37B data: a `winterHardyToZone` (or the `tender-perennial` verdict) makes the engine emit `bring-indoors`. Illinois states "Move the plant indoors before frost" (lemon verbena) and "Before frost, move the plant indoors" (lemon grass) | extension.illinois.edu/herbs/lemon-verbena, /lemon-grass, /marjoram-sweet, /savory-summer |
| anise-hyssop, bergamot-monarda, hyssop-officinalis, mountain-mint, perilla-shiso-green, stevia-sweetleaf, tulsi-holy-basil-rama, lovage, fennel-bulb-perfection, fennel-florence-zefa-fino, chamomile-german, calendula-resina | Any pinch, cut-back, divide or succession row | No page read states a seasonal action for the crop (Illinois's lovage and fennel pages give culture only) | content.ces.ncsu.edu; extension.umd.edu; hgic.clemson.edu; extension.usu.edu; njaes.rutgers.edu; yardandgarden.extension.iastate.edu |
| every row above | A sourced placement (month or growth stage) | The pages give "early spring", "mid-summer" or "November or December". `dayOfYear` and `daysAfterPlanting` are typical placements, so the calendar shows them as "Typical timing. Adjust to your farm." (OP-22). A day-level source would not change that label. | none needed unless OP-22 changes |

## Shipped with a weak second source

- `bringIndoorsLead` rests on one page, about rosemary. A second agreeing .edu page, giving a lead for tender herbs in general, would strengthen it. Candidates: extension.umn.edu herb pages; hgic.clemson.edu "Growing herbs indoors". Keep the low end of any range. If two sources disagree, record both in the entry's `note` and keep the stricter (longer) lead.
