# CropCard: issue #469, label research for the animal safety kernel

You are working in a local checkout of `mrpeanut01/crop-card` (SvelteKit + TypeScript, pnpm, Node 22). Pull `main` first. Read `CLAUDE.md` (Invariants 1, 2 and 6), then GitHub issue #469, then Tasks 9, 10 and 11 in `docs/research/label-research-prompt.md`. That file is the detailed brief. This prompt adds what has changed since it was written, and how to finish.

## What changed since the brief was written

- **Phase 32C has shipped.** The animal safety kernel is live at `RULES_VERSION` 0.7.0. It includes the C-35 hold guard, which means holds never shorten.
- **The prohibited-drug table is on `main`.** It lives at `apps/web/src/lib/safety/prohibitedAnimalDrugs.ts` (`PROHIBITED_EXTRA_LABEL_DRUGS`). Ignore the brief's references to a parked branch or `refs/pull/464/head`.
- **Species plugins exist.** They are in `plugins/species/`: cat, cattle, chicken, dog, duck, goat, horse, pig, rabbit and sheep. Every `speciesId` you use must be one of these.
- **Missing data blocks food use.** Today every animal treatment reads "withdrawal not known", and every sprayed pasture reads "grazing time not known". Owners have to type numbers in by hand until your data lands.
- **Adding shared label data is safe.** The kernel takes the longer of the stored snapshot and the current data, so records saved earlier keep their holds.
- **Correcting a value downward is not routine.** If you find a published number that should be lower than what ships, stop and report it rather than editing it.

## Ground rules

These are non-negotiable.

- **Primary sources only.** Use FDA Animal Drugs @ FDA (the NADA/ANADA record), DailyMed animal labels, the manufacturer's label PDF for the exact product and concentration, EPA PPLS pesticide labels, and eCFR. Search snippets, distributor pages, forums, summary tables, AI output and memory never count.
- **Two current labels disagree:** leave the value out and record both.
- **Every value gets a quote entry.** Each is `{ url, publisher, date, quote, note? }` in the matching sources file. A value without one gets reverted.
- **Ambiguous labels:** take the stricter reading. Where more than one withdrawal applies, use the longest, and say which in `note`.
- **Data only.** Don't edit app code, with one exception: the Task A2 table fix, if one is needed. No migrations. Keep diffs minimal and don't reformat plugin JSON.

## Step 0: look for work already done

The owner believes this research may have been run before. Before starting, check for:

- local branches
- closed or unmerged PRs on GitHub
- stashes
- any output files from an earlier run of `label-research-prompt.md` Tasks 9 to 11

If you find verified output, reuse it, but re-check every value against its source.

## Task A: 21 CFR 530.41 (prohibited extra-label drugs), highest priority

**A1.** Read the current 21 CFR 530.41 on ecfr.gov. Write a top-level `prohibitedExtraLabel` object into `apps/web/scripts/animal-health-sources.json`:

`{ "url", "date" (the eCFR "up to date as of" date), "quote", "drugs": [ { "cfr": "(a)(n)", "name", "species"?, "conditions"? } ] }`

**A2.** Compare `PROHIBITED_EXTRA_LABEL_DRUGS` with A1 paragraph by paragraph. For each entry check:

- the `cfr` paragraph
- the drug or class
- any species limits (cephalosporins: cattle, swine, chickens, turkeys; adamantanes and neuraminidase inhibitors: chickens, turkeys, ducks)
- the conditions (the sulfonamide exceptions in lactating dairy cattle; phenylbutazone in female dairy cattle 20 months or older; furazolidone and nitrofurazone except approved topical use; cephapirin excluded)
- `onLabelExempt`
- the brand names and spellings listed as search aids

Write every difference into the PR body as a table (paragraph, kernel says, eCFR says, action).

**A3.** Fixing the kernel table is a safety-kernel change.

- Make the fix in its own commit.
- Bump `RULES_VERSION` (0.7.0 to 0.7.1).
- Update `prohibitedAnimalDrugs.test.ts` and any tests that pin the version.
- Note the change in the "32C rulings" part of `docs/design/PHASE_32_PLAN.md` and in the Phase 32 bullet in `CLAUDE.md`.

You may only add entries, widen them, or correct a paragraph number. If eCFR shows the kernel prohibits something it shouldn't, don't remove it: report it for the owner to decide.

## Task B: animal-health withdrawal times (Task 9 in the brief)

**Scope.** Up to ten common over-the-counter products a small farm or homestead actually buys, covering poultry, goats, sheep, cattle and pigs. Good candidates:

- ivermectin, fenbendazole, levamisole and morantel dewormers
- amprolium
- a permethrin pour-on or spray
- a CD&T vaccine

Confirm each is still over the counter, since many antibiotics went prescription-only under FDA GFI #263 in June 2023.

**Where values go.**

- One `plugins/animal-health/<pluginId>.json` per fully verified product, following `animalHealthPluginSchema` (`packages/plugin-validation/src/schemas.ts`) and `schemas/animal-health.schema.json`.
- Record every species and class the label names.
- A food species with no sourced withdrawal fails `sourceCoverage.gate.test.ts`, and that is intended.
- Quotes go in `animal-health-sources.json` under `entries.<pluginId>.withdrawal.<speciesId>.<class>.<meatDays|milkHours|eggsDays|doNotUseFor>`.
- Record each label's classes exactly as printed. The kernel exempts a food only when a label use names the species, route and a class that covers that food: milk needs `all` or `lactating-dairy`, and eggs need `all` or `laying`.

Drop any product whose current label you can't open, and list it in the report with the reason.

## Task C: grazing and haying intervals (Task 10 in the brief)

**Work list.** The ten products in `pastureAllowlist` in `apps/web/scripts/grazing-sources.json`. Then check whether `2-4-d-amine`, `24d`, `stinger` and the glyphosate plugins each name one registrant's label with pasture or hay uses.

**For each covered product**, add a `grazingRestrictions` block to the plugin JSON.

- Include all four intervals: `grazeDays`, `hayDays`, `lactatingDairyGrazeDays` and `meatAnimalRemovalBeforeSlaughterDays`. Use `0` only where the label says there is no restriction, and quote that too.
- Add `speciesExceptions` where the label names a species, and `notForPasture` or `manureCarryover` where they apply. Aminopyralid, clopyralid and picloram labels warn about carryover.
- Set `source` to the product, EPA number and label date.
- Put the quotes in `grazing-sources.json` under `entries.<pluginId>.<field>`.
- Where the interval depends on rate, use the highest labelled rate and say so in `note`.
- Remove each product from `pastureAllowlist` as its block lands, since the gate fails on stale entries.

## Task D: species quotes (Task 11 in the brief)

Open each URL in `apps/web/scripts/species-sources.json`:

- 9 CFR 381.1
- 9 CFR 301.2
- 9 CFR 354.1
- the FDA CVM report

Confirm each quote word for word, fix any wording, URL or date that differs, and delete the "could not open the page" sentence once a quote is confirmed. If a page no longer supports a species' food flag, report it and don't change the flag.

## Verification before every commit

```sh
pnpm install --frozen-lockfile
pnpm --filter @cropcard/web exec vitest run src/lib/plugins src/lib/safety
pnpm typecheck && pnpm lint
pnpm test:unit
```

After a kernel change (Task A3), also run the full e2e suite: `pnpm test:e2e`.

## Shipping

- Commit each task separately.
- Open one PR against `main` with a commit per task, or one PR per task. Either way, Task A3 goes in its own commit.
- CI (`ci.yml`, job `test`) must be green.
- Fix any CI failure yourself, never by skipping or weakening a test.
- Squash-merge once the PR is clean and green.
- Then update the "Label research" bullet in `CLAUDE.md` and the Phase 32 plan status notes, and close #469 with the final tally.

## Final report

1. Task A: the eCFR date, the difference table, and whether `RULES_VERSION` changed.
2. Task B: each product you verified, and each one you dropped with the reason.
3. Task C: each product covered, and each one left on the allowlist with the reason.
4. Task D: each quote confirmed or corrected, and any flag you'd question.
5. Anything that contradicts data already shipped, especially any value that would shorten a hold.
