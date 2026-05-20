/**
 * Drizzle SQLite schema (server-side).
 *
 * Phase 18a (multi-tenant): every tenant-scoped operational table now carries
 * an `ownerId` text column. The column is nullable in this migration set so
 * the backfill (0022) can promote the legacy single-farm data into a "Home
 * Farm" Owner before NOT NULL is enforced in 0023. Application code reads
 * `requireOwnerId()` and writes go through `$lib/db/tenant.ts` helpers so a
 * forgotten WHERE clause cannot leak cross-tenant.
 *
 * The `TenantScoped` brand is applied via the local `tenantScoped()` cast
 * helper at the bottom of each branded table's definition. The cast itself
 * is a no-op at runtime; its only purpose is to make `scopedSelect(globalT)`
 * a type error.
 *
 * Mirrors the conceptual data model in spec §9 plus the multi-tenant
 * additions documented in /Users/nrene/.claude/plans/the-application-is-set-eventual-hanrahan.md.
 */

import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { TenantScoped } from './tenant';

/** Marks a table as tenant-scoped at the type level. Pure type cast; emits
 *  no runtime code. Pair with an `ownerId` column on the table definition. */
function tenantScoped<T>(table: T): T & TenantScoped {
  return table as T & TenantScoped;
}

// ─── Users (global identity) ─────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  /** Legacy single-farm role. Multi-tenant promotes `helper_assignments.role_within_owner`
   *  to the source of truth; this column survives one release for rollback safety
   *  and is dropped in a follow-up migration. */
  role: text('role', { enum: ['owner', 'helper', 'inspector', 'custom-operator'] })
    .notNull()
    .default('helper'),
  /** Cross-tenant support / abuse role. Boolean (not part of the role enum)
   *  because roles describe in-tenant permissions; superadmin is *across*
   *  tenants. Default false. */
  isSuperadmin: integer('is_superadmin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// ─── Multi-tenant core (Phase 18a) ──────────────────────────────────────

/** One row per farm / tenant. Created on self-serve signup (`/onboarding`)
 *  or by superadmin. `slug` is a URL-safe short id surfaced in the Owner
 *  picker; `billingStatus` gates request handling in `hooks.server.ts`
 *  (a 'suspended' tenant gets a 402-equivalent response). */
export const owners = sqliteTable('owners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  billingStatus: text('billing_status', {
    enum: ['trial', 'active', 'past_due', 'canceled', 'suspended']
  })
    .notNull()
    .default('trial'),
  /** Bumped on every plugin_overrides write so the per-owner plugin registry
   *  LRU can key on (ownerId, revision) for cache invalidation. */
  pluginOverridesRevision: integer('plugin_overrides_revision').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

/** N-to-N between users and owners. A helper may belong to multiple owners
 *  (contract scout, custom-operator serving several farms). The active
 *  assignment lives in the session cookie's `activeOwnerId`. */
export const helperAssignments = sqliteTable(
  'helper_assignments',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** Per-tenant role. Replaces `users.role` once the legacy column drops. */
    roleWithinOwner: text('role_within_owner', {
      enum: ['owner', 'helper', 'inspector', 'custom-operator']
    }).notNull(),
    invitedByUserId: text('invited_by_user_id').references(() => users.id),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    /** 'active', 'revoked', or 'pending'. Owners can revoke assignments;
     *  revoked rows survive for audit. */
    status: text('status', { enum: ['active', 'pending', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.ownerId, table.userId] }),
    userIdx: index('helper_assignments_user_idx').on(table.userId)
  })
);

/** Pending invitations. Owners create rows here via /settings/helpers; the
 *  helper redeems by visiting /invite/<token>. Token + email are hashed so
 *  a DB compromise doesn't leak active invite URLs. */
export const helperInvites = sqliteTable(
  'helper_invites',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    /** sha256(lowercased email). Lookup by email match during sign-in. */
    emailHash: text('email_hash').notNull(),
    /** sha256(plaintext token). Lookup by token from the invite URL. */
    tokenHash: text('token_hash').notNull(),
    roleWithinOwner: text('role_within_owner', {
      enum: ['helper', 'inspector', 'custom-operator']
    })
      .notNull()
      .default('helper'),
    invitedByUserId: text('invited_by_user_id').references(() => users.id),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    status: text('status', { enum: ['pending', 'accepted', 'revoked', 'expired'] })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    ownerIdx: index('helper_invites_owner_idx').on(table.ownerId),
    tokenIdx: index('helper_invites_token_idx').on(table.tokenHash),
    emailIdx: index('helper_invites_email_idx').on(table.emailHash)
  })
);

/** Per-Owner plugin overlays. The base plugin catalog lives on the
 *  filesystem under /plugins/; this table layers per-Owner customizations
 *  (full replacement per pluginId). Safety kernel never reads overrides. */
export const pluginOverrides = tenantScoped(
  sqliteTable(
    'plugin_overrides',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      pluginId: text('plugin_id').notNull(),
      kind: text('kind', {
        enum: ['crop', 'herbicide', 'insecticide', 'fungicide', 'fertilizer', 'companion']
      }).notNull(),
      payloadJson: text('payload_json').notNull(),
      /** sha256 of payloadJson, captured on insert for audit trail / cache key. */
      hash: text('hash').notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerPluginIdx: index('plugin_overrides_owner_plugin_idx').on(
        table.ownerId,
        table.pluginId
      )
    })
  )
);

/** Subscription state per Owner. Stripe IDs are nullable now — billing
 *  hookup is a code-only change later (no migration). */
export const ownerSubscriptions = sqliteTable('owner_subscriptions', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => owners.id),
  planCode: text('plan_code').notNull().default('free'),
  status: text('status', {
    enum: ['trial', 'active', 'past_due', 'canceled', 'suspended']
  })
    .notNull()
    .default('trial'),
  periodStart: integer('period_start', { mode: 'timestamp_ms' }),
  periodEnd: integer('period_end', { mode: 'timestamp_ms' }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

/** Per-Owner per-month usage counters. AI-call writes (and any future
 *  storage / spray-event counters) UPSERT here so a metered billing path
 *  has data on day one. */
export const ownerUsageCounters = sqliteTable(
  'owner_usage_counters',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    /** YYYYMM, e.g. 202605. Integer for fast range queries. */
    periodYyyymm: integer('period_yyyymm').notNull(),
    aiCalls: integer('ai_calls').notNull().default(0),
    storageBytes: integer('storage_bytes').notNull().default(0),
    sprayEventsCount: integer('spray_events_count').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.ownerId, table.periodYyyymm] })
  })
);

/** Append-only audit log for any superadmin mutation. Read-by-default is
 *  enforced in `hooks.server.ts`; impersonation writes a row here per
 *  mutation. Survives Owner deletes for compliance. */
export const superadminAudit = sqliteTable('superadmin_audit', {
  id: text('id').primaryKey(),
  superadminUserId: text('superadmin_user_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  // INTENTIONALLY NULLABLE: some superadmin actions are cross-tenant
  // (e.g. grant_superadmin, exit_impersonation) and don't bind to a
  // specific Owner.
  ownerId: text('owner_id'),
  targetTable: text('target_table'),
  targetId: text('target_id'),
  payloadJson: text('payload_json'),
  at: integer('at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

// ─── Fields → Blocks hierarchy (Phase 13, tenant-scoped in Phase 18a) ──

export const fields = tenantScoped(
  sqliteTable(
    'fields',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
    },
    (table) => ({
      ownerIdx: index('fields_owner_idx').on(table.ownerId, table.createdAt)
    })
  )
);

export const blocks = tenantScoped(
  sqliteTable(
    'blocks',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      name: text('name').notNull(),
      acres: integer('acres'),
      blockLabel: text('block_label'),
      /** Phase 13: parent field. Nullable in SQL for the migration backfill;
       *  application code treats blocks as always-having a field after migrate. */
      fieldId: text('field_id').references(() => fields.id),
      /** GeoJSON Polygon / MultiPolygon (Phase 10 — GPS mapping stub). */
      geometryGeojson: text('geometry_geojson'),
      tillageMethod: text('tillage_method', {
        enum: ['conventional', 'reduced-till', 'no-till']
      })
        .notNull()
        .default('conventional'),
      eastWestIndex: integer('east_west_index'),
      northSouthIndex: integer('north_south_index'),
      axesLocked: integer('axes_locked', { mode: 'boolean' }).notNull().default(false),
      sunExposure: text('sun_exposure', { enum: ['full', 'partial', 'shade'] }),
      slopePercent: real('slope_percent'),
      slopeAspectDeg: real('slope_aspect_deg')
    },
    (table) => ({
      ownerNameIdx: index('blocks_owner_name_idx').on(table.ownerId, table.name),
      ownerFieldIdx: index('blocks_owner_field_idx').on(table.ownerId, table.fieldId)
    })
  )
);

export const shadeSources = tenantScoped(
  sqliteTable(
    'shade_sources',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      name: text('name').notNull(),
      kind: text('kind', {
        enum: ['tree-row', 'tree-grove', 'tree-single', 'hedge', 'building', 'fence', 'structure', 'other']
      })
        .notNull()
        .default('tree-row'),
      geometryGeojson: text('geometry_geojson'),
      fieldId: text('field_id').references(() => fields.id),
      heightFt: real('height_ft').notNull(),
      opacity: real('opacity').notNull().default(0.7),
      isDeciduous: integer('is_deciduous', { mode: 'boolean' }).notNull().default(false),
      leafOnDayOfYear: integer('leaf_on_day_of_year').notNull().default(105),
      leafOffDayOfYear: integer('leaf_off_day_of_year').notNull().default(305),
      notes: text('notes'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerIdx: index('shade_sources_owner_idx').on(table.ownerId)
    })
  )
);

export const crops = tenantScoped(
  sqliteTable(
    'crops',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
      groupId: text('group_id'),
      groupRole: text('group_role', { enum: ['anchor', 'companion'] }),
      groupOffsetDays: integer('group_offset_days'),
      groupSystemKind: text('group_system_kind', {
        enum: ['three-sisters', 'succession', 'manual']
      }),
      /** Phase 21b follow-up — JSON-encoded string[] of HARVEST_USE_CASES
       *  the operator wants surfaced for this planting. NULL = show all
       *  harvest targets the plugin declares (default). Set this to,
       *  e.g., `["fresh-eating"]` on a dual-purpose corn crop to hide
       *  the dent/grain harvest window, or `["fresh-eating","dry-storage"]`
       *  to keep both. The loader filters `growthStageTable.harvestTargets`
       *  through this list before computing per-bar harvest windows. */
      harvestUseCases: text('harvest_use_cases')
    },
    (table) => ({
      ownerBlockIdx: index('crops_owner_block_idx').on(table.ownerId, table.blockId),
      ownerStatusIdx: index('crops_owner_status_idx').on(table.ownerId, table.status)
    })
  )
);

/** @deprecated Renamed to `crops`. Re-exported here so a couple of legacy
 *  callers compile during the in-flight rename; remove once all imports
 *  switch to `crops`. The underlying table is `crops` either way. */
export const plantingRecords = crops;

export const cropEquipment = tenantScoped(
  sqliteTable(
    'crop_equipment',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
    },
    (table) => ({
      ownerCropIdx: index('crop_equipment_owner_crop_idx').on(table.ownerId, table.cropId)
    })
  )
);

export const sprayers = tenantScoped(
  sqliteTable(
    'sprayers',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      label: text('label').notNull(),
      calibratedGpa: integer('calibrated_gpa'),
      calibrationDate: integer('calibration_date', { mode: 'timestamp_ms' }),
      lastChemistryClass: text('last_chemistry_class'),
      lastSprayedAt: integer('last_sprayed_at', { mode: 'timestamp_ms' }),
      lastDeconAt: integer('last_decon_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerIdx: index('sprayers_owner_idx').on(table.ownerId)
    })
  )
);

export const sprayEvents = tenantScoped(
  sqliteTable(
    'spray_events',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id),
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
      customRateOverride: integer('custom_rate_override', { mode: 'boolean' })
        .notNull()
        .default(false),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerOccurredIdx: index('spray_events_owner_occurred_idx').on(
        table.ownerId,
        table.occurredAt
      ),
      ownerBlockIdx: index('spray_events_owner_block_idx').on(table.ownerId, table.blockId)
    })
  )
);

export const harvestEvents = tenantScoped(
  sqliteTable(
    'harvest_events',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id),
      cropId: text('crop_id').references(() => crops.id),
      cropPluginId: text('crop_plugin_id').notNull(),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      quantity: text('quantity'),
      lotNumber: text('lot_number')
    },
    (table) => ({
      ownerOccurredIdx: index('harvest_events_owner_occurred_idx').on(
        table.ownerId,
        table.occurredAt
      )
    })
  )
);

// ─── Equipment Management (Phase 8a, tenant-scoped in Phase 18a) ────────

export const equipment = tenantScoped(
  sqliteTable(
    'equipment',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
      typeId: text('type_id'),
      label: text('label').notNull(),
      specJson: text('spec_json'),
      notes: text('notes'),
      retiredAt: integer('retired_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerTypeIdx: index('equipment_owner_type_idx').on(table.ownerId, table.type)
    })
  )
);

export const equipmentState = tenantScoped(
  sqliteTable(
    'equipment_state',
    {
      equipmentId: text('equipment_id')
        .primaryKey()
        .references(() => equipment.id),
      ownerId: text('owner_id').notNull(),
      hourMeter: integer('hour_meter'),
      lastChemistryClass: text('last_chemistry_class'),
      lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
      lastDeconAt: integer('last_decon_at', { mode: 'timestamp_ms' }),
      calibratedGpa: integer('calibrated_gpa'),
      calibrationDate: integer('calibration_date', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerIdx: index('equipment_state_owner_idx').on(table.ownerId)
    })
  )
);

export const equipmentLog = tenantScoped(
  sqliteTable(
    'equipment_log',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
    },
    (table) => ({
      ownerEquipIdx: index('equipment_log_owner_equip_idx').on(
        table.ownerId,
        table.equipmentId,
        table.occurredAt
      )
    })
  )
);

export const pendingCalibrations = tenantScoped(
  sqliteTable(
    'pending_calibrations',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
    },
    (table) => ({
      ownerIdx: index('pending_calibrations_owner_idx').on(table.ownerId)
    })
  )
);

// ─── Stock Management (Phase 8b, tenant-scoped in Phase 18a) ───────────

export const stockItems = tenantScoped(
  sqliteTable(
    'stock_items',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
      defaultUnit: text('default_unit').notNull(),
      reorderThresholdHundredths: integer('reorder_threshold_hundredths'),
      notes: text('notes'),
      barcode: text('barcode'),
      typeId: text('type_id'),
      metadataJson: text('metadata_json'),
      shortName: text('short_name'),
      activeIngredientsJson: text('active_ingredients_json'),
      formulationJson: text('formulation_json'),
      /** Phase 17 follow-up — pending AI Refresh suggestions awaiting
       *  operator review. JSON-serialized StockRefreshResult shape (the
       *  same payload the /api/stock/[id]/refresh-ai endpoint returns).
       *  Cleared when the operator clicks Apply or Discard. Survives
       *  modal close, page reload, and is per-item so bulk Settings →
       *  Refresh results can be reviewed individually later. */
      pendingRefreshJson: text('pending_refresh_json'),
      /** When pendingRefreshJson was written. Surfaced in the diff panel
       *  ("AI suggestion from 12 minutes ago") so stale data is obvious. */
      pendingRefreshAt: integer('pending_refresh_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerCategoryIdx: index('stock_items_owner_category_idx').on(
        table.ownerId,
        table.category
      ),
      ownerPluginIdx: index('stock_items_owner_plugin_idx').on(table.ownerId, table.pluginId),
      ownerBarcodeIdx: index('stock_items_owner_barcode_idx').on(table.ownerId, table.barcode)
    })
  )
);

export const stockLots = tenantScoped(
  sqliteTable(
    'stock_lots',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      stockItemId: text('stock_item_id')
        .notNull()
        .references(() => stockItems.id),
      lotNumber: text('lot_number'),
      expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
      receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
      receivedQuantityHundredths: integer('received_quantity_hundredths').notNull(),
      receivedCostCents: integer('received_cost_cents'),
      supplier: text('supplier'),
      notes: text('notes')
    },
    (table) => ({
      ownerItemIdx: index('stock_lots_owner_item_idx').on(table.ownerId, table.stockItemId),
      ownerExpiryIdx: index('stock_lots_owner_expiry_idx').on(table.ownerId, table.expiresAt)
    })
  )
);

// ─── Fertility / Soil Tests (Phase 10, tenant-scoped in Phase 18a) ─────

export const soilTests = tenantScoped(
  sqliteTable(
    'soil_tests',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id),
      sampledAt: integer('sampled_at', { mode: 'timestamp_ms' }).notNull(),
      lab: text('lab'),
      reportPdfUrl: text('report_pdf_url'),
      ph: integer('ph_hundredths'),
      cecHundredths: integer('cec_hundredths'),
      organicMatterPctHundredths: integer('organic_matter_pct_hundredths'),
      nitratePpm: integer('nitrate_ppm'),
      phosphorusPpm: integer('phosphorus_ppm'),
      potassiumPpm: integer('potassium_ppm'),
      notes: text('notes')
    },
    (table) => ({
      ownerBlockIdx: index('soil_tests_owner_block_idx').on(table.ownerId, table.blockId)
    })
  )
);

export const fertilityApplications = tenantScoped(
  sqliteTable(
    'fertility_applications',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id),
      cropId: text('crop_id').references(() => crops.id),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      source: text('source').notNull(),
      stockItemId: text('stock_item_id').references(() => stockItems.id),
      ratePerAcreHundredths: integer('rate_per_acre_hundredths').notNull(),
      rateUnit: text('rate_unit').notNull(),
      nDeliveredHundredths: integer('n_delivered_hundredths').notNull().default(0),
      pDeliveredHundredths: integer('p_delivered_hundredths').notNull().default(0),
      kDeliveredHundredths: integer('k_delivered_hundredths').notNull().default(0),
      performedById: text('performed_by_id').references(() => users.id),
      notes: text('notes')
    },
    (table) => ({
      ownerBlockIdx: index('fertility_applications_owner_block_idx').on(
        table.ownerId,
        table.blockId
      )
    })
  )
);

export const fertilityCredits = tenantScoped(
  sqliteTable(
    'fertility_credits',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id),
      appliesToYear: integer('applies_to_year').notNull(),
      source: text('source').notNull(),
      cropPluginId: text('crop_plugin_id'),
      nLbPerAcreHundredths: integer('n_lb_per_acre_hundredths').notNull().default(0),
      pLbPerAcreHundredths: integer('p_lb_per_acre_hundredths').notNull().default(0),
      kLbPerAcreHundredths: integer('k_lb_per_acre_hundredths').notNull().default(0),
      notes: text('notes'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerBlockYearIdx: index('fertility_credits_owner_block_year_idx').on(
        table.ownerId,
        table.blockId,
        table.appliesToYear
      )
    })
  )
);

export const insecticideEvents = tenantScoped(
  sqliteTable(
    'insecticide_events',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
      scoutObservationJson: text('scout_observation_json'),
      conditionsJson: text('conditions_json').notNull(),
      reEntryClearAt: integer('re_entry_clear_at', { mode: 'timestamp_ms' }),
      preHarvestClearAt: integer('pre_harvest_clear_at', { mode: 'timestamp_ms' }),
      rulesVersion: text('rules_version').notNull(),
      pluginHashesJson: text('plugin_hashes_json').notNull(),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerOccurredIdx: index('insecticide_events_owner_occurred_idx').on(
        table.ownerId,
        table.occurredAt
      ),
      ownerBlockIdx: index('insecticide_events_owner_block_idx').on(table.ownerId, table.blockId)
    })
  )
);

/**
 * Phase 21 (B-18): fungicide application events. Mirrors `insecticideEvents`
 * field-for-field — fungicides share REI/PHI semantics, the same 48-hour
 * lock window, and the same scout-observation flow (a disease-density
 * observation rather than a pest-count one). The product snapshot
 * captures FRAC codes (analogous to IRAC for insecticides) so the
 * agronomy/resistance rotation hint engine can warn about consecutive
 * single-FRAC sprays.
 */
export const fungicideEvents = tenantScoped(
  sqliteTable(
    'fungicide_events',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
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
      scoutObservationJson: text('scout_observation_json'),
      conditionsJson: text('conditions_json').notNull(),
      reEntryClearAt: integer('re_entry_clear_at', { mode: 'timestamp_ms' }),
      preHarvestClearAt: integer('pre_harvest_clear_at', { mode: 'timestamp_ms' }),
      rulesVersion: text('rules_version').notNull(),
      pluginHashesJson: text('plugin_hashes_json').notNull(),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerOccurredIdx: index('fungicide_events_owner_occurred_idx').on(
        table.ownerId,
        table.occurredAt
      ),
      ownerBlockIdx: index('fungicide_events_owner_block_idx').on(table.ownerId, table.blockId)
    })
  )
);

export const stockMovements = tenantScoped(
  sqliteTable(
    'stock_movements',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      stockLotId: text('stock_lot_id')
        .notNull()
        .references(() => stockLots.id),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      deltaHundredths: integer('delta_hundredths').notNull(),
      reason: text('reason', {
        enum: [
          'receipt',
          'spray-event',
          'insecticide-event',
          'fungicide-event',
          'fertility-application',
          'planting',
          'adjustment',
          'spill',
          'expiry'
        ]
      }).notNull(),
      sprayEventId: text('spray_event_id').references(() => sprayEvents.id),
      insecticideEventId: text('insecticide_event_id').references(() => insecticideEvents.id),
      fungicideEventId: text('fungicide_event_id').references(() => fungicideEvents.id),
      fertilityApplicationId: text('fertility_application_id').references(
        () => fertilityApplications.id
      ),
      cropId: text('crop_id').references(() => crops.id),
      performedById: text('performed_by_id').references(() => users.id),
      notes: text('notes')
    },
    (table) => ({
      ownerLotIdx: index('stock_movements_owner_lot_idx').on(
        table.ownerId,
        table.stockLotId,
        table.occurredAt
      )
    })
  )
);

export const hayCuttings = tenantScoped(
  sqliteTable(
    'hay_cuttings',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id),
      cropId: text('crop_id').references(() => crops.id),
      cropPluginId: text('crop_plugin_id').notNull(),
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
      baleMoistureHundredths: integer('bale_moisture_hundredths'),
      weatherForecastJson: text('weather_forecast_json'),
      performedById: text('performed_by_id').references(() => users.id),
      rulesVersion: text('rules_version').notNull(),
      notes: text('notes'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerBlockYearIdx: index('hay_cuttings_owner_block_year_idx').on(
        table.ownerId,
        table.blockId,
        table.year
      )
    })
  )
);

// ─── Taxonomy terms (mixed scope) ───────────────────────────────────────
//
// System defaults: `is_default=1`, `owner_id=null`. Visible to all owners.
// User-added terms: `is_default=0`, `owner_id=<owner>`. Visible to that
// owner only. Repo reads with `WHERE owner_id IS NULL OR owner_id = ?`.
// Kept OUT of the TenantScoped brand because of this hybrid semantics —
// repos must build their own conditions; `tenantWhere` would over-filter.
export const taxonomyTerms = sqliteTable(
  'taxonomy_terms',
  {
    id: text('id').primaryKey(),
    // INTENTIONALLY NULLABLE: system-default terms have owner_id IS NULL and
    // are globally visible. Per-owner additions stamp the active owner.
    ownerId: text('owner_id'),
    domain: text('domain').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    domainIdx: index('taxonomy_terms_domain_idx').on(table.domain),
    ownerDomainIdx: index('taxonomy_terms_owner_domain_idx').on(table.ownerId, table.domain)
  })
);

// ─── App settings (per-Owner KV store after Phase 18a) ──────────────────
//
// PK becomes composite (owner_id, key) — table rebuild in migration 0021
// because SQLite doesn't allow altering the PK in place.
export const appSettings = tenantScoped(
  sqliteTable(
    'app_settings',
    {
      ownerId: text('owner_id').notNull(),
      key: text('key').notNull(),
      value: text('value').notNull(),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      pk: primaryKey({ columns: [table.ownerId, table.key] })
    })
  )
);

// Per-location NOAA NWS forecast cache. Globally shared — immutable, keyed
// by lat/lon, no PII. Kept OUT of the TenantScoped brand on purpose.
export const weatherForecastCache = sqliteTable('weather_forecast_cache', {
  id: text('id').primaryKey(),
  cacheKey: text('cache_key').notNull().unique(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  payloadJson: text('payload_json').notNull()
});

// ─── Tasks (Phase 12, tenant-scoped in Phase 18a) ───────────────────────

export const tasks = tenantScoped(
  sqliteTable(
    'tasks',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      title: text('title').notNull(),
      body: text('body'),
      kind: text('kind', { enum: ['primary', 'pre-task', 'post-task'] }).notNull(),
      linkedToTaskId: text('linked_to_task_id'),
      cropId: text('crop_id').references(() => crops.id),
      blockId: text('block_id').references(() => blocks.id),
      equipmentId: text('equipment_id').references(() => equipment.id),
      scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }).notNull(),
      completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
      abortedAt: integer('aborted_at', { mode: 'timestamp_ms' }),
      abortReason: text('abort_reason'),
      relatedEventTable: text('related_event_table', {
        enum: [
          'spray_event',
          'harvest_event',
          'insecticide_event',
          'fungicide_event',
          'hay_cutting',
          'fertility_application'
        ]
      }),
      relatedEventId: text('related_event_id'),
      pluginTemplateKey: text('plugin_template_key'),
      recurrenceJson: text('recurrence_json'),
      userOverridden: integer('user_overridden', { mode: 'boolean' }).notNull().default(false),
      staleAnchor: integer('stale_anchor', { mode: 'boolean' }).notNull().default(false),
      supersededByTaskId: text('superseded_by_task_id'),
      createdById: text('created_by_id').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerScheduledIdx: index('tasks_owner_scheduled_idx').on(
        table.ownerId,
        table.scheduledFor
      ),
      ownerCropIdx: index('tasks_owner_crop_idx').on(table.ownerId, table.cropId)
    })
  )
);

// ─── AI call log (Phase 14, tenant-scoped in Phase 18a) ─────────────────

export const aiCallLog = tenantScoped(
  sqliteTable(
    'ai_call_log',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      userId: text('user_id').references(() => users.id),
      endpoint: text('endpoint', {
        enum: [
          'suggest',
          'succession',
          'optimize',
          'rationale',
          'allocate',
          'groups',
          'shortNames',
          'inputs'
        ]
      }).notNull(),
      model: text('model').notNull(),
      inputTokens: integer('input_tokens').notNull().default(0),
      cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
      outputTokens: integer('output_tokens').notNull().default(0),
      usdEstimate: real('usd_estimate').notNull().default(0),
      success: integer('success', { mode: 'boolean' }).notNull().default(true),
      errorClass: text('error_class'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerCreatedIdx: index('ai_call_log_owner_created_idx').on(
        table.ownerId,
        table.createdAt
      )
    })
  )
);
