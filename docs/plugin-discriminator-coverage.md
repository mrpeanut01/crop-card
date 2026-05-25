# Plugin discriminator coverage (Phase 25c.0)

Generated: 2026-05-24T22:22:47.826Z

Tracks coverage of the Phase 25c renderer-dispatch + Phase 25d gate-evaluator
discriminator fields across the plugin corpus. Per the [#87 plan](https://github.com/mrpeanut01/crop-card/issues/87),
Zod fields stay **optional** until coverage reaches ≥95%, then they are promoted
to required so future uploads must declare them. `FallbackHarvestRenderer` becomes
defensive-only after the promotion.

Regenerate with: `pnpm audit:plugins`

## Summary

| Plugin type | Total | Field | Coverage |
| --- | ---: | --- | ---: |
| Crop | 376 | growthStageTable.system | 0.8% (3/376) |
| Crop | 376 | harvestStyle | 100.0% (376/376) |
| Crop | 376 | postHarvestCuring (presence) | 2.4% (9/376) |
| Crop | 376 | bloomWindow | 100.0% (376/376) |
| Insecticide | 70 | scoutingThresholds | 91.4% (64/70) |
| Fungicide | 64 | activeIngredients[].fracCode (all set) | 100.0% (64/64) |

## Crop coverage by family

| Family | Total | growthStageTable | harvestStyle | postHarvestCuring | bloomWindow |
| --- | ---: | ---: | ---: | ---: | ---: |
| allium | 21 | 0.0% | 100.0% | 9.5% | 100.0% |
| apiaceae | 10 | 0.0% | 100.0% | 0.0% | 100.0% |
| bramble | 4 | 0.0% | 100.0% | 0.0% | 100.0% |
| brassica | 33 | 0.0% | 100.0% | 0.0% | 100.0% |
| broadleaf-companion | 26 | 0.0% | 100.0% | 0.0% | 100.0% |
| cereal-grain | 17 | 5.9% | 100.0% | 0.0% | 100.0% |
| corn | 17 | 11.8% | 100.0% | 5.9% | 100.0% |
| cover-grass | 6 | 0.0% | 100.0% | 0.0% | 100.0% |
| cover-legume | 11 | 0.0% | 100.0% | 0.0% | 100.0% |
| cucurbit | 41 | 0.0% | 100.0% | 4.9% | 100.0% |
| culinary-herb | 12 | 0.0% | 100.0% | 0.0% | 100.0% |
| forage | 7 | 0.0% | 100.0% | 0.0% | 100.0% |
| herb-culinary | 8 | 0.0% | 100.0% | 0.0% | 100.0% |
| leafy-green | 19 | 0.0% | 100.0% | 0.0% | 100.0% |
| legume | 20 | 0.0% | 100.0% | 0.0% | 100.0% |
| orchard | 18 | 0.0% | 100.0% | 11.1% | 100.0% |
| root | 15 | 0.0% | 100.0% | 6.7% | 100.0% |
| small-fruit | 18 | 0.0% | 100.0% | 0.0% | 100.0% |
| solanaceae | 58 | 0.0% | 100.0% | 1.7% | 100.0% |
| stone-fruit | 7 | 0.0% | 100.0% | 0.0% | 100.0% |
| vine-fruit | 8 | 0.0% | 100.0% | 0.0% | 100.0% |

## Missing coverage — crop harvestStyle (top 50)

_All crop plugins have `harvestStyle` set._ ✓

## Missing coverage — crop bloomWindow (top 50)

_All crop plugins have `bloomWindow` set._ ✓

## Missing coverage — insecticide scoutingThresholds

- `bt.json`
- `deadline-mps-metaldehyde.json`
- `majestene-nematicide.json`
- `sluggo-iron-phosphate.json`
- `spinosad.json`
- `velum-prime-fluopyram-nematicide.json`

## Missing coverage — fungicide fracCode

_All fungicide plugins have FRAC codes on every active ingredient._ ✓

