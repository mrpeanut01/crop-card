# CropCard

**The field card that knows what's in your sprayer.**

CropCard is an offline-first web app for small farms, market gardens and homesteads. It replaces the paper Field Card with something that plans your season, checks every spray against hard safety rules, keeps inspector-ready records, and still works when you're standing in a field with one bar of signal.

**[Open CropCard →](https://app.cropcard.io)** · **[Try the demo farm →](https://app.cropcard.io)** · **[Pricing →](https://app.cropcard.io/pricing)**

> **Try it in one click.** On the sign-in page, choose **Try the demo farm**. You get your own copy of Willow Run Farm in Loudoun County, Virginia, with a full season of plantings, sprays, harvests, animals and open tasks dated around today. No account, no email. It resets when you leave and expires after four hours.

CropCard is in public alpha. It was built for a real small-plot farm in Loudoun County and is used there every day.

## Why it exists

Small growers carry a lot in their heads: which herbicide is still in the tank, whether 2,4-D is safe over corn that's grown past eight inches, how many days until the chickens can go back on a sprayed pasture, when the lock window closes on last Tuesday's spray record. Paper cards and spreadsheets don't check any of that. CropCard does, and it keeps the record a state inspector or organic certifier will ask for as a side effect of doing the work.

## What it does

### Plan the season

- **Season planner.** Set your growing philosophy and fertility approach once, then let the planning wizard allocate crops to blocks, schedule plantings from your frost dates and soil temperatures, and build an inputs plan with a shopping list checked against what you already have on the shelf.
- **Draw your farm.** Sketch fields, beds, barns, coops and ponds on a map or by dimensions. Add fences, gates, waterers and irrigation lines.
- **Garden designer.** Lay out beds to scale, see plant counts from real spacing data, get succession, rotation and companion hints, and scrub through the season to see what's in the ground on any date.
- **Climate that's yours.** NOAA 1991-2020 frost normals and an approximate hardiness zone from the nearest similar-elevation station, plus season extension for row covers, low tunnels and greenhouses.
- **Sowing calendar, seed starting, watering and degree days.** Indoor sow, harden-off and transplant tasks backed off from your in-ground date; a weekly water balance per bed from nearby station rain or your own gauge.

### Spray safely

- **A safety kernel plugins can't override.** Active-ingredient conflicts, crop-stage gates, tank-mix prohibitions, environmental gates (wind, temperature, rain), PHI and REI, and a sprayer cross-contamination check that routes you to a cleanout wizard instead of a dilution table.
- **Dilution math you can trust.** Rates from your own 1/128-acre calibration, a mix order, and a printable Spray Card.
- **Insecticides and fungicides too,** with IPM scout thresholds, FRAC rotation warnings, a pollinator-protection gate tied to sunrise and sunset, and a leaf-wetness and dry-window view from hourly NWS data.

### Run the day

- **Today.** A deck of task cards with Day, Week, Month and Season views, current conditions and a 7-day forecast. Assign tasks to helpers, log time on Done, and get a Monday summary.
- **Offline first.** Records, scout notes, harvests, task closes and animal logs queue on the phone and sync when you're back in range. Printable, pinnable Cards for every sprayer, area, flock and planting work with no connection at all.
- **Inventory.** Pesticides, fertility, seed, feed and animal-health products in one list, added by barcode, label photo, search or by hand, with lots on hand, on order and planned.

### Animals

- Track animals and flocks, moves between pastures and coops, care plans, treatments, eggs and milk.
- **Withdrawal and grazing holds are enforced.** A treated animal's eggs, milk or meat can't be logged for use until its withdrawal clears, and food animals can't move onto a pasture still inside a label's grazing interval. Holds can only lengthen, never quietly shorten.

### Keep the records

- Spray records lock after 48 hours. Harvest, hay, fertility, irrigation and animal health records sit beside them in one ledger.
- USDA and VDACS exports, a year-end summary PDF, an organic certifier pack, an animal treatment log and a full GDPR export.
- A document vault for lab reports, certificates and receipts.
- Simple season profit from sales, purchases and labour.

### AI that helps but never decides

CropCard works end to end with no AI at all. When an Anthropic key is present, Claude can draft a planting plan, fill a garden bed, read a product label from a photo, or answer a question about a plant from a picture. Every value it suggests is tagged with where it came from (plugin data, your data, AI, manual entry or a fallback), every suggestion is re-checked by the deterministic rules, and if AI is unavailable the app quietly falls back to its own engine.

### For the whole crew

Owners, helpers, inspectors and custom operators each see what they need. Helpers can do the field work but can't edit locked records or override rates; inspectors get read-only access to the records. CropCard is available in English and Spanish (safety text stays in English).

## Pricing

Safety checks, records, compliance exports and deterministic planning are free on every plan. Paid plans add AI help and more helper seats.

| Plan   | Price                      | Helper seats |
| ------ | -------------------------- | ------------ |
| Free   | $0                         | 2            |
| Grower | $10 a month or $96 a year  | 5            |
| Farm   | $20 a month or $192 a year | 15           |

Details at [app.cropcard.io/pricing](https://app.cropcard.io/pricing).

## Feedback welcome

The most useful thing you can send right now is product feedback: what works, what's confusing, what's missing in your own operation. Use **Send feedback** in the app's More menu, or open an [issue](https://github.com/mrpeanut01/crop-card/issues). Please read the [contributing guidance](./CONTRIBUTING.md) before opening a pull request.

---

## For developers

### Stack

- **App:** SvelteKit + TypeScript, installable PWA (Workbox), Dexie.js offline queue on IndexedDB
- **Data:** SQLite through Drizzle, replicated to Azure Blob Storage with Litestream
- **Hosting:** one container on Azure Container Apps (scale to zero, single replica by design)
- **Auth:** email magic link with a 6-digit backup code or SMS code, HMAC cookie sessions, Bearer tokens for external agents ([OpenAPI](https://app.cropcard.io/api/openapi.json))
- **Weather and climate:** NWS forecasts and alerts, NOAA station observations and normals, USGS elevation

### Repository layout

| Path                       | Purpose                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web/`                | The SvelteKit application: UI, server endpoints, sync, plugin registry                         |
| `apps/web/src/lib/safety/` | The hard-locked safety kernel. Spray, withdrawal and grazing rules live here, in TypeScript    |
| `plugins/`                 | Data-only JSON: about 400 crops, 200 pesticides, fertilizers, companions, species, bed recipes |
| `schemas/`                 | Public JSON Schemas for plugin authors                                                         |
| `packages/`                | The `cropcard` ESLint plugin and plugin validation tooling                                     |
| `infra/`                   | Dockerfile, docker compose, Litestream config, Azure Bicep                                     |
| `docs/`                    | Personas, use cases, design specs, research and runbooks                                       |

### Run it locally

```sh
cp .env.example .env
cp infra/.env.dev.example infra/.env.dev
# In infra/.env.dev, replace PASTE_AZURITE_WELL_KNOWN_KEY_FROM_MICROSOFT_DOCS with the
# well-known Azurite key from https://learn.microsoft.com/azure/storage/common/storage-use-azurite
# (kept out of git to avoid a secret-scanning false positive).

docker compose -f infra/docker-compose.yml up
# → http://localhost:5173
```

VS Code users can open the repo and choose **Reopen in Container**.

```sh
pnpm test:unit     # vitest
pnpm test:e2e      # playwright
pnpm typecheck
pnpm lint
pnpm db:generate   # author a migration
pnpm db:migrate    # apply migrations
```

### Ground rules

- **Safety rules are code, not data.** Plugins cannot override the kernel; a plugin claiming a herbicide is safe for pumpkins when its active ingredient is a synthetic auxin is rejected at registration.
- **Plugins are data-only.** No executable code under `plugins/`; every file is schema-validated on load.
- **Single replica.** SQLite with Litestream is single-writer, so `maxReplicas: 1` stays until there's a database migration plan.
- **Tenant isolation is row-level** and checked by a cross-tenant property test.
- **AI assists, never gates.** The no-key path must always work.

[`CLAUDE.md`](./CLAUDE.md) has the full invariants and phase history. CI is described in [`docs/ci.md`](./docs/ci.md).

### Design docs

- [Personas](./docs/personas.md) and [use cases](./docs/use-cases.md)
- [Almanac UI design](./docs/design/almanac/) and the [AI provenance addendum](./docs/design/almanac/AI_PROVENANCE_ADDENDUM.md)
- [Pricing and tiers](./docs/design/PRICING_AND_TIERS.md)
- [Plugin spec](./docs/plugin-spec.md)

## License

[MIT](./LICENSE)
