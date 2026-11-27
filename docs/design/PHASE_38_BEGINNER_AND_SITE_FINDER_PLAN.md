# Phase 38: beginner growers, a how-to-start guide, soil survey and Find a spot

Owner request, 2026-11-27: help beginner farmers with tips as they go, add a "how to start",
rewrite the landing page for novice and experienced growers of garden and row crops, and help
the grower choose a good place to plant using an aerial view, sun, trees and soil data.

## Owner rulings (2026-11-27)

| #   | Ruling                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-1 | Claude reads USDA NAIP aerial imagery (public domain, fetched on the server from the USGS National Map image service). Esri World Imagery tiles stay display-only and are never sent to an AI service.                 |
| O-2 | Soil data is its own module (`lib/soil`, USDA NRCS Soil Data Access / SSURGO), shown wherever it helps. It is survey data tagged `data`, never replaces a lab soil test and is never read by safety or fertility math. |
| O-3 | The aerial analysis is on every plan with a small daily cap (Free 1, Grower 5, Farm 10) drawn from the general monthly AI budget. Without AI the finder still works from sun math, drawn shade sources and soil data.  |
| O-4 | Beginner material is a public `/start` guide linked from the landing page, plus a "first time growing?" question in onboarding that turns on per-screen tips, switchable in settings.                                  |

## Clusters (one PR each, merged in this order)

| Cluster | What                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 38A     | Landing page rewrite in plain English for gardens, fields, animals and records; public `/start` guide with a garden track, a fields track and a plain-English word list.                                                                |
| 38B     | Beginner tips: per-user `users.beginner_tips` (migration 0098), onboarding question, `BeginnerTip` inline card on each main screen (seen state through the hints store, keys `tip_*`), settings switch and reset, Getting Started item. |
| 38C     | Soil survey module: SSURGO lookup by point with a global cache, plain-English description, siting flags, `/api/soil/**`, a lazy panel on Area Cards, /fertility and /settings/farm.                                                     |
| 38D     | Find a spot (`/plan/site-finder`): deterministic scoring from sun position, drawn shade sources, existing Areas, water and soil; optional Claude reading of a NAIP aerial photo through `aiTry()` + `aiGuard` (endpoint `site-finder`). |

## Design rulings

| #   | Ruling                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1 | Guide and tip copy gives process advice only. No rates, distances, day counts, hours, temperatures, pH targets or product names; pesticide mentions say to follow the label. Never the word "safe" as a claim.                                                       |
| P-2 | Tips are per user, not per farm. NULL means never asked and reads as off, so existing users and seeded test users see no change. The throwaway demo visitor gets tips on.                                                                                            |
| P-3 | A tip is an inline card that never covers controls, hides while a safety stop is on screen and is shown one teaching element at a time (an anchored Hint waits for the tip).                                                                                         |
| P-4 | Soil survey is online only. It is not in the offline snapshot, so `FARM_SNAPSHOT_VERSION` does not change. "No data here" and "could not reach the service" are different states and are never conflated.                                                            |
| P-5 | Soil siting flags come from NRCS's own classes (drainage, flooding, hydric) plus named app-owned slope and depth thresholds, shown as a rough guide.                                                                                                                 |
| P-6 | Find a spot scores are an app-owned rough guide tagged `fallback`; survey facts are `data`; anything Claude saw in the photo is `ai` and is a suggestion until the owner confirms it (a tree Claude saw becomes a shade source only when the owner adds it).         |
| P-7 | Claude's reading of the photo is validated on the server: positions inside the photo, a capped count, text through the spray-advice guard. An invalid answer falls back to the deterministic result tagged `fallback`. Claude never names a product or gives a rate. |
| P-8 | Find a spot never gates anything and never feeds the safety kernel. It ends in "Create this Area here", which uses the existing Area endpoints (owner only; helpers read and see "Ask the owner").                                                                   |
| P-9 | No safety-rule change; `RULES_VERSION` unchanged.                                                                                                                                                                                                                    |

As-built notes per cluster are added below as each PR lands.

## As built: 38D (Find a spot)

Page `/plan/site-finder`, endpoint `POST /api/site-finder`, AI endpoint name `site-finder`. No migration, no Dexie or snapshot change, no safety-rule change (`RULES_VERSION` unchanged), no new /today query.

### Modules

| Module                                         | What it holds                                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/siteFinder/types.ts`                      | Goals (`GOALS`: starting plot size, Area kind, search box cap, weights), `SearchBox`, `Obstacle`, `Candidate`, `Factor`, `SunSeason`.                                                                                                |
| `lib/siteFinder/geometry.ts`                   | Local metre frame, the Web Mercator photo frame (`photoExtentFor`, `imageToLonLat`, `lonLatToImage`), rectangle, circle, line and polygon distance tests, `geojsonShape`.                                                            |
| `lib/siteFinder/sun.ts`                        | `estimateSun`: half-hour sun samples on three summer days and the two ends of the frost-free season; a point is shaded when the ray toward the sun meets an obstacle within its shadow length.                                       |
| `lib/siteFinder/score.ts`                      | One value per factor (sun, drainage, depth, slope, water, house, trees) and `combine`: the weighted average of the known factors; unknown factors lower confidence only.                                                             |
| `lib/siteFinder/candidates.ts`                 | `findSpots` (grid, exclusions, top three that do not overlap, stable ties), `rescoreWithSoil`, `whyBlocked`.                                                                                                                         |
| `lib/siteFinder/explain.ts`                    | Factor sentences in English and Spanish (`sitefinder.*` catalog), distances in the viewer's units.                                                                                                                                   |
| `lib/siteFinder/aiAnswer.ts`                   | `parseAiReading` / `validateAiReading` (strict JSON, capped counts, positions in 0 to 1, every text through the photo-help spray guard; one bad item refuses the reading) and `seenFeatures`.                                        |
| `lib/siteFinder/apiSchemas.ts`                 | Request schema (also in OpenAPI) and the response type.                                                                                                                                                                              |
| `lib/server/siteFinder/naip.server.ts`         | One USDA NAIP photo from `imagery.nationalmap.gov` through `safeFetch` (host-pinned, no redirects, 15 s, 1.5 MB); a PNG answer or a tiny JPEG is "no coverage". Honours `WEATHER_FEEDS=off`. Never cached or stored.                 |
| `lib/server/siteFinder/aiSiteRead.ts`          | The prompt and the Claude call (Sonnet tier, 1,500 output tokens); a refused reading is thrown as spent so it still counts against the budget.                                                                                       |
| `lib/server/siteFinder/run.ts`                 | Tenant-scoped map load, at most four soil lookups a run, the deterministic result first, then the photo reading through `tryAiWithGuard`; any failure returns the deterministic result tagged `fallback` with a reason and a banner. |
| `lib/server/aiFixture/siteFinder.ts`           | Fixture Claude answer for e2e (marker `CROPCARD_FIXTURE:site-finder`).                                                                                                                                                               |
| `components/siteFinder/*`, `lib/farm/mapTiles` | The map (Areas, shade sources and water read-only, the search box, numbered spots) and the spot card. The satellite tile URL is now one constant shared with `BlockMap` and `LocationPicker`.                                        |

`safeFetch` gained `readBytes()` on the response it returns (`SafeFetchBinaryResponse`); every address, redirect, timeout and size check is unchanged.

### How it follows the rulings

- **O-1:** only the NAIP photo is sent to Claude. A source-scan test fails if any Find a spot server, API or engine file names the display tile service.
- **O-3:** daily caps Free 1, Grower 5, Farm 10, drawn from the general monthly budget (not a planning endpoint). Reserve `SONNET_VISION = $0.04` a call: a 1024 x 1024 photo is about 1,400 input tokens and the prompt about 700 ($0.0063 at $3 per million), plus at most 1,500 output tokens ($0.0225 at $15 per million), so $0.029 worst case, held as $0.04.
- **P-6:** sun, score and distance lines are tagged `fallback`; soil survey lines `data`; what the owner drew `manual`; what Claude saw `ai`. A tree or building Claude saw becomes a shade source only through "Add to my map", where the owner types a height (existing `POST /api/shade-sources`).
- **P-7:** the reading is validated on the server; a refused reading, no photo, no key, a limit or a timeout all return the deterministic result. Claude's spots never reorder: the engine ranks again with the `ai` obstacles, and a spot the engine dropped is shown with the engine's reason.
- **P-8:** nothing is saved by the endpoint. "Create this Area here" posts the spot's rectangle to the existing `POST /api/fields`. Helpers and inspectors see an explainer and "Ask the owner."

### App-owned rough-guide constants

None of these is an extension recommendation. All are named exports.

- `types.ts`: goal starting sizes and weights (`GOALS`), `GARDEN_BOX_MAX_M` 120, `FIELD_BOX_MAX_M` 400, `MIN_BOX_M` 8, `FALLBACK_SEASON` (mid April to mid October when no frost dates are saved).
- `sun.ts`: `MIN_SUN_ELEVATION_DEG` 10, `SUN_STEP_HOURS` 0.5, `MAX_SHADOW_M` 150, `DEFAULT_TREE_HEIGHT_FT` 40, `DEFAULT_BUILDING_HEIGHT_FT` 15, `DEFAULT_OTHER_HEIGHT_FT` 8, `BARE_TREE_SHADE_FRACTION` 0.3, `FULL_SUN_HOURS` 6, `PART_SUN_HOURS` 4, `SIDE_LEAD_HOURS` 1.
- `score.ts`: `SUN_HOURS_FOR_TOP_SCORE` 8, `SUN_SUMMER_SHARE` 0.7, `WATER_NEAR_M` 15, `WATER_FAR_M` 90, `WATER_FLOOR` 0.2, `HOUSE_NEAR_M` 15, `HOUSE_FAR_M` 120, `HOUSE_FLOOR` 0.3, `TREE_CLOSE_M` 6, `TREE_NEAR_M` 12 and their values, `SLOPE_VALUE`, `FLAG_CAUTION_VALUE`, `FLAG_NOTE_VALUE`, `DROUGHTY_VALUE`, `GOOD_VALUE`, `OK_VALUE`, `GOOD_SCORE` 60, `HIGH_CONFIDENCE_SHARE`, `MEDIUM_CONFIDENCE_SHARE`.
- `candidates.ts`: `GRID_STEP_SHARE` one third, `MAX_GRID_CELLS` 900, `MAX_SPOTS` 3.
- `aiAnswer.ts`: `AI_MIN_RADIUS_M`, `AI_DEFAULT_RADIUS`, `AI_TREE_LINE_HALF_WIDTH_M`, `AI_PAVEMENT_HALF_WIDTH_M`.
- `run.ts`: `MAX_SOIL_LOOKUPS` 4, `SOIL_SAME_POINT_M` 15, `SAME_FEATURE_MARGIN_M` 3, `DRAWN_POINT_RADIUS_M`, `DRAWN_LINE_HALF_WIDTH_M`.

The slope and depth bands are cluster C's (`lib/soil/siting.ts`).

### Limits and what is deferred

- The real Claude call was verified only through the fixture (no Anthropic key in the build environment). The prompt asks for one JSON object and the parser refuses anything else.
- The sun model is flat ground with one height per obstacle. Slope aspect, terrain shadow and shade from things outside the search box are not modelled; the page says what was not checked.
- Claude's notes are asked for and shown in English (marked `lang="en"`), as photo help does, because the spray guard reads English.
- No Getting Started item (it would need a /today read). The page has a beginner tip (`tip_site_finder`, cluster B's `lib/tips.ts`).
- The search box is a square the owner moves and resizes; a free-form box, a per-run sun diagram and saving past results are not built.
- A tree-line or building that Claude gives as a circle is saved as a 12-sided outline when added to the map.
