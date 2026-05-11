/**
 * Drizzle SQLite schema (server-side).
 *
 * Mirrors the conceptual data model in spec §9. Phase 4 grows this; Phase 1
 * just establishes the table layout and lets drizzle-kit generate.
 */

import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  role: text('role', { enum: ['owner', 'helper', 'inspector', 'custom-operator'] })
    .notNull()
    .default('helper'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// ─── Fields → Blocks hierarchy (Phase 13) ───────────────────────────────
//
// A "Field" is a parent grouping for blocks. Larger growers may operate
// multiple fields (e.g., "Home Field" + "North Field"); smaller growers
// have a single auto-created "Home Field" that the UI hides. The migration
// auto-creates one Home Field row and points every existing block at it.
export const fields = sqliteTable('fields', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Optional reported acreage. Polygon-derived acres is informational only. */
  acres: integer('acres'),
  /** Free-form address / lat-lng paste; no geocoding. */
  location: text('location'),
  notes: text('notes'),
  /** Optional field-level outline (GeoJSON Polygon). Block polygons remain
   *  authoritative for the SVG renderer. */
  geometryGeojson: text('geometry_geojson'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const blocks = sqliteTable('blocks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  acres: integer('acres'),
  blockLabel: text('block_label'),
  /** Phase 13: parent field. Nullable in SQL for the migration backfill;
   *  application code treats blocks as always-having a field after migrate. */
  fieldId: text('field_id').references(() => fields.id),
  /** GeoJSON Polygon / MultiPolygon (Phase 10 — GPS mapping stub).
   *  Stored as text; never indexed. /map renders an SVG fallback if no PostGIS. */
  geometryGeojson: text('geometry_geojson'),
  /** Tillage practice for this block — drives pre-planting prep schedule. */
  tillageMethod: text('tillage_method', {
    enum: ['conventional', 'reduced-till', 'no-till']
  })
    .notNull()
    .default('conventional'),
  /** Phase 14 (swim-lane): column ordering. **Increases going east**
   *  (column 0 = westmost). Auto-computed from `geometryGeojson` centroid
   *  longitude rank when blocks are written; nullable for blocks without
   *  geometry. Falls back to alphabetical `name` if both axis indices null. */
  eastWestIndex: integer('east_west_index'),
  /** Phase 14 (swim-lane): increases going north. Auto-computed from
   *  centroid latitude rank. Tie-breaker for column ordering and shade
   *  neighbor matching (a block only shades neighbors within ±1 N-S). */
  northSouthIndex: integer('north_south_index'),
  /** Phase 14 (swim-lane): if true, manual axis indices are not overwritten
   *  by `inferBlockAxes` on subsequent writes. */
  axesLocked: integer('axes_locked', { mode: 'boolean' }).notNull().default(false),
  /** Phase 14 (swim-lane): user-tagged sun exposure. Used for AI suggestions
   *  and as a UI hint; does not feed the shade engine. */
  sunExposure: text('sun_exposure', {
    enum: ['full', 'partial', 'shade']
  }),
  /** v1.3 shade model: slope steepness, percent (0–100). Optional. Used by
   *  shadeModel.ts to elongate / shorten projected shadows along the
   *  downhill axis. Null = treated as flat. */
  slopePercent: real('slope_percent'),
  /** v1.3 shade model: downhill aspect (compass bearing where the slope
   *  faces, 0–360, 0=N, 90=E, etc.). Optional. Required for slopePercent
   *  to take effect; null aspect → slope treated as flat. */
  slopeAspectDeg: real('slope_aspect_deg')
});

/**
 * v1.3 shade model — external shade emitters that aren't crops. Tree rows,
 * buildings, hedges, fences, and other tall stationary features that cast
 * shadows onto blocks. Modelled with the same height + opacity inputs as
 * shade-casting crops, but with a deciduous canopy gate (oaks bare in
 * winter, fully canopied summer through fall).
 */
export const shadeSources = sqliteTable('shade_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Categorization for UI + reasonable defaults at form submit. */
  kind: text('kind', {
    enum: ['tree-row', 'tree-grove', 'tree-single', 'hedge', 'building', 'fence', 'structure', 'other']
  })
    .notNull()
    .default('tree-row'),
  /** GeoJSON Polygon, MultiPolygon, LineString, or Point. The shade model
   *  uses the centroid for direction calculations and the polygon edges
   *  for footprint. */
  geometryGeojson: text('geometry_geojson'),
  /** Optional scoping to a field; null = farm-wide. Future: shade-source
   *  filtering by field on the schedule view. */
  fieldId: text('field_id').references(() => fields.id),
  /** Mature height in feet. Required for shadow projection. */
  heightFt: real('height_ft').notNull(),
  /** Opacity factor 0..1. 1 = solid (building / dense conifer hedge),
   *  0.6 = leafed deciduous, 0.2 = bare deciduous, 0.0 = transparent. */
  opacity: real('opacity').notNull().default(0.7),
  /** When true, opacity is gated by leaf-on / leaf-off windows. */
  isDeciduous: integer('is_deciduous', { mode: 'boolean' }).notNull().default(false),
  /** Day-of-year leaves emerge (1-366). Defaults to 105 ≈ Apr 15 in N VA. */
  leafOnDayOfYear: integer('leaf_on_day_of_year').notNull().default(105),
  /** Day-of-year leaves drop (1-366). Defaults to 305 ≈ Nov 1 in N VA. */
  leafOffDayOfYear: integer('leaf_off_day_of_year').notNull().default(305),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// Phase 12: planting_records → crops. A "Crop" is an active instance of a
// planting on a specific block — analogous to a Brewfather Batch. Lifecycle
// status drives the dashboard (active vs harvested vs archived), and every
// event table now FK's `crop_id` so per-crop timelines are first-class.
export const crops = sqliteTable('crops', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  cropPluginId: text('crop_plugin_id').notNull(),
  varietyDisplayName: text('variety_display_name').notNull(),
  plantingDate: integer('planting_date', { mode: 'timestamp_ms' }),
  status: text('status', {
    enum: ['planned', 'active', 'harvested', 'failed', 'archived']
  })
    .notNull()
    .default('active'),
  harvestedAt: integer('harvested_at', { mode: 'timestamp_ms' }),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  quantityPlantedHundredths: integer('quantity_planted_hundredths'),
  quantityUnit: text('quantity_unit'),
  // Phase 15 — planting groups (e.g., Three Sisters trios, succession runs).
  // Members of one group share `groupId`; the anchor crop drives offset math.
  groupId: text('group_id'),
  groupRole: text('group_role', { enum: ['anchor', 'companion'] }),
  /** Days from anchor's plantingDate. Null on anchor; required on companion. */
  groupOffsetDays: integer('group_offset_days'),
  /** Origin of the grouping for UI labeling + future system-specific behavior. */
  groupSystemKind: text('group_system_kind', {
    enum: ['three-sisters', 'succession', 'manual']
  })
});

/** @deprecated Renamed to `crops`. Re-exported here so a couple of legacy
 *  callers compile during the in-flight rename; remove once all imports
 *  switch to `crops`. The underlying table is `crops` either way. */
export const plantingRecords = crops;

// ─── Crop ↔ Equipment binding (Phase 13 / Phase 12E) ────────────────────
//
// Per-crop assignment of equipment (a sprayer to a corn crop, a baler to a
// hay crop). Drives the Equipment tab on /plan and lets calendar-event
// promotion auto-suggest the right equipment for a primary task.
//
// Composite uniqueness on (crop_id, equipment_id, role) so the same sprayer
// can serve two roles only if you actually use it that way.
export const cropEquipment = sqliteTable('crop_equipment', {
  id: text('id').primaryKey(),
  cropId: text('crop_id')
    .notNull()
    .references(() => crops.id),
  equipmentId: text('equipment_id')
    .notNull()
    .references(() => equipment.id),
  role: text('role', {
    enum: [
      'planter',
      'sprayer',
      'baler',
      'mower',
      'tedder',
      'rake',
      'irrigation',
      'tractor',
      'other'
    ]
  }).notNull(),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

export const sprayers = sqliteTable('sprayers', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  calibratedGpa: integer('calibrated_gpa'),
  calibrationDate: integer('calibration_date', { mode: 'timestamp_ms' }),
  lastChemistryClass: text('last_chemistry_class'),
  lastSprayedAt: integer('last_sprayed_at', { mode: 'timestamp_ms' }),
  lastDeconAt: integer('last_decon_at', { mode: 'timestamp_ms' })
});

// F-M / UC-10: when a helper completes the 1/128-acre wizard they cannot
// directly write to a sprayer's calibrated_gpa (owner-only per FR-12). They
// stage the result here for owner review. Owner approval calls
// recordCalibration() on the equipment row and deletes the pending entry.
// FK targets `equipment` (Phase 8a unified table); legacy `sprayers` is
// vestigial and never populated.

export const sprayEvents = sqliteTable('spray_events', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  /** Phase 12: per-crop attribution. Nullable for back-compat with old
   *  rows that pre-date the rename; the migration backfill resolves most. */
  cropId: text('crop_id').references(() => crops.id),
  sprayerId: text('sprayer_id')
    .notNull()
    .references(() => sprayers.id),
  performedById: text('performed_by_id')
    .notNull()
    .references(() => users.id),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  productsJson: text('products_json').notNull(),
  conditionsJson: text('conditions_json').notNull(),
  rulesVersion: text('rules_version').notNull(),
  pluginHashesJson: text('plugin_hashes_json').notNull(),
  customRateOverride: integer('custom_rate_override', { mode: 'boolean' }).notNull().default(false),
  lockedAt: integer('locked_at', { mode: 'timestamp_ms' })
});

export const harvestEvents = sqliteTable('harvest_events', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  cropId: text('crop_id').references(() => crops.id),
  cropPluginId: text('crop_plugin_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  quantity: text('quantity'),
  lotNumber: text('lot_number')
});

// ─── Equipment Management (Phase 8a) ─────────────────────────────────────
//
// Generic field equipment: planters, drills, rakes, balers, sprayers,
// tractors, mowers, irrigation. Replaces the legacy `sprayers` table for
// new code (sprayers stays as vestigial back-compat). Sprayer-typed
// equipment carries the chemistry-history + decon + GPA-calibration state
// the safety kernel reads on every spray.

export const equipment = sqliteTable('equipment', {
  id: text('id').primaryKey(),
  type: text('type', {
    enum: [
      'sprayer',
      'planter',
      'drill',
      'rake',
      'baler',
      'tractor',
      'mower',
      'irrigation',
      'other'
    ]
  }).notNull(),
  /** Optional FK into taxonomyTerms. When set, replaces `type` for display. */
  typeId: text('type_id'),
  label: text('label').notNull(),
  /** Free-form spec (capacity, working width, hp, nozzle count, etc.). */
  specJson: text('spec_json'),
  notes: text('notes'),
  retiredAt: integer('retired_at', { mode: 'timestamp_ms' })
});

export const equipmentState = sqliteTable('equipment_state', {
  equipmentId: text('equipment_id')
    .primaryKey()
    .references(() => equipment.id),
  hourMeter: integer('hour_meter'),
  /** Sprayer-only: last chemistry class loaded; drives the decon gate. */
  lastChemistryClass: text('last_chemistry_class'),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  lastDeconAt: integer('last_decon_at', { mode: 'timestamp_ms' }),
  calibratedGpa: integer('calibrated_gpa'),
  calibrationDate: integer('calibration_date', { mode: 'timestamp_ms' })
});

export const equipmentLog = sqliteTable('equipment_log', {
  id: text('id').primaryKey(),
  equipmentId: text('equipment_id')
    .notNull()
    .references(() => equipment.id),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  kind: text('kind', {
    enum: ['use', 'maintenance', 'calibration', 'decon', 'inspection', 'note']
  }).notNull(),
  performedById: text('performed_by_id').references(() => users.id),
  notes: text('notes'),
  payloadJson: text('payload_json')
});

// F-M / UC-10: helpers complete the 1/128-acre wizard but cannot write a
// sprayer's calibrated_gpa directly (owner-only per FR-12). They stage the
// result here. Owner approval calls recordCalibration() on the equipment row
// and deletes the pending entry.
export const pendingCalibrations = sqliteTable('pending_calibrations', {
  id: text('id').primaryKey(),
  equipmentId: text('equipment_id')
    .notNull()
    .references(() => equipment.id),
  submittedById: text('submitted_by_id')
    .notNull()
    .references(() => users.id),
  submittedAt: integer('submitted_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  calibratedGpa: integer('calibrated_gpa').notNull(),
  spreadInches: integer('spread_inches'),
  ouncesCollected: integer('ounces_collected'),
  notes: text('notes')
});

// ─── Stock Management (Phase 8b) ─────────────────────────────────────────
//
// Inventory tracking for herbicides, insecticides, fungicides, fertilizer,
// seed, adjuvants, fuel, and parts. Each SKU (stock_item) has zero or more
// lots; each lot accumulates signed movements. On-hand = received_quantity
// + sum of movements per lot. Spray events auto-decrement via FIFO oldest
// non-expired lot. Quantities stored as integer hundredths of the default
// unit so we don't lose precision (1.50 fl-oz → 150 stored).

export const stockItems = sqliteTable('stock_items', {
  id: text('id').primaryKey(),
  /** Optional link to a herbicide/insecticide plugin. Drives auto-decrement. */
  pluginId: text('plugin_id'),
  category: text('category', {
    enum: [
      'herbicide',
      'insecticide',
      'fungicide',
      'fertilizer',
      'seed',
      'adjuvant',
      'fuel',
      'part'
    ]
  }).notNull(),
  displayName: text('display_name').notNull(),
  /** Canonical unit for on-hand display + reorder threshold. */
  defaultUnit: text('default_unit').notNull(),
  /** Reorder threshold in default-unit hundredths. */
  reorderThresholdHundredths: integer('reorder_threshold_hundredths'),
  notes: text('notes'),
  /** UPC/EAN/QR value captured at receiving scan. Enables re-scan → direct nav. */
  barcode: text('barcode'),
  /** Optional FK into taxonomyTerms. Drives sub-categorization in /stock. */
  typeId: text('type_id'),
  /** Category-specific structured data from label scan (JSON).
   *  For seeds: { daysToMaturity, plantingTempMinF, plantingTempMaxF,
   *              spacingInches, depthInches, sunRequirement, seedsPerPacket,
   *              guessed: string[] } */
  metadataJson: text('metadata_json'),
  /** Phase 15d — Haiku-generated short label (≤40 chars). Surfaced on the
   *  schedule swim-lane and wizard cards so long marketing names like
   *  "Pumpkin Cinderella Film Coated Treated" become "Cinderella Pumpkin".
   *  Null until the operator clicks ✨ Generate short names on /stock; falls
   *  back to displayName everywhere it's read. */
  shortName: text('short_name'),
  /** Phase 17 (Track 2) — AI-extracted active ingredients from label scan.
   *  JSON shape: Array<{ name: string; concentrationPct?: number;
   *  chemistryClass?: ChemistryClass; iracGroup?: string; fracCode?: string }>
   *  Populated when the vision API returns ingredient data and the user
   *  confirms in the inventory-add UI. Drives the data-augmented safety
   *  hook (`userAddedRestrictions`) for user-added stock items that don't
   *  match an existing herbicide/insecticide/fungicide plugin pluginId. */
  activeIngredientsJson: text('active_ingredients_json'),
  /** Phase 17 (Track 2) — AI-extracted formulation data from label scan.
   *  JSON shape: { type?: 'granular'|'liquid'|'WP'|'EC'|'soluble'|'compost'|...;
   *  npk?: { n: number; p: number; k: number };
   *  productClass?: 'synthetic'|'organic'|'biocontrol' } */
  formulationJson: text('formulation_json')
});

export const stockLots = sqliteTable('stock_lots', {
  id: text('id').primaryKey(),
  stockItemId: text('stock_item_id')
    .notNull()
    .references(() => stockItems.id),
  lotNumber: text('lot_number'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
  /** Initial quantity in default-unit hundredths. */
  receivedQuantityHundredths: integer('received_quantity_hundredths').notNull(),
  receivedCostCents: integer('received_cost_cents'),
  supplier: text('supplier'),
  notes: text('notes')
});

// ─── Fertility / Soil Tests (Phase 10) ───────────────────────────────────
//
// Per-block N/P/K budget. soil_tests holds lab results; fertility_applications
// records anything applied (synthetic, manure, compost, fertigation);
// fertility_credits stores cover-crop / legume credits the agronomist
// computed (e.g., +40 lb-N/ac from a clover mulch). Per-block remaining
// budget = sum of credits + applied − crop demand. Quantities stored in
// hundredths of pounds-per-acre to match stock-management precision.

export const soilTests = sqliteTable('soil_tests', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  sampledAt: integer('sampled_at', { mode: 'timestamp_ms' }).notNull(),
  lab: text('lab'),
  reportPdfUrl: text('report_pdf_url'),
  ph: integer('ph_hundredths'),
  /** Cation Exchange Capacity (meq/100g × 100). */
  cecHundredths: integer('cec_hundredths'),
  organicMatterPctHundredths: integer('organic_matter_pct_hundredths'),
  nitratePpm: integer('nitrate_ppm'),
  phosphorusPpm: integer('phosphorus_ppm'),
  potassiumPpm: integer('potassium_ppm'),
  notes: text('notes')
});

export const fertilityApplications = sqliteTable('fertility_applications', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  cropId: text('crop_id').references(() => crops.id),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  /** Free-form source label: '10-10-10', 'composted chicken manure', 'urea 46-0-0'. */
  source: text('source').notNull(),
  /** Optional FK to a stock_item for fertilizer auto-decrement. */
  stockItemId: text('stock_item_id').references(() => stockItems.id),
  /** Quantity applied per acre, in hundredths of the unit. */
  ratePerAcreHundredths: integer('rate_per_acre_hundredths').notNull(),
  rateUnit: text('rate_unit').notNull(),
  /** Pounds N / P2O5 / K2O delivered per acre (hundredths). Computed at write
   *  time from source + rate so per-block budget queries are simple sums. */
  nDeliveredHundredths: integer('n_delivered_hundredths').notNull().default(0),
  pDeliveredHundredths: integer('p_delivered_hundredths').notNull().default(0),
  kDeliveredHundredths: integer('k_delivered_hundredths').notNull().default(0),
  performedById: text('performed_by_id').references(() => users.id),
  notes: text('notes')
});

export const fertilityCredits = sqliteTable('fertility_credits', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  /** Credit window the rotation expert assigned this credit to. */
  appliesToYear: integer('applies_to_year').notNull(),
  /** 'cover-crop:clover', 'cover-crop:hairy-vetch', 'manure-residual', 'compost-residual'. */
  source: text('source').notNull(),
  /** Plugin-anchored credit: which cover-crop or legume plugin produced it. */
  cropPluginId: text('crop_plugin_id'),
  /** Pounds N credit per acre (hundredths). */
  nLbPerAcreHundredths: integer('n_lb_per_acre_hundredths').notNull().default(0),
  /** P2O5 lb/ac (hundredths). */
  pLbPerAcreHundredths: integer('p_lb_per_acre_hundredths').notNull().default(0),
  /** K2O lb/ac (hundredths). */
  kLbPerAcreHundredths: integer('k_lb_per_acre_hundredths').notNull().default(0),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// ─── Insecticide Events (Phase 10) ───────────────────────────────────────
//
// Mirror of spray_events but for the insecticide flow (UC-05 scout + spray).
// Kept separate from spray_events so herbicide cross-contam queries stay
// fast and so insecticide-specific fields (target pest, REI, PHI) live
// natively. Re-uses the safety kernel for env gates + sprayer decon.

export const insecticideEvents = sqliteTable('insecticide_events', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  cropId: text('crop_id').references(() => crops.id),
  sprayerId: text('sprayer_id').references(() => equipment.id),
  performedById: text('performed_by_id')
    .notNull()
    .references(() => users.id),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  productsJson: text('products_json').notNull(),
  /** Triggering scout observation — pest counts / threshold reading. */
  scoutObservationJson: text('scout_observation_json'),
  conditionsJson: text('conditions_json').notNull(),
  reEntryClearAt: integer('re_entry_clear_at', { mode: 'timestamp_ms' }),
  preHarvestClearAt: integer('pre_harvest_clear_at', { mode: 'timestamp_ms' }),
  rulesVersion: text('rules_version').notNull(),
  pluginHashesJson: text('plugin_hashes_json').notNull(),
  lockedAt: integer('locked_at', { mode: 'timestamp_ms' })
});

export const stockMovements = sqliteTable('stock_movements', {
  id: text('id').primaryKey(),
  stockLotId: text('stock_lot_id')
    .notNull()
    .references(() => stockLots.id),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  /** Signed delta in default-unit hundredths. +receipts, -consumption. */
  deltaHundredths: integer('delta_hundredths').notNull(),
  reason: text('reason', {
    enum: [
      'receipt',
      'spray-event',
      'insecticide-event',
      'fertility-application',
      'planting',
      'adjustment',
      'spill',
      'expiry'
    ]
  }).notNull(),
  sprayEventId: text('spray_event_id').references(() => sprayEvents.id),
  insecticideEventId: text('insecticide_event_id').references(() => insecticideEvents.id),
  fertilityApplicationId: text('fertility_application_id').references(
    () => fertilityApplications.id
  ),
  /** Phase 13: per-crop attribution for fast "what did this crop consume?"
   *  rollups. Backfilled from the source event row at migration time. */
  cropId: text('crop_id').references(() => crops.id),
  performedById: text('performed_by_id').references(() => users.id),
  notes: text('notes')
});

// ─── Hay / Forage cuttings (Sprint E — FR-19, FR-21, FR-23) ─────────────
//
// One row per cutting per block per year. Tracks the multi-step workflow
// (mow → ted → rake → bale → store) declared by the crop plugin's
// `hayOperations.steps`. The bale step records moisture + bale-type so the
// kernel can enforce the plugin's `baleMoistureGate` thresholds (FR-21);
// >22% baled hay is the canonical fire-risk gate.

export const hayCuttings = sqliteTable('hay_cuttings', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  cropId: text('crop_id').references(() => crops.id),
  cropPluginId: text('crop_plugin_id').notNull(),
  /** Sequential within (block, year). Operator assigns; defaults to next. */
  cuttingNumber: integer('cutting_number').notNull(),
  year: integer('year').notNull(),
  status: text('status', {
    enum: ['mowing', 'tedding', 'raking', 'baling', 'storing', 'complete', 'aborted']
  })
    .notNull()
    .default('mowing'),
  mowAt: integer('mow_at', { mode: 'timestamp_ms' }),
  tedAt: integer('ted_at', { mode: 'timestamp_ms' }),
  rakeAt: integer('rake_at', { mode: 'timestamp_ms' }),
  baleAt: integer('bale_at', { mode: 'timestamp_ms' }),
  storedAt: integer('stored_at', { mode: 'timestamp_ms' }),
  baleType: text('bale_type', { enum: ['small-square', 'large-round', 'large-square'] }),
  balesQuantity: integer('bales_quantity'),
  /** Moisture % × 100 (so 17.5% → 1750). Enforced against plugin's
   *  baleMoistureGate at the bale step. */
  baleMoistureHundredths: integer('bale_moisture_hundredths'),
  /** Canonical 3-day forecast captured at mow decision; immutable. */
  weatherForecastJson: text('weather_forecast_json'),
  performedById: text('performed_by_id').references(() => users.id),
  rulesVersion: text('rules_version').notNull(),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// ─── Taxonomy terms (user-managed Type lists) ────────────────────────────
//
// Domain-scoped taxonomy: e.g., domain='inventory:seed' name='Pumpkin' for
// inventory seed sub-categorization, domain='equipment' name='Tractor' for
// equipment categorization. Pre-seeded with system defaults; users add
// custom terms via the /settings UI or inline when adding inventory items.
export const taxonomyTerms = sqliteTable('taxonomy_terms', {
  id: text('id').primaryKey(),
  /** 'inventory:<category>' or 'equipment'. */
  domain: text('domain').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  /** True for system-seeded defaults. User-added terms are false. */
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// ─── App settings (owner-managed key-value store) ────────────────────────
//
// Stores operator-configured values like API keys that cannot live in env
// vars in a deployed container. Owner-only reads and writes via /api/settings.
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// Per-location NOAA NWS forecast cache. Reduces API calls; `expiresAt`
// drives re-fetch (1 hr default per the NWS rate-limit guidance).
export const weatherForecastCache = sqliteTable('weather_forecast_cache', {
  id: text('id').primaryKey(),
  /** Lat/lon rounded to 4 decimals (≈11 m precision) — keys the cache. */
  cacheKey: text('cache_key').notNull().unique(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  /** Raw NWS payload (the day-summary array). */
  payloadJson: text('payload_json').notNull()
});

// ─── Tasks (Phase 12 — /today as front door) ─────────────────────────────
//
// Forward-looking work items. A "primary" task is the operation itself
// (spray, mow, harvest); pre-tasks and post-tasks wrap it (mower-check
// before mow, decon after restricted-use spray). Tasks materialize:
//   - manually by the operator ("schedule a spray for Thursday")
//   - by promoting a calendar-engine event ("[+ Schedule]" on a derived
//     spray-window suggestion)
//   - automatically as pre/post-tasks attached to a primary, sourced from
//     plugin templates (cropPlugin.preTasks, equipment.preTasks)
//
// Closure: when a primary task's referenced event lands (e.g. a spray
// is recorded), the matching event endpoint stamps `completed_at` here.
//
// Self-FK: pre/post-tasks point at their primary via linkedToTaskId. We
// declare it as a plain `text` column without a Drizzle FK constraint at
// the type level (the migration adds the FK in SQL); this avoids a TS
// circular-reference error from referencing tasks within its own table
// definition. Application code enforces the relationship.
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body'),
  kind: text('kind', { enum: ['primary', 'pre-task', 'post-task'] }).notNull(),
  /** For pre/post-tasks, the primary they wrap. */
  linkedToTaskId: text('linked_to_task_id'),
  /** Most tasks belong to a crop; block-level / equipment-level tasks
   *  (e.g. winter equipment check) leave cropId null. */
  cropId: text('crop_id').references(() => crops.id),
  blockId: text('block_id').references(() => blocks.id),
  equipmentId: text('equipment_id').references(() => equipment.id),
  scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  abortedAt: integer('aborted_at', { mode: 'timestamp_ms' }),
  abortReason: text('abort_reason'),
  /** When closure happens via an event row, point at it loosely (table + id
   *  rather than a polymorphic FK). */
  relatedEventTable: text('related_event_table', {
    enum: [
      'spray_event',
      'harvest_event',
      'insecticide_event',
      'hay_cutting',
      'fertility_application'
    ]
  }),
  relatedEventId: text('related_event_id'),
  /** Stable key when this task was materialized from a plugin template;
   *  lets `materializePluginPrePost` skip duplicates. */
  pluginTemplateKey: text('plugin_template_key'),
  recurrenceJson: text('recurrence_json'),
  /** Phase 14 (hybrid drift): true if the user manually rescheduled this
   *  task. When the source planting date moves, overridden tasks stay put
   *  and get `staleAnchor=true` instead of being re-anchored. */
  userOverridden: integer('user_overridden', { mode: 'boolean' }).notNull().default(false),
  /** Phase 14 (hybrid drift): set when source `plantingDate` shifts after a
   *  task is overridden — drives a yellow chip in the UI ("Source date
   *  moved; click to re-anchor or keep"). */
  staleAnchor: integer('stale_anchor', { mode: 'boolean' }).notNull().default(false),
  /** Phase 14 (hybrid drift): set on the *old* task row when a crop swap
   *  re-derives its template tasks. The new task points to it; UI hides
   *  superseded rows by default. */
  supersededByTaskId: text('superseded_by_task_id'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// ─── AI call log (Phase 14 — Plan-Schedule cost transparency) ────────────
//
// Every call to /api/plan/{suggest,succession,optimize} writes one row,
// regardless of outcome. Powers per-day quotas + monthly USD cap and gives
// the owner an audit trail of actual spend.
export const aiCallLog = sqliteTable('ai_call_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  endpoint: text('endpoint', {
    enum: ['suggest', 'succession', 'optimize', 'rationale', 'allocate', 'groups', 'shortNames']
  }).notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  /** Estimated USD spend for this call, computed at call time from the
   *  current pricing in `aiPlanning.ts`. Stored alongside tokens so a
   *  later pricing change doesn't invalidate the audit. */
  usdEstimate: real('usd_estimate').notNull().default(0),
  success: integer('success', { mode: 'boolean' }).notNull().default(true),
  /** Optional error class when `success=false` (e.g. 'rate-limit',
   *  'cap-exceeded', 'upstream-5xx', 'invalid-json'). */
  errorClass: text('error_class'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});
