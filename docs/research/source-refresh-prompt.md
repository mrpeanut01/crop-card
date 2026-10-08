# CropCard: work the "Label and source drift" issue (local agent)

You are working in a local checkout of `mrpeanut01/crop-card` (SvelteKit + TypeScript, pnpm, Node 22). A scheduled check, `.github/workflows/source-drift.yml` running `apps/web/scripts/check-source-drift.mjs`, keeps one open GitHub issue titled **Label and source drift** (label `needs-research`). Each unticked item says that a source behind a stored value has changed since it was quoted: EPA stamped a newer label, a registration was cancelled or transferred, an OMRI listing expired or changed, an eCFR section was amended, an extension or government page changed, or a stored quote is no longer in its PDF word for word. Your job is to re-read each changed source and bring the data back in line with it, through reviewed PRs.

Read `CLAUDE.md` first. Invariants 1 and 2 matter most: plugins are data only, and safety rules live in `apps/web/src/lib/safety/`. Then read `docs/research/label-research-prompt.md`, whose ground rules (primary sources only, provenance for every value, minimal diffs, the stricter reading for safety data) apply here unchanged.

## What the check does and does not do

- It never changes data. Every value change is yours, in a PR a human reviews.
- A finding id names the new state it saw, for example `ppls:100-497:label:2024-07-08` or `omri:nbl-5404:expiring:2027-09-01`. The item text gives the plugin, the field (the JSON path in the `*-sources.json` file), the old and new date and links to the new source.
- "Could not check" is not "no change". If PPLS (`ordspub.epa.gov`), the label PDFs (`www3.epa.gov`), OMRI or eCFR did not answer, run the check yourself (below) before you conclude anything.
- The issue body keeps your ticks between runs. An item whose drift is gone (you updated the quote, or a newer run no longer sees it) drops off by itself. The issue closes once nothing is open.

Run it locally the same way CI does:

```sh
node apps/web/scripts/check-source-drift.mjs                       # weekly checks, prints the section
node apps/web/scripts/check-source-drift.mjs --only ppls,omri      # a subset
node apps/web/scripts/check-source-drift.mjs --verify-quotes       # monthly quote check (needs pdftotext)
node apps/web/scripts/check-source-drift.mjs --publish             # update the issue as CI would (needs gh)
```

Use `--publish` only for the full weekly set (no `--only`); a subset would drop the other kinds from the issue.

## Working one item

1. **Open the new source.** For a PPLS item, open the newest stamped label linked in the item and the PPLS record (`https://ordspub.epa.gov/ords/pesticides/cswu/ppls/<reg no>`). For OMRI, search the code at omri.org. For eCFR, use the compare link in the item, which shows the change between the two dates. For a page, open it and find the quoted passage.
2. **Re-read every value that cites the old source.** The item lists every reference (plugin, file, path). For a label, that can be the EPA number entry, `rei`, `phiByCrop`, `rate`, `rateByCrop`, `stageLimitByCrop`, `pollinator`, `formulation`, `chemistryClass`, `ingredientLethality`, `complianceFlags` and `grazing-sources.json` entries. Check each against the new label.
3. **Update value and provenance together.** Where the new source says the same thing, move the entry to the new source: new `sourceUrl`, `docDate` (the stamp date of the PPLS file, or the document date), `page`, and the `quote` copied from the new document's text. Where it says something different, change the plugin value and its provenance in the same commit, and say what changed in `note`. A value that no longer has a source is removed, not kept with a stale quote.
4. **Run the gates.**

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @cropcard/web exec vitest run src/lib/plugins src/lib/safety tests/unit/sourceDrift.test.ts tests/integration/seedLibrary.test.ts
   pnpm typecheck && pnpm lint
   pnpm test:unit
   ```

5. **Open a PR** against `main` with one commit per product or source. The PR body lists each issue item it resolves (paste the finding id). Tick the item in the issue once the PR merges.

## Per kind

- **Newer stamped label (`ppls:<reg>:label:<date>`).** Most re-stamps change nothing the app uses. Re-quote from the new label anyway, so the provenance points at the label growers can buy. Watch for changed REI, PHI, rates, crop lists, grazing and haying intervals, pollinator statements and the "not for use on" lines.
- **Transferred (`ppls:<reg>:transfer:<new>`).** The plugin's `epaRegistrationNumber` follows the current registrant (owner ruling 2026-09-30: where the plugin's number disagrees with the current label, update the plugin). Re-read the new registrant's newest label as for a new label.
- **Cancelled or inactive (`ppls:<reg>:status:<status>`).** Do not delete the plugin silently. Check whether existing stocks may still be used and whether a successor registration exists, then propose in the PR either retiring the plugin (`status` per the plugin spec, plus an entry in `epa-reg-sources.json` `retired`) or keeping it with a note. Retiring is the owner's call; ask in the PR.
- **Not found (`ppls:<reg>:not-found`).** Some numbers were never in PPLS (state SLN parents, distributor numbers). If the provenance note already says so, acknowledge it (below).
- **OMRI expired, expiring, missing or changed.** A renewed listing just needs the quote's `expires` date and `docDate` updated. A listing that lapsed or left the list means the plugin can no longer carry `omriListed`, `certifiedOrganicAllowed` or `transitioningAllowed` from that entry (rules in the `complianceFlags.$comment`); change the flags and the entry together. An "expiring" item needs no change until OMRI publishes the renewal; acknowledge it only if you have checked that.
- **eCFR amended (`ecfr:<title>:<section>:<date>`).** Read the change. If the quoted words are untouched, update the quote's `date` (and `ecfrAsOf` where the file has one). If the rule the app reads changed (`NOP_RULES` in `lib/organic/nopRules.ts`, `PROHIBITED_EXTRA_LABEL_DRUGS` in `lib/safety/prohibitedAnimalDrugs.ts`, the species food flags), see "Safety kernel" below.
- **Page changed (`page:<url>:…`).** Find the quoted passage. If it still reads the same, refresh the fingerprint: `node apps/web/scripts/check-source-drift.mjs --only pages --update-fingerprints --url <url>` and commit `apps/web/scripts/source-fingerprints.json`. If it changed, update the value and quote. A page that is gone (404) needs a new source or the value removed.
- **Quote not found in its PDF (`quote:…`).** Open the PDF at the cited page. Fix the quote's wording if it was copied loosely, or the URL if it points at the wrong file. Never edit a quote to match a document that now says something else; that is a changed value (step 3).

## The quote baseline

`quoteBaseline` in `source-fingerprints.json` lists the stored quotes that did not match their PDF word for word on 2026-10-08, when the monthly check started (201 of them, mostly PHI crop lists read down a label table, and quotes that join table cells or add editorial notes). The monthly check skips them and flags only quotes that stop matching after that. They are a backlog, not a clean bill: when you have time, open each one, fix the quote to the document's own words (or the URL or page if it points at the wrong file), and delete its id from `quoteBaseline`. Re-take the baseline only after such a pass, with `node apps/web/scripts/check-source-drift.mjs --verify-quotes --update-fingerprints`, and say in the PR how the count moved. Matching ignores case, spaces and punctuation, checks the words inside quotation marks when a quote is written `Label: "words"`, splits pieces on ellipses, `" / "` and `" | "`, drops `(p. N)` and `[...]` notes, and accepts a table cell or column whose words appear in order with at most 80 words between neighbours (`TABLE_GAP_WORDS`), in either `pdftotext` or `pdftotext -layout` output.

## Acknowledging a finding that needs no change

When an item needs no data change (a documented not-found number, a transfer the notes already handle, a re-stamped label you have read in full and that changes nothing), add its id to `acknowledged` in `apps/web/scripts/source-fingerprints.json` with a reason a reviewer can check:

```json
"acknowledged": {
  "ppls:279-3313:not-found": { "reason": "No PPLS record; SLN acceptance letters name parent 279-3313 (see epa-reg-sources.json entries.brigade-2ec).", "on": "2026-10-08" }
}
```

An acknowledgement silences only that exact state: a newer label, a different status or a later amendment gets a new id and shows up again. Acknowledgements go through a PR like any other change. Prefer re-quoting the newer label over acknowledging it.

## Safety kernel

Anything that changes what the safety kernel decides goes in its own PR, separate from plain re-quotes: a changed REI, PHI, grazing or haying interval, withdrawal time, pollinator class, kill-matrix class or ingredient lethality, a 21 CFR 530.41 change, or an edit under `apps/web/src/lib/safety/`. That PR bumps `RULES_VERSION` in `apps/web/src/lib/safety/version.ts` when kernel code or tables change, updates the kernel tests (vitest and fast-check), and says in its body which holds or stops get longer or shorter. Holds never shorten silently: a value that would shorten a hold needs the owner's explicit approval in the PR. Plugin data that only lengthens a hold still goes in its own PR, without a version bump unless kernel code changes.

## Finish

The final report gives, per kind, the items resolved, the items acknowledged with reasons, and anything that contradicts existing plugin data, especially safety-relevant fields. Leave the issue open if any item is still unticked.
