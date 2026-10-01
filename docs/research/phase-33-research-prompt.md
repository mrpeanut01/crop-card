# CropCard: Phase 33 research for a local agent

You are working in a local checkout of `mrpeanut01/crop-card` (SvelteKit + TypeScript, pnpm, Node 22). Pull `main` first. Read `CLAUDE.md` (Invariants 1, 2 and 7), the "Deferred" section of `docs/design/PHASE_32_PLAN.md`, and `docs/research/issue-469-prompt.md`, whose ground rules and shipping steps you reuse.

Phase 33 leads with the organic certification pack, the document vault, the aminopyralid manure chain and the prussic acid / nitrate forage gate. Each needs sourced numbers or real-device behaviour the app cannot invent. Until these tasks land, every affected number shows "verify" and no gate reads it.

## Ground rules

These are non-negotiable.

- **Primary sources only.** eCFR (7 CFR part 205), the USDA AMS National Organic Program site, EPA PPLS labels and the manufacturer's label PDF for the exact product, land-grant extension publications, and peer-reviewed or agency papers. Search snippets, forums, distributor pages, AI output and memory never count.
- **Every value gets a quote entry.** `{ url, publisher, date, quote, note? }` in the matching sources file. A value without one gets reverted.
- **Disagreement:** if two current sources disagree, leave the value out and record both.
- **Stricter reading wins** wherever a source is ambiguous.
- **Nothing becomes a gate from one source.** R5 data needs two agreeing independent sources before it can be marked `gateEligible: true`; otherwise it ships as advisory only.
- **Data only.** No app code, no migrations, no `lib/safety` edits. Don't reformat existing JSON. Plugins stay data-only (Invariant 2).
- **Where a source is silent, say so.** Record `"silent"` with the closest quote. Do not record 0 or a guess.
- **If a source would shorten or remove something that already ships** (a grazing, hay or withdrawal value), stop and report it. Don't edit it.

## Step 0: look for work already done

Check local branches, stashes, closed or unmerged PRs on GitHub and `apps/web/scripts/*-sources.json` for earlier output. Reuse verified entries, but re-check each value against its source.

## R1: 7 CFR part 205 quotes into `nop-sources.json`

Create `apps/web/scripts/nop-sources.json` (`{ "entries": { "<key>": { url, publisher, date, quote, note? } } }`). Read the current eCFR text, record the "up to date as of" date, and quote word for word:

- **Transition period:** 205.202(b), the 36-month rule for land with prohibited substances applied. Also the definition of "transition" in 205.2 if it adds anything.
- **Buffers:** 205.202(c), the buffer zone against prohibited-substance drift and contamination.
- **Seed and planting stock:** 205.204(a), including the commercially-available requirement, the exceptions, and the treated-seed rule in 205.204(a)(3) and (4). Record the documentation expected for non-organic seed use.
- **Livestock:** 205.236 (origin, including the one-year organic management for dairy and the slaughter stock rule), 205.237 (feed, including 205.237(b)), 205.238 (health care) and 205.239 (living conditions, including pasture).
- **205.238(c)(1):** the rule that livestock treated with a prohibited substance cannot be sold, labeled or represented as organic. Quote it exactly, and quote the neighbouring text on withdrawal of treated animals, euthanasia for suffering and the exceptions.
- **Records:** 205.103 (recordkeeping, five years) and 205.201 (organic system plan).

For each key add `note` saying which Phase 33 feature reads it (transition clock, buffer prompt, seed sourcing fields, animal status loss, record retention). Do not summarise the rule into a number; the app reads quotes and the 36-month figure only if quoted.

## R2: organic-use status of the 16 shipped animal-health products

The products are the 16 files in `plugins/animal-health/`. For each, find on eCFR 7 CFR 205.603 (synthetic substances allowed for livestock) and 205.604 (prohibited) whether the active ingredient is listed, with the annotation text (for example, species, route, "in accordance with approved labeling", withdrawal multipliers such as the doubled-withdrawal annotations).

Record in `nop-sources.json` under `entries.livestock.<pluginId>`:

- `status`: `allowed | allowed-with-annotation | not-listed | prohibited | unknown`
- the quoted 205.603 or 205.604 paragraph and any annotation
- a `note` where the product's other ingredients, route or species fall outside the annotation (for example, parasiticides are allowed only on a defined basis, and ivermectin has a milk-and-slaughter annotation)

Vaccines: find where 205.603 covers biologics and quote it. Where a product is not listed, say `not-listed` and do not infer. Report any product where the label or active ingredient could not be identified.

## R3: manure-carryover windows and hay-off-farm limits

Work list: the six carryover herbicide plugins (`grazonnext-hl`, `chaparral-aminopyralid-metsulfuron`, `duracor-aminopyralid-florpyrauxifen`, `resicore-rev`, `method-aminocyclopyrachlor`, `stinger`) plus any other plugin whose label names aminopyralid, clopyralid, picloram, aminocyclopyrachlor or fluroxypyr (grep `plugins/herbicides/`).

From the exact product's current EPA PPLS label, quote:

- the manure-and-compost carryover warning: how long after consuming treated forage manure remains hazardous, and the "do not use for compost or mulch" or equivalent wording
- any limit on moving treated hay or forage off the farm, or selling it, and what the label says to do with it
- the grazing, haying and slaughter statements already in `grazing-sources.json`, only to cross-check; do not change them

Record under `entries.<pluginId>.carryover` in `apps/web/scripts/grazing-sources.json` with fields `manureCarryoverWindow` (quote only, with the number if the label gives one), `hayOffFarm`, and `compostWarning`. Where the label gives no number, use `"silent"`. Add a note when a registrant bulletin (not the label) gives the window, and quote it as a separate, lower-ranked entry.

## R4: bean or pea bioassay method

Find a land-grant extension method for testing compost, manure or soil for persistent herbicide residue with a bean or pea bioassay. Candidates: Washington State University, Cornell, Penn State, Oregon State, University of Minnesota, NDSU, Colorado State. Pick the one or two with a step-by-step protocol, then record in a new `apps/web/scripts/bioassay-sources.json`:

- the method steps in the source's own words (quote), including the crop used, sample mix ratio, pot setup, control pots, how long to grow, and what injury looks like
- the stated limits of the test (which herbicides it detects, false negatives, minimum detection)
- any statement on when to retest or when material is safe, only if the source says it

If sources disagree on duration or mix ratio, record both and don't merge them. The app will show the method as a linked guide, never as a pass/fail verdict.

## R5: prussic acid and nitrate data

Sources: land-grant extension and forage agronomy publications (for example Virginia Tech, Penn State, Kansas State, Oklahoma State, Texas A&M, University of Missouri, Iowa State, University of Kentucky). Record in a new `apps/web/scripts/forage-toxicity-sources.json`, with two independent agreeing sources per value before `gateEligible: true`:

- **Crop flags:** which crops carry prussic acid (cyanogenic glycoside) risk (sorghums, sudangrass, sorghum-sudangrass, johnsongrass, other cyanogenic forages) and which carry nitrate risk (corn, oats and other small grains, sorghums, millets, brassicas, other named crops). Match to plugin ids in `plugins/crops/` and say when a crop has no plugin.
- **Frost waits:** how long after a killing frost, and after a non-killing frost, grazing a prussic-acid crop should wait, including the "regrowth" and "tillers" conditions.
- **Regrowth heights:** the minimum height before grazing sorghum, sudangrass and sorghum-sudangrass.
- **Nitrate classes:** the nitrate-nitrogen or nitrate ppm bands and the feeding guidance for each (safe, limit, danger), the unit basis (dry matter or as-fed, NO3 or NO3-N), and which animal groups the bands are for.
- **Drought, fertilizer and hay conditions** only where a source states them with numbers.

Where sources disagree on a threshold, record both, mark `gateEligible: false` and list the disagreement in `note`. State units exactly as printed. Do not convert.

## R6: a source for each Care Guide tip

Open `apps/web/src/lib/cards/build/careTips.ts`. For each family (solanaceae, cucurbit and the rest) and each string in `water`, `feed`, `prune` and `problems`, find an extension or botanical-garden source that supports it. Record in a new `apps/web/scripts/care-tips-sources.json`, keyed `family.<field>.<index>`: `{ url, publisher, date, quote, verdict }` where `verdict` is `supported | partly | unsupported | contradicted`.

For each `partly`, `unsupported` or `contradicted` tip, propose corrected wording in `suggestedText` (plain cultural practice only: no products, rates or spray timing). Do not edit `careTips.ts`; the owner decides. Flag any tip that implies a pesticide, rate or timing.

## R7: real browser and device checks

You need real devices or browsers. Do this one only if you can run Safari on macOS, Safari on a physical iPhone, Chrome on Android and Chrome on desktop. If you can't, say which you could not run and stop.

Use a throwaway local build (`pnpm dev` on a LAN address, or a preview deployment) and a throwaway account. Do not use production data.

- **HEIC uploads:** choose an iPhone HEIC photo through the journal photo and animal photo pickers. Record, per browser, whether the file arrives as `image/heic`, `image/jpeg` or empty, whether the browser converts, the resulting byte size, and whether the current upload path accepts it, strips EXIF and stays under the 300 KB cap. Test a live-photo and a portrait-mode sample.
- **PDF and image behaviour under a sandbox CSP:** serve a PDF and a PNG from a route with `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'` and `X-Content-Type-Options: nosniff`, once with `Content-Disposition: inline` and once with `attachment`. Record per browser: does the PDF render inline in the tab, in an `<iframe>`, in an `<object>`, or only download; does the image render in `<img>` and when opened directly; whether the sandbox blocks the built-in PDF viewer (Chrome and Firefox differ here); and the exact console message.
- Record the browser, OS version, device and date for each row.

Write the results as a table in `docs/research/phase-33-device-results.md`. No source file; observations only.

## Verification before every commit

```sh
pnpm install --frozen-lockfile
pnpm --filter @cropcard/web exec vitest run src/lib/plugins src/lib/safety
pnpm typecheck && pnpm lint
pnpm test:unit
```

The new source files are not read by any test yet; keep them valid JSON and consistent with the existing `*-sources.json` shape. If you change a plugin file (R3 changes none), run the plugin tests.

## Shipping

- One commit per task (R1 to R7), one PR against `main`.
- CI (`ci.yml`, job `test`) must be green; fix failures yourself, never by skipping or weakening a test.
- Squash-merge once green.
- Update the "Label research" bullet in `CLAUDE.md` with what landed and what is still open.

## Final report

1. Per task: what you verified, the eCFR or label date, and each value left out with the reason.
2. R2: a table of the 16 products and their organic status.
3. R3: each herbicide, its carryover window, and any that were `silent`.
4. R5: each value and whether it is `gateEligible`.
5. R6: counts of supported, partly, unsupported and contradicted tips.
6. R7: the browser matrix.
7. Anything that contradicts data already shipped, especially anything that would shorten a hold.
