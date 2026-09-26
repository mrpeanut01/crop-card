# Phase 30: Areas, Cards, and Setup That Gets Out of the Way

Status: **Sprint 30A in progress, 30E implemented** (2026-09-26). Owner: Shawn. The 30A foundations and the 30E garden designer are integrated on branches; 30B, 30C, 30D, 30F and 30G are not built yet. Panel decisions are recorded in [Decisions (2026-09-26)](#decisions-2026-09-26).

This is the implementation plan for reshaping CropCard's first-run experience, farm map and everyday UI. It borrows what works from [LiteFarm](https://github.com/LiteFarmOrg/LiteFarm) and [Seedtime](https://seedtime.us/), keeps what makes CropCard CropCard, and turns the paper Field Card that started this project into the organizing idea of the whole interface.

It covers four things:

1. **A two-screen onboarding** that asks for a farm name and a location and then gets out of the way.
2. **Just-in-time setup**: equipment, blocks and stock are asked for at the moment a task needs them, inside that task.
3. **A Getting Started card on `/today`** that replaces the locked second phase of the wizard.
4. **Areas**: a typed farm map in the LiteFarm mold, with **Garden** as a first-class area that drills down into a Seedtime-style bed designer.

The fifth thread runs through all of them: **Cards**, meaning self-contained, printable snapshots of a planting, an area, a spray, a piece of equipment or a day's work. They are generated on the device and available with no signal.

---

## 1. What we learned

### LiteFarm (read from the source, `integration` @ `12f6d20f9`)

**Onboarding is almost nothing, on purpose.**

- The whole flow is Welcome, then "Tell us about your farm" (name and location only), then role, then consent, then a short outro, then Home.
- Location can come from address autocomplete, typed `lat, lng` or a GPS pin. A satellite preview drops a pin on the spot.
- Currency and units are inferred from the country, so the user never picks them.
- In July 2026 they deleted the certification screens from onboarding entirely (commit `a74398475`, LF-5399) because they were slowing people down. Certification now lives in a later tool.

**Teaching happens at first use, once per user.**

- A `showed_spotlight` table holds one flag per feature: `map`, `draw_area`, `crop_catalog`, `transplant`, `management_plan_creation` and so on.
- A short spotlight fires the first time someone opens that feature and never again.
- There is no long up-front tour.

**The map is typed.**

- Areas: field, garden, greenhouse, barn, residence, natural area, surface water, farm site boundary.
- Lines: fence, watercourse, buffer zone. Points: gate, water valve, soil sample location.
- Field, garden, greenhouse and buffer zone can hold crops.
- Each type carries its own details. A garden has organic status and transition date; a greenhouse adds heating, supplemental light and CO₂.
- Area and perimeter are computed from the drawing.
- The map footer has three verbs: **Add** (a drawer grouped Areas / Lines / Points), **Filter** (layer toggles) and **Export**.

**Beds are never drawn.**

- A LiteFarm garden is one polygon.
- Beds and rows exist only as counts and dimensions on a crop plan ("4 beds, 3 rows per bed, 12 in spacing", plus a free-text "Beds 1-4").
- This is the gap Seedtime fills and we should too.

**Crop plans ask plain questions.**

- "Is it already in the ground?", "Seed or seedling?", "Cover crop or for harvest?"
- Then "days from seed to germination, transplant, harvest", which become dated Plant / Transplant / Harvest tasks.

**Task cards and offline.**

- Task cards carry a status that is derived, never stored (planned, late, completed, abandoned).
- They also show a "Will save when online" badge while a change is queued.
- Offline support arrived in 2026 and is tasks-first. The map is view-only offline, and drawing needs a connection.

### Seedtime (help-center articles; the live site was unreachable from our sandbox)

**Location in, calendar out.**

- A zip code fills in growing zone, average frost dates and **hard-frost** dates. The recommended date is the 30% probability one.
- Users can override for microclimates.
- The home surface is the planting calendar, not a map.

**Layout is a scale drawing of the property.**

- Beds, rows, containers and vertical planters are dragged onto a feet grid, alongside landmarks such as the house, trees and paths.

**Crops go into beds from the calendar.**

- Stretching a crop across a bed **recomputes the plant count from spacing**, in square or offset pattern.

**A timeline scrubber on the layout** shows what occupies each bed on a chosen date. This is what makes succession and double-cropping legible.

**Succession and history.**

- "Add succession" uses a per-crop default interval, and linked plantings move together.
- **Location History** per bed feeds rotation hints.
- **Garden Blocks** are templates that fill one bed with a timed _sequence_ of crops.

**Where it falls short.**

- There is no drill-down from property to garden to bed: it is one flat canvas with layers.
- Layout is weak on mobile.
- There is no offline mode.
- Printing covers the month view only.

### CropCard today (from the code)

**Onboarding** (`routes/onboarding/`, `lib/onboarding/steps.ts`)

- Six steps in two phases: farm, location, fields, implements, then season and plan.
- The season phase stays locked until at least one block is drawn and implements are confirmed.
- `/today` bounces `in-progress` owners back into the wizard, and `/plan` hard-redirects a farm with no blocks to `/plan/farm`.
- `/today` already has a separate "Get started" bootstrap card. So there are three setup surfaces, and that overlap is what feels wrong.

**Geography**

- `fields` → `blocks`, both with optional GeoJSON and width/length in feet (migration 0049).
- `shade_sources` holds trees, fences and buildings.
- There is **no notion of area type**, so a garden, a greenhouse and a hayfield all look the same.

**Frost dates** are typed in by hand, falling back to Loudoun's 04‑15 / 10‑15. Nothing derives them from the farm location.

**Offline**

- Previously visited pages are cached per Owner for 7 days, and herbicide, insecticide, fungicide, harvest and hay records queue.
- Scout does not queue.
- Plantings and blocks are not in Dexie.
- Every PDF is rendered on the server.
- A page never opened online cannot be opened offline.

**Cards exist but aren't a system.** There are `ui/Card.svelte` (a styled div), `PlantingCard`, `TodayHero` and a table-based inventory list. Nothing printable or offline is card-shaped.

---

## 2. Principles

1. **Two questions, then value.** Only the farm name and the location block entry. Everything else is optional, deferred, or asked in context.
2. **Ask where it's needed.** If the spray flow needs a sprayer, the spray flow offers to add one right there and then carries on. Setup is never a detour to another page.
3. **One setup surface.** The Getting Started card on `/today` is the only checklist. Kill the locked wizard phase and the duplicate bootstrap card.
4. **Teach once, in place.** LiteFarm-style first-use hints, tracked per user, dismissible, never modal walls.
5. **The map is the farm; the designer is the garden.** The farm map shows typed areas at acre scale. A garden or greenhouse opens into a feet-scale bed designer. A field stays blocks-and-rows.
6. **The card is the unit.** Anything you'd want in your pocket at the edge of a field is a Card: it looks the same on screen, prints to an index card, and opens with no signal.
7. **Invariants hold.**
   - Safety rules stay in `lib/safety/`, and a card never authorizes a spray.
   - Every new table is tenant-scoped through `tenantWhere` / `withTenant` / `tenantValues`.
   - AI assists and never gates; frost dates and plant counts carry provenance.
   - Single replica.
   - Inventory keeps one chrome (Invariant 8).

---

## 3. Onboarding: two screens (idea 1)

### Screen 1: "Tell us about your farm"

| Field        | Required | Notes                                                                                                                                                              |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Farm name    | Yes      | Prefilled with "{First name}'s Farm" when we can infer a first name (`inferFirstName()` exists).                                                                   |
| Where is it? | Yes      | The three LiteFarm paths: **search an address**, **use my location** (GPS) or **drop a pin** on a satellite preview. Typed `lat, lon` stays as an advanced option. |

When the location is set, the screen fills in, right below the map and before the user continues:

- **Last and first frost dates.** These come from the nearest NOAA 1991-2020 climate-normals station, at 50% probability by default, with a "cautious (90%)" toggle. They are shown with a `data` provenance tag and the station name and distance ("Dulles Intl, 6 mi").
- **Hard-frost dates** (≤ 24 °F) from the same station, used later for winter-hardy crops.
- **Units.** Imperial for US locations, as today. The unit preference from #415 remains the override.

Every value is editable inline ("My place runs colder"). An edited value flips to `manual` provenance. With no station within 50 miles, or no data, it falls back to today's defaults and says so (`fallback`).

**Address search.** The server calls the US Census Bureau geocoder, which is free, keyless and US-only, through `lib/server/safeFetch.ts`, which already handles pinned-IP and redirect checks. It degrades silently to GPS / pin when unavailable. No key and no AI.

### Screen 2: "What are you growing on?"

Four large cards; pick any that apply:

- **A garden**: beds by the house, vegetables, herbs, a few fruit trees.
- **Fields**: row crops, grain, market-garden blocks.
- **Hay or pasture**.
- **A greenhouse or high tunnel**.

This does three things:

1. **Creates starter areas.** Each choice creates one undrawn area of that kind ("Kitchen Garden", "Home Field", "Hayfield", "High Tunnel"), replacing today's hardcoded "Home Field". Nothing has to be drawn yet.
2. **Sets a farm profile** (`farm_profile` setting: `garden`, `farm` or `mixed`) that tunes the defaults below. It never hides records or safety features from an owner who needs them. Gardeners who never add a sprayer simply never see sprayer prompts, because those prompts are just-in-time.
3. **Lands on `/today`**, with the Getting Started card at the top.

**Removed from onboarding:**

- Drawing fields.
- Picking implements.
- Season Setup.
- The allocation hand-off.

Each of these becomes a Getting Started item or a just-in-time prompt. **Kept:** the AI key offer moves to a Getting Started item, and helper invites stay separate (`/invite/[token]` skips onboarding, as today).

### Route and data changes

- **`lib/onboarding/steps.ts`** shrinks to `farm` and `growing`. `STEPS`, `resolveStep` and the phase lock go away.
- **`/onboarding`**: `?step=location|fields|implements|season|plan` 308-redirects to `/today` for a farm that already exists, so bookmarks don't break.
- **`onboarding_status` semantics**
  - `in-progress` now means "screen 2 not answered".
  - The `/today` redirect stays, but only for that state.
  - `later` and `complete` both mean "done".
  - Existing farms are untouched: they are already `complete`, `later` or unset.
- **`/plan` hard redirect to `/plan/farm` is removed.** An empty `/plan` shows the "Where will this grow?" card instead (§4).
- **New `lib/climate/frostNormals.ts`** holds a pure nearest-station lookup over a bundled, compact JSON table (`lib/climate/data/frost-normals-us.json`).
  - Each row: station id, lat, lon, and last-spring / first-fall dates at 50% and 90% for 32 °F and 24 °F.
  - About 5,000 stations, roughly 250 KB raw and 60 KB gzipped, lazy-imported.
  - Because it is bundled, the lookup works offline and in the client.
  - A build script `apps/web/scripts/build-frost-normals.mjs` produces the file from NOAA NCEI normals (public domain).
  - **This needs a machine that can reach ncei.noaa.gov**; see the label-research note in CLAUDE.md for the same constraint.

### Acceptance

- A brand-new user reaches `/today` in **two screens and under 60 seconds** with GPS.
- They reach it with no drawing, no implements, no Season Setup and no AI key.
- Frost dates for a Loudoun pin land within a week of the Dulles normals, with the station named.
- e2e:
  - new owner → two screens → `/today` with the Getting Started card;
  - legacy `?step=fields` → `/today`;
  - geocoder down → pin flow still completes.

---

## 4. Setup where it's needed (idea 3)

One reusable pattern, **`SetupSheet`**: a bottom sheet on phones, or a side panel on desktop, that opens _inside_ the flow that needs something. It collects the minimum, saves through the existing API, and returns to the exact step the user was on, with the new item selected.

| Where                                                    | Missing                            | Today                                                                                                | Proposed sheet                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/spray` step 3                                          | Sprayer                            | Empty state with links to `/inventory/sprayer/add` and `/calibrate` (#125)                           | "Which sprayer?" as a 6-tile template grid from `equipmentTemplates.ts` (backpack, 25 gal ATV, 3-pt boom…). One tap creates it. The sheet then continues into the existing UC-10 calibration wizard, rendered in the sheet. **The kernel is unchanged**: an uncalibrated sprayer still can't produce a rate. |
| `/spray`, `/scout`, `/harvest`                           | Any block                          | `/spray` links to `/plan`, `/scout` renders nothing, `/harvest` says "Add a planting on /plan first" | "Where?" lists existing areas plus **Name a new spot** (name + area kind, no map needed). Draw-it-later is the default.                                                                                                                                                                                      |
| `/harvest`                                               | A planting for what's being picked | Dead end                                                                                             | "What are you picking?" means crop search, area, and "planted around…" (month picker). It creates an `active` planting with `source_provenance='manual'` and a planting date the user confirms, then continues to the harvest record.                                                                        |
| `/plan` (empty)                                          | Any area                           | Hard redirect to `/plan/farm`                                                                        | A **"Where will this grow?"** card with three choices: **Draw it on the map**, **Sketch it by size** (the dimensions mode from #409), **Just give it a name**.                                                                                                                                               |
| `/inventory` (empty)                                     | Any stock                          | A table row reading "No rows."                                                                       | Empty state becomes the 5-type card grid from `/inventory/[type]/add`, keeping Invariant 8's one chrome.                                                                                                                                                                                                     |
| Allocation wizard → seeds                                | Season Setup                       | Wizard step 0                                                                                        | Stays where it is. It already is just-in-time.                                                                                                                                                                                                                                                               |
| Planting a crop that needs an implement task (e.g. till) | Tillage implement                  | Silent: no pre-task                                                                                  | A **soft** prompt in the planting card: "Add your tiller to get prep reminders?" It is never blocking.                                                                                                                                                                                                       |

**Engineering**

- `components/setup/SetupSheet.svelte` provides the chrome: focus trap, ≥48 px targets, and a way to return a value.
- Content components:
  - `SetupSprayer.svelte`
  - `SetupSpot.svelte`
  - `SetupPlantingBackfill.svelte`
  - `SetupCalibration.svelte`, which wraps the existing wizard.
- Everything posts to existing endpoints: `/api/equipment`, `/api/fields`, `/api/blocks`, `/api/blocks/[id]/plantings`. **No new write paths**, so authz, tenant scoping and foreign-ref checks (`lib/server/foreignRefs.ts`) are inherited.
- Helpers see the sheet only where they already have write rights. Otherwise they see "Ask the owner to add a sprayer" (Invariant 5 unchanged).
- **Fix:** `loadEquipmentContext` should match on `spec.templateId` before `type + label`, so renamed implements still get pre/post tasks. That matters once sprayers are created from sheets with custom names.

**Acceptance**

- A new owner can go from `/today` → Spray → add sprayer → calibrate → record, without leaving `/spray`.
- `/scout` with no blocks shows a "Where?" card.
- e2e for each row of the table.

---

## 5. Getting Started card and first-use hints (idea 4)

### The card

It sits at the top of `/today` and replaces the UC-20 "Get started" bootstrap card (`routes/today/+page.svelte:414-492`). It looks like every other Card: a kicker ("Getting started · 3 of 7"), a progress ring, and one row per item. Each row has a ≥48 px tap target that opens the real page or a SetupSheet.

| Item                           | Done when                                      | Shown for                                                                       |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Set your farm location         | `farm_lat_lon` exists                          | all (always done after onboarding; shown ticked for momentum)                   |
| Put your first area on the map | any area has geometry **or** dimensions        | all                                                                             |
| Plan your first crop           | any planting exists                            | all                                                                             |
| Design a garden bed            | any `bed` block inside a garden area           | profile includes garden                                                         |
| Add your equipment             | any equipment row                              | profile includes fields or hay                                                  |
| Calibrate a sprayer            | any sprayer with `calibratedGpa > 0`           | only once a sprayer exists                                                      |
| Invite a helper                | any `helper_assignments` row besides the owner | optional, farm profile                                                          |
| Turn on the planning assistant | Claude key present                             | optional; copy says it's optional and everything works without it (Invariant 7) |
| Save cards for offline         | a card deck has been pinned (§7)               | all                                                                             |

**Behavior**

- Predicates are pure and live in `lib/onboarding/gettingStarted.ts`, like `steps.ts` today, fed by one loader query.
- Optional items render muted with "Optional".
- The card collapses to a slim "Setup 6 of 7 · Show" strip once the required items are done.
- It disappears for good at 100% or on **Dismiss**, stored in the `getting_started_dismissed_at` setting per Owner.
- It is restorable from Settings → "Re-show setup checklist", which replaces today's "Re-walk setup tour".
- Owners only; helpers never see it.

### First-use hints

A small per-user table, `user_hints (user_id, hint_key, seen_at)`. It is keyed by user, not Owner (the same person learns once, on any farm), and is **not** tenant-scoped data. It holds no farm information, so the repo helper that reads it carries `unscopedQueryNote('per-user UI hint state')`.

Hint keys for v1:

- `map_add`, `map_draw_area`, `map_filter`;
- `garden_designer`, `designer_scrubber`;
- `plan_first_crop`, `spray_first`, `cards_offline`.

Each hint is one or two sentences in a speech-bubble pointer anchored to the control, with **Got it**. At most one hint per screen view. Never on top of a safety STOP.

Component: `components/ui/Hint.svelte`, with `lib/client/hints.ts` for optimistic local state plus `POST /api/me/hints`. Offline, hints are marked seen locally and synced later; losing one is harmless.

**Acceptance**

- The bootstrap card and the locked wizard phase are gone.
- The Getting Started card reflects live data.
- Dismiss persists.
- Each hint shows once per user across reloads and devices.

---

## 6. Areas: a typed farm map with gardens you can open (idea 6, LiteFarm-style)

### Data model

Keep the tables and add a type. Renaming `fields` to `areas` in SQL would ripple through exports, VDACS reports, the cross-tenant tests and 40+ repos for no user benefit. The UI says **Areas**; the table stays `fields`, and `lib/db/areas.ts` becomes the repo name going forward (`fields.ts` re-exports during transition).

**Migration 0050 (`areas_kind`)**

`fields` gains:

- `kind text not null default 'field'`, with values:
  - crop-bearing: `field | garden | greenhouse | orchard | pasture`
  - other areas: `barn | residence | natural_area | water | boundary`
- `details_json text`: kind-specific attributes, validated by a Zod discriminated union in `lib/farm/areaKinds.ts`:
  - `garden`: `organicStatus`, `transitionDate`, `irrigation` (`none | hose | drip | sprinkler`)
  - `greenhouse`: `organicStatus`, `heated`, `supplementalLight`, `structure` (`glass | poly | high-tunnel | caterpillar`)
  - `orchard`: `rowSpacingFt`, `treeSpacingFt`
  - `pasture`: `hay | graze | both`
  - `barn`: `washPack`, `coldStorage`, `chemicalStorage` (the last one feeds a future spill-kit card)
  - `water`: `usedForIrrigation`
- `perimeter_ft real`, computed like `acres`.

`blocks` gains:

- `kind text not null default 'block'`, with values `block | bed | row | container`.
- `x_ft`, `y_ft`, `rotation_deg`: position inside the parent area's local feet grid. Used only by beds and containers in garden and greenhouse areas, and never read by geometry consumers such as pollination distance, shade or weather.
- `bed_style`, with values `raised | in-ground | container | vertical`.

Existing rows backfill to `field` / `block`, so nothing changes for current farms. Composite indexes are unchanged, since `owner_id` is already present on both tables.

**Migration 0051 (`planting_footprint`)**

`crops` gains:

- `footprint_json`: `{x_in, y_in, w_in, l_in}` within the bed.
- `spacing_in`, `row_spacing_in`, `spacing_pattern` (`square | offset | sfg`).
- `plant_count`, with `plant_count_provenance` (`data` when computed from spacing, `manual` when typed).

The quantity-in-hundredths fields stay the record of what was planted for fields.

**Lines and points** (fence, gate, water source, hydrant) are **deferred to 30G**. `shade_sources` already covers fences, hedges and buildings for shade. A future `map_features` table would add gates and water points with the same tenant pattern.

**Tenant checklist per Invariant 6:** no new tenant tables in 0050 and 0051 (columns only); the cross-tenant property test gains cases for `kind` filters; the `no-raw-tenant-table` drift test needs no change.

### The farm map

`FarmMapEditor` and `BlockMap` (Leaflet + Geoman) stay. LiteFarm's Terra Draw rewrite doesn't give us anything Geoman lacks, and we'd lose offline tile caching. What changes is the chrome, which follows LiteFarm's three verbs:

- **Add** opens a drawer grouped **Crop areas** (field, garden, greenhouse, orchard, pasture), **Other areas** (barn, house, woods, pond, boundary) and **Shade & structures** (the existing shade kinds). You pick a kind, then draw. The post-draw modal becomes a kind-aware detail form with area and perimeter already computed.
- **Filter** has layer toggles per kind, plus Labels and Satellite, saved per Owner in `localStorage`.
- **Export** produces a **Farm Map Card** (§7) instead of a PNG: printable and offline.

Other map changes:

- Areas are colored by kind, using the Almanac palette: forest for fields, wheat for hay, sage for gardens, sky for greenhouses.
- Tapping an area opens its **Area Card** with Details / Plantings / Tasks / History, mirroring LiteFarm's location tabs.
- A garden or greenhouse Area Card has a primary **Open designer** button.
- Dimensions mode (#409) remains the no-map path. A garden sketched as 40 × 60 ft opens in the designer just the same.

### The garden designer (Seedtime-style drill-down)

Route: `/plan/areas/[id]/design`, for crop-bearing areas of kind `garden` or `greenhouse`.

**Canvas**

- An SVG feet grid sized from the area's `width_ft × length_ft`, or from the polygon's bounding box when drawn.
- Snap to 6 in. Pan and zoom with pinch or wheel.
- North arrow when the area has geometry.

**Beds**

- Toolbar presets: 4×8 raised, 3×10 in-ground, 30 in row, 5 gal container, and a custom size.
- Drag, resize by handles, rotate in 90° steps, duplicate, name ("Bed 1"…).
- Each bed is a `blocks` row with `kind='bed'`, so **everything that works on blocks already works on beds**: plantings, tasks, spray records, harvest, pollination grouping and exports.

**Landmarks**

- Paths and existing shade sources render for context, reusing `shade_sources` rows attached to this area.
- A tree placed here also shades the beds (it already feeds the shade model when geometry exists).

**Crops**

- A side panel (a sheet on phones) lists this season's planned crops plus search over the 406 crop plugins.
- Drag a crop onto a bed to create a planting with a `footprint_json`.
- Stretching the footprint recomputes `plant_count` from spacing: `inRowSpacingIn` + `rowSpacingIn` from the plugin's planting guide (289 of 406 plugins have in-row spacing and 382 have row spacing).
- The pattern can be square, offset (hex) or square-foot-gardening.
- Plugins without spacing fall back to `defaultRowSpacingInches` both ways, flagged as `fallback`.

**Time scrubber**

- A date slider across the top shows what occupies each bed on that date: planting date → harvest end, using DTM and the archetype's harvest window.
- Empty stretches of a bed are shaded "open from Jul 12".
- It shares `lib/schedule/scheduleCandidacy.ts` occupancy logic, so the designer and the allocation wizard agree.

**Succession and sequences**

- **Add succession** on a planting uses `FAMILY_SUCCESSION_DAYS` and creates a linked group (`group_system_kind='succession'`).
- **Bed recipes** are Seedtime's Garden Blocks, done our way: data-only plugins under `plugins/bed-recipes/`, e.g. "Spring greens → bush beans → fall brassicas" for a 4×8 bed with ~180+ frost-free days. Each one has a Zod schema, a public JSON Schema and registry validation, following Invariant 2. Applying one creates the planned sequence in one step.

**History and hints**

- The bed's **History** tab lists past plantings from `crops` by `block_id`.
- The rotation advisor (`lib/season/carryForwardPlan.ts` `buildRotationSuggestion`) flags same-family repeats.
- Companion plugins surface "good neighbors" and "keep apart" on adjacent beds.

**Calendar link**

- Moving a planting in the designer's time view re-anchors its tasks through the existing `reanchor*` helpers.
- Moving it on `/plan`'s Gantt moves it here.

**Mobile**

- Full view, scrubber and tap-to-place on phones.
- Resize and rotate need a tablet or desktop, by design. Seedtime reviewers' biggest complaint is a desktop-only layout, so viewing and placing must work one-handed.

**Offline**

- The designer reads from the offline snapshot (§7).
- In v1, edits need a connection and say so plainly. Queued designer edits are a later phase.

**AI (optional, through `aiTry()`)**

- "Fill this bed for me" proposes a recipe from the owner's crop list, rendered with `ai` provenance and accepted or rejected per planting.
- **Photo help**, from a garden Area Card or a Planting Card: take a picture and ask "ready to pick?", "where do I prune?" or "what's wrong with these leaves?".
  - It goes through the existing vision path and `aiGuard`.
  - The answer is saved to the planting's journal with `ai` provenance.
  - No key means the button explains the feature and links to the Care Guide Card instead.

---

## 7. Cards: offline, printable, everywhere

The paper Field Card is the reason this app exists. Phase 30 makes the Card the unit of the interface: a thing you can glance at, act on, print, and trust with no signal.

### Card anatomy (one component, many kinds)

```
┌──────────────────────────────────────────┐  ← color strip by kind
│ PLANTING · BED 3 · KITCHEN GARDEN        │  ← kicker
│ Cherokee Purple tomato                   │  ← title (serif)
│ ─────────────────────────────────────────│
│ Planted   May 4      Harvest  Jul 20-Sep │  ← 4-6 key facts
│ Spacing   24 in · 6 plants   PHI  clear  │
│ ─────────────────────────────────────────│
│ Next: stake + prune suckers (due Thu)    │  ← one next action (≥48 px)
│ ─────────────────────────────────────────│
│ As of Sep 26, 9:14 PM · data ● manual ●  │  ← as-of + provenance
│ [QR]  cropcard.io/c/pl_8f2…               │  ← on printed cards only
└──────────────────────────────────────────┘
```

- Built from `lib/cards/model.ts`, `CardModel = { kind, key, kicker, title, facts[], next?, sections[], asOf, rulesVersion?, provenance[], href }`.
- One renderer, `components/cards/CardView.svelte`, handles screen, compact list and print.

### Card kinds

| Card                                | Contents                                                                                                                  | Built from                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Planting**                        | variety, area/bed, dates, spacing and count, stage, next tasks, recent sprays with REI/PHI countdown, harvest window      | `crops`, tasks, spray/insecticide/fungicide events, plugin                          |
| **Area**                            | kind, size, what's in it now, bed map thumbnail (gardens), history, open tasks                                            | `fields`, `blocks`, `crops`                                                         |
| **Farm Map**                        | the whole farm by kind, legend, frost dates, owner's emergency contacts                                                   | areas + settings                                                                    |
| **Spray** (the original Field Card) | product, EPA reg no., target, rate, **dilution for the chosen calibrated sprayer**, mix order, PPE, REI, PHI, decon steps | kernel outputs + `lib/dilution/` + `deconProtocol.ts`, stamped with `RULES_VERSION` |
| **Equipment**                       | calibration (GPA, date), last decon, winterized, upcoming maintenance                                                     | equipment + `equipment_state` + tasks                                               |
| **Care Guide**                      | water, feed, stake/prune, harvest cues, common problems                                                                   | crop plugin `plantingGuide` / `harvestIndicators` / `notes`                         |
| **Day**                             | today's tasks as a deck (Today's hero plus the rest)                                                                      | tasks                                                                               |
| **Seed & stock**                    | lots, amount on hand, expiry, what it's planned for                                                                       | stock + plan                                                                        |

**Safety rule for Spray Cards.**

- A Spray Card is a **reference**, never a clearance.
- It prints "Recheck weather, REI and label before spraying."
- It carries `rulesVersion` and an as-of time, and shows a stale banner after 24 h.
- **Recording** a spray still runs every kernel gate: server-side on sync, and client-side as today.
- A Spray Card is generated only for a sprayer with `calibratedGpa > 0`. Uncalibrated sprayers get "Calibrate first," matching the kernel.
- Tests go in `lib/cards/spray.test.ts`, alongside the dilution property tests, treated like the security boundary it sits next to.

### Offline generation

Today, pages work offline only if they were opened online first. Cards need to work for things you've never opened on this phone.

1. **Snapshot endpoint.** `GET /api/cards/snapshot` returns one tenant-scoped bundle for the active Owner:
   - areas, blocks, active and planned plantings, open tasks for the next 30 days;
   - equipment with state, stock summary;
   - the crop plugins referenced by those plantings;
   - frost dates, `RULES_VERSION`.

   Every read goes through `tenantWhere` / `withTenant`. The endpoint returns an `ETag` and is covered by an `exports.crossTenant`-style test. Size target is under 500 KB gzipped for a typical farm.

2. **Dexie v4.**
   - `farmSnapshots` (`ownerId` primary key, `etag`, `fetchedAt`, `bundle`) and `pinnedCards` (`[ownerId+key]`, `pinnedAt`).
   - `resetTenantCaches` clears both.
   - A fake-indexeddb property test proves no cross-Owner reads, using the infra from #278.
3. **Refresh.** On app open, on coming back online, and on "Save for offline", with a conditional GET. The service worker is not involved, so there are no cache-key games.
4. **Client-side builders.** `lib/cards/build/*.ts` are **pure** functions `(snapshot) → CardModel`, shared by server and client. A card never opened online still renders offline from the snapshot.
5. **A route that exists offline.** `/cards` (and `/cards/[kind]/[key]`) is a client-rendered route (`ssr = false`) whose shell is precached by Workbox with a `navigateFallback` scoped to `/cards/**`. Opening CropCard with no signal lands you in your card deck, not a browser error.
6. **Storage durability.**
   - Call `navigator.storage.persist()` when the user pins cards.
   - iOS Safari clears script storage after 7 days without use for sites that aren't installed; installed home-screen PWAs are exempt. So "Save for offline" also nudges **Add to Home Screen** on iOS and offers **Print**.
7. **Printing.**
   - Print CSS for 3×5 and 4×6 index cards and Letter (4-up), with page breaks per card.
   - "Save as PDF" through the browser's print dialog works offline, so no client-side PDF library is needed.
   - A QR code on printed cards links back to the live card. `qrcode-generator` is about 20 KB with no dependencies; the QR is generated locally.
8. **Scout joins the queue.** Add a `scout` kind to `syncQueue.ts` `ENDPOINT_BY_KIND` (the one record flow that doesn't queue today). Queued items show LiteFarm's **"Will save when online"** badge on their cards.

### Cards across the interface

- **`/today`**: Getting Started card, hero card, then the day as a deck of task cards.
  - Status pills are derived LiteFarm-style (planned / due today / late / done / skipped), never stored.
  - The legacy tabs `<details>` goes away.
- **`/plan`**:
  - The left rail lists **Area cards**.
  - A field shows Block cards → Planting cards (the existing `PlantingCard` becomes a `CardView` kind).
  - A garden shows its bed map, plus a "Open designer" button.
- **`/inventory`**: the table stays on desktop; phones get a card list (the same chrome and fields, Invariant 8).
- **Records**: each record row expands into its card, and any card can be printed.
- **`/cards`**: the deck.
  - Filters: Today · Plantings · Areas · Equipment · Spray · Care guides.
  - **Pin** / **Save for offline** / **Print selected**.
  - This is where the paper Field Card lives now.

---

## 8. Delivery plan

Each sprint is one or more PRs, CI-gated, squash-merged per the repo's shipping rules. Migrations and Dexie versions are numbered from today: migration 0049, Dexie v3.

### 30A. Foundations (1 sprint) (in progress)

- Migration 0050: area `kind`, `details_json` and `perimeter_ft`; block `kind` and layout columns.
- `lib/farm/areaKinds.ts` Zod union, with a repo alias `lib/db/areas.ts`.
- `lib/climate/frostNormals.ts` + `scripts/build-frost-normals.mjs`, with a checked-in dataset built from NOAA's AWS Open Data mirror (`noaa-normals-pds`), pinned by SHA-256.
- `lib/cards/model.ts` + `components/cards/CardView.svelte` (screen + print CSS), with Planting and Area builders.
- Tests: kind validation, nearest-station lookup (property: always returns the true nearest station within the radius), cross-tenant cases for kind filters, CardView component tests.

### 30B. Onboarding + Getting Started (1 sprint)

- Two-screen `/onboarding` and the Census geocoder through `safeFetch`.
- `farm_profile`, starter areas, legacy `?step=` redirects.
- Getting Started card replaces the UC-20 bootstrap card; `getting_started_dismissed_at`.
- `user_hints` table (migration 0052) + `Hint.svelte` + `/api/me/hints`.
- e2e: new-owner happy path, geocoder-down path, legacy redirect, dismiss persistence, hint shows once.
- Update `docs/personas.md` P5 (First-Run) and `docs/use-cases.md` UC-20.

### 30C. Just-in-time setup (1 sprint)

- `SetupSheet` + Sprayer / Spot / Planting-backfill / Calibration content.
- Wire into `/spray`, `/spray/insecticide`, `/spray/fungicide`, `/scout`, `/harvest`, `/plan` empty state and `/inventory` empty state.
- Remove the `/plan` → `/plan/farm` redirect.
- Fix `loadEquipmentContext` to prefer `spec.templateId`.
- e2e per entry point, including helper read-only variants.

### 30D. Typed farm map (1 sprint)

- Add / Filter / Export chrome.
- Kind-aware post-draw form.
- Kind colors, and an Area Card on tap with Details / Plantings / Tasks / History.
- Farm Map Card.
- Visual baselines re-captured with `visual.yml update`.

### 30E. Garden designer v1 (2 sprints) (implemented)

**Implemented (2026-09-26).** The designer lives at `/plan/areas/[id]/design` for garden and greenhouse Areas, with the full contract in [`GARDEN_DESIGNER.md`](GARDEN_DESIGNER.md). What shipped:

- A hand-rolled Svelte 5 SVG canvas in feet with a 1 ft and 5 ft grid, rulers, a north arrow for drawn Areas, landmarks from shade sources, 6 in snapping, 90° turns, drag with Pointer Events on tablet and desktop, pinch and wheel zoom, and a keyboard path for every action. Phones use tap to select, then tap to place, with a 48dp toolbar. A List view has full parity and the choice is remembered.
- Pure logic in `lib/garden/`: geometry (clamping, overlap, free spots, adjacency), plant counts from plugin spacing in Rows, Offset and Square foot patterns with provenance, occupancy from planting date to harvest end plus turnover (now shared with `scheduleCandidacy`), succession proposals keyed on `FAMILY_SUCCESSION_DAYS`, rotation warnings through `buildRotationSuggestion`, and companion hints for the same or adjacent beds.
- Placement data on plantings (footprint, spacing, pattern, count and count provenance), written through `PATCH /api/crops/[id]` `set-placement` and `POST /api/blocks/[id]/plantings`. Date moves re-anchor tasks and move linked sowings together. `/api/blocks` refuses overlapping or out-of-Area beds, refuses helpers on beds, and `DELETE ?ifEmpty=1` refuses a bed that has records.
- A time scrubber showing what occupies each bed on any date, with open-from and next-open chips. **Add succession** previews on the canvas and commits through `POST /api/garden/beds/[blockId]/succession` as one succession group.
- Bed recipes as a new data-only plugin kind (`plugins/bed-recipes/`, seven recipes, Zod and JSON Schema validated, every crop checked against the registry), previewed client side.
- **Fill this bed** through `aiTry()` and `aiGuard`, with every proposal checked on the server and a recipe or spacing-packed plan tagged `fallback` whenever Claude is off.
- The Area Card gains an **Open designer** link and a to-scale bed map, on screen and in print. First-use hints for the designer and the scrubber.
- e2e for the household gardener and the high tunnel at 375 px and 1280 px in both views, keyboard-only placement, helper read-only, and a field Area returning 404.

Deferred: dragging a crop or a bed preset onto the canvas (tap to place works everywhere); the `/plan` left-rail Gardens group and a Getting Started entry; Print opening the Area Card print view (Print uses the browser on the designer page today); a server-side recipe commit endpoint (accepted recipe steps are saved one at a time); moving a linked sowing to another bed; and full offline fallback for a client-side navigation to the designer, which needs a universal loader over a `GET /api/garden/areas/[id]/design` endpoint and card snapshots that 30F owns. The adjacency gap stays at 4 ft, so the high-tunnel scenario's beds 4.5 ft apart get no keep-apart hint; widen it or move the beds if that hint matters. When a footprint is narrower than its row spacing the count uses one row rather than zero.


- Canvas, beds, snapping, 90° rotation.
- Crop panel, footprint and spacing-driven counts (migration 0051).
- Time scrubber sharing `scheduleCandidacy`.
- Add succession, bed History, rotation and companion hints.
- Phone view + tap-to-place.
- e2e: sketch a 20×30 garden, add two 4×8 beds, place tomatoes and lettuce, scrub to July and see lettuce gone and the bed open.

### 30F. Offline cards (1-2 sprints)

- `/api/cards/snapshot` + Dexie v4 + refresh logic + tenant property test.
- Pure builders for all eight card kinds, with Spray Card tests next to the kernel.
- `/cards` CSR route + scoped `navigateFallback`, pinning, `storage.persist()`, iOS install nudge.
- Print layouts + QR.
- Scout in the sync queue, and "Will save when online" badges.
- e2e with Playwright `context.setOffline(true)`: cold-open `/cards`, open a planting card never visited online, print preview renders.

### 30G. Cards everywhere + garden extras (1-2 sprints)

- `/today` deck and derived status pills; `/plan` area → bed → planting cards; inventory mobile cards; record → card expansion.
- Care Guide cards; photo help through `aiTry()`.
- `plugins/bed-recipes/` plugin kind with schema + 6 starter recipes for zones 6-7.
- Map lines and points (fence, gate, water source) via `map_features`, if still wanted.

**Total:** roughly 8-10 sprints. 30A-30C alone fix the onboarding complaint and can ship first.

---

## 9. Risks and open questions

**Risks**

- **Frost data access.** Resolved for v1: ncei.noaa.gov is unreachable from the sandbox, but the same public-domain 1991-2020 normals archive is on NOAA's AWS Open Data mirror, and the committed dataset is built from it. With no station within 50 mi, onboarding still falls back to manual entry with `fallback` provenance.
- **Plant spacing coverage.** 117 of 406 crop plugins lack `inRowSpacingIn`. Their counts use the row-spacing fallback and say so. A backfill goes in the label-research brief.
- **Offline staleness.** A card is only as fresh as its snapshot. Every card shows its as-of time; Spray Cards add a stale banner and never gate or permit anything.
- **iOS storage eviction.** Mitigated by the install nudge and printing, and documented on the `/cards` page.
- **Scope creep in the designer.** v1 is rectangles, 90° rotation and one grid. Freeform shapes, arbitrary rotation and vertical planters wait for real use.

**Open questions**

1. **Hardiness zone.** Should onboarding also show a USDA zone? It needs another dataset (PRISM). Frost dates matter more for planning, so this proposal leaves it out of v1.
2. **Terminology.** "Areas" or "Places" on the map? LiteFarm says Locations. "Areas" is proposed because it reads naturally for both a 20-acre field and a 4×8 bed's parent garden. **Decided 2026-09-26: "Areas"** (see Decisions).
3. **Garden-only households.** Should a `garden`-profile farm hide the VDACS audit tier in `/settings/records` entirely? The proposal keeps it visible but quiet, because a gardener spraying copper still has label obligations. **Decided 2026-09-26: quiet, not hidden, triggered by pesticide records** (see Decisions).

## Decisions (2026-09-26)

A three-view panel (farmer, household gardener, engineer) settled the open questions below before Sprint 30A. Where the views disagreed, the engineer's constraints on bundle size, offline use and the invariants decided it. None of these decisions changes the safety kernel, the tenant schema or `RULES_VERSION`.

### Hardiness zone (open question 1)

Onboarding in v1 shows frost dates only. That means the last spring and first fall 32 °F dates and the hard-frost 24 °F dates, taken from the bundled NOAA station table, each with a `<Provenance>` tag and the station label (for example "Last frost ~Apr 20 · Dulles Intl, 6 mi · data"). Neither screen shows a USDA hardiness zone, and v1 adds no PRISM data and no zip-to-zone package. If the station table has nothing in range, the Loudoun fallback dates (Apr 15 / Oct 15) show with `fallback` provenance and a clear prompt to confirm or edit; an edit is stored as `manual`.

The reason is that nothing in the app uses a zone. Planting windows come only from frost dates (`lib/plan/plantingWindow.ts`, `lib/schedule/scheduleCandidacy.ts`, succession and the AI schedule prompt), and no plugin has a zone field. A zone on screen would be a pre-filled value the app never acts on, which goes against Invariant 7, and it would slow the two-screen setup while leaving a new gardener unsure which climate number to trust. Loudoun is almost entirely zone 7a/7b, so it adds nothing for the farm either. A second dataset would also add a larger client payload or a server call that breaks offline onboarding, and the PRISM/USDA 2023 data carries an Oregon State University copyright.

The per-Owner settings keys `farm.hardiness_zone` (a string such as "7a", or null) and `farm.hardiness_zone_provenance` (`data`, `manual` or null) are reserved in the farm settings shape so no backfill is needed later; nothing reads them in v1. Bed recipes key their applicability on frost-date offsets or a frost-free-days range, and any zone text on a recipe is a display label that the validator never filters on.

In v1.1 the frost build adds an `extremeMinF` column (the 1991-2020 mean annual extreme minimum) to the same station table. A pure `zoneFromExtremeMin` in `lib/climate/zone.ts` then derives an approximate zone, shown read-only on /settings/farm and the Farm Map sheet as "Zone 7a (approx., from Dulles Intl) · data" and never labelled as the USDA map. The owner can override it with `manual` provenance. Perennial and orchard work is its first consumer, and the zone never gates anything.

### Terminology: "Areas" (open question 2)

Typed map objects are called "Areas" in the UI. We do not use "Places", and we do not use LiteFarm's "Locations", because "location" already means the farm's latitude and longitude (onboarding "Where is it?", "Set your farm location", `lib/schedule/farmLocation.ts` and the frost and weather provenance). "Areas" fits a 20-acre hayfield, a kitchen garden, a barn footprint and a pond equally well, and it matches the words LiteFarm users know. "Places" sounds soft next to VDACS spray records and sprayer calibration.

The collective word appears only in the map's Add drawer groups ("Crop areas" / "Other areas"), list headings, the Area Card title and the Cards filter chip. Wherever one record is shown, the UI uses the owner's name or the kind label with its size, such as "Hayfield · 20 ac" or "Kitchen Garden · 30×40 ft", and never builds "{kind} area"; the `natural_area` kind reads "Woods / natural". The measured size is labelled "Size", never "Area", in the map editor and post-draw form. Fences, watercourses and buffers are "Lines", gates and sample spots are "Points", both under "Map features", and the map verb is "Add to map". The Seedtime-style per-bed "Location History" becomes "Bed history". Search treats "location", "place" and "field" as synonyms for Areas, and a one-time map hint tells newcomers that Areas are sometimes called locations or fields.

This is a copy decision only. **Glossary: UI "Area" = the `fields` table.** The table keeps its name, `lib/db/areas.ts` is the repo alias, and `lib/farm/areaKinds.ts`, the `areas_kind` migration and the `/plan/areas/[id]/design` route already use the word, so Invariant 6 and its tests are untouched. USDA/VDACS exports and the year summary keep their "Field" and "Block" column headers because inspectors expect them. The garden-persona usability pass re-checks the wording before copy freeze, and "Places" is reopened only if named points of interest are added later.

### Compliance tier for garden households (open question 3)

The VDACS/audit tier on /settings/records is quieted, not hidden, and the trigger is the data rather than the profile. A `garden`-profile Owner with no spray, insecticide or fungicide records sees the tier folded into one keyboard-reachable disclosure titled "Pesticide record-keeping (applies if you spray)". The full tier appears on the first pesticide record, and always for the `farm` and `mixed` profiles. Hiding it outright would break §4's rule that the profile never hides records or safety features, and would let `farm_profile` quietly switch compliance off, even though gardeners do spray copper, sulfur, Bt and spinosad. Showing it unchanged puts "VDACS", "FR-09" and "SHA-256" in front of a four-bed household.

One pure, client-safe helper, `complianceChromeLevel(profile, counts)` in `lib/records/complianceChrome.ts`, returns `quiet` only for the garden profile with all three counts at zero and `full` otherwise, including an unknown profile. The /today retention banner and the /records export wording use the same helper. It is display-only: enforcement, exports, the 48 h lock, retention, owner-only deletes, the hash chain and every spray-flow safety step never read `farm_profile`, and regression tests check that. Records still waiting in the offline queue are not counted, which is acceptable because the server enforces lock and retention regardless of what the page shows. The disclosure copy never says home use is exempt.

### Frost data source

Sprint 30A ships real frost dates. The dataset is NOAA's 1991-2020 annual/seasonal normals archive from NOAA's official AWS Open Data mirror (`noaa-normals-pds`), the same public-domain NCEI data the design already named. `scripts/build-frost-normals.mjs` verifies a hard-coded SHA-256 of the pinned archive and writes `lib/climate/data/frost-normals-us.json`, which is committed; CI and the running app never touch the network for it. The file is about 226 KB gzipped, several times the earlier estimate, so it loads through a dynamic `import()` and stays out of the /today and field-flow chunks.

`lib/climate/frostNormals.ts` is a pure nearest-station lookup with a 50-mile cap. A station result carries `data` provenance with the station name and distance, an edit becomes `manual`, and no station or a missing file gives the Loudoun `fallback`. NOAA's FPxx columns mean an xx% chance the frost comes after the date, so the "cautious" setting reads the P10 columns for both seasons; tests pin Dulles at Apr 15 / Oct 24 median and Apr 30 / Oct 10 cautious. We rejected zone-keyed frost packages (a zone does not determine frost dates), runtime Open-Meteo (not offline, not normals) and unlicensed or 1981-2010 datasets. Census geocoding stays an optional online extra behind `safeFetch`; the map pin and GPS are the main path. The work needs no new runtime dependency and no `RULES_VERSION` bump.

### Printing Cards

Printable Cards use browser print CSS. The single `CardView.svelte` renderer has a print variant, the Print button calls `window.print()`, and people save a PDF from the print dialog, which works offline and reuses the precached Almanac fonts. pdfmake stays server-only for compliance exports, because shipping it to the client would add one to two megabytes to the service-worker install and a second layout engine that could drift from the screen Card. QR codes are generated on the device by a vendored copy of Nayuki's MIT `qrcodegen` rendered as inline SVG, with error correction M. The QR payload is only `${ORIGIN}/c/<cardKey>` from the server-provided origin, never the Host header; with no stable origin there is no QR, and the short link is always printed as text. A printed Spray Card carries its as-of time, `RULES_VERSION`, "Recheck weather, REI and label before spraying", "Reference, not clearance" and "Calibrate first" for uncalibrated sprayers, and garden-only accounts do not see a Spray Card print option.

### Garden designer

The garden designer is a hand-rolled Svelte 5 SVG component with a viewBox in feet and Pointer Events, and all its geometry lives in a pure `lib/garden/designer.ts`. Konva, svelte-konva and Fabric are excluded (roughly 150 to 300 KB precached on every install for a screen many owners seldom open), and Leaflet in CRS.Simple is not reused because its power-of-two zoom and small vertex handles fight a feet grid and gloved hands. Leaflet with Geoman stays the acre-scale farm map. On a phone the flow is tap to select, then tap to place, backed by 48dp buttons for nudge, rotate, duplicate, delete and zoom, and an editable List view with the same abilities serves screen readers and devices without a usable canvas. Beds are real DOM nodes with roles and labels, so they are keyboard and screen-reader reachable and Playwright can test them without pixel coordinates.

Designer positions use their own branded coordinate type so they can never reach distance, pollination, shade or weather consumers; like the Dimensions sketch, the layout is illustrative. Writes go only through the tenant-scoped `/api/blocks` endpoints and their `foreignRefs` checks. Editing needs a connection in v1, and the canvas is read-only offline. "Fill this bed" suggestions go through `aiTry()` with `ai` provenance, and without a key a deterministic spacing fill tagged `fallback` does the same job.
