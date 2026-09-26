# Garden designer: interaction spec (Phase 30E)

Status: ratified for build, 2026-09-26. Route: `/plan/areas/[id]/design`.

This is the concrete spec behind [`PHASE_30_AREAS_CARDS_ONBOARDING.md`](PHASE_30_AREAS_CARDS_ONBOARDING.md) §6 "The garden designer" and its "Decisions (2026-09-26)". Where the two differ, the Decisions section wins, then this file. The shared TypeScript contract lives in `apps/web/src/lib/garden/` (see [§22](#22-contract-files)).

The designer is where the drill-down pays off: farm map, then a garden or greenhouse Area, then its beds, then the crops in each bed over time. Seedtime proved the model (a feet grid, beds with handles, crops placed on a timeline, successions, bed history). Its weak spots are ours to fix: it is desktop-only, it has no drill-down from property to bed, it does not work offline and it prints poorly. LiteFarm never maps beds at all.

## 1. Who it serves

- **A first-time household gardener.** A 20×30 ft kitchen garden with two 4×8 raised beds, tomatoes and lettuce. Uses a phone, often one-handed, sometimes with gloves. Has no Anthropic key. Needs to see "what goes where, and when is that bed free again", in plain words.
- **A small market farm's high tunnel.** A 30×96 ft tunnel with four 3×90 ft beds and successions of greens every two weeks. Uses a tablet in the tunnel and a laptop in the office. Needs accurate plant counts, fast succession entry and a printed bed map on the tunnel door.

Both need the same thing from the timeline: pick a date, see what is in every bed, see where the gaps are.

## 2. Principles

1. **Beds are blocks.** Each bed or container is a `blocks` row (`kind = 'bed' | 'container'`) inside the Area (`fields` row). Everything that already works on blocks (plantings, tasks, spray records, harvest, pollination grouping, exports) works on beds with no special case.
2. **Layout is illustrative.** Positions live in the Area's own feet grid (`x_ft`, `y_ft`, `rotation_deg`). The `AreaFrame` brand in `lib/garden/types.ts` keeps these shapes out of pollination distance, shade and weather code, which read map geometry only.
3. **Tap first, drag second.** Every action has a tap or button path that works one-handed on a phone. Dragging is a shortcut on tablet and desktop, never the only way.
4. **Real DOM, not pixels.** The canvas is Svelte 5 SVG with a `viewBox` in feet. Each bed is a focusable element with a role and a label, so keyboards, screen readers and Playwright reach it without coordinates. No Konva, Fabric or Leaflet for beds.
5. **AI assists, never gates.** "Fill this bed" goes through `aiTry()`. With no key it returns a deterministic plan tagged `fallback`, and the whole designer works end to end.
6. **Owner edits, everyone reads.** Helpers and inspectors see the designer read-only. The server enforces this on every write.

## 3. Entry points

| From                                     | Control                                                                                  | Goes to                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Area Card (garden or greenhouse kind)    | Primary **Open designer** button                                                         | `/plan/areas/[id]/design`                                                   |
| Farm map, tapping a garden or greenhouse | Area Card sheet, then **Open designer**                                                  | same                                                                        |
| `/plan` left rail                        | "Gardens" group listing each designable Area with its Size ("Kitchen Garden · 20×30 ft") | same                                                                        |
| Getting Started card                     | "Design a garden bed" row                                                                | the owner's first designable Area, or the map's Add drawer when none exists |
| Bed or Planting Card                     | "Show in garden" link                                                                    | same route with `?bed=<blockId>` selected and `?on=YYYY-MM-DD`              |

Other Area kinds return 404 for this route with a link back to the Area Card. Query parameters: `bed` (selected bed), `on` (scrubber date), `view=list` (open in List view).

## 4. Screen layout by device

Breakpoints match the app shell: phone below 640 px, tablet 640 to 1023 px, desktop 1024 px and up.

| Region                                  | Phone                                                                    | Tablet                               | Desktop                        |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ | ------------------------------ |
| Header                                  | Area name + Size, Canvas/List toggle, overflow menu (Print, Area Card)   | same, Print visible                  | same                           |
| Time scrubber                           | Full width under the header, sticky                                      | same                                 | same                           |
| Canvas                                  | Full width, fit to width                                                 | Left 2/3                             | Center                         |
| Bed toolbar                             | Bottom bar of 48 dp buttons when a bed is selected; preset bar otherwise | Floating bar above the canvas        | Same as tablet                 |
| Crop panel                              | Bottom sheet, opened by **Add crop**                                     | Right column, collapsible            | Right column                   |
| Bed sheet (details, Plantings, History) | Bottom sheet over the canvas, half height, drag to full                  | Right column replaces the crop panel | Right column, crop panel stays |

Resize handles show on tablet and desktop only. On a phone, size changes go through the numeric **Size** field, which also exists on larger screens. Rotate, nudge, duplicate, rename and delete are buttons on every device.

## 5. Canvas

- **Size.** From the Area's typed Size (`width_ft` × `length_ft`) when set. Otherwise from the drawn polygon's bounding box in feet, with the polygon outline drawn faintly inside it for context. Otherwise 20×30 ft with a banner saying the garden has no Size yet and a link to set it in Draw your farm (`/plan/farm`). (`canvasFromArea`, `source: 'dimensions' | 'polygon-bbox' | 'default'`).
- **Axes.** `x` runs across the Area's width, `y` down its length, origin at the top-left. When the Area has map geometry, width runs west to east and length north to south, and a north arrow shows at the top-right. Dimension-only Areas show no arrow.
- **Grid.** Light lines every 1 ft, stronger every 5 ft; below 8 px per foot only the 5 ft lines draw. Rulers along the top and left edges in feet.
- **Zoom and pan.** Pinch or Ctrl/Cmd+wheel zooms around the pointer; two-finger drag, wheel or dragging empty ground pans. Buttons (48 dp): **Zoom in**, **Zoom out**, **Fit**. Zoom ranges from "whole Area fits" to 96 px per foot. Opening the page fits the Area.
- **Landmarks.** `shade_sources` rows attached to this Area (trees, fences, buildings) render as muted shapes with labels. They are read-only in v1; editing stays on the farm map.

## 6. Beds

### Presets

The preset bar (shown when nothing is selected) holds `BED_PRESETS` from `lib/garden/geometry.ts`:

| Preset          | Kind      | Style     | Size                      |
| --------------- | --------- | --------- | ------------------------- |
| 4×8 raised      | bed       | raised    | 4 × 8 ft                  |
| 3×10 in-ground  | bed       | in-ground | 3 × 10 ft                 |
| 30 in row       | bed       | in-ground | 2.5 × 20 ft               |
| 5 gal container | container | container | 1 × 1 ft                  |
| Custom          | bed       | raised    | opens the Size form first |

**Adding.** Tap a preset, then tap the ground where the bed's top-left should go. On tablet and desktop the preset can also be dragged onto the canvas. Tapping a preset twice drops it at `freeSpot()`. A new bed is named "Bed N" with the lowest unused N ("Pot N" for containers) and saved right away through `POST /api/blocks`.

### Actions

| Action     | Pointer                                                 | Toolbar (48 dp)                                                                                      | Keyboard (bed focused)                                                             |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Select     | Tap the bed                                             | n/a                                                                                                  | Tab to it, then Enter                                                              |
| Move       | Drag the bed body (6 px threshold before a drag starts) | **Move**, then tap the new top-left; or the nudge pad (6 in per tap)                                 | Enter to pick up, arrows move 6 in, Shift+arrows 5 ft, Enter drops, Escape cancels |
| Resize     | Drag the corner handle (tablet/desktop)                 | **Size**: W × L fields in feet with 6 in steppers                                                    | Alt+arrows change width and length by 6 in                                         |
| Rotate 90° | n/a                                                     | **Turn**                                                                                             | R                                                                                  |
| Duplicate  | n/a                                                     | **Duplicate** (same size and style, placed by `freeSpot` next to the original, plantings not copied) | D                                                                                  |
| Rename     | Double-click the label                                  | **Rename** (inline field in the bed sheet)                                                           | F2                                                                                 |
| Delete     | n/a                                                     | **Delete**, with a confirm that lists planned plantings removed with it                              | Delete, then confirm                                                               |
| Deselect   | Tap empty ground                                        | **Done**                                                                                             | Escape                                                                             |

**Snapping.** Positions and sizes snap to 6 in (`SNAP_FT = 0.5`), rounded half away from zero. Minimum bed size is 1 ft.

**Clamping.** A bed always stays fully inside the canvas. Moves and resizes clamp to the edge (`clampToArea`); a rotation that cannot fit anywhere is refused with "Bed 3 won't fit turned. Make the garden bigger or the bed shorter." (`rotate90` returns null).

**Overlap.** Beds may not overlap; shared edges are fine. A drop onto another bed returns the bed to where it was, with "Beds can't overlap". The server checks both rules on every layout write (`OUTSIDE_AREA`, `OVERLAP`).

**Rotation.** Stored in 90° steps. `widthFt`/`lengthFt` are the bed's own size; at 90° and 270° the canvas box swaps them. Rotation turns about the bed's center, then snaps and clamps. Footprints inside a bed keep their bed-relative inches, so turning a bed turns its plantings with it.

**Delete guard.** Deleting a bed that holds anything beyond `planned` plantings (an active or harvested planting, or any spray, harvest or task record) is refused: "Bed 2 has records, so it stays. Delete it from the Plan page if you really mean it." The designer calls `DELETE /api/blocks/[id]?ifEmpty=1`, which returns 409 `BED_HAS_RECORDS` in that case.

**Persistence.** Each committed change (drop, resize end, turn, rename) is one `PATCH /api/blocks/[id]`. The canvas updates optimistically and rolls back with the server's message on failure. Beds without a stored position (created on the farm map or before 30E) are laid out with `freeSpot` in name order, drawn dashed with "Not placed yet", and saved on their first move.

## 7. Crop panel and placing crops

**Panel contents.**

1. **This season:** plantings in this Area's beds with no footprint yet (for example from the allocation wizard), with date and planned quantity.
2. **Search crops:** type-ahead over the crop plugins (display name and family), grouped by family, each row with days to maturity and spacing. Recently used crops in this Area sort first.

**Tap to place (every device).** Tap a crop. A banner reads "Tap a bed to place Tomatoes · Cancel". Tap a bed, and the planting lands at the tap point:

- Size: the footprint that holds the planned quantity (`footprintForCount`), else the bed's full width by 2 ft, then fitted into free space with `fitFootprint`.
- Date: the planting's own date when scheduled, else the scrubber's date. New plantings from search are created `planned` with that date.
- No room on that date: "No room in Bed 2 on Apr 1. It opens Jul 1." with **Place on Jul 1** and **Cancel**.

**Drag to place (tablet, desktop).** Drag a crop row onto a bed with Pointer Events (not HTML5 drag and drop, so touch and mouse behave alike). A mouse drags the row itself after 6 px; touch drags only from the row's 48 px handle (`touch-action: none`), so a finger on the rest of the row still scrolls the list. A ghost footprint shows the spot `placeCrop` will pick on that date (the same `fitFootprint` search), rust when the bed has no room then, and a chip by the pointer names the bed. Dropping off the beds places nothing, and Escape puts it back. The canvas lends the panel a `locate` function for the hit test; the List view has no drag.

**Moving a planting.** Select a footprint and drag it, or use **Move** and tap. Within a bed any status can move. Moving to another bed is allowed only while the planting is `planned`; an active or harvested planting says "Tomatoes are already in the ground in Bed 1. Record a new planting instead." (server `IN_GROUND`).

**Sharing space.** Two footprints may overlap in space when their occupancy intervals do not overlap in time. Overlap in space and time is allowed (interplanting) but shows a warning chip: "Shares space with Lettuce until Jul 1."

All placement writes use `PUT /api/garden/plantings/[cropId]/footprint` or `POST /api/garden/plantings`.

## 8. Footprints and plant count

A footprint is `{x_in, y_in, w_in, l_in}` in the bed's own unrotated inches (`lib/farm/footprint.ts`). Footprints snap to 6 in (12 in for square-foot pattern), are at least one step each way and stay inside the bed (`clampFootprint`).

**Stretching.** Tablet/desktop: drag the footprint's corner handle. Every device: the planting row's **Size** field (W × L in inches or feet). The plant count updates live as the size changes.

**Spacing** (`resolveSpacing`):

| Source                 | In-row                                     | Between rows                                             | Count provenance |
| ---------------------- | ------------------------------------------ | -------------------------------------------------------- | ---------------- |
| Plugin planting guide  | midpoint of `plantingGuide.inRowSpacingIn` | `plantingGuide.rowSpacingIn` (in-row value when missing) | `data`           |
| Plugin without a guide | `defaultRowSpacingInches`                  | same                                                     | `fallback`       |
| Nothing on the plugin  | 12 in                                      | 12 in                                                    | `fallback`       |
| Owner typed spacing    | typed value                                | typed value                                              | `manual`         |

**Patterns** (`spacing_pattern`), with rows running along the bed's length:

- **Rows** (`square`): `rows = floor(w / rowIn)`, `perRow = floor(l / inRowIn)`, `count = rows × perRow`.
- **Offset** (`offset`, intensive hex): spacing `s = inRowIn` both ways, row pitch `p = s × √3 / 2`. `rows = floor((w − s) / p) + 1` when `w ≥ s`, else 1. Even rows hold `floor(l / s)`, odd rows `floor((l − s/2) / s)`.
- **Square foot** (`sfg`): cells are 12 in. When `s ≤ 12`, each cell holds `floor(12 / s)²`; when `s > 12`, a plant takes `k = ceil(s / 12)` cells each way and `count = floor(cellsW / k) × floor(cellsL / k)`.

Every result is at least 1 (`plantCount`). The count shows with its `<Provenance>` tag. Typing a count stores it as `manual`; after that, stretching keeps the typed count and offers **Recount from spacing**. `plant_count`, `plant_count_provenance`, `spacing_in`, `row_spacing_in` and `spacing_pattern` are the stored columns (migration 0051). The server recomputes the count from spacing on every footprint write that omits `plantCount`, so the client cannot store a `data` count that does not match.

## 9. Time scrubber

A date slider under the header shows the season (`scrubRange`: Jan 1 to Dec 31 of the season year, widened to cover any planting that runs past it). It opens on today, or on `?on=`. Tick marks sit on last spring frost, first fall frost and every day a bed changes (`occupancyChangeDays`). A **Today** button returns to today.

**Occupancy** (`plantingOccupancy`), shared with `scheduleCandidacy`:

- Start: planting date.
- Harvest starts: start + `daysToMaturity.min` (or `max`, or 90 days).
- Harvest ends: start + `daysToMaturity.max`, then the archetype's tail (`ARCHETYPE_HARVEST_TAIL`): 21 more days for cut-and-come-again leafy crops, until first fall frost for continuous-harvest fruit, the whole season for perennials and forage, none for the rest. A recorded `harvestedAt` replaces the estimate.
- End: harvest end + 10 day bed turnover (`BED_TURNOVER_DAYS`).
- Unscheduled, failed and archived plantings are not on the timeline.

The build agent moves `computeBlockOccupancy` in `lib/schedule/scheduleCandidacy.ts` onto `plantingOccupancy`, so the allocation wizard's free windows and the designer's shading always agree. That changes the wizard's windows for continuous-harvest and cut-and-come-again crops, which is intended; its tests update with it.

**What the canvas shows on the chosen date** (`bedOccupancyOn`):

- Footprints of plantings in the ground that day, colored by family, with name and count. Plantings still to come are hidden unless **Whole season** is on, which draws them as faint outlines.
- Free space in each bed is hatched. An empty bed carries "Open from Jul 1" (the day its last occupant left) or "Open" when nothing has grown there this season. A full bed carries a small "Open from Nov 3" chip (the next free day).
- Stage chips on footprints: "Growing", "Harvesting".

A polite live region reads a summary after the slider settles (500 ms): "July 15. Bed 1: Tomatoes, harvesting. Bed 2: open from July 1."

## 10. Succession

**Add succession** is on each planting row in the bed sheet and on a selected footprint's toolbar.

1. A sheet shows "Sow again every 14 days" (interval from `FAMILY_SUCCESSION_DAYS` for the crop's family, editable, `manual` once edited) and "How many more?" (1 to 5).
2. `proposeSuccession` previews each sowing on the canvas as a dashed ghost: same footprint size, the free spot in the same bed closest to the anchor on its date. A sowing that has no room, or would not mature before first fall frost, shows its reason and is left out unless the owner changes the count or interval.
3. **Add N sowings** commits through `POST /api/garden/beds/[blockId]/succession` (`commit: true`), which calls `createPlantingGroup` with `systemKind: 'succession'` and the anchor's footprint, spacing and pattern on each member.

Families with a 0-day interval (tomatoes, squash) show "Tomatoes don't usually succession-sow here. Plant once." and no form. Linked sowings move together in time: changing the anchor's date shifts every member by the same number of days and re-anchors their tasks. A sowing not yet in the ground can move to another bed by drag, by **Move** and a tap, or by **Move to bed** in the bed sheet and List view. It keeps its group link (and still follows the anchor's date), lands on the first spot free for its whole time there, and the server refuses a spot another planting holds then (`OVERLAP`, see `linkedSowingClash`), a spot past the bed edge and a sowing already in the ground (`IN_GROUND`). Linked sowings never share space the way a hand-placed interplanting may.

## 11. Bed sheet: details, Plantings, History

Selecting a bed opens its sheet with three tabs.

- **Details:** Name, Style (raised, in-ground, container, vertical), Size (W × L ft), position (from west, from north), and the Bed Card link.
- **Plantings:** this season's plantings in date order, each with date, size, count and provenance, and **Add succession**, **Change date**, **Remove from bed**. **Use a bed recipe** and **Fill this bed** sit at the bottom.
- **History** ("Bed history"): past plantings from `crops` by `block_id`, grouped by season, newest first, up to four seasons back (`bedHistory`).

**Rotation warnings.** When a crop is placed or proposed, `rotationWarnings` checks its family against the bed's history using `buildRotationSuggestion` and the family plant-back years. A same-family repeat inside the window shows on the placement and in the Plantings tab: "Tomato family grew here in 2025. Rotating away for 3 years cuts disease carryover." `warn` renders amber, `suggest` renders muted. Warnings never block a placement.

**Companion hints.** `companionHints` reads companion plugins for plantings that share time in the same bed or in beds within 4 ft of each other (`adjacentBeds`). A pair is a good neighbour when both crops are in one plugin's `goodWith` (the pairing `lib/layout/buildInput.ts` already uses), or when one is in `goodWith` and the other's family matches the plugin's `primaryFamily` or a `members[].family`. A pair is keep-apart when both are in one plugin's `badWith` (every listed crop against every other), or when one is on side `a` and the other on side `b` of one of its `keepApart` entries (`{ a, b, reason, source? }`; two crops on the same side never pair, so 28 tomato varieties against 6 potatoes flags no tomato next to a tomato). `lib/plugins/companionRelations.ts` owns both readings (`keepApartMatch`, `companionIndex`), and the layout engine input (`lib/layout/buildInput.ts`) and the allocation endpoints (`/api/plan/allocate`, `/api/plan/allocate/refine`) build their per-crop partner lists from the same helper, so all three agree; `badWith` no longer pairs with `goodWith` anywhere. A `keepApart` member that names no crop plugin loads with a registry warning, and the seed-library test fails on one. The first entry is `tomato-potato-late-blight` (WVU Extension, sources in `apps/web/scripts/crop-data-sources.json`). Good neighbours show as a green chip with the plugin's `benefit` line; keep-apart pairs show amber with the entry's reason: "Keep apart: Celebrity (Bed 2) and Kennebec (Bed 3). Late blight (Phytophthora infestans) spreads between them." Keep-apart sorts first. Hints never block.

## 12. Bed recipes

Seedtime calls these Garden Blocks. Ours are data-only plugins under `plugins/bed-recipes/`, validated by `bedRecipePluginSchema` (`packages/plugin-validation/src/schemas.ts`), published as `schemas/bed-recipe.schema.json` through `gen:schemas`, and registered by their own registry pass (Invariant 2). They are not part of `pluginSchema`, so no existing `plugin.type` switch changes.

A recipe has a reference `bedSize`, an optional `frostFreeDays` range, a display-only `zoneLabel`, and 1 to 12 `steps`. Each step names a crop (with up to 5 alternates), a start anchored to last spring frost, first fall frost or the end of an earlier step, a `section` of the bed as fractions, an optional pattern and optional successions.

Every crop a recipe names, alternates included, must be a registered crop plugin, or the recipe fails registration. Timing comes from plugin data: "the end of an earlier step" is that step's occupancy end (days to maturity, the archetype tail and bed turnover), succession intervals default to `FAMILY_SUCCESSION_DAYS`, spring offsets never start a crop before its hardiness allows (`EARLIEST_OFFSET_DAYS`), and the three sisters offsets are the Three Sisters companion plugin's. Successions split the step's section into equal slices along the bed's length, one per sowing. A step whose earlier step was skipped is skipped too.

**Apply flow.**

1. **Use a bed recipe** lists recipes; ones whose frost-free range fits the farm (`recipeFits`) come first with "Fits your season", others are shown muted with the reason.
2. Choosing one previews it (`applyRecipe`, `commit: false`): each step as a dashed ghost on the bed and a row with crop, date, size, count and the `plugin` provenance tag. Steps that cannot be placed (unknown crop, too short a season, no room) are listed with the reason.
3. Each row has **Keep**/**Skip** (all kept by default). **Add N plantings** commits the kept keys through `POST /api/garden/beds/[blockId]/recipe` (`lib/server/garden/recipe.ts`). The server recomputes the recipe from the bed as stored with the same `applyRecipe`, saves the kept steps as `planned` plantings with `plugin` provenance in one transaction, and refuses the whole commit with `STALE` when a kept key is no longer in its plan (the bed changed since the preview).

v1 ships seven recipes: "Spring greens, bush beans, fall brassicas", "Garlic, then summer squash", "Radishes, then tomatoes", "Carrots, then fall spinach", "Three sisters in a 4×8 bed" and "Tomato and basil" (all 4×8), and "Salad succession" (3×10). Peas are left out on purpose: their archetype holds the bed until frost, so nothing can follow them.

## 13. Fill this bed (optional AI)

**Fill this bed** on the Plantings tab asks for proposals for the bed's free space on the scrubber's date.

- The endpoint `POST /api/garden/beds/[blockId]/fill` runs through `aiTry()` (endpoint name `garden-fill`, an `aiGuard` quota of 10 a day) with `deterministicFill` as the fallback.
- Claude sees the owner's unplaced planned crops, the bed's size, occupancy and history, frost dates and candidate recipes. The server validates every AI proposal (registered crop, inside the bed, no time overlap with existing plantings, date inside the crop's `scheduleCandidacy` window) and drops the rest. If none survive, the fallback answers.
- The deterministic fallback applies the best-fitting recipe when one fits, else packs the owner's unplaced planned crops into free space by spacing.
- The response lists proposals, each drawn as a ghost and listed with `<Provenance source="ai">` or `fallback`. Each row has **Accept**/**Skip**, none accepted by default. **Add accepted (N)** sends them to `POST /api/garden/plantings` with their `source`, and the server recomputes each count from spacing.
- Without a key, the banner reads: "Claude is off, so this is a plain plan from the Salad succession recipe. Everything here works the same." There is no error state and no dead end.

The request never gates anything else on the page, and a timeout falls back within 6 s.

## 14. List view

**Canvas/List** in the header switches views and is remembered per user in `localStorage`. The List view can do everything the canvas can:

- A table of beds (name, kind and style, Size, position, rotation, what is in it on the scrubber date, open-from date), sorted by name.
- Each row expands to the same bed sheet (Details, Plantings, History) with the same buttons: Size, position fields (from west, from north, in feet), Turn, Duplicate, Rename, Delete, Add crop, Add succession, Use a bed recipe, Fill this bed.
- **Add bed** asks for a preset and fills the position from `freeSpot`.
- The scrubber stays on top and drives the "in it on" and "open from" columns.

The List view opens by default when the window is narrower than 320 px; otherwise the user chooses. Playwright covers both views with the same scenarios.

## 15. Roles

- **Owner:** full editing.
- **Helper and inspector:** the same page read-only. The toolbar, preset bar, handles and write buttons are gone; the scrubber, zoom, List view, bed history, hints and print remain. A banner reads "View only. The farm owner changes the layout."
- **Server:** `GET /api/garden/areas/[id]/design` is readable by every role. Every garden write endpoint calls `requireOwner`. On `/api/blocks`, creating or patching a `bed` or `container`, or any layout field, also requires the owner role. Every write runs `rejectForeignRefs` on `blockId`, `fieldId` and `cropId`, checks the block's Area is a garden or greenhouse (`NOT_DESIGNABLE`), and reads and writes only through the tenant helpers.

## 16. Offline

- The page's universal loader (`routes/plan/areas/[id]/design/+page.ts`) fetches `GET /api/garden/areas/[id]/design`. When that fetch fails in the browser (a client-side visit with no signal), it builds the page from the Owner's offline snapshot with `designerDataFromSnapshot` (`lib/garden/offlineDesign.ts`, over `designFromSnapshot`, which gains each planting's `footprint`, `spacingPattern`, `groupId` and `groupSystemKind`). That page has no crop search beyond the Area's own crops, no recipes and no companions, and it reloads its data when the connection comes back. With no saved snapshot it says so and points to Cards.
- Offline, the designer is read-only with "You're offline. This layout is from Sep 26, 9:40 am. Editing needs a connection." Scrubbing, zoom, List view, history and print all work.
- A write that fails because the connection dropped rolls back and says "That change didn't save because you're offline." v1 does not queue designer edits.

## 17. Print

The Area Card for a garden or greenhouse gains a **Garden bed map** section in its print variant (§7 of the Phase 30 doc): a black-and-white SVG of the beds to scale with names, what is in each bed on the print date (patterns, not color alone), a scale bar, the north arrow when known, and a legend listing each bed's plantings with dates and counts. **Print** in the designer refreshes the card snapshot when there is signal (waiting at most 4 s), then opens `/cards/area/<key>?on=<scrubber date>&print=1`; the card draws its bed map for that date (`BuildOptions.bedMapOnMs`) and opens the print dialog once, dropping `print` from the URL so a reload never reprints. It works offline from the saved snapshot.

## 18. Accessibility

- **Structure.** The canvas is a `role="group"` labelled "Kitchen Garden layout, 20 by 30 feet". Each bed is a focusable `<g>` with `role="button"`, `aria-pressed` for selection and a label such as "Bed 1, 4 by 8 foot raised bed, 2 feet from west, 3 feet from north. On July 15: Tomatoes, 3 plants." Footprints inside the selected bed are focusable buttons too.
- **Focus order.** Header, scrubber, Canvas/List toggle, preset bar or bed toolbar, beds in reading order (top to bottom, then left to right), crop panel, bed sheet. Selecting a bed moves focus into its sheet on phones and keeps it on the bed elsewhere. Closing a sheet returns focus to the bed.
- **Keyboard move.** Enter picks a bed up, arrows move it, Enter drops, Escape puts it back; this is announced: "Bed 1 picked up. Use arrow keys to move, Enter to drop."
- **Scrubber.** A native `input type="range"` with `aria-valuetext` as a date ("July 15"). Arrows move a day, PageUp/PageDown jump to the previous or next change, Home/End to the season's ends.
- **Announcements.** One polite live region for results ("Bed 1 moved to 4 feet from west", "Beds can't overlap", the scrubber summary). Errors that undo a change use an assertive region.
- **Targets and contrast.** All buttons at least 48 × 48 px. Bed and footprint hit areas pad invisibly to 48 px where they are drawn smaller. Text and bed outlines meet WCAG AA against the grid. Families use pattern plus color. Motion respects `prefers-reduced-motion`.

## 19. First-use hints

Through the 30B `components/ui/Hint.svelte` and `lib/client/hints.ts`, at most one per view, never over a safety STOP. The anchors are `data-hint-anchor="garden_designer"` on the preset bar and `data-hint-anchor="designer_scrubber"` on the scrubber; both stay hidden while the crop panel is open or a bed or crop is being placed, so the bubble never sits over the tap target.

- `garden_designer`: owners only, on the first visit, anchored to the preset bar. "Pick a bed size, then tap the garden to put it there. Tap a bed to move, turn or size it."
- `designer_scrubber`: anyone, on a later view once the Area has a scheduled planting, anchored to the slider. "Slide through the season to see what's growing in each bed and when it opens up."

## 20. Calendar link

- **Change date** on a planting (bed sheet or List view) sends `plantingDateMs` in the footprint write. The server calls `setSchedule`, then `reanchorCropTasks` with the old and new dates, and group members follow the anchor.
- A date moved on `/plan`'s Gantt changes the same `plantingDate`, so the designer shows it on next load.
- The designer never writes task rows itself.

## 21. API

| Method and path                                | Who            | Body / response (`lib/garden/api.ts`)             |
| ---------------------------------------------- | -------------- | ------------------------------------------------- |
| `GET /api/garden/areas/[id]/design`            | any role       | `GardenDesignResponse`                            |
| `POST /api/blocks`                             | owner for beds | `BedCreateRequest`, `{ block }` (existing)        |
| `PATCH /api/blocks/[id]`                       | owner for beds | `BedPatchRequest` (existing)                      |
| `DELETE /api/blocks/[id]?ifEmpty=1`            | owner          | 409 `BED_HAS_RECORDS` when not empty              |
| `PUT /api/garden/plantings/[cropId]/footprint` | owner          | `FootprintWriteRequest`, `FootprintWriteResponse` |
| `POST /api/garden/plantings`                   | owner          | `PlantingCreateRequest`, `PlantingCreateResponse` |
| `POST /api/garden/beds/[blockId]/succession`   | owner          | `SuccessionRequest`, `SuccessionResponse`         |
| `POST /api/garden/beds/[blockId]/recipe`       | owner          | `RecipeRequest`, `RecipeResponse`                 |
| `POST /api/garden/beds/[blockId]/fill`         | owner          | `FillRequest`, `FillResponse`                     |

Errors use `GardenErrorResponse` with a `code`. Request schemas are exported as `_requestSchema` from each new endpoint (SvelteKit refuses any other non-handler export from `+server.ts`).

The data track also takes placement on the existing planting routes: `PATCH /api/crops/[id]` with `{ action: 'set-placement', ...FootprintWriteRequest }` (owner only) and `POST /api/blocks/[id]/plantings` with optional `footprint`, `spacingPattern`, `spacingIn`, `rowSpacingIn` and `plantCount`. Both go through `lib/server/garden/placement.ts` (`writeFootprint`, `createPlacedPlantings`, `resolveDesignableBed`), which the `/api/garden/plantings` endpoints are meant to wrap.

## 22. Contract files

| File                                                                | State in `p30e-base`                            | Filled by                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `lib/garden/types.ts`                                               | complete                                        | n/a                                                                                                 |
| `lib/garden/api.ts`                                                 | complete (Zod schemas and types)                | n/a                                                                                                 |
| `packages/plugin-validation/src/schemas.ts` `bedRecipePluginSchema` | complete                                        | registry pass + `gen:schemas` entry by the recipes agent                                            |
| `lib/garden/geometry.ts`                                            | presets and constants complete, functions throw | geometry agent (unit + fast-check: clamp stays inside, four turns are identity, snap is idempotent) |
| `lib/garden/plantCount.ts`                                          | throws                                          | geometry agent (table tests including §23's numbers)                                                |
| `lib/garden/occupancy.ts`                                           | constants complete, functions throw             | timeline agent (also refactors `scheduleCandidacy`)                                                 |
| `lib/garden/succession.ts`, `rotation.ts`                           | throw                                           | timeline agent                                                                                      |
| `lib/garden/recipes.ts`                                             | throws                                          | recipes agent                                                                                       |
| `lib/garden/design.ts`                                              | throws                                          | page agent                                                                                          |

`PHASE_30_AREAS_CARDS_ONBOARDING.md` names a single `lib/garden/designer.ts`; the geometry lives in `geometry.ts` and the rest is split by concern as above.

**UI track (as built).** The page's universal loader (`routes/plan/areas/[id]/design/+page.ts`) reads `GET /api/garden/areas/[id]/design`, which builds the design server side through `lib/server/gardenDesignLoad.ts` (`loadDesignerResponse`), and the page body is `components/garden/DesignerPage.svelte`; `lib/garden/design.ts` holds the shared pure builder (`buildGardenDesign`, `layoutBeds`, `designFromSnapshot`, `landmarkRect`, `designerHref`). Additive contract changes: `GardenDesign.unplacedBedIds?` and `GardenDesign.landmarks?` (`DesignLandmark`) in `types.ts`, and `CardModel.links?` plus `CardModel.bedMap?` (`CardBedMap`) in `lib/cards/model.ts` for the Area Card's **Open designer** link and bed-map thumbnail. The client writes through the routes that exist today: beds through `/api/blocks` (which now refuses overlapping or out-of-Area beds with `OVERLAP` / `OUTSIDE_AREA`, is owner-only for every write through `requireOwner` (a helper gets 403, which the designer shows as view-only), and honours `DELETE ?ifEmpty=1` with `BED_HAS_RECORDS`), placement through `PATCH /api/crops/[id]` `set-placement`, new plantings and accepted Fill proposals through `POST /api/garden/plantings`. Recipes preview client side with `applyRecipe` over the recipes the loader sends and commit through `POST /api/garden/beds/[blockId]/recipe`. **Add N sowings** posts to `POST /api/garden/beds/[blockId]/succession` (`lib/server/garden/succession.ts`), which recomputes the proposal from the bed's stored plantings, keeps only the sowings that fit, and links them to the planting through `createPlantingGroup` with `systemKind: 'succession'`. A planting that already has tasks joins the group as its anchor without new tasks or a status change.

## 23. Acceptance scenarios

Dates use the Dulles frost normals (last spring frost Apr 15, first fall frost Oct 24).

### A. Household gardener, phone, no Anthropic key

1. Sam opens the Kitchen Garden Area Card (Size 20×30 ft) and taps **Open designer**. The `garden_designer` hint points at the preset bar.
2. Sam taps **4×8 raised**, then taps near the top-left. "Bed 1" appears at 2 ft from west, 3 ft from north. Sam taps **4×8 raised** again and taps to the right: "Bed 2" at 8 ft from west, 3 ft from north. Each save announces its position.
3. Sam selects Bed 2, taps **Move** and taps a spot that would overlap Bed 1. Bed 2 stays put and "Beds can't overlap" is announced.
4. Sam taps **Add crop**, searches "Celebrity", taps Tomato Celebrity F1, then taps Bed 1. With the scrubber on May 1, a 4×8 ft footprint in Rows pattern holds 3 plants (30 in in-row, 48 in rows) with a `data` tag.
5. Sam adds Lettuce Buttercrunch to Bed 2 dated Apr 1 and sets Size to 4×4 ft. The plugin has no planting guide, so spacing falls back to 12 in and the count reads 16 with a `fallback` tag.
6. Sam drags the scrubber to July 15. Bed 1 shows Tomatoes, "Harvesting". Bed 2 is hatched with "Open from Jul 1" (Apr 1 + 60 days + 21 day cut window + 10 day turnover). The live region reads "July 15. Bed 1: Tomatoes, harvesting. Bed 2: open from July 1."
7. Sam taps **Fill this bed** on Bed 2. With no key, proposals arrive tagged `fallback` with the "Claude is off" banner. Sam accepts one row and it saves.
8. Offline, the page still shows the layout read-only with the as-of time; scrubbing still works.

The 30E e2e test covers steps 1 to 6 in both Canvas and List view.

### B. Market farmer, tablet, high tunnel

1. Jo opens the greenhouse Area "Tunnel 1" (high-tunnel, Size 30×96 ft) and adds four beds with **Custom** at 3 × 90 ft, at 2, 9.5, 17 and 24.5 ft from west, 3 ft from north. Resizing by handle snaps to 6 in, and a bed dragged past the far end stops with its end on the 96 ft wall.
2. Jo places Salanova Mix in Bed 1 as a 3 × 15 ft footprint dated Mar 1. Rows gives 60 plants (9 in in-row, 12 in rows); switching to Offset gives 78, both tagged `data`.
3. **Add succession** proposes every 14 days (leafy-green). Jo asks for 5 more. The preview places sowings on Mar 15, Mar 29, Apr 12, Apr 26 and May 10, each in the next free 15 ft section, filling the 90 ft bed. **Add 5 sowings** creates one succession group.
4. Scrubbing to May 12 shows all six sections occupied. Scrubbing to Jun 1 shows the first section open from May 31 (Mar 1 + 60 + 21 + 10 days).
5. Jo moves the anchor's date to Mar 8. All six sowings shift a week and their tasks re-anchor.
6. Bed history on Bed 3 shows 2025 tomatoes; placing peppers there shows the amber rotation warning. With a companion fixture that lists beans and onions under `badWith`, beans in Bed 2 next to onions in Bed 3 (within 4 ft) show "Keep apart".
7. A helper opens the same page and sees it read-only; a direct `PATCH /api/blocks/[id]` with layout fields from the helper's session returns 403.
8. Jo prints the Area Card with the scrubber on May 12 and gets the bed map to scale with each section's crop and dates.

## 24. Not in v1

Queued offline edits, dragging a bed preset onto the canvas, free rotation angles, non-rectangular beds, editing landmarks in the designer, greenhouse season-extension offsets on frost dates, and a USDA zone anywhere in the designer.
