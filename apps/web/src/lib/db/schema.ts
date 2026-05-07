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
  role: text('role', { enum: ['owner', 'helper'] })
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
  blockLabel: text('block_label')
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
