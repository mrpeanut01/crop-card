# Continuous bloom rulings (#676, 2026-10-09)

`isInBloom` in `apps/web/src/lib/safety/pollinatorBloom.ts` reads a crop plugin with `bloomWindow.continuous: true` as in bloom from first flower (`daysFromPlantingMin`, default 30 days) with no end. It feeds the `/api/fungicide/record` bloom gate (a bee-toxic fungicide is refused) and the "Expected in bloom today" hint on /spray/insecticide, which only pre-fills the farmer's own bloom answer. The bee-attractive crops on that branch are 43 cucurbits, the 4 alfalfa and red clover forage plugins, 11 cover legumes and the orchardgrass and timothy plugins (the 53 Solanaceae are `beeAttractive: false`).

#767 already dropped harvested and archived plantings from the bloom check from their harvested or archived time, and counts beds in the same Area as nearby. #793 shows crop names, not plugin ids, in "Expected in bloom today" and in the fungicide bloom notice.

Three panelists (safety, farmer usability, data provenance) ruled on what was left. No kernel change; `RULES_VERSION` is unchanged.

| Id   | Question                                                                  | Vote   | Ruling                                                                                  |
| ---- | ------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| PB-1 | Does any source found qualify to give continuous bloomers a bloom window? | a, 3-0 | No. Keep the continuous reading.                                                        |
| PB-2 | End cucurbit bloom at the farm's fall frost date?                         | a, 3-0 | No. Frost is not a sourced bloom end, and the stored date is a normal (about a median). |
| PB-3 | Close #676 or keep it open as needs-research?                             | a, 3-0 | Close by this ruling. The protective reading is the ruled behaviour.                    |

## What was searched (2026-10-08 and 2026-10-09)

- Virginia Tech, "A Beekeeper's Year in a Virginia Apiary" (Powhatan County Extension): names a month a plant is in bloom ("May: Clover…", "August: Alfalfa…"), never a start or an end.
- Oklahoma State EPP-7155: alfalfa nectar "May 10 to Frost". Not a mid-Atlantic source.
- Rutgers FS1222 (Blooms for Bees): no alfalfa, clover or cucurbits.
- Xerces, University of Delaware and SARE "Pollinator Plants: Mid-Atlantic Region" lists, and NRCS Cape May PMC Technical Note 3: native pollinator species only.
- Penn State, UMD (FS-2023-0692) and Cornell cover crop pages and the SARE cover crops and pollinators chart: pollinator value ratings, no bloom calendar.
- Virginia Cooperative Extension alfalfa pages: no first-flower date found; Iowa State, UGA and UNL give growth-stage advice only.
- NASA Goddard HoneyBeeNet regional forage lists (honeybeenet.gsfc.nasa.gov): rejected. They reproduce Ayers and Harman, chapter 11 of the commercial book _The Hive and the Honey Bee_ (Dadant, 1992), so the primary source is not a land-grant or government publication. They also would not fix the complaint: Virginia region 11 does not list alfalfa, gives red clover April to September and crimson clover April to July (both already in bloom in mid-April), and Virginia region 12 lists Cucurbita and cucumber as blooming January to December.
- No source gives days of bloom from first flower for any crop on the branch.

## PB-1. No bloom window for continuous bloomers

A pollinator stop may only be narrowed on a quoted primary source, and none was found. The one source with start and end months is a secondary copy of a commercial book that does not list alfalfa for Virginia and starts clover bloom in April.

## PB-2. No frost-based end

No source names the first fall frost as the end of bloom. The farm's fall frost date is a NOAA 1991-2020 normal, so frost comes later in about half of years, while the plants can still flower; coastal Virginia data lists cucurbits in bloom all year. Passing farm climate into the gate would be a kernel change made only to shorten a stop with nothing sourced behind it. A finished planting leaves the check when the farmer harvests or archives it (#767).

## PB-3. Accepted cost and reopen condition

- Accepted cost: the fungicide bloom gate may refuse a bee-toxic fungicide (ZeroTol 2.0, OxiDate 2.0, Trilogy, Topsin M WSB, Rovral 4F) on an established alfalfa, clover or cover legume stand outside its real bloom, such as April, and an unharvested old cucurbit planting keeps reading as in bloom. On /spray/insecticide the hint only pre-fills the answer and the farmer can change it.
- Reopen when a mid-Atlantic .edu or .gov source (or a label) states a planted crop's bloom start and end, or its days of bloom from first flower, quoted word for word in `apps/web/scripts/crop-data-sources.json`. That change goes in `pollinatorBloom.ts` with a `RULES_VERSION` bump and vitest and fast-check tests showing it only narrows where sourced.
- Follow-up (usability panelist, not a condition of the ruling): a plain line beside the expected-bloom hint and the fungicide bloom notice saying a continuous bloomer is treated as in bloom from first flower and that harvesting or archiving the planting ends it, in English and Spanish.
