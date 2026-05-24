# Plugin discriminator coverage (Phase 25c.0)

Generated: 2026-05-24T21:34:21.936Z

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
| Crop | 376 | harvestStyle | 71.8% (270/376) |
| Crop | 376 | postHarvestCuring (presence) | 2.4% (9/376) |
| Crop | 376 | bloomWindow | 21.0% (79/376) |
| Insecticide | 70 | scoutingThresholds | 0.0% (0/70) |
| Fungicide | 64 | activeIngredients[].fracCode (all set) | 100.0% (64/64) |

## Crop coverage by family

| Family | Total | growthStageTable | harvestStyle | postHarvestCuring | bloomWindow |
| --- | ---: | ---: | ---: | ---: | ---: |
| allium | 21 | 0.0% | 100.0% | 9.5% | 0.0% |
| apiaceae | 10 | 0.0% | 0.0% | 0.0% | 0.0% |
| bramble | 4 | 0.0% | 100.0% | 0.0% | 0.0% |
| brassica | 33 | 0.0% | 93.9% | 0.0% | 6.1% |
| broadleaf-companion | 26 | 0.0% | 0.0% | 0.0% | 0.0% |
| cereal-grain | 17 | 5.9% | 100.0% | 0.0% | 0.0% |
| corn | 17 | 11.8% | 100.0% | 5.9% | 0.0% |
| cover-grass | 6 | 0.0% | 100.0% | 0.0% | 0.0% |
| cover-legume | 11 | 0.0% | 100.0% | 0.0% | 100.0% |
| cucurbit | 41 | 0.0% | 26.8% | 4.9% | 100.0% |
| culinary-herb | 12 | 0.0% | 0.0% | 0.0% | 0.0% |
| forage | 7 | 0.0% | 14.3% | 0.0% | 0.0% |
| herb-culinary | 8 | 0.0% | 100.0% | 0.0% | 0.0% |
| leafy-green | 19 | 0.0% | 100.0% | 0.0% | 0.0% |
| legume | 20 | 0.0% | 40.0% | 0.0% | 0.0% |
| orchard | 18 | 0.0% | 100.0% | 11.1% | 100.0% |
| root | 15 | 0.0% | 100.0% | 6.7% | 0.0% |
| small-fruit | 18 | 0.0% | 100.0% | 0.0% | 0.0% |
| solanaceae | 58 | 0.0% | 86.2% | 1.7% | 0.0% |
| stone-fruit | 7 | 0.0% | 100.0% | 0.0% | 100.0% |
| vine-fruit | 8 | 0.0% | 100.0% | 0.0% | 0.0% |

## Missing coverage — crop harvestStyle (top 50)

- `acorn-squash-table-queen.json` (cucurbit)
- `amaranth-burgundy.json` (broadleaf-companion)
- `bean-kentucky-blue-pole-seed-standard-cruiser-treated-1-000-seed.json` (legume)
- `bmr-sorghum-sudan.json` (forage)
- `bush-bean-provider.json` (legume)
- `bush-bean-roma-ii.json` (legume)
- `calendula-resina.json` (broadleaf-companion)
- `cantaloupe-ambrosia-f1.json` (cucurbit)
- `cantaloupe-hales-best.json` (cucurbit)
- `celeriac-brilliant.json` (apiaceae)
- `celery-tall-utah-52-70.json` (apiaceae)
- `chamomile-german.json` (broadleaf-companion)
- `chervil.json` (apiaceae)
- `cilantro-santo.json` (apiaceae)
- `clover-red-mammoth.json` (forage)
- `collards-georgia-southern.json` (brassica)
- `cosmos-double-click.json` (broadleaf-companion)
- `dahlia-cafe-au-lait.json` (broadleaf-companion)
- `dill-mammoth.json` (apiaceae)
- `echinacea-purpurea.json` (broadleaf-companion)
- `edamame-tohya.json` (legume)
- `eucalyptus-silver-dollar.json` (broadleaf-companion)
- `fairytale-pumpkin-film-coated-treated-seed.json` (cucurbit)
- `fennel-bulb-perfection.json` (apiaceae)
- `fennel-florence-zefa-fino.json` (apiaceae)
- `field-pea-aragorn.json` (legume)
- `flax-grain-omega.json` (broadleaf-companion)
- `ground-cherry-aunt-mollys.json` (solanaceae)
- `hyssop-officinalis.json` (culinary-herb)
- `lavender-english-munstead.json` (culinary-herb)
- `lemon-balm.json` (culinary-herb)
- `lemon-verbena.json` (culinary-herb)
- `lemongrass-east-indian.json` (culinary-herb)
- `lentil-pardina.json` (legume)
- `lisianthus-arena.json` (broadleaf-companion)
- `lovage.json` (apiaceae)
- `luffa-gourd.json` (cucurbit)
- `madder-dye.json` (broadleaf-companion)
- `marjoram-sweet.json` (culinary-herb)
- `marshmallow-althaea.json` (broadleaf-companion)
- `melon-charentais-savor.json` (cucurbit)
- `melon-galia.json` (cucurbit)
- `melon-honeydew-tam-dew.json` (cucurbit)
- `microgreens-pea-shoots.json` (legume)
- `microgreens-sunflower-shoots.json` (broadleaf-companion)
- `milk-thistle-medicinal.json` (broadleaf-companion)
- `mountain-mint.json` (culinary-herb)
- `mustard-greens-southern-giant-curled.json` (brassica)
- `nasturtium-companion.json` (broadleaf-companion)
- `okra-clemson-spineless.json` (broadleaf-companion)
- _…and 56 more_

## Missing coverage — crop bloomWindow (top 50)

- `alfalfa-vernema.json` (forage)
- `amaranth-burgundy.json` (broadleaf-companion)
- `arugula-astro.json` (brassica)
- `arugula-rocket.json` (leafy-green)
- `asparagus-jersey-knight.json` (allium)
- `asparagus-millennium.json` (allium)
- `asparagus-purple-passion.json` (allium)
- `barley-grain-thoroughbred.json` (cereal-grain)
- `basil-genovese.json` (herb-culinary)
- `bean-kentucky-blue-pole-seed-standard-cruiser-treated-1-000-seed.json` (legume)
- `beet-chioggia.json` (root)
- `beet-detroit-dark-red.json` (root)
- `black-bean-black-turtle.json` (legume)
- `blackberry-prime-ark-freedom.json` (bramble)
- `blackberry-triple-crown.json` (bramble)
- `bloody-butcher-ornamental-corn-raw-untreated-non-gmo-1-2-lb.json` (corn)
- `blueberry-bluecrop.json` (small-fruit)
- `blueberry-duke-northern-highbush.json` (small-fruit)
- `bmr-sorghum-sudan.json` (forage)
- `broccoli-de-cicco.json` (brassica)
- `broccoli-raab-rapini.json` (brassica)
- `broomcorn-mennonite.json` (cereal-grain)
- `brussels-sprouts-jade-cross-f1.json` (brassica)
- `brussels-sprouts-long-island.json` (brassica)
- `buckwheat-cover.json` (cover-grass)
- `bush-bean-provider.json` (legume)
- `bush-bean-roma-ii.json` (legume)
- `cabbage-early-jersey-wakefield.json` (brassica)
- `cabbage-savoy-king.json` (brassica)
- `cabbage-storage-no-4-f1.json` (brassica)
- `calendula-resina.json` (broadleaf-companion)
- `carrot-chantenay-red-cored.json` (root)
- `carrot-cosmic-purple.json` (root)
- `carrot-nantes-half-long.json` (root)
- `carrot-rainbow-mix.json` (root)
- `carrot-scarlet-nantes-seed.json` (root)
- `cauliflower-snowball-y.json` (brassica)
- `celeriac-brilliant.json` (apiaceae)
- `celery-tall-utah-52-70.json` (apiaceae)
- `cereal-rye-cover.json` (cover-grass)
- `chamomile-german.json` (broadleaf-companion)
- `chervil.json` (apiaceae)
- `chives-common.json` (herb-culinary)
- `cilantro-santo.json` (apiaceae)
- `clover-red-mammoth.json` (forage)
- `collards-georgia-southern.json` (brassica)
- `corn-bantam-sweet.json` (corn)
- `corn-bloody-butcher.json` (corn)
- `corn-feed-dent-pioneer.json` (corn)
- `corn-sweet-bodacious.json` (corn)
- _…and 247 more_

## Missing coverage — insecticide scoutingThresholds

- `acramite-bifenazate.json`
- `actara.json`
- `admiral-igr.json`
- `admire-pro.json`
- `agrimek-sc.json`
- `altacor-chlorantraniliprole.json`
- `apollo-clofentezine.json`
- `applaud-buprofezin.json`
- `asana-xl.json`
- `assail-30sg.json`
- `avaunt-evo.json`
- `aza-direct.json`
- `azaguard.json`
- `baythroid-xl.json`
- `belay.json`
- `beleaf-50sg.json`
- `botanigard-es-beauveria.json`
- `brigade-2ec.json`
- `bt.json`
- `closer-sc.json`
- `confirm-2f-tebufenozide.json`
- `coragen.json`
- `cyd-x-codling-moth-virus.json`
- `deadline-mps-metaldehyde.json`
- `dimethoate-4ec.json`
- `dimilin-2l.json`
- `dipel-df.json`
- `entrust-sc.json`
- `envidor-spirodiclofen.json`
- `exirel.json`
- `fulfill-pymetrozine.json`
- `grandevo-wdg.json`
- `intrepid-edge.json`
- `isomate-c-plus-pheromone.json`
- `javelin-wg.json`
- `jms-stylet-oil-omri.json`
- `jms-stylet-oil.json`
- `kanemite-acequinocyl.json`
- `lannate-lv.json`
- `m-pede-organic.json`
- `m-pede.json`
- `madex-hp-virus.json`
- `majestene-nematicide.json`
- `met52-ec-metarhizium.json`
- `movento.json`
- `mustang-maxx.json`
- `mycotrol-eso.json`
- `nematode-steinernema-feltiae.json`
- `oberon-spiromesifen.json`
- `onager-hexythiazox.json`
- _…and 20 more_

## Missing coverage — fungicide fracCode

_All fungicide plugins have FRAC codes on every active ingredient._ ✓

