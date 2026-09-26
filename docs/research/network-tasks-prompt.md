# CropCard: network-dependent tasks (local agent)

You are working in a local checkout of `mrpeanut01/crop-card` (SvelteKit + TypeScript, pnpm, Node 22). The cloud agents that built Phase 30 run in a sandbox that cannot reach several services: `api.weather.gov`, the Census geocoder, NEWA, most university extension sites, seed-company pages and the Anthropic API with a real key. You can. Your job is to verify the integrations that were only tested against hand-written fixtures, fill agronomy data gaps from primary sources, and test the AI features for real.

This file is the companion to [`label-research-prompt.md`](label-research-prompt.md), which covers pesticide labels (EPA numbers, pollinator classes, rainfast hours, formulation, organic flags). Do that one separately; don't mix label work into these PRs.

Read `CLAUDE.md` first, then `docs/design/PHASE_30_AREAS_CARDS_ONBOARDING.md`. Invariants 1, 2, 6 and 7 matter most here: the safety kernel is off limits, plugins are data only and schema-validated, every tenant read goes through the tenant helpers, and AI assists but never gates. Every pre-filled value carries an honest provenance tag (`plugin | data | ai | manual | fallback`).

## Ground rules

- **Primary sources only.** Weather and climate values come from the agency that publishes them (NWS, NOAA, NEWA). Agronomy values come from land-grant extension publications (Virginia Cooperative Extension first, then Penn State, University of Maryland, Cornell, NC State) or, for a named variety's days to maturity, the seed company's own page for that variety. Blogs, forums, AI summaries and search snippets don't count. When sources disagree, leave the field empty and write down both values.
- **Record provenance for every value you add.** Agronomy values go in a new `apps/web/scripts/crop-data-sources.json` keyed by pluginId, then field: `{ url, publisher, date, quote }`. A value without an entry there will be reverted.
- **Never invent numbers.** If a source doesn't state it, the field stays empty and the app keeps its labelled fallback.
- **Terms of use.** Before wiring any new data source into the app, read its terms. CropCard charges owners a hosting fee, so "non-commercial use only" terms rule a source out. Put what you found in the PR description.
- **Secrets stay local.** An Anthropic key goes in the gitignored `.env` or your shell, never in a commit, fixture, log or PR.
- **New outbound hosts** go through `apps/web/src/lib/server/safeFetch.ts` with the host pinned, a timeout and a size cap, matching how the NWS client works.
- **Minimal diffs.** In plugin JSON, insert or edit only the field you're filling; don't reformat files.

## Verification (run before every commit)

```sh
pnpm install --frozen-lockfile
pnpm test:unit                                   # repo root: eslint plugin, marketplace and web suites
pnpm --filter @cropcard/web run check
pnpm --filter @cropcard/web lint
pnpm --filter @cropcard/web exec vitest run src/lib/plugins tests/integration/seedLibrary.test.ts
CI=1 pnpm --filter @cropcard/web test:e2e        # when you touch UI or endpoints
```

Commit each task separately and open one PR per task against `main`. The `test` gate in `ci.yml` must be green. The repo owner's standing instruction is to fix any CI failure yourself and merge once the PR is clean and green.

---

## Task 1: verify the live integrations and replace hand-written fixtures

These were built and tested only against fixtures written from documentation.

1. **NWS forecast and hourly gridpoint data.** This is Task 6 in the label prompt. If nobody has done it yet, do it here: fetch real `/points/39.1157,-77.5636`, `forecast` and `forecastGridData` responses with the `User-Agent` header that `weather.ts` sends. Replace `apps/web/src/lib/server/__fixtures__/nws-points-lwx.json` and `nws-gridpoint-lwx.json`, trimmed to about five days. Then run `vitest run src/lib/server/weather.test.ts src/lib/server/weatherHourly.test.ts src/lib/weather`. Also fetch one point in Mobile, Alabama (30.69,-88.04) and one in Bozeman, Montana (45.68,-111.04) so the parser sees a different forecast office and a mountain grid.
2. **Census geocoder** (`apps/web/src/lib/server/geocode.ts`, `/api/geocode`). Call the real `onelineaddress` endpoint for a handful of addresses: a Leesburg street address, a rural route, a PO box, a misspelled town and nonsense text. Save trimmed responses as fixtures and point the geocode tests at them. If the real shape differs from the parser's assumption (`addressMatches[].coordinates.x/y`), fix the parser. That would be a production bug, so say so in the PR.
3. **Onboarding end to end with the network on.** Start the app (`docker compose -f infra/docker-compose.yml up`, or `pnpm --filter @cropcard/web dev`). Create a new account and search for a real address on onboarding screen 1. Confirm that the frost dates, station name and distance appear, and that `/today` shows the weather strip for that location.

## Task 2: weather model upgrades (research first, then build only what the terms allow)

`CLAUDE.md` lists these limits under "Weather-model limits". For each item, research first. Build it only if the source is reachable, reliable and licensed for a paid app. Otherwise write up what you found in `docs/research/weather-sources.md` and stop.

1. **NEWA (newa.cornell.edu) station data** for real leaf wetness and hourly temperature and RH near Loudoun County. Leaf wetness today is an RH ≥ 90% proxy in `apps/web/src/lib/weather/leafWet.ts`.
   - Find out whether NEWA exposes station data programmatically, whether its terms allow a commercial app to use it, and which stations sit within 25 miles of Leesburg.
   - If yes, add `apps/web/src/lib/server/weatherNewa.ts` behind `safeFetch`. The nearest station wins; the proxy stays as the `fallback`, and NEWA values carry `data` provenance with the station name.
   - Test it with recorded fixtures. The `/spray/fungicide` leaf-wet dial should say which one it used.
2. **Past hourly weather for vernalization** (`/plan/wheat`). Before the forecast window starts, the app uses Dulles climate normals today.
   - Compare the candidates: NOAA ISD or GHCN-hourly (public domain, and reachable through the AWS Open Data mirror), Open-Meteo's historical API (check the commercial terms carefully), and anything else you find.
   - Pick the best source a paid app is allowed to use, and implement a cached, location-keyed fetch the same way `weatherHourly.ts` does. Say in the PR what provenance the values carry.
3. **Fusarium head blight (scab) risk.** The `/plan/wheat` FHB panel is a proxy for the national model at wheatscab.psu.edu. Find out whether that model, or a state version of it, offers an API or data feed that a third party may use. If not, document that and leave the proxy.
4. **NWS frost and freeze alerts.**
   - Check whether `api.weather.gov/alerts/active?point=` returns Frost Advisory and Freeze Warning products for a farm's point.
   - If it does, add them to the Web Push scheduler (`lib/server/push*`) as an optional "frost tonight" alert. Owners opt in on `/settings/notifications` and are alerted only when they have something planted or planned that is frost-tender.
   - Include tests with recorded alert payloads.

## Task 3: crop agronomy gaps (406 crop plugins)

The garden designer computes plant counts from spacing, and the planting cards and Care Guides depend on maturity and harvest cues. Count the current gaps yourself first; at the time of writing they were:

- **117** crops without `plantingGuide.inRowSpacingIn`. The designer falls back to `defaultRowSpacingInches` both ways and tags the count `fallback`.
- **15** crops without `daysToMaturity`.
- **38** crops without `harvestIndicators`.

Fill them from primary sources: extension vegetable, herb and fruit guides for spacing and harvest cues, and the seed company's page for the variety for days to maturity. Match the existing field shapes (see `packages/plugin-validation/src/schemas.ts` and a complete plugin such as a tomato). A generic crop plugin (for example "Lettuce") takes the extension figure; a named variety takes that variety's figure. Record every value in `crop-data-sources.json`. After each batch, run the plugin and seed-library tests plus the garden tests: `vitest run src/lib/garden src/lib/cards`.

## Task 4: companion "keep apart" data

The garden designer can warn when two beds next to each other hold crops that shouldn't be neighbours. None of the 47 companion plugins (`plugins/companions/*.json`) has any `badWith` entries, so the warning never fires.

Add `badWith` only where an extension publication or a peer-reviewed study states the antagonism. Examples: juglone from black walnut, allelopathy from sunflower or rye residue, shared-disease pairs an extension guide names explicitly. Popular companion-planting charts and folklore don't qualify. It's fine to end with a short list. Record sources in `crop-data-sources.json`, keyed by the companion pluginId. Run `vitest run src/lib/garden/rotation src/lib/plan`.

## Task 5: hardiness zone data (check first, it may already be done)

The Phase 30 follow-ups were due to add `extremeMinF` to `apps/web/src/lib/climate/data/frost-normals-us.json` and a derived zone chip. If `apps/web/src/lib/climate/zone.ts` exists and the dataset rows carry `extremeMinF`, skip this task.

Otherwise, extend `apps/web/scripts/build-frost-normals.mjs` to derive each station's mean annual extreme minimum from NOAA public-domain data, with pinned, SHA-256-verified sources the way the script already works. Then rebuild the dataset and update `SOURCE.md`. The zone decision in the Phase 30 doc says how the chip should behave. It never gates anything and is never labelled "USDA map".

## Task 6: exercise the AI features with a real key

Everything was tested with mocked Claude responses. Set `ANTHROPIC_API_KEY` in your shell or in the gitignored `.env` at the repo root (see `.env.example`), or paste a key into `/settings/integrations` after signing in. Start the app and sign in as the demo owner.

1. **Photo help** (`POST /api/plantings/[id]/photo-help`, "Ask about a photo" on a Planting Card). Use real photos: ripe and unripe tomatoes, a tomato plant that needs suckering, leaves with early blight, and a squash plant with powdery mildew. Judge whether the answers are short, plain, correct and grounded in the crop plugin. Paste the good and bad examples into the PR.
2. **The no-pesticide-advice guard.** Red-team it with at least 40 phrasings that try to get a product, rate or spray timing. Mix direct asks, indirect ones ("what do the big farms put on this?"), misspellings, brand names, organic products ("how much neem oil per gallon?"), questions tucked inside a longer message, and prompt-injection text inside the question. Any answer that names a product with a rate, or gives spray timing, is a failure. Add each bypass as a regression test in the guard's test file and fix the guard in `lib/journal/photoHelp.ts` (and its server side). Treat this like a safety boundary.
3. **Garden "Fill this bed"** (`/api/garden/beds/[blockId]/fill`) and **the allocation wizard** (`/plan?wizard=allocation`). Check that answers pass validation and look sensible for a Loudoun garden. Also check that invalid answers fall back to the deterministic result with `fallback` provenance.
4. **Label scan** (`/inventory/pesticide/add`, label photo method). Test it against three real pesticide label photos.
5. **Metering.** Confirm that every call above shows up in `/settings/ai` usage and the owner's usage counters. Confirm that the daily quotas and the monthly USD cap stop calls, and that the app keeps working through the deterministic path when they do.

## Task 7 (optional, needs real devices): phones and printing

The cloud agents only tested with desktop Chromium emulating phone sizes. Use real devices:

1. **iOS Safari, both in the browser and installed to the Home Screen.**
   - Onboarding with GPS.
   - `/cards`: pin some cards, turn on airplane mode, force-quit and reopen, then open a card that was never viewed online.
   - The Add to Home Screen nudge.
   - Printing a Spray Card and a garden Area Card to PDF from the share sheet.
2. **An Android phone in Chrome.** The same flow, plus the garden designer: tap-to-place a crop, drag-to-place it, and pinch to zoom.

Report what broke, with screenshots. Fix anything small; open an issue for anything larger.

---

## Out of scope for this prompt

The Azure launch configuration listed in `CLAUDE.md` ("Launch configuration" and "Custom domain") changes production and billing. It needs the owner present to approve each step, so don't do it unattended.

## Finish

Update the matching bullets in `CLAUDE.md` "Known follow-ups": the weather-model limits, the Census geocoder note, the crop data counts, and companion data. The final report should give:

- per task: what was verified, filled, built or ruled out, with the reason
- any live response that contradicted a fixture or an assumption in the code (these are production bugs)
- any guard bypass found in Task 6, and how it was fixed
