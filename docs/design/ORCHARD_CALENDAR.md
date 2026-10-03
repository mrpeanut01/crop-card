# Orchard seasonal calendar: data-shape proposal

Status: proposal for owner review (#530, orchard item). No data, no code. Nothing below is a value a farmer would be shown.

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
- New `orchardCalendar.sources.gate.test.ts` (or `orchardCalendarFactPaths` in `sourceCoverage.ts`): every stage description, `gddEstimate`, target and product class has a source key that resolves; `edition` is the current or previous year; the copy guard above holds; every host crop id names a crop plugin.
- Where the two guides disagree on a stage or a GDD number, the value stays empty with the reason recorded (label-research rules).

## Open questions for the owner

Items marked **(safety)** change what a farmer is told is safe and need a ruling before any data lands.

1. **(safety)** The existing `orchardSeasonalTasks` on `apple-orchard` and `seasonalTasks` on `pear-bartlett` and `peach-redhaven` name products (captan, sulfur, streptomycin, Apogee, copper), a 14-day PHI and spray timing on fixed dates, with no source. Remove them now, keep them until the sourced calendar ships, or rewrite them without product names?
2. **(safety)** Should windows name product classes (FRAC and IRAC groups, oil, copper) at all, or only targets ("scab infection period, protect new growth") and leave the product choice to the label and the inventory?
3. **(safety)** May an owner-marked "bloom" or "pink" stage feed the pollinator gate as `in-bloom` (stricter only)? That is a kernel input change, needs a `RULES_VERSION` bump and kernel tests, and must never let a stage mark a block "not in bloom".
4. **(safety)** The spray bulletin is written for commercial orchards with conventional programs. For garden households and organic or low-input Season Setup philosophies, should the calendar use the home-grounds guide (VCE 456-018), filter windows through `philosophyFilter.isProductAllowed()`, or show only scouting and cultural windows?
5. Should a degree-day estimate be shown when only one guide gives it, or require two agreeing sources (the R5 `gateEligible` rule)?
6. Which crops first: apple and pear only (one pome calendar), then peach and other stone fruit, leaving fig, pawpaw, nuts and citrus out?
7. Should marking a stage create dated tasks on /today (as care plans do), or only show windows on the calendar and the Planting Card?
8. Is a new plugin kind acceptable, or would you rather keep everything on the crop plugin (simpler loader, more duplication)?
