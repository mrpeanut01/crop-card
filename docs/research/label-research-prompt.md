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

---

## Finish

Update the "Known follow-ups" bullets in `CLAUDE.md` on EPA numbers, pollinator data, rainfast and formulation gaps to the new counts. Close or comment on #381 with the final tally. The final report should give:

- per-task counts: filled, still gapped with reasons, data corrections made
- anything you found that contradicts existing plugin data, especially safety-relevant fields
