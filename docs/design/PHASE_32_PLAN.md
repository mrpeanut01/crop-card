# Phase 32 plan: animals, growing workflow and farm operations

Status: 32A shipped 2026-09-27 (schema, plugin contracts, cleanup and soil tests). 32B shipped 2026-09-27 (animals and pets core; its panel rulings are under "32B rulings"). 32C is built but parked, not shipped: the animal safety kernel (RULES_VERSION 0.6.0) went through four adversarial review rounds (23, 15, 11 and 7 verified bypasses, all fixed), and the C-35 backdating guard ruled in `PHASE_32C_C35_RULING.md` was interrupted mid-build. The code waits on the `claude/determined-johnson-4ndty4` checkpoint branch; its panel rulings are under "32C rulings". See the Phase 32 bullet in CLAUDE.md. 32D to 32F proposed. Sources: four research reports (livestock and home pets; growing workflow gaps; farm operations; records, compliance and reach) and three independent judge rulings. The Decisions section records every ruling and its vote.

## Why this phase

The owner's top priority for Phase 32 is livestock and home pets. CropCard has no animal code yet. It does have every building block the feature needs: typed Areas with `pasture` and `barn` kinds, the tenant-scoped table pattern, one inventory chrome, Cards with an offline snapshot, replayable record endpoints, a task engine with a twice-daily push tick, and a hard-locked safety kernel. Two new kernel rules come with animals. One stops food use during a medication withdrawal. The other stops grazing or haying inside a label interval after a pesticide application. No competitor we know of enforces either one.

The rest of the phase closes growing-workflow gaps that gardeners and small growers ask for: seed starting, season extension, rain-aware watering and degree-day scouting. It also adds the first farm-operations layer: task assignees, time on Done, a simple owner-only ledger and a weekly digest. Everything deterministic is free on every plan. AI stays optional and always degrades through `aiTry()`.

Phase 32 runs as six sprints, 32A through 32F. Three of them are about animals. The judges' plans ran from 6 to 11 sprints. This merged sequence keeps what all three agreed on and what the majority scheduled early, and moves the rest to Deferred with a stated reason.

## Ground rules for every sprint

- **Numbers need sources.** Every withdrawal time, grazing interval, degree-day threshold, cover day shift, indoor-start week and water target ships with a source entry (`url`, `publisher`, `date`, `quote`). A value that cannot be sourced is left out. Where the kernel applies, a missing value is treated as unknown, and unknown blocks. None of the numbers in the research reports have been checked yet. They came from memory, so the label research brief in 32A is on the critical path.
- **Tenant isolation.** Every new table is branded with `tenantScoped(...)`, has an `owner_id` column with a composite index, is wired into `tenant.crossTenant.test.ts`, is wiped with the farm and is included in the GDPR JSON export. Every id in a request body is checked in `lib/server/foreignRefs.ts`.
- **Offline.** New queue kinds are tagged with the Owner, follow the `__unassigned__` fail-safe and replay through `withClientRecordId` plus `writeRecord()`. They are added to the fake-indexeddb property test. Dexie moves from v4 to v5 once, in 32A, with every Phase 32 store and kind declared up front so later sprints do not bump it again.
- **OpenAPI.** Every new endpoint keeps its Zod schema in a client-safe `lib/**/apiSchemas.ts` so the drift test covers it.
- **Season close-out.** `SEASON_CLOSED` never gates animal endpoints, animal-care tasks, irrigation logs, ledger entries or time entries. Each exemption has a test.
- **Glove operation.** Every new action button is at least 48 dp. `/inventory`, `/animals` and `/today` stay free of horizontal overflow at 375 px under the existing e2e guard.
- **Performance.** `/today` query count and CPU are measured before and after each sprint against the Phase 31 numbers (57 queries, about 5 ms CPU). Any regression over 20% blocks the merge.

## Migration map

Two of the three judges wanted every Phase 32 table to land in one PR before feature work forks, so parallel worktrees never fight over the drizzle journal. The schema PR is cluster A1 of 32A. Tables sit empty until their sprint wires them up.

| #    | Migration             | Contents                                                                                                                                                                                                                                      |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0060 | `soil_test_fields`    | `soil_tests` gains `extraction_method`, `units_basis`, `ca_ppm`, `mg_ppm`, `buffer_ph_hundredths`, `lab_rating_json`, `provenance`, and a nullable `document_id` kept for the future vault                                                    |
| 0061 | `animals_core`        | `animal_groups`, `animals`, `animal_locations` (with `client_record_id`)                                                                                                                                                                      |
| 0062 | `animal_records`      | `animal_health_events` (including `food_producing_at_record`, `locked_at`), `animal_production_logs`, `animal_status_events`, `grazing_attestations`, `animal_flag_changes` (audit of `food_producing` and horse "not for slaughter" changes) |
| 0063 | `animal_care_plans`   | `animal_care_plans`                                                                                                                                                                                                                           |
| 0064 | `seed_starting`       | `crops.establishment`, `crops.sown_indoors_at`, `seed_starts`                                                                                                                                                                                 |
| 0065 | `block_protections`   | `block_protections`                                                                                                                                                                                                                           |
| 0066 | `irrigation`          | `irrigation_events`, `rain_gauge_readings`                                                                                                                                                                                                    |
| 0067 | `task_assignees_time` | `tasks.assignee_user_id`, `tasks.assigned_at`, index `(owner_id, assignee_user_id, scheduled_for)`, `task_time_entries`                                                                                                                       |
| 0068 | `ledger`              | `ledger_entries` with optional `crop_id`, `block_id`, `field_id`, `animal_id`, `animal_group_id`, `stock_lot_id`, `harvest_event_id` and a free-text `enterprise`                                                                             |
| 0069 | `animals_32b`         | Used by 32B, since 0058 has no SQL CHECK: `animal_groups.food_producing` (B-04) and `animal_locations.from_group_id` / `to_group_id` (B-08), both foreign keys `ON DELETE set null`.                                                          |

Confirmed in the repo: `stock_items.category` and `tasks.category` are drizzle TEXT enums with no SQL CHECK, so widening them is a TypeScript-only change. Adding `coop_pen` to the Area kinds is also TypeScript and Zod only, since `fields.kind` and `details_json` are TEXT.

Every table except `grazing_attestations`' shared lookups is tenant-scoped. `animal_health_events`, `animal_status_events` and `animal_production_logs` join the FR-09 lock and the `record_deletions` tombstone path for food-producing subjects (see Q7). None of the new tables are added to `RETENTION_RULES`.

---

## 32A: Foundations, label data and cleanup

**Goal.** Land the whole phase's schema and plugin contracts in one pass, start the label research that the animal kernel depends on, and fix the data-honesty gaps left over from Phase 30. The soil-test unit fix goes here because a known correctness bug should not wait behind new features.

### Features and MVP scope

1. **Phase 32 schema PR.** Migrations 0060 through 0068 (and 0069 if needed), the `tenantScoped` brand on every new table, cross-tenant test fixtures for each one, `foreignRefs.ts` checkers (`assertAnimalSubject`, `assertAssignableUser`, `assertStockLot`, `assertField`), and the Dexie v5 bump with every Phase 32 store and queue kind declared, each still unused.
2. **Plugin contracts.**
   - New data-only kinds `plugins/animal-health/` and `plugins/species/`, with `schemas/animal-health.schema.json` and `schemas/species.schema.json`.
   - A `grazingRestrictions` block on the herbicide, insecticide and fungicide schemas: `grazeDays`, `hayDays`, `lactatingDairyGrazeDays`, `meatAnimalRemovalBeforeSlaughterDays`, `speciesExceptions[]`, `notForPasture`, `manureCarryover`, `source`.
   - `plugins/pest-models/` with an enum-only `method` field and no expressions.
   - Crop `plantingGuide` gains `establishment`, `startIndoorsWeeks`, `transplantOffsetDays`, `hardenOffDays`, `germinationTempF` and `dtmFrom`.
   - Crop `animalToxicity[]`.
   - `pnpm gen:schemas` regenerates `/schemas`.
3. **Source files and coverage gates.**
   - New files: `apps/web/scripts/animal-health-sources.json`, `grazing-sources.json` and `pest-model-sources.json`.
   - CI fails on an animal-health plugin that lacks a sourced withdrawal for any species it is labelled for.
   - CI fails on a pesticide plugin whose label crops include pasture but that has neither `grazingRestrictions` nor an allowlist reason.
   - The existing #255 gate gets allowlists so empty crop fields do not fail CI.
4. **Label research brief.** Extend `docs/research/label-research-prompt.md` with two task sections. One covers withdrawal times for the seed set of animal-health products and the FDA 21 CFR 530.41 prohibited list. The other covers grazing and haying intervals for about ten pasture herbicides. The brief is worked by a local agent with label access while 32B runs. Its output lands as plugin data in 32C.
5. **Phase 30 cleanup.**
   - The GDPR export gains Areas, block details and layout columns, `map_features`, soil tests, journal metadata and every Phase 32 table.
   - The two "Fence" choices are renamed "Fence (shade)" and "Fence line".
   - The six record endpoints' inline schemas move into `apiSchemas.ts`, and the remaining `PATCH /api/crops/:id` actions are published as a discriminated union.
   - Storage is computed from source: a `SUM` over journal photo sizes, cached in an owner setting and recomputed nightly by `runDbMaintenance`. `owner_usage_counters.storage_bytes` stops being treated as authoritative.
6. **Soil tests.**
   - Fix the ppm versus lb/acre handling in `lib/plan/inputsPlan.ts` first, with regression tests.
   - Then add `lib/fertility/soilInterpret.ts`: pH class, P and K class by extraction method, a lime estimate tagged `fallback`, and staleness after three years.
   - A `SetupSoilTest` sheet and a `soilTest` Card kind in the snapshot.
   - The lab's typed rating wins over the computed class, and the Card always says "follow your lab's recommendation".
7. **Invariant 8 wording.** CLAUDE.md and `INVENTORY_UNIFICATION.md` change "5-chip type swap" to "one chip per inventory type, with empty types hidden". The chips themselves ship in 32D.

- **Data model:** see the migration map.
- **Routes:** no new pages. `GET /api/account/export.json` gains sections. `POST /api/fertility/soil-tests` gains the new fields and an OpenAPI entry.
- **Card kinds:** `soilTest` (prefix `st`).
- **Offline queue kinds:** declared only in this sprint. Soil test entry stays online.
- **Safety kernel:** no rule changes. `RULES_VERSION` stays at 0.5.7.
- **AI touchpoints:** none.
- **Plan tiers:** all free.

### Work clusters

| Cluster             | Owns                                                                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 Schema           | `apps/web/drizzle/0060..0069*`, `lib/db/schema.ts`, `lib/db/tenant.crossTenant.test.ts`, `lib/server/foreignRefs.ts`, `lib/client/dexie.ts`                                                                                                                                       |
| A2 Plugin contracts | `packages/plugin-validation/src/schemas.ts`, `schemas/*.schema.json`, `lib/plugins/registry*`, `apps/web/scripts/*-sources.json`, the coverage-gate scripts, `docs/research/label-research-prompt.md`, CLAUDE.md Invariant 8 text, `docs/design/almanac/INVENTORY_UNIFICATION.md` |
| A3 Cleanup          | `routes/api/account/export.json/**`, `components/farm/FarmMapEditor.svelte`, `AreaAddDrawer.svelte`, record-endpoint `apiSchemas.ts` modules, `scripts/gen-openapi.mjs`, `lib/server/dbMaintenance.ts` (storage recompute only)                                                   |
| A4 Soil             | `lib/plan/inputsPlan.ts` (soil credit functions only), `lib/fertility/soilInterpret.ts`, `lib/fertility/apiSchemas.ts`, `components/setup/SetupSoilTest.svelte`, `lib/cards/build/soilTest.ts`, the `soilTest` entry in `lib/cards/model.ts`                                      |

A1 merges first. A2, A3 and A4 rebase on it and do not touch each other's files. A4 adds its Card kind to `lib/cards/model.ts` and to `lib/server/cardSnapshot.ts`, the only shared file. A4 owns that edit in this sprint.

### Acceptance

- **Unit:** the cross-tenant test covers every new table. The schema drift test and the OpenAPI drift test pass. Soil unit regression tests cover a lab report in lb/acre and one in ppm giving the same credit. The `soilInterpret` table tests cover each extraction method.
- **Coverage gates:** a fixture plugin missing a source fails CI, and the allowlist path passes.
- **e2e:** the GDPR export contains Areas and map features for a seeded farm. The map's Add drawer shows two distinct fence labels. The soil test sheet saves and the Card renders offline.
- **Persona, farm:** the owner enters last spring's Virginia Tech soil report in under two minutes and sees the Inputs Plan P and K credits change sensibly.
- **Persona, garden household:** a gardener with no soil test sees a single "Add a soil test" nudge, no compliance chrome, and can dismiss it.

---

## 32B: Animals and pets core

**Goal.** One place to know every animal or flock on the farm or in the household, where it lives and whether it is still here. Pets are a simpler view of the same tables.

### Features and MVP scope

- **Animals and groups (Q1).** Individuals can optionally sit in a group, and unnamed groups carry a `head_count`. Records target `animal|group`. Status changes cover sold, died, culled and rehomed, each written to `animal_status_events` with a date and reason.
- **Housing.** A group or animal is housed on a barn, pasture or `coop_pen` Area (the new other-Area kind with `details.capacity`). The Area Card and the farm map's Area sheet list who lives there.
- **Moves.** `POST /api/animals/move` is a replayable record endpoint writing `animal_locations`. In this sprint it has no gate. The grazing gate arrives in 32C, and the endpoint is shaped so the gate can be inserted before the write.
- **Species plugin kind.** Ten species (chicken, duck, goat, sheep, cattle, pig, horse, rabbit, dog, cat). Each carries a `food_producing` default, care-cadence defaults for 32D, and display tiles. Every value has a source.
- **Food-producing flag (Q8).** Defaults come from the species plugin: poultry, ruminants, pigs, rabbits and horses are food-producing, dogs and cats are not. Only the owner can change the flag. Each change writes an `animal_flag_changes` row with a reason and shows a warning. Horses get a recorded "not for slaughter" toggle.
- **Pets view (Q9, Q13).** `/animals` is labelled "Pets & animals" when `farm_profile.animals` is `pets`, or when the farm profile is a garden household. That layout hides tags, breed codes and production analytics, and lists individuals before groups. It never hides safety chips.
- **Onboarding.** Screen 2 gains "Animals", "Pets" and "Backyard chickens" tiles. They seed an undrawn Barn or Coop Area and set `farm_profile.animals`. The Getting Started card gains "Add your animals".
- **SetupSheet.** `SetupAnimalHousing` (pick or create a barn, pasture or coop Area, with the map opened only on request) and `SetupAnimal` (species tiles plus a name or tag).
- **Authz (Q11).** Owners create, archive and delete animals and groups and set `food_producing`. Helpers read everything and log moves. `DELETE /api/animals/[id]?ifEmpty=1` returns `ANIMAL_HAS_RECORDS` when records exist.

### Data model

- `animal_groups`: `id`, `owner_id`, `name`, `species_id`, `purpose` (`production|pet|mixed`), `head_count`, `housing_field_id`, `status`, `notes`, timestamps.
- `animals`: `id`, `owner_id`, `group_id`, `species_id`, `breed`, `name`, `tag`, `sex`, `birth_date`, `birth_date_estimated`, `acquired_date`, `acquired_from`, `purpose`, `food_producing`, `not_for_slaughter`, `status`, `status_date`, `status_reason`, `housing_field_id`, `photo_ref`, `notes`, timestamps.
- `animal_locations`: `id`, `owner_id`, `subject_type`, `subject_id`, `field_id`, `from_ms`, `to_ms`, `moved_by`.

`photo_ref` reuses the journal photo path: EXIF stripped and a 300 KB cap.

### Routes

- Pages: `/animals`, `/animals/add`, `/animals/[id]`, `/animals/groups/[id]`.
- API: `GET/POST /api/animals`, `PATCH/DELETE /api/animals/[id]`, `/api/animal-groups/**`, `POST /api/animals/move`.
- Schemas live in `lib/animals/apiSchemas.ts`.

- **Card kinds:** none yet. The detail pages use `CardView` chrome so 32D can turn them into Cards.
- **Offline queue kinds:** `animal-move` is wired in this sprint, since moves are the chore helpers do most.
- **Safety kernel:** no rule change. `food_producing` is plain data here, and the kernel reads it in 32C.
- **AI touchpoints:** none.
- **Plan tiers:** free on every plan. Helpers count against seats as they do today.

### Work clusters

| Cluster                 | Owns                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1 Data and API         | `lib/db/animals.ts`, `lib/db/animalGroups.ts`, `lib/db/animalLocations.ts`, `routes/api/animals/**`, `routes/api/animal-groups/**`, `lib/animals/apiSchemas.ts`                                                                            |
| B2 Species plugins      | `plugins/species/*.json`, `apps/web/scripts/species-sources.json`, `lib/plugins/species.ts`                                                                                                                                                |
| B3 Surfaces             | `routes/animals/**`, `components/animals/**`, `components/setup/SetupAnimal*.svelte`, `lib/animals/profile.ts` (pets layout rules)                                                                                                         |
| B4 Onboarding and Areas | `lib/farm/areaKinds.ts` (`coop_pen`), `lib/farm/kindStyle.ts`, the onboarding screen 2 tiles, `lib/onboarding/**` Getting Started item, the Area Card housed-animals list, `lib/client/syncQueue.ts` (`animal-move` endpoint mapping only) |

### Acceptance

- **Unit:**
  - The cross-tenant property test covers animals, groups and locations.
  - `foreignRefs` rejects another Owner's `field_id` on a move.
  - A helper receives 403 on create, archive, delete and `food_producing` changes.
  - Animal endpoints stay open while `SEASON_CLOSED` is set.
- **e2e:**
  - An owner adds a flock of 24 layers to a new Coop Area, a helper moves them offline, and the move replays exactly once.
  - A garden-profile account sees "Pets & animals" with no tag field.
- **375 px:** `/animals` has no horizontal overflow.
- **Persona, farm:** the owner enters a herd of 12 ewes, a ram and a family cow, houses them on pasture and barn, and moves the ewes, all in under five minutes.
- **Persona, garden household:** a household adds a dog, two cats and four hens from onboarding tiles and never sees the word "livestock". The hens show as food-producing, with a one-line explanation.

### 32B rulings

A three-judge panel answered 32 build questions before 32B started. Each row is the choice at least two judges shared; where all three differed, the records and safety judge's choice was adopted.

| ID   | Ruling                                                                                                                                                                                                                                          | Vote |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| B-01 | One animal needs a name or a tag. Everything else is optional. With neither, the form offers "Add as a group with a count".                                                                                                                     | 3-0  |
| B-02 | "24 layers" is one group with a head count. "Name some of them" turns each named row into an animal in the group and takes one off the unnamed count.                                                                                           | 3-0  |
| B-03 | `head_count` is the unnamed part only. The group total is `head_count` plus active named members, from one helper (`lib/animals/counts.ts`).                                                                                                    | 3-0  |
| B-04 | New `animal_groups.food_producing` column. The value the kernel reads is the group flag or any active member's flag, never derived from purpose.                                                                                                | 3-0  |
| B-05 | One species per group. Mixed living is two groups on the same Area.                                                                                                                                                                             | 3-0  |
| B-06 | The open `animal_locations` row is authoritative; `housing_field_id` is a cache rewritten in the same transaction. A grouped animal lives where its group lives.                                                                                | 3-0  |
| B-07 | Part of a group moves by count and picked names into a new group in one replayable transaction. Helpers can do it.                                                                                                                              | 3-0  |
| B-08 | Joining or leaving a group is a move, recorded on the location row in `from_group_id` / `to_group_id` (migration 0069).                                                                                                                         | 3-0  |
| B-09 | Losses from a group are status events with a negative delta, never more than the unnamed count. At zero the page asks whether to archive. Additions write an `active` event with a positive delta.                                              | 3-0  |
| B-10 | `slaughtered` and `sold-for-meat` are refused by the API schema until the 32C withdrawal gate exists.                                                                                                                                           | 3-0  |
| B-11 | A mistaken entry with no records can be deleted with its first stay; anything with records is archived. Sold, died, culled and rehomed animals are read-only except notes and photo. A group with active members cannot be deleted or archived. | 3-0  |
| B-12 | Status history is append-only, corrected by a new `active` event. Owners can delete the latest change inside the 48 hour lock. Status events of food-producing subjects get `locked_at` from 32B.                                               | 3-0  |
| B-13 | Any Area can house animals except natural areas, water and boundaries. Housing stays optional.                                                                                                                                                  | 3-0  |
| B-14 | Capacity only on `coop_pen`, owner-typed, shown as "Over capacity (26 of 24)" and never enforced.                                                                                                                                               | 3-0  |
| B-15 | The onboarding answer is its own `farm_animals` setting (a comma list of `animals`, `pets`, `chickens`), parsed in `lib/onboarding/profile.ts`. `farm_profile` readers are untouched.                                                           | 3-0  |
| B-16 | Animals seeds an undrawn Barn, Backyard chickens an undrawn Chicken Coop, Pets nothing. An animals-only answer is valid: Animals reads as a farm, Pets or chickens alone as a household.                                                        | 3-0  |
| B-17 | Pets layout for a garden household, or when the answer has Pets but not Animals (`usesPetsLayout`). Tags and farm fields hide per row by purpose. Safety chips always show. No "livestock" in that layout.                                      | 3-0  |
| B-18 | Only the owner changes the food flag, with a reason, audited in the same save. The add form shows the species default as a chip with a one-line reason.                                                                                         | 3-0  |
| B-19 | The horse "not for slaughter" toggle is reversible, shown only when the species offers it, and never changes `food_producing`.                                                                                                                  | 3-0  |
| B-20 | Ten species, no Other. Requests for turkeys, geese, alpacas and bees are follow-ups.                                                                                                                                                            | 3-0  |
| B-21 | Only `foodProducingDefault` is sourced in 32B (`species-sources.json`). Care defaults wait for 32D.                                                                                                                                             | 3-0  |
| B-22 | Breed is free text. Sex words per species are a display-only map.                                                                                                                                                                               | 3-0  |
| B-23 | A tag already in use is a warning with a link, not a block. No unique index.                                                                                                                                                                    | 3-0  |
| B-24 | Photos ship in 32B: EXIF stripped, 300 KB cap, counted in storage, owner and helper, online only.                                                                                                                                               | 3-0  |
| B-25 | Birth date can be marked estimated and shows as "about N years".                                                                                                                                                                                | 3-0  |
| B-26 | The live Area Card and the map's Area sheet list who lives there. Nothing enters the offline snapshot until 32D.                                                                                                                                | 3-0  |
| B-27 | Deleting an Area with animals on it is refused (`AREA_HAS_ANIMALS`). An archive-an-Area path is filed for 32C.                                                                                                                                  | 2-1  |
| B-28 | Moves can be backdated and replay out of order. The timeline never overlaps, checked by a property test.                                                                                                                                        | 3-0  |
| B-29 | Helpers correct a move by moving the animals back. Owners can delete only the latest move, which reopens the stay before it.                                                                                                                    | 3-0  |
| B-30 | Creating animals and groups is online only. A queued move for an unknown id fails with a clear message.                                                                                                                                         | 3-0  |
| B-31 | "Add your animals" shows only for farms that answered with an animal tile, owner-only, done once any animal or group exists.                                                                                                                    | 3-0  |
| B-32 | The nav shows "Animals" or "Pets & animals" only once the owner answered with an animal tile or an animal exists.                                                                                                                               | 3-0  |

---

## 32C: Animal safety kernel (RULES_VERSION 0.5.7 to 0.6.0)

**Goal.** Refuse to let eggs, milk or meat reach the table during a withdrawal period, and refuse to graze or cut hay inside a label interval. Treatment records always save.

### Features and MVP scope

**Animal-health plugins (Q4).** The seed set is ten or fewer common OTC products, and each one ships only once its label withdrawal numbers carry a checked quote. Products the research brief could not verify are left out, and the kernel then treats them as unknown. Core pet vaccines ship with no withdrawal and `food_producing: false` species only.

**Health events.** Treatment, vaccination, deworm, vet visit, injury and note, logged against an animal or a group.

- Each event stores `route`, `label_use`, an optional `stock_item_id` (the dose deducts stock with the new movement reason `animal-treatment`) and a manual `lot_number`.
- When a vet directs the use, the owner can enter a vet-directed withdrawal.
- At write time the endpoint computes `withdrawal_clear` and stores it with `rules_version`, the same way spray records store their verdicts.

**Production logs.** Eggs and milk, with `use` set to `food|sale|discard|feed-to-animals|unknown`. Weight is optional and never gated.

**Withdrawal rule (Q2).** `lib/safety/animalWithdrawal.ts`, pure, with no DB access.

- `computeWithdrawalClear(treatment, plugin, species)`.
- `evaluateFoodUse(subject, species, treatments[], use, atMs)` returns `safe`, or a block with reason `WITHDRAWAL_ACTIVE`, `WITHDRAWAL_UNKNOWN` or `PROHIBITED_DRUG`, plus `clearsAtMs` and the products involved.
- The check runs on production logs with `use` of food or sale, and on status changes to slaughter or sale for meat.
- It is non-overridable. The client can resubmit as `discard` and the count still saves.
- The FDA 21 CFR 530.41 prohibited extra-label list is hardcoded in the kernel after verification against the current CFR. A food-producing animal treated with one of those drugs can never be declared for food again. For a horse, that means sale for meat stays blocked even if "not for slaughter" is later switched off.

**Membership (Q1).**

- A group treatment covers every current member, and also any animal that joins the group while the withdrawal is still running.
- An individual treatment blocks group-level egg and milk food logs for the group it belongs to.
- Moving an animal between groups carries its hold with it.

**Lock (Q7).**

- Treatments, vaccinations and deworms on a food-producing subject lock at 48 h under FR-09, with owner-only force delete through `record_deletions`.
- Vet visits, notes and records for non-food animals stay editable, with an audit trail.
- The lock uses the stricter of `food_producing_at_record` and the current flag, so flipping the flag cannot unlock an old record.

**Grazing rule (Q5, Q6).** `lib/safety/grazingInterval.ts`, pure.

- `evaluateGrazing({sprays[], species, lactating, foodProducing, attestations[], atMs})` and `evaluateHayCut(...)` check spray, insecticide and fungicide events on blocks inside the destination Area.
- When the product has `grazingRestrictions`, the general interval is a hard, non-overridable block. Species and lactating exceptions come only from `speciesExceptions` data.
- When the product has no data, the Area has a recorded application inside the lookback window (365 days, or the longest known interval if that is longer) and the animal is food-producing, the move or hay cut is blocked with `GRAZING_UNKNOWN`. The block lifts when the owner records an interval read from the label in `grazing_attestations`, with `manual` provenance, a reason and an audit row. Helpers see "Ask the owner".
- Pets and non-food animals get a warning only.
- `hasManureCarryover(sprays[])` backs advisory copy.

**Wiring.** The kernel runs in:

- `POST /api/animals/move` and group housing changes when the destination is a pasture or any crop-bearing Area;
- the hay mow step at `status='mowing'`;
- `POST /api/animals/production/record`;
- the slaughter and sale status change on `PATCH /api/animals/[id]`.

**Pasture backfill.** Sourced `grazingRestrictions` for about ten pasture herbicides from the research brief's output. The coverage gate turns on for pasture-labelled products.

**Advisories.**

- The Area Card shows "Grazing clear on <date>".
- The spray context strip on a pasture shows "Animals here now: 12 ewes; this product requires removal for N days". This is advisory only and never blocks the spray.
- The product detail page carries a copy line about aminopyralid manure carryover.

### Data model

- `animal_health_events`: `id`, `owner_id`, `subject_type`, `subject_id`, `kind`, `product_plugin_id`, `product_name`, `stock_item_id`, `lot_number`, `dose`, `dose_unit`, `route`, `administered_at`, `course_end_at`, `label_use`, `vet_name`, `vet_directed_withdrawal`, `withdrawal_clear`, `rules_version`, `food_producing_at_record`, `performed_by_id`, `client_record_id`, `locked_at`.
- `animal_production_logs`: `id`, `owner_id`, `subject_type`, `subject_id`, `kind`, `quantity`, `unit`, `occurred_at`, `use`, `rules_version`, `client_record_id`.
- `grazing_attestations`: `id`, `owner_id`, `field_id`, `product_plugin_id`, `spray_event_ref`, `graze_days`, `hay_days`, `reason`, `attested_by`, `created_at`.
- `stock_movements.reason` gains `animal-treatment` as a TypeScript enum value.

### Routes

- `POST /api/animals/health/record`
- `POST /api/animals/production/record`
- `POST /api/animals/grazing-attestations` (owner only)
- `/animals/[id]/health`
- `/animals/[id]/log`

The existing structured bypass-error modal shows the stop. An aria-live banner announces it.

- **Card kinds:** none new. A "HOLD until <date>" chip appears on the animal detail page.
- **Offline queue kinds:** `animal-health` and `animal-production` are wired server-side in this sprint. The client recovery UX ships in 32D.
- **RULES_VERSION:** 0.5.7 to 0.6.0, covering both rules in one bump.
- **AI touchpoints:** none in this sprint. Withdrawal numbers and lot are never `ai`.
- **Plan tiers:** free on every plan. This is safety and records.

### Kernel test expectations

The kernel is tested as a security boundary, with exhaustive vitest tables and fast-check properties.

Withdrawal properties:

- Clearance is never earlier than the plugin label.
- A vet-directed withdrawal can only lengthen clearance.
- Unknown always blocks for a food-producing subject.
- A group treatment covers every member, including animals that join during the window.
- An individual treatment blocks group egg and milk food logs.
- Prohibited drugs block forever.
- Changing `food_producing` never shortens an existing hold.
- `discard` is always accepted.

Grazing properties:

- Clearance is never before application plus the largest applicable interval.
- The lactating path is never shorter than the general path.
- A species exception can only come from data.
- A missing-data block exists only when there is a recorded application inside the lookback window and the animal is food-producing.
- An attestation clears exactly the attested interval and nothing more.

Integration tests confirm that a helper hits the same blocks with no override path, and that every read inside the kernel's callers goes through `tenantWhere`.

### Work clusters

| Cluster                            | Owns                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 Withdrawal kernel               | `lib/safety/animalWithdrawal.ts`, `lib/safety/prohibitedAnimalDrugs.ts`, their tests, `lib/safety/version.ts`                                                                                                                                                          |
| C2 Grazing kernel and backfill     | `lib/safety/grazingInterval.ts` and tests, `plugins/herbicides/*` `grazingRestrictions` values, `apps/web/scripts/grazing-sources.json`, the spray context strip pasture notice, the Area Card grazing line                                                            |
| C3 Health and production endpoints | `routes/api/animals/health/**`, `routes/api/animals/production/**`, `routes/api/animals/grazing-attestations/**`, `lib/db/animalHealth.ts`, `lib/db/animalProduction.ts`, the lock and tombstone wiring, `routes/animals/[id]/health/**`, `routes/animals/[id]/log/**` |
| C4 Plugin data and wiring          | `plugins/animal-health/*.json`, `apps/web/scripts/animal-health-sources.json`, the kernel call sites in `routes/api/animals/move/**`, `routes/api/animals/[id]/**` (status gate) and the hay mow endpoint                                                              |

C1 and C2 share only `version.ts`. C1 owns the version bump and C2 rebases on it. C3 and C4 import the kernels through their exported types, which are agreed on the first day.

### Acceptance

- **Unit:** the kernel suites above. Cross-tenant tests on the new tables. `foreignRefs` covers the subject, stock and field ids.
- **e2e:**
  - Treat one hen in a flock with a product carrying an egg withdrawal, then try to log eggs as food. The app stops with the clear date. Saving as discard succeeds.
  - Move ewes onto a pasture sprayed ten days earlier with a sourced product. The move is blocked.
  - Move them onto a pasture sprayed with an unsourced product. The block names the owner, and a helper sees "Ask the owner".
- **Persona, farm:** the owner treats the family cow with a vet-directed extra-label drug, enters the vet's milk withdrawal, and sees exactly when milk can go back in the house. A helper cannot change that number.
- **Persona, garden household:** a household deworms its hens with a labelled product and sees "HOLD eggs until <date>" on the flock page. Logging a vet visit for the dog never shows a lock or a withdrawal.

### 32C rulings

A three-judge panel answered 34 build questions before 32C started. Each row is the choice at least two judges shared; every vote was unanimous.

| ID   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Vote |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| C-01 | Only the owner adds a withdrawal entry, append-only in `vet_directed_withdrawal`, and it works on locked records. Each entry clears `WITHDRAWAL_UNKNOWN` for one treatment and one food. A `label` entry is refused unless the owner confirms the label names the species and class, or when the label says not to use it for that food; those need a vet entry with the vet's name. Zero needs an explicit "The label says no withdrawal". Numbers are never `ai`, never scanned and never pre-filled. | 3-0  |
| C-02 | The floor is the longest of the plugin label and every entry; a vet value can only lengthen. Extra-label use in a food animal takes the vet path only.                                                                                                                                                                                                                                                                                                                                                  | 3-0  |
| C-03 | Withdrawal runs from the last dose. An open course blocks as unknown. The recorded end date can only move later. A date with no time reads as 23:59 farm-local.                                                                                                                                                                                                                                                                                                                                         | 3-0  |
| C-04 | Clear times round up to the start of the next local day, DST-safe through Intl (property-tested in 15 zones). With no farm time zone setting, callers pass the user's saved zone.                                                                                                                                                                                                                                                                                                                       | 3-0  |
| C-05 | A production log is checked at the time the food was collected. A log saved more than 48 h late is marked "logged N days later". A replay that hits a hold gets 422 with `resubmitAs: 'discard'` and waits in the queue.                                                                                                                                                                                                                                                                                | 3-0  |
| C-06 | A backdated treatment always saves and never rewrites saved logs. The response and the owner's /today list the food or sale logs it covers: "If any of these were sold, tell the buyer."                                                                                                                                                                                                                                                                                                                | 3-0  |
| C-07 | Production logs lock at 48 h. A change toward discard is always allowed and audited; any other change respects the lock and runs the gate.                                                                                                                                                                                                                                                                                                                                                              | 3-0  |
| C-08 | `unknown` and `feed-to-animals` save with a warning, never a block.                                                                                                                                                                                                                                                                                                                                                                                                                                     | 3-0  |
| C-09 | The food gate never reads `food_producing`; holds are computed for every treatment, so flipping the flag never shortens one.                                                                                                                                                                                                                                                                                                                                                                            | 3-0  |
| C-10 | Lactating and laying are presumed (for groups and unknowns); helpers never answer a question that shortens a hold. An owner-only audited "dry / not laying" flag is a follow-up.                                                                                                                                                                                                                                                                                                                        | 3-0  |
| C-11 | A plugin's label use must match species, class and route; any mismatch reads as unknown and only a vet entry resolves it.                                                                                                                                                                                                                                                                                                                                                                               | 3-0  |
| C-12 | A label `doNotUseFor` the food is cleared only by a vet entry.                                                                                                                                                                                                                                                                                                                                                                                                                                          | 3-0  |
| C-13 | Prohibited drugs (21 CFR 530.41) are matched by name and class, erring toward inclusion. A free-text match counts as prohibited until the owner picks the plugin product that proves on-label use; seven drugs (chloramphenicol, clenbuterol, DES, the nitroimidazoles, glycopeptides, phenylbutazone, the flu antivirals) can never be exempted.                                                                                                                                                       | 3-0  |
| C-14 | A prohibited drug holds every food forever. Animals that join a group during the course carry the hold; later joiners do not.                                                                                                                                                                                                                                                                                                                                                                           | 3-0  |
| C-15 | Group membership over time is rebuilt from `animal_locations.from_group_id`/`to_group_id` (`lib/animals/membership.ts`, fast-check property); a split group carries its parents' holds from before the split.                                                                                                                                                                                                                                                                                           | 3-0  |
| C-16 | An individual treatment blocks its group's eggs and milk while it is a member, never the meat of the group's unnamed animals.                                                                                                                                                                                                                                                                                                                                                                           | 3-0  |
| C-17 | `slaughtered`, `sold-for-meat`, and `sold`/`died`/`culled` with `meatUsed` run the meat gate. A blocked slaughter can be recorded as culled, meat not used. The gate ignores `food_producing` and `not_for_slaughter`.                                                                                                                                                                                                                                                                                  | 3-0  |
| C-18 | The stored `withdrawal_clear` verdict is a floor: a new rule version or relabelled product can only lengthen an old hold.                                                                                                                                                                                                                                                                                                                                                                               | 3-0  |
| C-19 | Treatment, vaccination and deworm carry a product and a hold; only the owner edits or removes a record carrying a hold.                                                                                                                                                                                                                                                                                                                                                                                 | 3-0  |
| C-20 | The 48 h lock counts from the date the treatment happened, like spray records; the form says "Locks when saved" for an older date.                                                                                                                                                                                                                                                                                                                                                                      | 3-0  |
| C-21 | Every block in an Area counts; moving a block with an open hold to another Area is refused (`BLOCK_HAS_GRAZING_HOLD`).                                                                                                                                                                                                                                                                                                                                                                                  | 3-0  |
| C-22 | No schema change: a spray is always recorded on a block, so the gate sees every recorded application. Letting a pasture with no blocks take a spray record is a follow-up.                                                                                                                                                                                                                                                                                                                              | 3-0  |
| C-23 | Lookback is inclusive, the longest of 365 days, the registry's longest interval and the input's longest, snapshotted into the verdict.                                                                                                                                                                                                                                                                                                                                                                  | 3-0  |
| C-24 | A missing interval inside `grazingRestrictions` is unknown; `notForPasture` cannot be attested away. The coverage gate requires all four intervals (0 = none stated).                                                                                                                                                                                                                                                                                                                                   | 3-0  |
| C-25 | A species exception replaces the general interval; lactating is never shorter than general.                                                                                                                                                                                                                                                                                                                                                                                                             | 3-0  |
| C-26 | A force-deleted dose keeps its hold unless the owner says it was never given. Tombstone kinds gain animal-health, animal-production, animal-status and fungicide.                                                                                                                                                                                                                                                                                                                                       | 3-0  |
| C-27 | Grazing attestations are per application and product, owner only, batchable, and can only fill an unknown or lengthen.                                                                                                                                                                                                                                                                                                                                                                                  | 3-0  |
| C-28 | The hay-mow gate runs on every mow of a sprayed block whether or not animals are near, and the weather override never bypasses it.                                                                                                                                                                                                                                                                                                                                                                      | 3-0  |
| C-29 | Every move path (group, split, single, joining a group) runs the grazing gate; Areas with no recorded application pass free.                                                                                                                                                                                                                                                                                                                                                                            | 3-0  |
| C-30 | A move dated 30 minutes or more in the past saves with a warning, and the animals' eggs, milk and meat are held for the interval (`grazingExposure.ts`). A newer move into an interval gets 422.                                                                                                                                                                                                                                                                                                        | 3-0  |
| C-31 | A spray while food animals are on the Area is never blocked; their food is held by the same exposure rule.                                                                                                                                                                                                                                                                                                                                                                                              | 3-0  |
| C-32 | Helpers hit the same stops with "Ask the owner." and no override path.                                                                                                                                                                                                                                                                                                                                                                                                                                  | 3-0  |
| C-33 | Hold chips are per food: "HOLD eggs until <date>", "withdrawal not known", "Never for food".                                                                                                                                                                                                                                                                                                                                                                                                            | 3-0  |
| C-34 | The bottle picked from stock names the product that drives the hold; a dose in a unit the stock item cannot take saves without a deduction and says so.                                                                                                                                                                                                                                                                                                                                                 | 3-0  |

---

## 32D: Animal care, offline Cards and feed inventory

**Goal.** Make animals work in the barn with no signal. Reminders arrive on their own, and feed and meds live in the one inventory chrome.

### Features and MVP scope

- **Care plans (Q12).** `animal_care_plans` rows use a fixed interval or a one-off date. They materialize into `tasks` with category `animal-care`, both on read and at the push tick, deduped by `planId:dueDate` and exempt from `SEASON_CLOSED` suppression. Closing the task through `POST /api/tasks/close` with an attached event creates the `animal_health_events` row and rolls `next_due_at` forward. Species defaults come from species plugins tagged `plugin`, and owner edits are tagged `manual`. Core pet vaccine defaults say "ask your vet".
- **Alerts.**
  - `animal-care-due` push, on by default, with a matching opt-in email category.
  - `withdrawal-clears`, informational and off by default.
  - The tick re-checks `helper_assignments` before sending.
- **Animal and Flock Cards.** Card kinds `animal` (prefix `an`) and `flock` (prefix `fl`, used for any herd, flock or litter).
  - A pet renders the `animal` kind in its pet layout: next vaccine, meds, food amount, the vet contact and the microchip ID.
  - `farm_emergency_contacts` gains a "Vet" contact type.
  - Cards support pin, print and `/c/an_<id>` short links.
- **Snapshot.** `lib/server/cardSnapshot.ts` adds:
  - animals and groups;
  - active care plans;
  - treatments whose withdrawal clears in the future, plus the last 90 days;
  - per-pasture grazing-clear dates and the recent sprays needed for a client pre-check.

  `snapshotStateKey` includes the max `updated_at` of each new table, so the 304 path never serves a stale HOLD. A farm with hundreds of tagged animals stays inside the Phase 31 snapshot budget, which is measured.

- **Client HOLD chip.** The client runs the same pure kernel modules over snapshot data, so the chip shows offline. The server stays authoritative on replay.
- **Offline recovery.**
  - Quick actions on the Flock Card (log eggs, log treatment, move) enqueue as `animal-production`, `animal-health` and `animal-move`.
  - A replayed 422 becomes a queue row offering "Save as discard" (production) or "Keep animals here" (move). A 422 never leaves a stuck failed row.
- **Inventory types (Q3).**
  - `feed` (bedding maps here) and `animal-health` join `/inventory`. Each chip is hidden until the farm has animals or stock of that type, so crop-only farms still see five.
  - Detail components `FeedDetail` and `AnimalHealthDetail`, plus per-type maps in `A_InventoryEditForm`.
  - `LotUnit` gains `bag`, and a manual "used N lb" action records feed use with the movement reason `animal-feed`.
  - The five add methods route through the canonical form. A label scan on a med goes through `aiTry()` and may prefill the name and NADA number only, tagged `ai`. Withdrawal data never comes from a scan.
- **Toxic-plant advisory (Q14).** Sourced `animalToxicity` values on about a dozen crop plugins, with a pure `lib/animals/toxicAdjacency.ts` helper. It produces same-Area callouts on the Animal, Flock and Area Cards, with `plugin` provenance. It is advisory and has no kernel impact.

- **Data model:** `animal_care_plans` (`id`, `owner_id`, `subject_type`, `subject_id`, `kind`, `title`, `product_plugin_id`, `interval_days`, `once_on`, `next_due_at`, `lead_days`, `active`, `provenance`). The TypeScript enums widen as follows, with no migrations: `tasks.category` gains `animal-care`, `related_event_table` gains `animal_health_event`, and `stock_items.category` gains `feed`, `bedding` and `animal-health`.
- **Routes:**
  - Pages: `/cards/animal/[key]` and `/cards/flock/[key]` through the existing `/cards/[kind]/[key]`.
  - API: `/api/animals/[id]/care-plans/**` (owner writes).
  - `/inventory?type=feed|animal-health`.
- **Card kinds:** `animal`, `flock`.
- **Offline queue kinds:** `animal-health`, `animal-production` and `animal-move` get their full recovery UX.
- **Safety kernel:** no new rules. The client reuses the 0.6.0 modules.
- **AI touchpoints:** the med label scan, through `aiTry()` and `aiGuard`, fills the name only. It degrades to manual entry with no key.
- **Plan tiers:** free. The label scan draws on the AI budget like every other scan.

### Work clusters

| Cluster                  | Owns                                                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 Care plans and alerts | `lib/db/animalCarePlans.ts`, `lib/animals/carePlans.ts`, `routes/api/animals/[id]/care-plans/**`, `lib/push/prefs.ts`, `lib/server/push/triggers.ts`, `lib/server/emailAlerts.ts` (new kinds only), the `/settings/notifications` toggles |
| D2 Cards and snapshot    | `lib/cards/model.ts` (`animal`, `flock`), `lib/cards/build/animal.ts`, `lib/cards/build/flock.ts`, `lib/server/cardSnapshot.ts`, the `snapshotStateKey` tests                                                                             |
| D3 Offline recovery      | `lib/client/syncQueue.ts`, the queue UI in `routes/records/pending/**`, the client HOLD evaluator wrapper `lib/client/animalHold.ts`, fake-indexeddb tests                                                                                |
| D4 Inventory             | `lib/inventory/types.ts`, `components/inventory/**` feed and animal-health detail and form maps, `/inventory` chip visibility, `lib/stock/**` movement reasons                                                                            |
| D5 Toxic advisory        | crop plugin `animalToxicity` values, `apps/web/scripts/crop-data-sources.json` entries, `lib/animals/toxicAdjacency.ts`, callout components                                                                                               |

### Acceptance

- **Unit:**
  - Care-plan materialization is idempotent across two ticks.
  - An `animal-care` task is still due after season close-out.
  - A revoked helper gets no push or email.
  - `snapshotStateKey` changes when a treatment is logged.
  - The cross-tenant snapshot test covers animals.
  - Chip visibility follows stock and animal presence.
- **e2e:**
  - Offline, log eggs as food for a flock on hold. The HOLD shows before submit. After forcing the submit and going online, the replay's 422 offers "Save as discard", and choosing it saves once.
  - `/inventory` at 375 px with all seven chips visible has no overflow.
- **Persona, farm:** a helper in a barn with no signal opens the pinned Flock Card, logs eggs and a feed scoop, and both sync later with no duplicates.
- **Persona, garden household:** the dog's rabies booster shows on /today two weeks ahead. The owner closes it with a vet visit, and the next due date rolls forward a year.

---

## 32E: Growing season helpers

**Goal.** Seed starting, season extension, watering and pest timing, all deterministic, sourced and free.

### Features and MVP scope

**Seed starting (GW-1, GW-2, GW-3).**

- `crops.plantingDate` stays the in-ground date. `sown_indoors_at` and plugin `dtmFrom` make days to maturity count from the right event.
- `lib/schedule/seedStart.ts` backs off from the transplant date to produce Sow indoors, Start hardening off and Transplant tasks. `pluginTemplateKey` is `seedstart:<cropId>:<step>`, so re-planning replaces tasks idempotently.
- Family defaults are tagged `fallback`. About 20 common transplanted crops get sourced overrides, and disputed values are left out.
- The planting form, bed Fill and the designer ask "Seed or seedling?".
- A minimal `seed_starts` table holds one row per tray: cells, seeds per cell and the germinated count. The Planting Card gets a germination stepper, queued offline as `seed-start`.
- Regression tests pin occupancy, the harvest window, pollination staggering and PHI to the in-ground date.

**Season extension (GW-11, GW-12).**

- `block_protections` records per bed, with sourced kind defaults and an owner override. Stacked covers take the largest shift and never add.
- `lib/climate/effectiveFrost.ts` threads per-block frost dates through `scheduleCandidacy`, `plantingWindow`, garden occupancy, `server/garden/fill.ts`, the Fill prompt, `aiPlantingWindow` and the seed-start back-off.
- A heated greenhouse is frost-free.
- Shifts apply to planning windows only. Frost alerts are suppressed for heated greenhouses and relabelled "Check covers on Bed 3" for covered beds.
- A cover chip set appears in the bed inspector and `EditBlockModal`. A `SetupProtection` sheet opens when a planting date comes before the frost window.

**Sowing calendar (GW-4).** `/plan/calendar` shows horizontal bars for indoor sow, transplant and direct sow against the frost lines and the Persephone line (under 10 hours of daylight, from `lib/calendar/solar.ts`). It prints through the `CardView` print CSS. It has no offline Card kind.

**Watering (GW-5, GW-6, GW-7).**

- `lib/weather/waterBalance.ts` produces a verdict of skip, water, ok or unknown.
- Past rain comes from station records and NWS observations, with QC. Missing hours count as unknown.
- The advice always names the station and its distance.
- "Skip watering" is allowed only when the station is within 10 miles and hourly coverage is at least 90%. Otherwise the Card says "Rain unknown here, check your gauge".
- A manual rain-gauge reading overrides the station and is tagged `manual`.
- The default target is 1 inch a week, tagged `fallback` with a cited source, and editable per Area by the owner.
- A /today watering Card appears per garden or field Area that has crops in the ground. A Log watering sheet writes `irrigation_events`, queued offline as `irrigation`. The log never locks and stays out of compliance exports and `RETENTION_RULES`.
- Greenhouses always return unknown.

**Degree days (GW-8, GW-9, GW-10).**

- `lib/climate/degreeDays.ts` supports simple and single-sine methods.
- Season-to-date totals are cached globally by location and day, with `unscopedQueryNote`.
- `plugins/pest-models/` ships two or three models, only those with checked extension consensus. Squash vine borer is first, and one or two of cabbage maggot, Colorado potato beetle and codling moth follow, depending on which sources check out.
- The biofix defaults to the model's date, tagged `fallback`, with a manual trap-catch override per owner and year in `app_settings`. Helpers may enter it.
- Output is a "Watch for" strip on /scout and a /today recommendation Card. The wording is always about scouting or covering, never spraying. None of it touches `lib/safety` or the IPM threshold gate.
- Outside the Dulles normals area, gaps show as incomplete. The code never borrows Virginia numbers.

### Data model

- `seed_starts`: `id`, `owner_id`, `crop_id`, `sown_at`, `tray_label`, `cells`, `seeds_per_cell`, `location_area_id`, `location_text`, `stock_lot_id`, `germinated_count`, `germinated_at`, `harden_started_at`, `transplanted_at`, `performed_by_id`, `client_record_id`.
- `block_protections`: `id`, `owner_id`, `block_id`, `kind`, `spring_shift_days`, `fall_shift_days`, `provenance`, `installed_on`, `removed_on`, `season_year`, `notes`.
- `irrigation_events`: `id`, `owner_id`, `field_id`, `block_id`, `occurred_at`, `duration_min`, `inches`, `gallons`, `method`, `notes`, `performed_by_id`, `client_record_id`.
- `rain_gauge_readings`: `id`, `owner_id`, `field_id`, `read_at`, `inches`.

### Routes and schemas

API:

- `POST /api/seed-starts`, `PATCH /api/seed-starts/[id]`
- `POST /api/blocks/[id]/protections`, `DELETE /api/blocks/[id]/protections/[pid]` (owner only)
- `POST /api/irrigation`, `GET /api/irrigation`, `POST /api/rain-gauge`
- `GET /api/weather/degree-days`

Pages: `/plan/calendar`.

Schemas live in `lib/seedStart/apiSchemas.ts`, `lib/irrigation/apiSchemas.ts` and `lib/farm/apiSchemas.ts`.

- **Card kinds:** none new. The irrigation record card uses `rc_irrigation` through `RECORD_ONLY_CARD_KINDS`.
- **Offline queue kinds:** `seed-start`, `irrigation`.
- **Safety kernel:** none. `RULES_VERSION` is unchanged.
- **AI touchpoints:** no new calls. The existing Fill this bed and `aiPlantingWindow` prompts receive effective frost dates and still degrade through `aiTry()` to their deterministic plans.
- **Authz (GW-13):** helpers log germination, watering, gauge readings and trap catches. Trays, covers and water targets are owner only.
- **Plan tiers:** all free (GW-14).

### Work clusters

| Cluster             | Owns                                                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 Seed starting    | `lib/schedule/seedStart.ts`, `lib/plugins/familyDefaults.ts` (seed-start fields), crop plugin seed-start values, `routes/api/seed-starts/**`, `lib/db/seedStarts.ts`, commit hooks in `components/wizard/allocation/flows/commitFlow.ts` and `/api/garden/plantings`       |
| E2 Season extension | `lib/climate/effectiveFrost.ts`, `lib/climate/frostShift.ts` (`warmerFrostDates`), `lib/climate/protection.ts`, `routes/api/blocks/[id]/protections/**`, `lib/server/push/frost.ts`, `EditBlockModal`, the designer bed inspector cover chips                              |
| E3 Calendar         | `routes/plan/calendar/**`, `lib/calendar/engine.ts` event kinds, `lib/calendar/persephone.ts`, print CSS for the calendar                                                                                                                                                  |
| E4 Watering         | `lib/weather/waterBalance.ts`, `lib/server/waterAdvice.server.ts`, `lib/server/weatherHourly.ts` (precip parsing only), `lib/server/weatherObserved.ts` (precip QC only), `routes/api/irrigation/**`, `routes/api/rain-gauge/**`, the watering card in `lib/today/deck.ts` |
| E5 Degree days      | `lib/climate/degreeDays.ts`, `lib/server/degreeDays.server.ts`, `plugins/pest-models/*`, `lib/ipm/pestModels.ts`, the /scout strip, the degree-day recommendation card                                                                                                     |

E2 changes the signatures of `scheduleCandidacy` and `plantingWindow`. E1 consumes them. E2 publishes the `effectiveFrostDates` signature on the first day, and E1 codes against it.

E4 and E5 both add /today recommendation cards. E4 owns `lib/today/deck.ts`, and E5 registers its card through a small exported hook.

### Acceptance

- **Unit:**
  - Seed-start back-off handles a fall brassica started in July across a year-crossing frost season.
  - Effective frost works in spring and fall, keeps a heated greenhouse frost-free and takes the maximum when covers stack.
  - The water balance covers a distant station, low coverage, a gauge override and a greenhouse.
  - Degree-day properties: accumulation is never negative and is monotonic, and the two methods agree when there is no cutoff.
  - The PHI and occupancy regression suite passes unchanged.
- **e2e:**
  - Choosing "Seed or seedling?" as seedling creates three dated tasks.
  - Adding a low tunnel moves the planting window earlier.
  - The watering Card shows unknown when the only station is 25 miles away.
- **Performance:** /today query count and CPU stay within 20% of the Phase 31 baseline, with the watering and degree-day cards on.
- **Persona, farm:** the grower plans fall brassicas under row cover and sees the window stretch. A frost alert says "Check covers on Bed 3" rather than going silent.
- **Persona, garden household:** after a thunderstorm the gardener enters a gauge reading, sees "Skip watering the Kitchen beds today", and later sees squash vine borer on the Watch for strip.

---

## 32F: Farm operations

**Goal.** Hand out work, capture how long it took, see whether a crop or a flock paid for itself, and get one Monday summary.

### Features and MVP scope

- **Assignees.** `tasks.assignee_user_id`. Only owners assign, from the task card or "+ Task", and the assignee must hold an active `helper_assignments` row for this Owner. The /today deck gains a Mine/Everyone filter, which defaults to Mine for helpers who have assigned tasks. The task card and the printed card show "Assigned to" through `identityLabel()`. Helpers can still close any task.
- **Time on Done (OPS-5, OPS-6).** The Done sheet shows 48 dp duration chips (15 m, 30 m, 1 h, 2 h, other). Minutes ride on the existing task close payload and write a `task_time_entries` row with crop, block and field denormalized from the task. Season hours per crop and per person appear on the Planting Card.
- **Ledger (OPS-2, OPS-3, OPS-4, OPS-9, OPS-10).** An owner-only `/finance` page with expenses and income, links to a crop, Area, animal or group, and a free-text enterprise tag.
  - Per-crop input cost is derived at read time from stock movements times lot unit cost, tagged `data`. A lot without a cost shows "cost unknown", never zero.
  - An optional "record purchase as expense" link on `stock_lot_id` is de-duplicated by the calculator.
  - Labour cost uses the owner's `labour_rate_cents_per_hour` and is labelled an estimate.
  - "Record a sale" after a harvest record writes a linked ledger entry and never touches the harvest record.
  - Entries have no lock and use soft delete with an audit trail.
  - A CSV export is included.
- **Season Profit Card.** `profit` kind (prefix `pf`), owner only, printable. It is kept out of helper snapshots, the helper GDPR export, the year summary for non-owners and every inspector export.
- **Week and month Cards (OPS-11).** Kinds `week` (`wk`) and `month` (`mo`), built from the snapshot, with Letter landscape print layouts and optional Area and assignee filters. Spray tasks show no rates or mix steps and link to the Spray Card.
- **Weekly digest (OPS-7, OPS-8).**
  - Built by a pure `lib/digest/weekly.ts`.
  - It appears as a `digest` Card (`dg`) on /today on Monday, plus opt-in `weekly-digest` push and email.
  - It is sent on the first tick at or after Monday 10:00 UTC, one per (user, farm), inside `withTenant`, deduped through `push_deliveries`.
  - Finance lines are for owners only.
  - Safety alerts are never batched into the digest.
  - The email follows `docs/email-consent.md`: explicit opt-in, a signed unsubscribe link, List-Unsubscribe headers and respect for `contact_suppressions`.
- **i18n infrastructure (Q-I18N-FIRST, split vote, see Decisions).**
  - A hand-rolled typed catalog and `t()` in `lib/i18n/`, with locale resolution in `hooks.server.ts` and `html lang`.
  - The locale is part of the snapshot ETag and the service-worker cache key.
  - A raw-text lint rule for opted-in directories, and a missing-key CI check.
  - Spanish catalogs sit behind a flag and stay off in production until a paid native-speaker agricultural reviewer signs off. Safety text, decon steps, the harvest STOP and every spray flow stay English-only until then.

- **Data model:** `task_time_entries` (`id`, `owner_id`, `task_id`, `user_id`, `crop_id`, `block_id`, `field_id`, `started_at`, `minutes`, `source`, `note`, `client_record_id`). `ledger_entries` (`id`, `owner_id`, `kind`, `occurred_at`, `amount_cents`, `category`, `description`, the link columns, `enterprise`, `quantity`, `unit`, `provenance`, `created_by_id`, timestamps, `deleted_at`). The `weekly-digest` consent category may need migration 0069.
- **Routes:**
  - API: the `assign` action on `PATCH /api/tasks/[id]`, `assigneeUserId` on `POST /api/tasks`, `minutes` on `POST /api/tasks/close`, `/api/finance/entries/**`, `/api/finance/summary`, `/api/finance/export.csv`.
  - Pages: `/finance`, `/cards/week/[key]`, `/cards/month/[key]`.
- **Card kinds:** `profit`, `week`, `month`, `digest`.
- **Offline queue kinds:** no new kinds. `task` gains optional `minutes`.
- **Safety kernel:** none.
- **AI touchpoints:** none. The digest is deterministic, and a receipt scan is deferred.
- **Plan tiers:** all free. Seats already limit how many people can be assigned.

### Work clusters

| Cluster                | Owns                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 Assignees and time  | `routes/api/tasks/**`, `lib/tasks/apiSchemas.ts`, `lib/today/deck.ts` (Mine filter), `lib/cards/build/task.ts`, `lib/db/taskTime.ts`, `lib/labour/hours.ts`, the Done sheet |
| F2 Finance             | `lib/finance/**`, `lib/db/ledger.ts`, `routes/api/finance/**`, `routes/finance/**`, `lib/cards/build/profit.ts`, the harvest "Record a sale" step                           |
| F3 Print Cards         | `lib/cards/build/week.ts`, `lib/cards/build/month.ts`, `lib/cards/print.ts` layouts, print CSS, the print buttons on /today Calendar and `/calendar`                        |
| F4 Digest              | `lib/digest/weekly.ts`, `lib/cards/build/digest.ts`, `lib/server/push/triggers.ts` (`weeklyDigestAlerts` only), `lib/server/email.ts` (new kind), the notification toggle   |
| F5 i18n infrastructure | `lib/i18n/**`, `hooks.server.ts` locale resolution, `packages/eslint-plugin-cropcard` raw-text rule, `scripts/i18n-check`, `/settings/account` language picker              |

`lib/cards/model.ts` gets four new kinds. F3 owns that edit and adds `profit` and `digest` for F2 and F4 on the first day. F1 and F4 both touch `lib/today/deck.ts`. F1 owns it, and F4 registers the digest card through the same hook E5 used.

### Acceptance

- **Unit:**
  - An assignee from another Owner is rejected.
  - `seasonProfit` properties: no double count of a stock-derived cost and a linked purchase expense, unknown cost is never zero, and totals reconcile.
  - Every snapshot, card, export and year-summary builder refuses finance data to a helper or inspector.
  - The digest never goes to an opted-out, suppressed or revoked user.
  - Every `en` key exists in `es` or is on the allowlist.
- **e2e:**
  - An owner assigns a task and the helper sees it under Mine.
  - A helper closes a task with 30 minutes, offline, and it replays once.
  - `/finance` returns 403 for a helper.
  - A printed week Card has no spray rates.
  - The digest opt-in toggle works.
- **Persona, farm:** at close-out the owner sees that the tomatoes paid and the laying flock almost did, including feed and the dewormer. A helper never sees a dollar figure.
- **Persona, garden household:** the gardener prints a month calendar for the fridge and opts into the Monday email. They never meet the ledger unless they open it.

---

## Decisions

A vote of "3-0" means all three judges agreed. "2-1" means the majority ruling was adopted. "Split" means all three judges differed, and the ruling follows the safety lens unless that would block shipping.

| ID                                       | Ruling                                                                                                                                                            | Vote           | Reasoning                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1                                       | Individuals optionally in groups, plus head-count groups. The hold follows an animal across group moves.                                                          | 3-0            | One treated hen in an untagged flock must still block the flock's eggs.                                                                                                                      |
| Q2                                       | Block the food or sale declaration, with no override. Treatments always save, and "save as discard" is offered.                                                   | 3-0            | Truthful records matter, and the harm happens at the table.                                                                                                                                  |
| Q3                                       | Two inventory types, `feed` and `animal-health`, with chips hidden while empty. Invariant 8 wording is updated.                                                   | 3-0            | Their fields differ, and hiding empty chips protects the 375 px layout.                                                                                                                      |
| Q4                                       | Data-only animal-health and species plugins. The kernel owns the floors and the prohibited list. At most ten verified products seed the set.                      | 3-0            | Label numbers are data, and decisions about them belong in TypeScript. Unverified products fall to unknown.                                                                                  |
| Q5                                       | Missing grazing data blocks a food animal's move when the pasture has a recorded application in the lookback window, until the owner attests. Pets get a warning. | Split          | One judge chose warn-and-allow, two chose attest-or-block with different scopes. The narrower and safer version was adopted; one owner attestation clears it, so it does not block shipping. |
| Q6                                       | Hard block when data exists. Exceptions come only from plugin data.                                                                                               | 3-0            | Label intervals are legal requirements.                                                                                                                                                      |
| Q7                                       | Food-animal treatments lock at 48 h. Vet visits and pet records stay editable. The stricter of the two flag states applies.                                       | 3-0            | Editing a locked treatment could silently clear a withdrawal.                                                                                                                                |
| Q8                                       | Species default, changed by the owner only, audited. Horses get "not for slaughter", and a prohibited drug still blocks meat.                                     | 3-0            | Safety keyed on the word "pet" lets treated eggs through.                                                                                                                                    |
| Q9                                       | Same tables, with a profile-driven "Pets & animals" layout.                                                                                                       | 3-0            | One model keeps the kernel, Cards and queue single-sourced.                                                                                                                                  |
| Q10                                      | Exempt from `SEASON_CLOSED`. The year-summary section is deferred.                                                                                                | 3-0            | Animals are year-round.                                                                                                                                                                      |
| Q11                                      | Helpers do chores. Owners set flags, vet withdrawals and attestations.                                                                                            | 3-0            | Mirrors Invariant 5.                                                                                                                                                                         |
| Q12                                      | `animal_care_plans` materialize into `tasks`, deduped by plan and date.                                                                                           | 3-0            | Reuses the deck and offline close without changing crop recurrence.                                                                                                                          |
| Q13                                      | `/animals`, shown as "Pets & animals" for pet and garden profiles.                                                                                                | 3-0            | Neutral across personas.                                                                                                                                                                     |
| Q14                                      | Toxic plants are advisory only, with sourced data.                                                                                                                | 3-0            | Dose and access cannot be known.                                                                                                                                                             |
| GW-1                                     | `plantingDate` stays the in-ground date. Add `sown_indoors_at` and `dtmFrom`.                                                                                     | 3-0            | PHI and occupancy depend on it.                                                                                                                                                              |
| GW-2                                     | A minimal `seed_starts` table per tray.                                                                                                                           | 2-1            | Cheap now, and it gives honest plant counts.                                                                                                                                                 |
| GW-3                                     | Family fallbacks plus sourced overrides for about 20 crops.                                                                                                       | 3-0            | Every value stays sourced.                                                                                                                                                                   |
| GW-4                                     | A printable `/plan/calendar`, with no offline Card kind.                                                                                                          | 3-0            | It is a planning surface.                                                                                                                                                                    |
| GW-5                                     | 1 inch a week default, tagged fallback, owner-editable.                                                                                                           | 3-0            | Simple and honest.                                                                                                                                                                           |
| GW-6                                     | Station rain with QC. "Skip" only within 10 miles at 90% coverage. Manual gauge override in the same sprint.                                                      | 2-1            | Two judges gated on distance (10 and 15 miles); the safer 10 was adopted. Two wanted the gauge now.                                                                                          |
| GW-7                                     | Irrigation is a light record with no lock and stays out of exports.                                                                                               | 3-0            | It is not a compliance record.                                                                                                                                                               |
| GW-8                                     | Pest models are a data-only plugin kind.                                                                                                                          | 3-0            | Invariant 2.                                                                                                                                                                                 |
| GW-9                                     | Two or three models with checked consensus.                                                                                                                       | 2-1            | A wrong threshold is worse than no model.                                                                                                                                                    |
| GW-10                                    | Model default biofix with a manual trap override.                                                                                                                 | 3-0            | Trap-biofix models are wrong from Jan 1.                                                                                                                                                     |
| GW-11                                    | Per-bed covers, taking the largest shift, planning windows only.                                                                                                  | 3-0            | Covers go on bed by bed.                                                                                                                                                                     |
| GW-12                                    | Suppress only for heated greenhouses and relabel the rest.                                                                                                        | 3-0            | Covers blow off.                                                                                                                                                                             |
| GW-13                                    | Helpers log observations. Plan-shaping writes are owner only.                                                                                                     | 3-0            | Matches the bed-write split.                                                                                                                                                                 |
| GW-14                                    | All free. Later AI goes through `aiTry`.                                                                                                                          | 3-0            | Deterministic features are free.                                                                                                                                                             |
| OPS-1                                    | All free.                                                                                                                                                         | 3-0            | Paid plans buy AI and seats.                                                                                                                                                                 |
| OPS-2                                    | Money is owner only, with a test on every surface.                                                                                                                | 3-0            | Wages and margins are sensitive.                                                                                                                                                             |
| OPS-3                                    | Derived per-crop cost, deduped purchase link, unknown shown as unknown.                                                                                           | 3-0            | Accurate, with no double count.                                                                                                                                                              |
| OPS-4                                    | "Record a sale" writes a linked ledger entry after the harvest record.                                                                                            | 3-0            | Harvest records stay immutable.                                                                                                                                                              |
| OPS-5                                    | Duration chips on Done.                                                                                                                                           | 3-0            | Glove-friendly.                                                                                                                                                                              |
| OPS-6                                    | Minutes on the close payload now, a standalone kind later.                                                                                                        | 3-0            | Stays inside existing replay fencing.                                                                                                                                                        |
| OPS-7                                    | First tick at or after Monday 10:00 UTC.                                                                                                                          | 3-0            | No infra change.                                                                                                                                                                             |
| OPS-8                                    | One digest per user and farm.                                                                                                                                     | 3-0            | Simple tenant isolation.                                                                                                                                                                     |
| OPS-9                                    | No lock, with soft delete and audit.                                                                                                                              | 3-0            | Accounting trails the season.                                                                                                                                                                |
| OPS-10                                   | Optional animal and group foreign keys plus an enterprise tag.                                                                                                    | 3-0            | Phase 32 builds the animal model, so a real link beats free text.                                                                                                                            |
| OPS-11                                   | Letter landscape only, with no spray rates.                                                                                                                       | 3-0            | US persona, and no spray instructions on paper.                                                                                                                                              |
| Q-VAULT-STORE                            | Blob in production, disk in dev, streamed through a tenant-checked endpoint.                                                                                      | 3-0            | Keeps files out of Litestream. Built in a later phase.                                                                                                                                       |
| Q-VAULT-CAPS                             | Free 100 MB, Grower 1 GB, Farm 5 GB. Reads are never blocked.                                                                                                     | 2-1            | One judge wanted 250 MB free; the majority kept 100 MB.                                                                                                                                      |
| Q-VAULT-ACCOUNTING                       | `SUM` over the source, with a nightly cached total.                                                                                                               | 3-0            | Storage is a stock. Applied to journal photos in 32A.                                                                                                                                        |
| Q-ORG-SEED-FIELDS                        | `stock_lots` columns plus a JSON list of sources checked.                                                                                                         | 3-0            | Certifiers audit per purchase.                                                                                                                                                               |
| Q-ORG-WARN                               | A non-blocking warning outside `lib/safety`.                                                                                                                      | 3-0            | Assist, never gate.                                                                                                                                                                          |
| Q-ORG-DISP-LOCK                          | Dispositions take the 48 h lock and tombstones.                                                                                                                   | 3-0            | Keeps Invariant 4 uniform.                                                                                                                                                                   |
| Q-SALES-SCOPE                            | Dispositions only.                                                                                                                                                | 3-0            | Stay out of e-commerce.                                                                                                                                                                      |
| Q-I18N-LIB                               | A hand-rolled typed catalog.                                                                                                                                      | 3-0            | No dependency, and strict TS catches missing keys.                                                                                                                                           |
| Q-I18N-SAFETY                            | Reason codes reviewed by a human. Label text verbatim. Spray flows English-only.                                                                                  | 3-0            | A mistranslated safety step is real harm.                                                                                                                                                    |
| Q-I18N-FIRST                             | Infrastructure and gates in 32F. Spanish stays behind a flag until a native-speaker review.                                                                       | Split          | Defer, infrastructure-with-flag and ship-last all differed. The flagged option ships no unreviewed safety copy and fits the sprint cap.                                                      |
| Q-OFFLINE-RECORDS                        | Pinned or recent record cards, LRU per Owner, when built.                                                                                                         | 3-0            | Design agreed; scheduling was 2-1 to defer.                                                                                                                                                  |
| Q-SOIL-INTERP                            | The lab's rating wins. The computed class is tagged fallback. Fix units first.                                                                                    | 3-0            | Wrong units make wrong credits.                                                                                                                                                              |
| Scope: organic pack, dispositions, vault | Deferred to Phase 33.                                                                                                                                             | 2-1 to include | Two judges scheduled them as sprints 7 to 8 of 8- and 11-sprint plans. The six-sprint cap moves them to the front of Phase 33.                                                               |
| Scope: degree days                       | Included, with two or three models.                                                                                                                               | 2-1            | One judge deferred them; two scheduled them.                                                                                                                                                 |

## Deferred

These items are out of Phase 32. Items marked "Phase 33 first" lead the next phase.

- **Organic certification pack, harvest dispositions and organic seed-sourcing fields (Phase 33 first).** The design rulings above stand. Until the pack lands, animal and crop records carry no organic chrome, so a certified farm is never shown a status the app does not track.
- **Document vault (Phase 33 first).** Blob storage with tenant-checked streaming, MIME sniffing, a sandbox CSP and a byte-level cross-tenant test. `soil_tests.document_id` waits for it. Journal photos move into it afterwards.
- **Aminopyralid manure and compost provenance chain (Phase 33).** Phase 32 ships only advisory copy. This remains a real way to kill a garden, so it is scheduled work and stays on the list.
- **Spanish surfaces going live.** This waits on the paid native-speaker agricultural review. Owner planning surfaces, spray flows and other languages come later.
- **Offline record cards** (pinned and recent, LRU per Owner).
- **Year-summary animal section**, an animal treatment log export for inspectors and certifiers, and organic status loss for treated animals (NOP 205.238). Until then, the Animal Card shows a visible "organic status not tracked" note.
- **Medicated feed and VFD** as kernel treatments, rations, days of feed left, bulk-tank hold, and a FARAD link helper.
- **Prussic acid and nitrate forage gate.** It can graduate from the toxic-plant advisory once thresholds are sourced. Distance-based toxic adjacency and hazard-plant map points also wait.
- **Breeding, pedigree, weight charts, CSV import, RFID/EID scanning.** Sales, invoices, customer lists and CSA are cut.
- **Pet-sitter share links and sitter mode.** These need a new auth concept.
- **Pest models beyond the first two or three**, disease models, a pest-window push, and crop degree-day maturity for corn and small grains.
- **Evapotranspiration watering**, soil holding capacity, dry-spell alerts and valve integrations.
- **Tray and cell designer**, printed tray labels, seed stock decrement per tray and pot-up steps.
- **Tunnel vent and close task automation** and plastic-mulch soil warming.
- **Live start/stop timer**, standalone time entries, per-person wage rates and payroll-grade timesheets. The timer is the first follow-up.
- **Per-user digest weekday**, a merged multi-farm digest, a third push job and an SMS digest.
- **Paper sizes:** A4 and 11x17 prints. Also an iCal feed.
- **AI extensions:** AI receipt scan, soil lab OCR, an Organic System Plan generator and certifier templates.
- **Garden designer:** drag a bed preset onto the canvas. Tap to place already works.
- **Real-device iOS and Android testing and printing** (network-tasks Task 7). This should be booked alongside 32D, since barn Cards are the most device-sensitive feature in the phase.
