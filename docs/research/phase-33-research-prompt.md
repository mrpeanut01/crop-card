# CropCard: Phase 33 research, organic rules, carryover labels, forage hazards and care tips

You are working in a local checkout of `mrpeanut01/crop-card` (SvelteKit + TypeScript, pnpm, Node 22). Pull `main` first. Read `CLAUDE.md` (Invariants 1, 2, 6 and 7), then [`docs/design/PHASE_33_PLAN.md`](../design/PHASE_33_PLAN.md), especially "Ground rules", "33 rulings" and every value marked "(verify)". This brief lists every number and regulation the plan needs from a primary source. The cloud environment that wrote the plan could not open eCFR, EPA PPLS or extension sites, so nothing below has been checked yet.

## Why it matters

- **33B (organic records)** shows a derived transition date and treats antibiotic treatments as an automatic loss of organic status only once Task R1 lands a verified quote. Until then the app shows facts and "needs review", which is safe but less useful.
- **33C (manure carryover)** uses the label's manure window. Without it, every exposure counts to the end of the collection window, which over-warns.
- **33C (forage advisory)** shows no numbers at all until Task R5 sources them.
- **33D (Care Guide)** removes any tip Task R6 cannot source.

## Ground rules

These are non-negotiable.

- **Primary sources only.**
  - Regulations: eCFR (ecfr.gov) for 7 CFR part 205, with its "up to date as of" date. USDA AMS NOP handbook guidance and policy memos are acceptable as a second source for how a rule is read, never instead of the regulation text.
  - Pesticide labels: EPA PPLS stamped labels, or the registrant's current label PDF for the exact product.
  - Agronomy and animal health: land-grant extension publications (VCE, Penn State, Cornell, NC State, UMN, Oklahoma State, UC ANR and the like) and the Merck Veterinary Manual.
  - Search snippets, distributor pages, forums, blog posts, AI output and memory never count.
- **Every value gets a quote entry** `{ url, publisher, date, quote, note? }` in the matching sources file. A value without one gets reverted.
- **Two current sources disagree:** leave the value out and record both in the report.
- **Ambiguous text:** take the stricter reading, and say why in `note`.
- **Thresholds that could become a kernel gate** (Task R5) need at least two agreeing sources (ruling M-11). One source is enough for advisory copy.
- **Data only.** Don't edit app code except the source files, plugin JSON and the `careTips.ts` text named below. No migrations. Keep diffs minimal and don't reformat plugin JSON.
- **If a file named here doesn't exist yet** because its Phase 33 sprint hasn't merged, write the entries into a new file at that path with the shape given, and the sprint will pick it up. Say so in the report.

## Step 0: look for work already done

Check local branches, open or closed PRs, stashes and `apps/web/scripts/*-sources.json` for any earlier run of these tasks. Reuse verified output, but re-check every value against its source.

## Task R1: USDA organic regulations (7 CFR part 205), highest priority

Read the current text on ecfr.gov and write a `nop-sources.json` entry for each item below at `apps/web/scripts/nop-sources.json`, shaped as `{ "ecfrAsOf": "<date>", "entries": { "<key>": { url, publisher, date, quote, note? } } }`. Quote the paragraph word for word.

| Key                       | Citation               | What the plan needs                                                                                                                                                              |
| ------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `landTransition`          | 205.202(b)             | The period with no prohibited substances before harvest (the plan assumes 36 months). Whether it runs to the harvest date or the application date.                               |
| `bufferZones`             | 205.202(c)             | Whether the rule names any distance. The plan defers buffer zones either way; record what it says.                                                                               |
| `recordRetention`         | 205.103                | How long records must be kept (the plan assumes 5 years) and what they must show.                                                                                                |
| `seedSourcing`            | 205.204(a)             | When non-organic untreated seed is allowed, and what treated seed is allowed.                                                                                                    |
| `commerciallyAvailable`   | 205.2                  | The definition of "commercially available".                                                                                                                                      |
| `rawManure`               | 205.203(c)(1)          | The days between raw manure application and harvest, for crops whose edible part touches soil and for the rest (the plan assumes 120 and 90).                                    |
| `compost`                 | 205.203(c)(2)          | The composting conditions (C:N ratio, temperatures, days, turnings).                                                                                                             |
| `livestockOrigin`         | 205.236(a)             | Slaughter stock (last third of gestation), poultry (second day of life) and dairy transition (the plan assumes one year). Record each in its own key.                            |
| `treatedAnimal`           | 205.238(c)(1)          | The rule that an animal treated with antibiotics, or with a substance not allowed under 205.603 or prohibited under 205.604, cannot be sold, labelled or represented as organic. |
| `withholdTreatment`       | 205.238(c)(7)          | The rule that medical treatment must not be withheld to keep organic status.                                                                                                     |
| `parasiticides`           | 205.238(b), 205.603(a) | The conditions on parasiticide use and any milk or slaughter withholding periods for the parasiticides listed.                                                                   |
| `allowedSynthetics`       | 205.603                | The list headings only (what classes appear), for the report.                                                                                                                    |
| `prohibitedNonsynthetics` | 205.604                | The list, for the report.                                                                                                                                                        |

In the report, list every place where the regulation differs from the plan's assumption.

## Task R2: organic use of the shipped animal-health products

For each plugin in `plugins/animal-health/` (16 products), find whether its active ingredient appears in 7 CFR 205.603(a) and under what conditions, using the Task R1 text. Write an `organicUse` object into the plugin JSON:

`{ "status": "allowed" | "allowed-with-conditions" | "not-allowed", "citation": "205.603(a)(n)", "conditions"?: "<quote>" }`

Put the quote in `apps/web/scripts/animal-health-sources.json` under `entries.<pluginId>.organicUse`. A vaccine is "allowed" only if 205.603 or 205.238 says so in words you can quote. Leave out any product you cannot settle, and list it with the reason. The app never decides a treatment "does not affect" status from this data (ruling O-09); it only decides which treatments go to the owner for review.

## Task R3: carryover herbicide labels

**Work list.**

- The five plugins with `"manureCarryover": true`: `crossbow`, `grazonnext-hl`, `chaparral-aminopyralid-metsulfuron`, `duracor-aminopyralid-florpyrauxifen` and `stinger`.
- Every other herbicide plugin in `plugins/herbicides/` whose active ingredients include aminopyralid, clopyralid or picloram. Report any that lack the `manureCarryover` flag, with the label quote that supports adding it.

**For each, from the stamped label:**

- `manureCarryoverDays`: the days between an animal grazing treated forage or eating treated hay and manure that must be kept out of compost, mulch or land for sensitive crops. GrazonNext HL's quote already in `grazing-sources.json` says "within the previous 3 days"; confirm it and find the rest.
- `hayOffFarmRestricted`: `true` only when the label limits moving hay or manure from treated areas off the farm. Quote it.
- The label's list of sensitive crops, for the report only. The plan uses the kernel's synthetic-auxin family list (ruling M-03); flag any crop the label names that is not in that list.
- Any plant-back or bioassay wording, for the report only.

Write the two fields into each plugin's `grazingRestrictions` and the quotes into `apps/web/scripts/grazing-sources.json` under `entries.<pluginId>.manureCarryoverDays` and `.hayOffFarmRestricted`. Values only lengthen what ships; if a label suggests a shorter window than anything already on file, stop and report it.

## Task R4: the bean or pea bioassay

Find one or two extension publications that describe a home bioassay for herbicide carryover in manure, compost or soil (for example NC State's "Herbicide carryover in hay, manure, compost, and grass clippings", or WSU or Penn State equivalents). Record the method in steps (mix, pots, plant, days to read, symptoms to look for) with quotes in `apps/web/scripts/forage-hazard-sources.json` under `bioassay`. 33C's after-spread line and the bioassay form cite it.

## Task R5: prussic acid and nitrate

**Crop flags.** For each crop plugin that is a sorghum, sudangrass or sorghum-sudan type (`sorghum-grain-pioneer`, `sorghum-sudangrass-cover`, `sudangrass-piper`, `bmr-sorghum-sudan` and any others you find), and for any crop plugin an extension source names as a nitrate accumulator, record which hazards apply and which triggers the source names (`frost`, `drought`, `young-regrowth`, `heavy-nitrogen`). Write `forageHazards` into the plugin JSON and the quotes into `apps/web/scripts/crop-data-sources.json` under `<pluginId>.forageHazards`.

**Numbers.** In `apps/web/scripts/forage-hazard-sources.json` under `prussicAcid` and `nitrate`, record each value with its source:

- the wait before grazing after a killing frost, and after a non-killing frost;
- the minimum regrowth height before grazing, per crop type;
- whether proper hay curing and silage fermentation lower each hazard, and any wait for silage;
- forage nitrate levels by class (safe, caution, toxic), with the units basis the source uses (ppm nitrate, ppm nitrate-N, % nitrate or % KNO3), and the conversion factors between the four bases;
- any species differences the sources name (cattle, sheep, goats, horses).

Two agreeing sources per number are needed for any value that could later gate (M-11). Record single-source values too, marked `"singleSource": true`.

## Task R6: Care Guide horticulture review

`apps/web/src/lib/cards/build/careTips.ts` holds general care tips by crop family (`FAMILY_CARE_TIPS`), shown on the Care Guide Card with `fallback` provenance. For each tip:

- find an extension or university source that supports it, and write `{ url, publisher, date, quote }` into `apps/web/scripts/care-tips-sources.json` keyed by `<family>.<section>.<index>`;
- where a source supports a different wording or number (for example "about an inch of water a week"), propose the reworded tip in the report and in the sources entry's `note`;
- where no source supports it, mark it `"unsourced": true`.

You may edit tip text in `careTips.ts` only to match a source word for word in meaning. Never add product names, rates or spray timing (the Care Guide gives no spray advice).

## Task R7: browsers and devices for the vault

These need real devices or desktop browsers, so they join network-tasks Task 7.

- Does an iPhone's file picker (Safari, `accept="image/*,application/pdf"`) send HEIC or convert to JPEG? Same on Android Chrome.
- Does a PDF served `inline` with `Content-Security-Policy: sandbox` render in current Chrome, Safari and Firefox? The plan serves PDFs as downloads (V-06); report whether inline would work anywhere.
- Does a sandboxed image response display normally inside an `<img>` tag on all three browsers?

Record results in the report only.

## Verification before every commit

```sh
pnpm install --frozen-lockfile
pnpm --filter @cropcard/web exec vitest run src/lib/plugins src/lib/safety
pnpm gen:schemas
pnpm typecheck && pnpm lint
pnpm test:unit
```

## Shipping

- Commit each task separately, on a branch off `main`.
- Open one PR against `main`. CI (`ci.yml`, job `test`) must be green. Fix any CI failure yourself, never by skipping or weakening a test.
- Squash-merge once the PR is clean and green.
- Then update the Phase 33 plan's "(verify)" marks for each value you confirmed, and the Phase 33 line in `CLAUDE.md`.

## Final report

1. Task R1: the eCFR date, each entry, and every difference from the plan's assumptions.
2. Task R2: each product's organic use, and each one left out with the reason.
3. Task R3: each label's values, any herbicide missing the carryover flag, and any sensitive crop outside the kernel's list.
4. Task R4: the bioassay sources and steps.
5. Task R5: each crop flagged, each number with its sources, and which numbers meet the two-source bar.
6. Task R6: tips confirmed, reworded and unsourced.
7. Task R7: device and browser results.
8. Anything that contradicts data already shipped, especially any value that would shorten a hold or a grazing interval.
