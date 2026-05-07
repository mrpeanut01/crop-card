/**
 * Drizzle SQLite schema (server-side).
 *
 * Mirrors the conceptual data model in spec §9. Phase 4 grows this; Phase 1
 * just establishes the table layout and lets drizzle-kit generate.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export const blocks = sqliteTable('blocks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  acres: integer('acres'),
  blockLabel: text('block_label'),
  /** GeoJSON Polygon / MultiPolygon (Phase 10 — GPS mapping stub).
   *  Stored as text; never indexed. /map renders an SVG fallback if no PostGIS. */
  geometryGeojson: text('geometry_geojson')
});

export const plantingRecords = sqliteTable('planting_records', {
  id: text('id').primaryKey(),
  blockId: text('block_id')
    .notNull()
    .references(() => blocks.id),
  cropPluginId: text('crop_plugin_id').notNull(),
  varietyDisplayName: text('variety_display_name').notNull(),
  plantingDate: integer('planting_date', { mode: 'timestamp_ms' }).notNull()
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
  notes: text('notes')
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
