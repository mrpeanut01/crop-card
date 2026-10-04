# Orchard seasonal calendar: data-shape proposal

Status: ruled 2026-10-04 (#544). The rulings below replace the open questions. The data-shape sections above them still describe the target design, as amended by the rulings (no `productClasses` field in the first version, no degree-day estimate without two agreeing sources, no kernel change).

## What exists today

- All 28 tree-fruit crop plugins declare `archetype: tree-fruit-multi-pick` (`cropFamily` `orchard` or `stone-fruit`). That archetype covers harvest only; there is no spray calendar.
- `crop.sprayWindows[]` (`packages/plugin-validation/src/schemas.ts`) needs a `chemistryClass` from `CHEMISTRY_CLASSES`, which are herbicide modes of action only, and is anchored on `planting | emergence | stage` day offsets. `purpose` has no dormant, bactericide, thinning or growth-regulator slot. It does not fit orchard fungicide, insecticide or bactericide windows without stretching the kernel enum.
- Three plugins already carry unsourced orchard spray text on fixed days of the year: `apple-orchard.json` (`orchardSeasonalTasks`, naming captan and sulfur, a 14-day PHI and "spray after sunset"), and `pear-bartlett.json` and `peach-redhaven.json` (`seasonalTasks`, naming streptomycin, Apogee and copper). `lib/calendar/engine.ts` renders these as `orchard-task` events. `lib/plugins/growthStageTemplates.ts` has a `perennialDeciduousFruit` template with day-of-year stage ranges and its own spray hints. None of it has an entry in any `*-sources.json` file, and the source-coverage gate does not look at it.
- The pollinator gate (`lib/safety/pollinatorProtection.ts`, insecticide record endpoint) takes `bloomStatus` from the operator, then the crop's `bloomWindow`, else `unknown`, and treats unknown as in bloom.
- The `pest-model` plugin kind and `lib/climate/degreeDays.ts` already give a sourced, display-only degree-day pipeline: a station, a base temperature, a biofix and copy that may never say "spray".

## Primary guides (checked 2026-10-03, not transcribed)

1. **2026 Spray Bulletin for Commercial Tree Fruit Growers**, VCE Publication 456-419 (ENTO-638), Virginia Tech, WVU and University of Maryland Extension. <https://www.pubs.ext.vt.edu/456/456-419/456-419.html>. 187 pages. Its apple, pear and peach chapters are calendars keyed by phenology stage (dormant, silver tip, green tip, half-inch green, tight cluster, pink, bloom, petal fall, shuck split for stone fruit, first and later covers), with a degree-day section. This is the regional guide for a Loudoun County farm. It says its calendar is "only as a general guide" and it is written for commercial orchards (dilute rates assume 400 gal/acre on standard rootstock).
2. **Penn State Tree Fruit Production Guide, 2026-2027** (AGRS-045). <https://extension.psu.edu/tree-fruit-production-guide>. A second source for stage descriptions and degree-day estimates.
3. For small and backyard plantings: **2026 Pest Management Guide: Home Grounds and Animals**, VCE 456-018 (<https://www.pubs.ext.vt.edu/456/456-018/456-018.html>). Whether this, rather than the commercial bulletin, should drive a garden household's calendar is an open question below.

## Recommendation: a new data-only plugin kind, `orchard-calendar`

One plugin per crop group and guide edition (for example `pome-va-2026`, `stone-fruit-va-2026`), not a field on each crop plugin:

- Stage windows are shared by every variety in a group (five apple plugins, three pears); a crop field would copy them and drift.
- The guides are re-issued every year. A plugin with an `edition` lets the gate flag a stale calendar without touching crop files.
- It follows the 32A pattern (`species`, `animal-health`, `pest-model`): strict schema, loaded by `registryDataKinds.ts`, its own source file and gate.

Crop plugins opt in through `hostCropPluginIds` / `hostCropFamilies` on the calendar plugin, so crop files do not change. `sprayWindows[]` stays the annual, herbicide-anchored mechanism; this kind does not reuse it.

```json
{
  "pluginId": "pome-va-2026",
  "type": "orchard-calendar",
  "version": "1.0.0",
  "edition": "2026",
  "hostCropFamilies": ["orchard"],
  "hostCropPluginIds": ["apple-gala", "apple-fuji", "pear-bartlett"],
  "stages": [
    {
      "id": "tight-cluster",
      "name": "Tight cluster",
      "order": 5,
      "recognise": {
        "description": "<visual phenology description, quoted or close to the guide>",
        "sourceKey": "pome-va-2026.tight-cluster.description",
        "gddEstimate": {
          "baseTempF": "<number>",
          "biofix": "january-1",
          "gddFrom": "<number>",
          "gddTo": "<number>",
          "sourceKey": "pome-va-2026.tight-cluster.gdd"
        }
      },
      "windows": [
        {
          "id": "tight-cluster-scab",
          "purpose": "fungicide",
          "targets": [{ "id": "apple-scab", "kind": "disease" }],
          "productClasses": [{ "scheme": "FRAC", "code": "<group>" }],
          "pestStrategyGate": "preventive",
          "pollinatorSensitive": false,
          "note": "<short plain text, no product names, no rates>",
          "sourceKeys": ["pome-va-2026.tight-cluster.scab"]
        }
      ]
    }
  ]
}
```

Schema rules: `purpose` takes the existing `SPRAY_WINDOW_PURPOSES` plus new orchard values (`dormant-oil`, `bactericide`, `thinning`, `growth-regulator`); `productClasses` takes FRAC, IRAC or a fixed list such as `horticultural-oil` and `copper`, never brand names; `note` refuses rate and unit patterns (`oz`, `lb`, `pt`, `qt`, `gal`, `%`, `ml` next to a number) and the words PHI, REI and "safe", the way `SPRAY_WORDS` guards pest-model copy. Stone-fruit plugins use their own stage list (shuck split, shuck fall).

## How the stage is known at runtime

In order, with provenance (Invariant 7):

1. **Owner or helper marks the stage** for a block ("This block is at pink today"): stored per Owner, block and year in settings (`orchard_stage.<blockId>.<year>`, like `pest_biofix.*`), tagged `manual`.
2. **Degree-day estimate** from `degreeDays.ts` and the nearest station, when the stage carries a sourced `gddEstimate`: tagged `data`, always shown as "estimated" with the station and a "lower bound" note when days are missing.
3. **Nothing**: "Mark the stage when you see it." No day-of-year guess is shown for spray timing (the `perennialDeciduousFruit` dates stay a display-only `fallback`, if at all).

The calendar never gates. It produces windows and suggested tasks; it does not enable or block a record. No AI call is involved; if one is ever added it goes through `aiTry()` and can only suggest a stage, never mark it.

## What must not go in

- Rates, dilutions, tank mixes, spray volumes or product brand names. Rates stay with the label and `lib/dilution/`.
- Anything that overrides or restates the kernel: PHI, REI, pollinator, cross-contamination, FRAC rotation and tank-mix gates stay in `lib/safety/` (Invariant 1). A calendar window never tells the user a product is allowed.
- Bloom: windows at pink, bloom and petal fall set `pollinatorSensitive: true` and the UI defers to the pollinator gate. A calendar stage or a GDD estimate never sets `bloomStatus` to `not-in-bloom`; an owner-marked bloom may at most make it stricter, and only if the owner rules so (Q3).
- Executable logic or expressions (Invariant 2).

## Sources and the gate

- New `apps/web/scripts/orchard-calendar-sources.json`: `{ url, publisher, date, quote, edition, page, note? }` per key, `.edu` or `.gov` hosts only, same rules as `calendar-sources.json` (an excerpt says so and must be checked word for word).
- New `orchardCalendar.sources.gate.test.ts` (or `orchardCalendarFactPaths` in `sourceCoverage.ts`): every stage description, `gddEstimate`, target and product class has a source key that resolves; `edition` is the current or previous year; the copy guard above holds; e## Rulings (2026-10-04)

Three panelists reviewed the open questions. Where they disagreed, the ruling takes the safer and smaller option unless that leaves the farmer worse off. Nothing here allows an unsourced value to ship.

| id | question | ruling | reason | panel split |
| --- | --- | --- | --- | --- |
| OC-1 | (safety) Existing unsourced orchard spray text | Remove every spray row now, in its own change, with no rewrite. That is `apple-orchard` `orchardSeasonalTasks` dormant-oil, pre-bloom-fungicide, bloom-fungicide, summer-cover-spray and pre-harvest-cover-spray; `pear-bartlett` dormant-oil, bloom and fire-blight-cover; `peach-redhaven` dormant-spray, shuck-split-cover, summer-cover and pre-harvest; and the same kind of rows found on `blueberry-bluecrop` (mummy-berry-cover, anthracnose-pre-bloom) and `grape-concord` (downy-mildew-cover, post-bloom-cover). Kept rows lose pesticide wording: the blueberry and raspberry SWD scouting rows drop their insecticide and pyrethroid interval sentences, and apple's thinning row drops "chemical". In the three orchard plugins, kept rows also drop numbers that have no source (apple "10-15 mm", "Cool within 24 h"; peach "Refrigerate within 4 h"). Remove the spray hints from the `perennialDeciduousFruit` stage template (dormant oil, copper, first fungicide, cover spray), keeping the stage names and the "avoid insecticides during bloom" caution. Bump each plugin version. A migration aborts every still-open task whose `plugin_template_key` is `crop:<pluginId>:seasonal:<removedKey>`, with a plain stored reason; closed tasks stay as history and farm copies in `plugin_overrides` are left alone. The source-coverage gate is extended so no crop plugin may carry a `seasonalTasks` or `orchardSeasonalTasks` row of category or kind `spray`, or pesticide or product wording in any row. | `materializeSeasonalTasks` turns pear, peach, blueberry and grape rows into dated /today tasks, and the calendar engine and the card snapshot show apple's. A farmer is told "Streptomycin/Apogee", "Captan + insecticide tank-mix" and "Respect 3-day PHI" on fixed days, which is an unsourced product recommendation and regulatory number. A rewrite would still keep fixed-date spray timing that no guide supports. An honest gap beats a confident wrong prompt. | Unanimous on acting now. Two panelists said remove, one said rewrite without products while dropping all fixed-date spray rows; both reach the same result, so remove. Blueberry and grape were added from the third panelist's audit. |
| OC-2 | (safety) Product classes in windows | Targets, stage and timing only, plus a "Check the label" line. No `productClasses` field in the first version. Adding classes later needs its own owner ruling and a source quote per class, stage and edition, and is never linked to stock or offered as a pick. Brand names, rates, oil or copper percentages, PHI and REI are never allowed. | A class next to a window reads as "use this group now" and nudges a product choice that only the label, inventory and the kernel's FRAC rotation and tank-mix gates can judge. | Unanimous on targets only for now. One panelist would allow a collapsed class line for commercial owners later; that waits for a ruling. |
| OC-3 | (safety) Owner-marked bloom feeding the pollinator gate | No kernel change in this phase and no `RULES_VERSION` bump. Once stage marks exist, a marked pink or bloom stage may only pre-fill the insecticide form's bloom answer as `in-bloom`, tagged `manual` and showing the mark's date, and the operator can still change it as today. No calendar input (a stage, a degree-day estimate or a missing mark) may ever produce `not-in-bloom`; a test must fail if any calendar path sets it. A server refusal of a `not-in-bloom` answer that contradicts a mark is a separate future ruling with its own `RULES_VERSION` bump, fast-check tests and a stale-mark expiry rule. | The gate already treats unknown bloom as possibly in bloom, so the gain over today is small, while a hard override with a stale mark could block a correct record at petal fall. Keeping the kernel change separate keeps a safety boundary out of a feature change. | Split: one panelist said no kernel change, one said yes now with expiry, one said yes but later and separate. Ruled the smaller option. |
| OC-4 | (safety) Garden households and organic or low-input philosophies | They see only scouting, sanitation, cultural and stage-recognition windows (prune, remove mummies, thin, traps, watch for scab weather). No commercial-bulletin spray windows. The home-grounds guide (VCE 456-018) may drive this tier only after a local agent sources it as its own edition. Commercial-bulletin windows show only for a commercial or conventional Season Setup, and the screen names which guide is in use. Windows are not run through `philosophyFilter.isProductAllowed()`, because they carry no products. | VCE 456-419 is written for commercial conventional orchards at 400 gal/acre. Showing it to a backyard grower implies a spray program is expected. A product filter over windows without products would mean nothing and could suggest the result was checked. | Unanimous. |
| OC-5 | Degree-day estimate on one source or two | Two agreeing sources (VCE 456-419 and Penn State AGRS-045, the R5 `gateEligible` rule). With one source or a disagreement, no estimate is shown, the reason is recorded in the sources file, and the screen says "Mark the stage when you see it." A gated estimate is always labelled estimated, names the station, gives the lower-bound note for missing days, and never drives a task date or the pollinator gate. | A wrong single-source number near bloom shifts a pollinator-sensitive window in a way the farmer cannot see. A marked stage is always the better signal. | Unanimous. |
| OC-6 | Which crops first | Apple first, as one pome calendar, with pear added only where the guide's pear stages and windows are sourced (pear is not given apple's windows by default). Peach and other stone fruit second, as their own stage list. Fig, pawpaw, nuts, citrus, blueberry and grape stay out of this kind; their plugins show an honest "no seasonal calendar for this crop yet" line. The OC-1 removal applies to every listed plugin now regardless. | The bulletin's pome chapter is the most complete and holds the riskiest existing text. Fire blight timing is too important to guess from apple. | Unanimous on pome first; one panelist added that pear needs its own sourced windows. |
| OC-7 | Dated /today tasks from a marked stage | No. A marked stage only shows windows on the calendar, the Planting Card and the Area Card, with a "Schedule a scouting task" button that creates a scouting or cultural task, never a spray task, and nothing titled "Spray". No /today advisory card in the first version. | Auto-created dated tasks are how the unsourced text reached /today. /today is at its 68-query cap, and a changing stage mark would need stale-task cleanup. | Two panelists said windows only; one wanted one capped advisory line per block on /today. Ruled the smaller option. |
| OC-8 | New plugin kind or crop fields | A new data-only `orchard-calendar` plugin kind following the 32A pattern: strict Zod schema, a `registryDataKinds.ts` loader, its own sources file and gate, an `edition` field, crop opt-in through `hostCropPluginIds` and `hostCropFamilies` (checked against the registry), and a copy guard refusing rates, units, PHI, REI, "safe", "recommended" and brand names, tested against the English and Spanish strings. Crop plugins do not change. The kind ships now with an empty `plugins/orchard-calendars/` folder holding only a README; stage marks, engine events and UI wait until sourced data lands. | One shared stage list per crop group cannot drift across varieties, and an edition lets a stale calendar be flagged. Building the empty shell now costs little and gives the local agent a schema to fill. | Unanimous on the kind. One panelist would also build stage marks and the UI shell now; deferred as the smaller option, since they would show nothing without data. |

## Build now (this container)

1. **Remove the unsourced spray text (OC-1).** Plugin JSON edits and version bumps, the `perennialDeciduousFruit` hint edits, a migration that aborts open tasks keyed to the removed rows, the source-coverage gate extension, and test and fixture updates (`calendar/engine.test.ts`, `cardSnapshot.careTasks.test.ts`, `today/calendar.test.ts`, demo data). No safety-rule change.
2. **The empty `orchard-calendar` kind (OC-8).** Schema without `productClasses`, purposes limited to targets and timing, the loader, an empty `orchard-calendar-sources.json`, the gate with its copy guard, a test-only fixture plugin and a README. No UI, no stage marks, no engine events, no /today reads.

## Needs a local agent

The cloud container cannot reach pubs.ext.vt.edu, extension.psu.edu or EPA PPLS. A local agent with normal web access should:

1. Read VCE 456-419 (2026, <https://www.pubs.ext.vt.edu/456/456-419/456-419.html>) apple and pear chapters and Penn State AGRS-045 (2026-2027, <https://extension.psu.edu/tree-fruit-production-guide>). For each pome stage (dormant through later covers) record the visual description, the disease and pest targets the guide lists for that stage, and any degree-day range with its base temperature and biofix. Record no products, classes, rates, PHI or REI.
2. Write each value to `apps/web/scripts/orchard-calendar-sources.json` as `{ url, publisher, date, quote, edition, page, note? }`, quoting word for word. A degree-day range ships only where both guides agree (OC-5); otherwise leave it empty and record why.
3. Write `plugins/orchard-calendars/pome-va-2026.json` against the schema from Build now step 2, with pear stages and windows only where the guide gives them for pear (OC-6), and run the orchard-calendar gate.
4. Separately, read VCE 456-018 (<https://www.pubs.ext.vt.edu/456/456-018/456-018.html>) for the scouting, sanitation and cultural content that the garden and organic tier may show (OC-4), as its own edition. Stone fruit (peach) comes after pome, as `stone-fruit-va-2026.json` with its own stage list.
5. Source or drop the unsourced numbers still in non-spray seasonal rows on other crop plugins (for example strawberry "30 °F", raspberry "32-34 °F within 1 h", blueberry "every 5-7 d", grape "Brix ≥ 16"), quoting each in `crop-data-sources.json`.
