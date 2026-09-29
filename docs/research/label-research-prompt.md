# CropCard: plugin label research (local agent)

You are working in a local checkout of `mrpeanut01/crop-card` (SvelteKit + TypeScript, pnpm, Node 22). Your job is to replace guesses and gaps in the plugin library with facts read from primary sources: product labels, EPA's Pesticide Product Label System (PPLS), manufacturer technical sheets, and the OMRI Products List. A cloud agent already did everything it could from search-result snippets; it could not open label PDFs. You can, so the remaining work is yours.

Read `CLAUDE.md` first. Invariants 1, 2 and 6 matter most here: plugins are data only, every plugin must pass schema validation, and nothing you write can weaken the safety kernel.

## Ground rules

- **Primary sources only.** A value goes into a plugin only if you read it on the product label (PPLS PDF or manufacturer label) or, for rainfast intervals only, a manufacturer technical sheet for that exact product. Search snippets, distributor pages and AI summaries don't count. If sources disagree, leave the field empty and write down both values.
- **Record provenance for every value.** Extend `apps/web/scripts/epa-reg-sources.json`, which is keyed by pluginId. Add one entry per field you fill: the source URL, the label or document date, and a short quote or page reference. A value with no provenance entry will be reverted.
- **Minimal diffs.** Insert or edit only the field you're filling. Don't reformat plugin JSON. `apps/web/scripts/backfill-plugin-metadata.mjs` and `backfill-pollinator.mjs` show the single-line insert pattern.
- **Keep the gate honest.** `apps/web/scripts/plugin-metadata-allowlist.json` lists known gaps, each with a reason. When you fill a gap, delete its allowlist entry; the coverage test fails on stale entries. When you conclude a gap should stay, rewrite its reason to say what you checked and why it stays.
- **Safety-relevant data gets the stricter reading.** For pollinator hazard, take the more protective class whenever the label is ambiguous.
- **Don't touch app code** except where a task below says so. No migrations.

## Verification (run before every commit)

```sh
pnpm install --frozen-lockfile
pnpm --filter @cropcard/web audit:plugin-metadata        # coverage table
pnpm --filter @cropcard/web exec vitest run src/lib/plugins tests/integration/seedLibrary.test.ts
pnpm typecheck && pnpm lint
pnpm test:unit
```

Commit each task separately. Open one PR per task, or one PR with a commit per task, against `main`. The PR gate (`ci.yml`, job `test`) must be green. The repo owner's standing instruction: fix any CI failure yourself and merge once the PR is clean and green.

---

## Task 1: EPA registration numbers (issue #381, 42 remaining)

The field is `epaRegistrationNumber` on herbicide, insecticide and fungicide plugins, format `NNN-NNN` or `NNN-NNN-NNN`. PPLS label file names encode it: `…/ppls/000264-01050-YYYYMMDD.pdf` is `264-1050`. Open the PDF and confirm the brand name and formulation on the label itself.

**Probably stays allowlisted (15).** These are generic, exempt or test plugins. Confirm the reason and keep the entry unless the plugin clearly names a single registrant:

`2-4-d-amine`, `24d`, `atrazine-4l-generic`, `clethodim-2e-generic`, `clethodim-2e`, `clethodim`, `glyphosate-generic`, `mesotrione-4sc`, `bt-kurstaki`, `spinosad`, `sulfur-90w` (generic, many registrants); `corn-gluten-meal-pre` (FIFRA 25(b) exempt); `nematode-steinernema-feltiae`, `trichogramma-egg-parasitoid` (macro-organisms); `ct-test-herbicide-clickthrough` (test fixture).

**Needs a label check (27).** Resolve each one, or record why it can't be resolved.

| Plugin               | What's unresolved                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engenia`            | PPLS lists 7969-345, 7969-472 and 7969-507 after the 2024 dicamba vacatur. Find the registration that is currently valid for over-the-top use.                                        |
| `xtendimax`          | 264-1210 was vacated in 2024. Find its current status and any successor. If nothing is currently registered, set `status` retired per the plugin spec rather than inventing a number. |
| `banvel`             | Several Banvel variants exist (4-S, SGF, potassium). Match the formulation the plugin's rate and data describe.                                                                       |
| `gramoxone-sl-3`     | PPLS has "Gramoxone 3LB" (100-1652) and "Gramoxone SL 2.0". Confirm whether "SL 3.0" is 100-1652's current brand name.                                                                |
| `me-too-lachlor-ii`  | Drexel has 19713-548 and 19713-549 (truncated title). Open both labels.                                                                                                               |
| `treflan-trust-ec`   | The plugin covers two brands with two registrants. Consider splitting the plugin, or document the choice.                                                                             |
| `valor-sx`           | PPLS titles read "Valor Herbicide" (59639-99). Confirm SX is that registration.                                                                                                       |
| `anthem-maxx`        | Only an untitled 279-3450 letter found. Open it.                                                                                                                                      |
| `liberty-ultra`      | Only candidate is 7969-500 ("BASF L-Glufosinate…"). Confirm the Liberty ULTRA brand.                                                                                                  |
| `permit`             | PPLS results are Permit Plus / halosulfuron / Sedgehammer. Find plain Permit.                                                                                                         |
| `roundup-powermax-3` | Candidate 524-659 is titled "MON 301108". Confirm the brand on the label.                                                                                                             |
| `stadia`             | No PPLS result titled Stadia.                                                                                                                                                         |
| `stadia-dry`         | Placeholder plugin (`stadia-active-ingredient`). Decide whether to delete, merge into `stadia`, or keep allowlisted.                                                                  |
| `warrant`            | Candidate 524-591 is titled "MON 63410". Confirm the brand.                                                                                                                           |
| `admire-pro`         | Likely 264-827, but the title is truncated. Open the label.                                                                                                                           |
| `aza-direct`         | No PPLS title found. Check the Gowan label.                                                                                                                                           |
| `belay`              | Clothianidin labels are titled by Valent development codes. Find Belay's.                                                                                                             |
| `lannate-lv`         | 352-384 (DuPont) and 61842-55 (2024–2025). Pick the current registrant.                                                                                                               |
| `mustang-maxx`       | Candidate 279-3426 is titled "F9114 EC". Confirm the brand.                                                                                                                           |
| `sivanto-prime`      | PPLS titles are Sivanto 200 SL (264-1141) and 400 SL (264-1198). Confirm which is sold as Prime.                                                                                      |
| `bravo-weather-stik` | PPLS title is "Bravo 720" (50534-188). Confirm.                                                                                                                                       |
| `captan-80wdg`       | At least five registrants. Pick one only if the plugin names a manufacturer; otherwise keep it allowlisted as generic.                                                                |
| `flint-extra`        | PPLS shows "Flint Fungicide" (264-777). Find Flint Extra.                                                                                                                             |
| `indar-2f`           | Only a Michigan 24(c) SLN found. Find the federal registration.                                                                                                                       |
| `kocide-3000-o`      | PPLS shows Kocide 3000 (91411-2, 352-662). Find the -O (organic) product.                                                                                                             |
| `quadris-flowable`   | Titles are Abound (100-1098) and Quadris Top. Confirm the Quadris Flowable registration.                                                                                              |
| `topsin-m-wsb`       | 8033-125 (2020) and 73545-16 (2009). Pick the current one.                                                                                                                            |

When a brand has changed hands, use the registrant the plugin name points to. Say so in the provenance note.

## Task 2: pollinator hazard for 17 insecticides

The safety gate (`apps/web/src/lib/safety/pollinatorProtection.ts`) treats these plugins with a conservative fallback because they have no `pollinator` block. Read each label's Environmental Hazards and bee statements and add:

```json
"pollinator": { "beeToxicity": "highly-toxic|toxic|relatively-nontoxic|unknown", "bloomRestriction": "prohibited-during-bloom|dusk-to-dawn-only|none", "residualToxicityHours": 3 }
```

`residualToxicityHours` is optional. Field semantics are in `docs/plugin-spec.md` §5.3. If a label restricts larvae or brood but not adults (spirotetramat labels, for example), use the stricter class and explain it in the note. This is a data change, not a kernel rule change, so don't bump `RULES_VERSION`. Do run the pollinator tests: `vitest run src/lib/safety/pollinatorProtection`.

`spear-lep`, `met52-ec-metarhizium`, `grandevo-wdg`, `aza-direct`, `azaguard`, `dimilin-2l`, `acramite-bifenazate`, `oberon-spiromesifen`, `venerate-xc`, `majestene-nematicide`, `movento`, `portal-xlo`, `kanemite-acequinocyl`, `admiral-igr`, `pfr-97-isaria`, `velum-prime-fluopyram-nematicide`, `envidor-spirodiclofen`.

## Task 3: fungicide rainfast intervals (57 of 64 missing)

The optional field `rainfastHours` drives the `/spray/fungicide` dry-window gate; the default is 4 h. Fill it only where the label or manufacturer technical sheet for that exact product states a rainfast interval. Known disagreements to settle from the label: Quadris (4 h vs 1 h), Zampro (1 h vs 2 h). Skip generics. Run `pnpm --filter @cropcard/web audit:plugin-metadata` or list `plugins/fungicides/*.json` lacking the field to get the work list.

## Task 4: formulation (140) and defaultUnit (24) gaps

These are the `formulation` and `defaultUnit` entries in `plugin-metadata-allowlist.json`. Take the formulation code (EC, SL, SC, WDG, WP, …) from the label's product name or first page. The allowed codes and their liquid/dry mapping are in `packages/plugin-validation/src/schemas.ts`. Set `defaultUnit` to the unit the product is sold and measured in, consistent with the label rate unit. The `oz` rates are ambiguous between fluid and dry ounces; the formulation settles which. The entries flagged "plugin data looks wrong" need a closer read: an `oz` rate on counted items, an `lb` rate on live nematodes, `dithane-rainshield` named F45 with an `lb` rate, and `can-17-calcium-ammonium-nitrate` marked liquid with an `lb` rate. Fix the rate data if the label shows it's wrong, and note that in the PR.

## Task 5: organic compliance flags (90 pesticides)

The inputs-plan philosophy filter reads `complianceFlags` (`omriListed`, `certifiedOrganicAllowed`, `transitioningAllowed`, `nonGmoCompliant`, `notes`; schema in `schemas.ts`). Currently missing on 24 herbicides, 20 insecticides and 46 fungicides. Use the OMRI Products List (omri.org) for `omriListed` and the label's organic statement. Set `certifiedOrganicAllowed: true` only for OMRI-listed or NOP-compliant products. Conventional products get `omriListed: false, certifiedOrganicAllowed: false`. Leave `transitioningAllowed` unset unless a source addresses it. Put the OMRI listing or label reference in `notes`.

## Task 6 (optional, needs network): real NWS weather payloads

`apps/web/src/lib/server/__fixtures__/nws-points-lwx.json` and `nws-gridpoint-lwx.json` were written by hand because the cloud environment couldn't reach `api.weather.gov`. Fetch real `/points/39.1157,-77.5636` and `forecastGridData` responses (send a `User-Agent` header, as `weather.ts` does). Replace the fixtures with them, trimmed to about 5 days. Then run `vitest run src/lib/server/weatherHourly.test.ts src/lib/weather`. If field shapes differ from the fixtures, fix `weatherHourly.ts` and its tests. That would be a real production bug, so call it out.

## Task 7 (macOS only): darwin visual baselines

The `*-darwin.png` screenshots in `apps/web/tests/e2e/visual/**` went stale when fonts became self-hosted. On a Mac, run `E2E_VISUAL=1 pnpm --filter @cropcard/web exec playwright test tests/e2e/visual --update-snapshots=all`. Commit only the `-darwin.png` files. Leave the Linux baselines alone; CI owns those through `visual.yml`.

## Task 8: housekeeping

A leftover stash named `agent-adcf-crops-const` exists. Its contents are already on main. Confirm with `git stash show -p` against `main`, then drop it.

## Task 9: animal-health withdrawal times (Phase 32, on the critical path)

The animal safety kernel coming in sprint 32C refuses to let eggs, milk or meat be used for food while a treated animal is inside its withdrawal period. The kernel treats a product with no withdrawal data as unknown, and unknown blocks. So this task decides which products CropCard can support at all. None of the numbers in the Phase 32 research reports have been checked. Treat them as leads, never as answers.

**Where values go.** Write one `plugins/animal-health/<pluginId>.json` per product you fully verify, following `schemas/animal-health.schema.json` (Zod source: `animalHealthPluginSchema` in `packages/plugin-validation/src/schemas.ts`). Every `labelUses[].speciesId` must name a species plugin in `plugins/species/`, which sprint 32B adds. If 32B has not landed, record your findings in the sources file only and leave the plugin JSON for 32C. For every value, add a quote to `apps/web/scripts/animal-health-sources.json` under `entries.<pluginId>` with the key `withdrawal.<speciesId>.<class>.<field>`. The fields are `meatDays`, `milkHours` and `eggsDays`, plus `doNotUseFor` when the label says "do not use in lactating dairy cattle" or "not for use in laying hens". Each entry is `{ "url", "publisher", "date", "quote", "note"? }`.

**Sources.** Use the current label on FDA Animal Drugs @ FDA (the NADA or ANADA record), DailyMed's animal labels, or the manufacturer's label PDF for that exact product and concentration. Distributor pages, forum posts and summary tables don't count. If two current labels for the same product disagree, leave the value out and write down both.

**Seed set: ten products at most.** Pick common over-the-counter products a small farm or homestead actually buys, covering poultry, goats, sheep, cattle and pigs. Good places to start are the ivermectin, fenbendazole, levamisole and morantel dewormers, amprolium for coccidiosis, a permethrin pour-on or spray, and a clostridial (CD&T) vaccine. For each candidate, confirm that it is still sold over the counter. Many antibiotics moved to prescription in June 2023 under FDA GFI #263, so check the current status rather than assuming. Also confirm which species and classes the label names. Drop any product whose label you cannot open. Core dog and cat vaccines may ship with no withdrawal, but only when every species on the label is a non-food species.

**Rules for this task.**

- Record every species and class on the label. A plugin that lists a food species without a sourced withdrawal fails the CI gate (`sourceCoverage.gate.test.ts`), and that is intended.
- Use the longest withdrawal where the label gives more than one for a class (by route or dose, for example). Say which one you used in `note`.
- Never add a field the schema doesn't have. The schema is strict, and the kernel, not the plugin, decides what an unknown or extra-label use means.
- Withdrawal numbers never come from a label scan, AI or memory.

**The FDA prohibited list.** Read the current 21 CFR 530.41 on eCFR (ecfr.gov). Record the full list of drugs prohibited from extra-label use in food-producing animals, with the eCFR "up to date as of" date and a quote, as a top-level `prohibitedExtraLabel` object in `animal-health-sources.json`: `{ "url", "date", "quote", "drugs": [ ... ] }`. Do not put it in any plugin.

**The kernel's copy must be checked against the current eCFR.** Sprint 32C had no internet access, so the list in `apps/web/src/lib/safety/prohibitedAnimalDrugs.ts` (`PROHIBITED_EXTRA_LABEL_DRUGS`, RULES_VERSION 0.6.0, now 0.7.0) was written from memory and errs toward including a drug when unsure. Compare it paragraph by paragraph with the current 21 CFR 530.41: each entry's `cfr` paragraph number, the drug or class it names, the species it is limited to (cephalosporins: cattle, swine, chickens, turkeys; adamantanes and neuraminidase inhibitors: chickens, turkeys, ducks), the conditions (sulfonamides in lactating dairy cattle with the sulfadimethoxine, sulfabromomethazine and sulfaethoxypyridazine exceptions; phenylbutazone in female dairy cattle 20 months or older; furazolidone and nitrofurazone except approved topical use; cephapirin excluded), and which entries have approved food-animal labels (`onLabelExempt`). The brand names and class members listed under each paragraph are search aids and also need a check. Report every difference; any change to the table is a kernel change and needs a RULES_VERSION bump and updated tests in `prohibitedAnimalDrugs.test.ts`. The kernel applies an `onLabelExempt` entry per food: a plugin's label use exempts a food only when it names the species, the route and a class that covers that food (milk needs `all` or `lactating-dairy`, eggs `all` or `laying`), so record each label's classes exactly as printed.

Run `pnpm --filter @cropcard/web exec vitest run src/lib/plugins` before you commit.

## Task 10: grazing and haying intervals for pasture herbicides (Phase 32)

The grazing rule coming in sprint 32C blocks moving food animals onto, or cutting hay from, a pasture sprayed inside the label's grazing or haying interval. A pasture-labelled product with no interval data blocks food animals until the owner types the interval from the label. This task fills that data for about ten products.

**Work list.** The ten products in `pastureAllowlist` in `apps/web/scripts/grazing-sources.json`: `balan-benefin`, `banvel`, `chaparral-aminopyralid-metsulfuron`, `crossbow`, `dimilin-2l`, `duracor-aminopyralid-florpyrauxifen`, `grazonnext-hl`, `harmony-sg-thifensulfuron`, `pursuit` and `raptor-imazamox`. Then check whether `2-4-d-amine`, `24d`, `stinger` and the glyphosate plugins name one label with pasture or hay uses. Skip the generic plugins unless the plugin clearly names a single registrant.

**Where values go.** Add a `grazingRestrictions` block to the plugin JSON (schema: `grazingRestrictionsSchema`). The block records every interval the label gives. The kernel (`lib/safety/grazingInterval.ts`, ruling C-24) reads a missing field as unknown, and unknown blocks food animals and every hay cut, so each block must carry `grazeDays`, `hayDays`, `lactatingDairyGrazeDays` and `meatAnimalRemovalBeforeSlaughterDays`, with `0` where the label states none. The coverage gate fails on a block that leaves one out, unless the block sets `notForPasture: true`. The fields:

- `grazeDays` and `hayDays`: days after application before grazing or cutting hay;
- `lactatingDairyGrazeDays`: the separate interval for lactating dairy animals;
- `meatAnimalRemovalBeforeSlaughterDays`: "remove meat animals from treated areas N days before slaughter";
- `speciesExceptions`: `{ speciesId, lactating?, grazeDays?, hayDays? }` only where the label names a species (horses or lactating goats, for example). `speciesId` must name a species plugin.
- `notForPasture: true` when the label forbids use on grazed or hayed land;
- `manureCarryover: true` when the label warns that residue passes through manure, hay or compost (aminopyralid, clopyralid and picloram labels do).

Set `source` to a short citation (product, EPA number, label date). For every number, and for a true `notForPasture` or `manureCarryover`, add a quote to `grazing-sources.json` under `entries.<pluginId>.<field>`. For a species exception, the key is `speciesExceptions.<speciesId>.<field>`, or `speciesExceptions.<speciesId>.lactating.<field>` for the lactating variant. When a label has no restriction ("no grazing restrictions"), record `0` with the quote. Never leave a field out to mean zero. Once a product is covered, delete its `pastureAllowlist` entry, because the gate fails on stale entries.

Take the stricter reading whenever the label is ambiguous. If the interval depends on the rate, use the interval for the highest labelled rate and say so in `note`.

## Task 11: check the species food-flag quotes (Phase 32B)

Sprint 32B shipped ten species plugins in `plugins/species/`. Each `foodProducingDefault` is quoted in `apps/web/scripts/species-sources.json`, but those quotes came from web search excerpts because the cloud environment could not open the pages (9 CFR 381.1, 9 CFR 301.2, 9 CFR 354.1 and the FDA CVM 2018 antimicrobial sales report). Open each URL, confirm the quote word for word, and fix the wording, URL or date where it differs. Once a quote is confirmed, delete the "could not open the page" sentence from its `note`. If a page no longer supports the flag, say so in the report instead of changing the flag: the kernel reads it in 32C, and an unknown species counts as food-producing.

---

## Finish

Update the "Known follow-ups" bullets in `CLAUDE.md` on EPA numbers, pollinator data, rainfast and formulation gaps to the new counts. Close or comment on #381 with the final tally. The final report should give:

- per-task counts: filled, still gapped with reasons, data corrections made
- anything you found that contradicts existing plugin data, especially safety-relevant fields
- for Tasks 9 and 10, each product you verified and each one you dropped, with the reason
