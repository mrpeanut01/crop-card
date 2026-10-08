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
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';
import type { TenantScoped } from './tenant';

/** Marks a table as tenant-scoped at the type level. Pure type cast; emits
 *  no runtime code. Pair with an `ownerId` column on the table definition. */
function tenantScoped<T>(table: T): T & TenantScoped {
  return table as T & TenantScoped;
}

// ─── Users (global identity) ─────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Sign-in identities. Either may be null (a phone-only signup has no
   *  email) but never both: every row is created from a verified email or
   *  phone, and removing the last one is refused. Email is lowercased,
   *  phone is E.164. */
  email: text('email').unique(),
  phone: text('phone').unique(),
  /** Cross-tenant support / abuse role. Boolean (not part of any role enum)
   *  because roles describe in-tenant permissions; superadmin is *across*
   *  tenants. Default false. */
  isSuperadmin: integer('is_superadmin', { mode: 'boolean' }).notNull().default(false),
  /** Phase 25d (#89) v2-addendum — drives AI-on vs AI-off variant on
   *  every AI-touchable screen. Flips true when the user validates a
   *  Claude API key in Settings → AI. Defaults false so the safe AI-off
   *  product mode is the first-paint baseline for new users + inspectors
   *  (Dale persona) who will never paste a key. */
  aiEnabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(false),
  /** Self-chosen name shown in the app chrome and to farm members. Null
   *  falls back to the email local-part or the formatted phone. */
  displayName: text('display_name'),
  /** Chosen app language (32F, F5-3). Null follows the cookie or the
   *  browser. Only locales listed in `CROPCARD_LOCALES` are honoured. */
  locale: text('locale'),
  /** IANA zone for dates and times this user reads. */
  timeZone: text('time_zone').notNull().default('America/New_York'),
  displayUnits: text('display_units', { enum: ['us', 'metric'] })
    .notNull()
    .default('us'),
  /** "Sign out everywhere": session cookies issued before this instant are
   *  refused by `revalidateCookieUser`. Null accepts every unexpired cookie. */
  sessionsValidAfter: integer('sessions_valid_after', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});

/** Profile picture, one per user. Kept off `users` so the hot per-request
 *  user lookups never pull the image bytes. The client downsizes before
 *  upload; the server re-checks type and size (`lib/db/userProfile.ts`). */
export const userAvatars = sqliteTable('user_avatars', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mime: text('mime', { enum: ['image/jpeg', 'image/png', 'image/webp'] }).notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

/** Phase 30 first-use hints a person has dismissed. Keyed by user, not
 *  Owner (someone learns a control once, on any farm), and holds no farm
 *  data, so it is deliberately not tenant-scoped. */
export const userHints = sqliteTable(
  'user_hints',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hintKey: text('hint_key').notNull(),
    seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.hintKey] })
  })
);

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
  /** Superadmin-granted plan that wins over Stripe (comped farms, support). */
  planOverride: text('plan_override', { enum: ['free', 'grower', 'farm'] }),
  /** When this Owner first drew the free-plan starter AI boost. The boost is
   *  granted once per owning identity, so a second farm does not get it. */
  starterBoostUsedAt: integer('starter_boost_used_at', { mode: 'timestamp_ms' }),
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

// ─── Phase 24 — External Agent API tokens ───────────────────────────────

/** Bearer-token credentials for external Claude agents (Phase 24, UC-43).
 *  Mirrors helper_invites: only the SHA-256 hash of the plaintext token
 *  lands here, plaintext shown once on mint. Unlike helper_invites this
 *  table is NOT branded `tenantScoped` because the Bearer lookup path is
 *  cross-tenant by definition (we resolve which Owner the token belongs
 *  to from the lookup result) — but every WRITE goes through composite
 *  (owner_id, id) keys via tenant-aware helpers in apiTokens.ts.
 *
 *  The `is_service_account` + `daily_quota_*` columns gate Sub-task D's
 *  per-token rate-limit branching in aiGuard.ts. A null quota column means
 *  "use the endpoint-default daily quota". */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    label: text('label').notNull(),
    /** sha256(plaintext). UNIQUE — constant-time match in apiTokens.ts. */
    tokenHash: text('token_hash').notNull(),
    isServiceAccount: integer('is_service_account', { mode: 'boolean' }).notNull().default(false),
    dailyQuotaAllocate: integer('daily_quota_allocate'),
    dailyQuotaSchedule: integer('daily_quota_schedule'),
    dailyQuotaInputs: integer('daily_quota_inputs'),
    dailyQuotaStockRefresh: integer('daily_quota_stock_refresh'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    requestCount: integer('request_count').notNull().default(0),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    tokenHashIdx: index('api_tokens_token_hash_idx').on(table.tokenHash),
    ownerIdx: index('api_tokens_owner_idx').on(table.ownerId, table.createdAt)
  })
);

/** Magic-link sign-in tokens. Identity-level (like `users`), so NOT
 *  tenant-scoped: the row exists before the email is proven and before any
 *  Owner is chosen. Only sha256(token) is stored; `ip_hash` is sha256 of
 *  the requesting client address, used solely for the per-IP rate limit. */
export const loginTokens = sqliteTable(
  'login_tokens',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    ipHash: text('ip_hash'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('login_tokens_token_hash_idx').on(table.tokenHash),
    emailIdx: index('login_tokens_email_idx').on(table.email, table.createdAt),
    ipIdx: index('login_tokens_ip_idx').on(table.ipHash, table.createdAt)
  })
);

/** Short numeric sign-in / contact-verification codes (email or SMS).
 *  Identity-level like `login_tokens`, so unscoped. `destination` is the
 *  normalized address the code was sent to; `purpose='link'` rows carry the
 *  signed-in `user_id` they will attach the destination to. An email login
 *  code shares a lifetime with its magic link via `login_token_id`:
 *  redeeming either burns both. Only an HMAC of the code is stored and
 *  `attempts` caps guessing per code. */
export const loginCodes = sqliteTable(
  'login_codes',
  {
    id: text('id').primaryKey(),
    channel: text('channel', { enum: ['email', 'sms'] }).notNull(),
    purpose: text('purpose', { enum: ['login', 'link'] }).notNull(),
    destination: text('destination').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    loginTokenId: text('login_token_id'),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    ipHash: text('ip_hash'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    destinationIdx: index('login_codes_destination_idx').on(table.destination, table.createdAt),
    ipIdx: index('login_codes_ip_idx').on(table.ipHash, table.createdAt),
    loginTokenIdx: index('login_codes_login_token_idx').on(table.loginTokenId)
  })
);

// @hold-fact (C-35: a farm copy carries grazing and withdrawal data; writes run inside the hold guard)
/** Per-Owner plugin overlays. The base plugin catalog lives on the
 *  filesystem under /plugins/; this table layers per-Owner customizations:
 *  newest row per pluginId wins, a full payload replaces the shared plugin
 *  for that Owner, an empty payload hides (retires) it for that Owner.
 *  Repo: `lib/db/pluginOverrides.ts`; applied by `getRegistry()`. Payloads
 *  pass the same schema + bypass validation as shared-library uploads
 *  before the kernel ever sees them. */
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
      ownerPluginIdx: index('plugin_overrides_owner_plugin_idx').on(table.ownerId, table.pluginId)
    })
  )
);

/** Append-only version history for the global plugin catalog (Phase 22).
 *  Each upload that changes a plugin's payload writes a new row + supersedes
 *  the prior current row (`superseded_at = now`). The on-disk JSON under
 *  `plugins/{kind}s/{pluginId}.json` always reflects the current row.
 *
 *  Replay safety: `spray_events.pluginHashesJson` resolves to a row here by
 *  (pluginId, hash) even after the on-disk file is rotated or retired.
 *
 *  Retire/uninstall use the same table:
 *  - retire sets `retiredAt` on the current row (reversible via unretire).
 *  - uninstall hard-deletes payload-bearing rows for a pluginId AFTER a
 *    server-side referencing-events check, then writes one tombstone row
 *    with `payloadJson = ''` and `changeReason = 'uninstall'`.
 *
 *  GLOBAL: no `owner_id` column. Plugins are a single catalog per
 *  CLAUDE.md invariant #2; per-tenant customization lives in
 *  `plugin_overrides`. B-31 (marketplace) will introduce per-owner
 *  installed-plugin state when multi-tenant requires it. */
export const pluginVersions = sqliteTable(
  'plugin_versions',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    /** Semver string. Server auto-bumps the patch on every payload change;
     *  authors can override to a minor / major bump via the form. */
    version: text('version').notNull(),
    kind: text('kind', {
      enum: ['crop', 'herbicide', 'insecticide', 'fungicide', 'fertilizer', 'companion']
    }).notNull(),
    /** SHA-256 of `payloadJson`. Matches the values stored in event rows'
     *  `pluginHashesJson` so `getPluginByHash` can resolve historical
     *  plugin state for export / replay. */
    hash: text('hash').notNull(),
    /** Full plugin JSON at this version. Empty string ('') on uninstall
     *  tombstone rows. */
    payloadJson: text('payload_json').notNull(),
    changedByUserId: text('changed_by_user_id').references(() => users.id),
    /** Free-text. Common values: 'initial-import', 'manual-edit',
     *  'rollback to {version}', 'retire', 'unretire', 'uninstall'. */
    changeReason: text('change_reason'),
    /** {addedKeys[], removedKeys[], changedKeys[]} captured at write time
     *  so the timeline UI does not need to re-diff on every render. */
    diffSummaryJson: text('diff_summary_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /** NULL = current. Non-null when a newer version row has been written. */
    supersededAt: integer('superseded_at', { mode: 'timestamp_ms' }),
    /** Soft-delete timestamp. NULL = active; set by retire / uninstall. */
    retiredAt: integer('retired_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    pluginIdx: index('plugin_versions_plugin_idx').on(table.pluginId, table.createdAt),
    hashIdx: index('plugin_versions_hash_idx').on(table.pluginId, table.hash)
  })
);

/** Subscription state per Owner. Stripe IDs are nullable now — billing
 *  hookup is a code-only change later (no migration). */
export const ownerSubscriptions = sqliteTable('owner_subscriptions', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => owners.id),
  planCode: text('plan_code', { enum: ['free', 'grower', 'farm'] })
    .notNull()
    .default('free'),
  status: text('status', {
    enum: ['trial', 'active', 'past_due', 'canceled', 'suspended', 'incomplete']
  })
    .notNull()
    .default('trial'),
  billingInterval: text('billing_interval', { enum: ['month', 'year'] }),
  /** First failed payment of the current dunning run; the paid plan holds
   *  for PAST_DUE_GRACE_DAYS from here. Cleared when the subscription is
   *  active again. */
  pastDueSince: integer('past_due_since', { mode: 'timestamp_ms' }),
  periodStart: integer('period_start', { mode: 'timestamp_ms' }),
  periodEnd: integer('period_end', { mode: 'timestamp_ms' }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  /** `created` of the newest subscription or invoice event applied, so a
   *  late or retried older event cannot overwrite newer state. */
  lastStripeEventAt: integer('last_stripe_event_at', { mode: 'timestamp_ms' }),
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

// @hold-fact (C-35: writes run inside the hold guard)
/**
 * Force-delete tombstones (#329). When an owner hard-deletes a *locked*
 * record via `?force=true`, the row itself is removed — leaving a gap in
 * the audit sequence with no trace of what was destroyed or by whom. This
 * table records a tombstone written *before* the delete: record kind, id,
 * the acting user, an optional reason, and a JSON snapshot of the row so
 * the deletion is reconstructable. Tenant-scoped so tombstones never leak
 * across Owners.
 */
export const recordDeletions = tenantScoped(
  sqliteTable(
    'record_deletions',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      recordKind: text('record_kind', {
        enum: [
          'spray',
          'insecticide',
          'fungicide',
          'harvest',
          'animal-health',
          'animal-production',
          'animal-status',
          'hay',
          'harvest-disposition'
        ]
      }).notNull(),
      recordId: text('record_id').notNull(),
      deletedBy: text('deleted_by'),
      reason: text('reason'),
      deletedAt: integer('deleted_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      snapshotJson: text('snapshot_json').notNull()
    },
    (table) => ({
      ownerDeletedIdx: index('record_deletions_owner_deleted_idx').on(
        table.ownerId,
        table.deletedAt
      )
    })
  )
);

/**
 * Offline-queue replay receipts. The client sends its queue row id with each
 * replayed record; a repeat of an id already saved answers success without
 * writing a second record. `pending` marks a save still running.
 */
export const clientRecordReceipts = tenantScoped(
  sqliteTable(
    'client_record_receipts',
    {
      ownerId: text('owner_id').notNull(),
      clientRecordId: text('client_record_id').notNull(),
      endpoint: text('endpoint').notNull(),
      status: text('status', { enum: ['pending', 'done'] }).notNull(),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
    },
    (table) => ({
      pk: primaryKey({ columns: [table.ownerId, table.clientRecordId] })
    })
  )
);

// ─── Fields → Blocks hierarchy (Phase 13, tenant-scoped in Phase 18a) ──

// @hold-fact (C-35: writes run inside the hold guard)
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
      /** Sketch dimensions in feet for farms mapped without GPS (drawn as boxes). */
      widthFt: real('width_ft'),
      lengthFt: real('length_ft'),
      /** Phase 30: the UI calls a `fields` row an Area. Values mirror
       *  `AREA_KINDS` in `lib/farm/areaKinds.ts`. */
      kind: text('kind', {
        enum: [
          'field',
          'garden',
          'greenhouse',
          'orchard',
          'pasture',
          'barn',
          'coop_pen',
          'residence',
          'natural_area',
          'water',
          'boundary'
        ]
      })
        .notNull()
        .default('field'),
      /** Kind-specific attributes, validated by `areaDetailsSchema`. */
      detailsJson: text('details_json'),
      perimeterFt: real('perimeter_ft'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerIdx: index('fields_owner_idx').on(table.ownerId, table.createdAt)
    })
  )
);

// @hold-fact (C-35: writes run inside the hold guard)
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
      slopeAspectDeg: real('slope_aspect_deg'),
      widthFt: real('width_ft'),
      lengthFt: real('length_ft'),
      kind: text('kind', { enum: ['block', 'bed', 'row', 'container'] })
        .notNull()
        .default('block'),
      /** Position in the parent Area's local feet grid (garden designer).
       *  Illustrative only: never read by geometry consumers. */
      xFt: real('x_ft'),
      yFt: real('y_ft'),
      rotationDeg: real('rotation_deg'),
      bedStyle: text('bed_style', { enum: ['raised', 'in-ground', 'container', 'vertical'] })
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
        enum: [
          'tree-row',
          'tree-grove',
          'tree-single',
          'hedge',
          'building',
          'fence',
          'structure',
          'other'
        ]
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

/** Map lines and points (Phase 30H): fences, gates, water sources,
 *  hydrants, irrigation lines and paths. `geometry_geojson` is a LineString
 *  or a Point depending on `kind`; `details_json` is validated per kind in
 *  `lib/farm/mapFeatures.ts`. */
export const mapFeatures = tenantScoped(
  sqliteTable(
    'map_features',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      fieldId: text('field_id').references(() => fields.id, { onDelete: 'set null' }),
      kind: text('kind', {
        enum: ['fence', 'gate', 'water_source', 'hydrant', 'irrigation_line', 'path']
      }).notNull(),
      geometryGeojson: text('geometry_geojson').notNull(),
      name: text('name').notNull(),
      detailsJson: text('details_json'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerKindIdx: index('map_features_owner_kind_idx').on(table.ownerId, table.kind),
      ownerFieldIdx: index('map_features_owner_field_idx').on(table.ownerId, table.fieldId)
    })
  )
);

/** Areas a hydrant or waterer serves (#478). One row per (feature, Area);
 *  both sides cascade so a link never points at a deleted row.
 *  `map_features.field_id` stays as the first (primary) Area. */
export const mapFeatureAreas = tenantScoped(
  sqliteTable(
    'map_feature_areas',
    {
      ownerId: text('owner_id').notNull(),
      featureId: text('feature_id')
        .notNull()
        .references(() => mapFeatures.id, { onDelete: 'cascade' }),
      fieldId: text('field_id')
        .notNull()
        .references(() => fields.id, { onDelete: 'cascade' }),
      position: integer('position').notNull().default(0),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      pk: primaryKey({ columns: [table.featureId, table.fieldId] }),
      ownerFeatureIdx: index('map_feature_areas_owner_feature_idx').on(
        table.ownerId,
        table.featureId
      ),
      ownerFieldIdx: index('map_feature_areas_owner_field_idx').on(table.ownerId, table.fieldId)
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
      harvestUseCases: text('harvest_use_cases'),
      /** Sprint 3 (#212 / CT-PP-004) — provenance tag the wizard commit
       *  flow writes so PlanV2Shell can render the right PlantingCard
       *  source badge ("AI plan" / "Carry-forward") instead of the
       *  catch-all "Manual entry". NULL = manual drag-drop (the existing
       *  /plan?tab=crops behavior); explicit `'ai'` or `'fallback'` for
       *  wizard runs. Phase 30E adds `'plugin'` for plantings saved from a
       *  bed recipe. SQLite stores the enum as plain TEXT, so widening it
       *  needs no migration. */
      sourceProvenance: text('source_provenance', { enum: ['ai', 'fallback', 'plugin'] }),
      /** Sprint 6 / Phase 27A (#257) — per-planting archetype override.
       *  NULL means "use the resolved archetype from the crop plugin"
       *  (the default — `resolveArchetype(plugin)` in plugin-validation).
       *  Set to one of the 10 canonical archetype values to override at
       *  the planting level (e.g., corn-for-silage routes through
       *  `forage-cutting-cycle` instead of `row-grain.pollination`). The
       *  enum constraint is enforced in code; SQLite stores any text. */
      archetypeOverride: text('archetype_override'),
      /** Phase 30: where the planting sits in its bed, as JSON
       *  `{x_in, y_in, w_in, l_in}` (see `lib/farm/footprint.ts`). */
      footprintJson: text('footprint_json'),
      spacingIn: real('spacing_in'),
      rowSpacingIn: real('row_spacing_in'),
      spacingPattern: text('spacing_pattern', { enum: ['square', 'offset', 'sfg'] }),
      plantCount: integer('plant_count'),
      /** `data` when computed from spacing, `manual` when typed,
       *  `fallback` when the plugin had no spacing. */
      plantCountProvenance: text('plant_count_provenance', {
        enum: ['data', 'manual', 'fallback']
      }),
      /** Phase 32E. `planting_date` stays the in-ground date; a transplant
       *  records its indoor sowing here. */
      establishment: text('establishment', { enum: ['direct-seed', 'transplant'] }),
      sownIndoorsAt: integer('sown_indoors_at', { mode: 'timestamp_ms' }),
      /** Phase 35: one seed lot planted across several blocks. Every part
       *  carries the same `sg_<uuid>` the wizard minted at commit. */
      splitGroupId: text('split_group_id'),
      /** #548: the owner's answer to "Tree size" (`dwarf | semi-dwarf |
       *  standard`, checked in code; always `manual`). NULL = not sure. */
      treeSizeClass: text('tree_size_class'),
      /** #555: Drilled or Broadcast for a crop sown by area (`drilled |
       *  broadcast`, checked in code). NULL = the plugin's default method. */
      sowingMethod: text('sowing_method')
    },
    (table) => ({
      ownerBlockIdx: index('crops_owner_block_idx').on(table.ownerId, table.blockId),
      ownerStatusIdx: index('crops_owner_status_idx').on(table.ownerId, table.status),
      ownerSplitGroupIdx: index('crops_owner_split_group_idx').on(table.ownerId, table.splitGroupId)
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

// @hold-fact (C-35: writes run inside the hold guard)
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
      // FK targets `equipment(id)` since Phase 8a unified gear under
      // equipment. The legacy `sprayers` table is now write-frozen and only
      // survives for the cross-tenant delete in admin.ts.
      sprayerId: text('sprayer_id')
        .notNull()
        .references(() => equipment.id),
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
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
      /** Phase 25d (#89) v2-addendum — per-field provenance map keyed by
       *  field name; values are objects {source, detail?, confidence?,
       *  fallbackReason?, attemptedAiAt?}. See AI_PROVENANCE_ADDENDUM.md
       *  "Field-by-field map" for the canonical field set. Single
       *  column (not N per-field columns) for query simplicity. */
      provenanceJson: text('provenance_json'),
      /** C-35: the hold parameters (label intervals) read when this was
       *  recorded. A later data change can only lengthen the hold: the
       *  kernels take the longer of this snapshot and the current data. */
      holdParamsJson: text('hold_params_json')
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

// @hold-fact (C-35: writes run inside the hold guard)
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
      lotNumber: text('lot_number'),
      /** UC-16 (#339) — stored moisture % captured at harvest. Nullable:
       *  null means the operator didn't measure. When present, the
       *  harvest-moisture kernel (RULES_VERSION >=0.5.2) gates the commit
       *  against the family threshold. Persisted so the gate decision is
       *  auditable, not just enforced then dropped. */
      moisturePct: real('moisture_pct'),
      /** RULES_VERSION of the hay cut gate (C-28) that cleared this cut.
       *  Null for crops the gate does not run on and for older cuts. */
      rulesVersion: text('rules_version'),
      /** FR-09 (#308) — 48-hour immutability lock, stamped on the first
       *  read past the window (mirrors spray_events.locked_at). Nullable:
       *  null means still-mutable. */
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
      /** Phase 25d v2-addendum — see sprayEvents.provenanceJson. */
      provenanceJson: text('provenance_json'),
      /** #662: the harvest form's archetype readings (pick number, grade,
       *  Brix, cut height, ...) as `HarvestDetails` JSON, kept out of the
       *  lot number, which stays the grower's own traceability code. */
      detailsJson: text('details_json'),
      /** #749: who saved the harvest. Null on harvests saved before 0091. */
      performedById: text('performed_by_id')
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
      calibrationDate: integer('calibration_date', { mode: 'timestamp_ms' }),
      // UC-45 — set when the sprayer is winterized for the off-season.
      // The same write nulls calibration (recalibrate in spring) and clears
      // chemistry via the decon semantics. Null = not winterized.
      winterizedAt: integer('winterized_at', { mode: 'timestamp_ms' })
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
          'part',
          'feed',
          'bedding',
          'animal-health'
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
      ownerCategoryIdx: index('stock_items_owner_category_idx').on(table.ownerId, table.category),
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
      notes: text('notes'),
      /** #475: `ordered` and `planned` lots carry no receipt movement, so they
       *  never count toward on-hand until they are marked received. */
      quantityStatus: text('quantity_status', { enum: ['existing', 'ordered', 'planned'] })
        .notNull()
        .default('existing'),
      /** Phase 33B: seed lots only. Null means not recorded. */
      seedOrganicStatus: text('seed_organic_status', {
        enum: ['organic', 'untreated', 'treated', 'unknown']
      }),
      /** JSON `[{ supplier, checkedAt, result }]` (Q-ORG-SEED-FIELDS). */
      seedSourcesCheckedJson: text('seed_sources_checked_json'),
      seedUnavailabilityNote: text('seed_unavailability_note'),
      /** Phase 33C: hay put into feed inventory from this cutting. No SQL FK. */
      sourceHayCuttingId: text('source_hay_cutting_id')
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
      notes: text('notes'),
      /** Phase 32A. Nutrient columns are ppm unless `units_basis` says the
       *  lab reported lb/acre; `lib/fertility/soilInterpret.ts` converts. */
      extractionMethod: text('extraction_method', {
        enum: ['mehlich-1', 'mehlich-3', 'bray-p1', 'olsen', 'morgan', 'modified-morgan', 'other']
      }),
      unitsBasis: text('units_basis', { enum: ['ppm', 'lb-per-acre'] }),
      caPpm: integer('ca_ppm'),
      mgPpm: integer('mg_ppm'),
      bufferPhHundredths: integer('buffer_ph_hundredths'),
      /** The lab's own low/medium/high ratings, which win over the computed
       *  class. JSON `{ p?, k?, ca?, mg? }`. */
      labRatingJson: text('lab_rating_json'),
      provenance: text('provenance', { enum: ['manual', 'ai', 'fallback'] }),
      /** Reserved for the document vault (Phase 33); no FK until it exists. */
      documentId: text('document_id')
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
      notes: text('notes'),
      /** Phase 33C: the manure or compost batch spread. No SQL FK (A-05). */
      amendmentBatchId: text('amendment_batch_id'),
      /** Phase 33C: the carryover facts confirmed at save, and who confirmed. */
      carryoverAckJson: text('carryover_ack_json')
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

// @hold-fact (C-35: writes run inside the hold guard)
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
      /** C-35: the hold parameters (label intervals) read when this was
       *  recorded. A later data change can only lengthen the hold: the
       *  kernels take the longer of this snapshot and the current data. */
      holdParamsJson: text('hold_params_json'),
      scoutObservationJson: text('scout_observation_json'),
      conditionsJson: text('conditions_json').notNull(),
      reEntryClearAt: integer('re_entry_clear_at', { mode: 'timestamp_ms' }),
      preHarvestClearAt: integer('pre_harvest_clear_at', { mode: 'timestamp_ms' }),
      rulesVersion: text('rules_version').notNull(),
      pluginHashesJson: text('plugin_hashes_json').notNull(),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
      /** Phase 25d v2-addendum — see sprayEvents.provenanceJson. */
      provenanceJson: text('provenance_json'),
      /** #130 — bloom status the pollinator gate evaluated. NULL on pre-#130 rows. */
      bloomStatus: text('bloom_status', { enum: ['in-bloom', 'not-in-bloom', 'unknown'] }),
      bloomStatusSource: text('bloom_status_source', { enum: ['operator', 'plugin', 'default'] }),
      attestedNoForagers: integer('attested_no_foragers', { mode: 'boolean' }),
      pollinatorVerdict: text('pollinator_verdict', { enum: ['pass', 'warn', 'block'] })
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

// @hold-fact (C-35: writes run inside the hold guard)
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
      /** C-35: the hold parameters (label intervals) read when this was
       *  recorded. A later data change can only lengthen the hold: the
       *  kernels take the longer of this snapshot and the current data. */
      holdParamsJson: text('hold_params_json'),
      scoutObservationJson: text('scout_observation_json'),
      conditionsJson: text('conditions_json').notNull(),
      reEntryClearAt: integer('re_entry_clear_at', { mode: 'timestamp_ms' }),
      preHarvestClearAt: integer('pre_harvest_clear_at', { mode: 'timestamp_ms' }),
      rulesVersion: text('rules_version').notNull(),
      pluginHashesJson: text('plugin_hashes_json').notNull(),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
      /** Phase 25d v2-addendum — see sprayEvents.provenanceJson. */
      provenanceJson: text('provenance_json')
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
          'expiry',
          'animal-treatment',
          'animal-feed'
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

// @hold-fact (C-35: writes run inside the hold guard)
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
      /** C-35: saved more than 48 hours after the date it records. A label only. */
      recordedLate: integer('recorded_late', { mode: 'boolean' }).notNull().default(false),
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

// Process-level key/value state (e.g. when DB maintenance last ran). Holds
// no farm data, so it is global and outside the TenantScoped brand.
export const systemState = sqliteTable('system_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

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
          'fertility_application',
          'animal_health_event',
          'scout_observation'
        ]
      }),
      relatedEventId: text('related_event_id'),
      pluginTemplateKey: text('plugin_template_key'),
      recurrenceJson: text('recurrence_json'),
      userOverridden: integer('user_overridden', { mode: 'boolean' }).notNull().default(false),
      staleAnchor: integer('stale_anchor', { mode: 'boolean' }).notNull().default(false),
      supersededByTaskId: text('superseded_by_task_id'),
      createdById: text('created_by_id').references(() => users.id),
      // Phase 21b follow-up — authoritative task type for the swim-lane
      // pip glyph + popover category dropdown. Plugin pre/post/seasonal
      // task schemas, the inputs-plan commit, and manual entry surfaces
      // all stamp this. Nullable for v1 plugin / legacy row back-compat.
      category: text('category', {
        enum: [
          'plant',
          'till',
          'fertilize',
          'spray',
          'scout',
          'companion-check',
          'prune',
          'harvest',
          'hay-cutting',
          'animal-care',
          'other'
        ]
      }),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      /** Phase 32F. Must hold an active `helper_assignments` row for this
       *  Owner (`assignableUserRef`). */
      assigneeUserId: text('assignee_user_id').references(() => users.id, {
        onDelete: 'set null'
      }),
      assignedAt: integer('assigned_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerScheduledIdx: index('tasks_owner_scheduled_idx').on(table.ownerId, table.scheduledFor),
      ownerCropIdx: index('tasks_owner_crop_idx').on(table.ownerId, table.cropId),
      ownerAssigneeScheduledIdx: index('tasks_owner_assignee_scheduled_idx').on(
        table.ownerId,
        table.assigneeUserId,
        table.scheduledFor
      ),
      categoryIdx: index('tasks_category_idx').on(table.category)
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
      /** Phase 24 — set when the call originated from a Bearer-authed
       *  service-account token. aiGuard keys rate-limit on (tokenId,
       *  endpoint, UTC-day) when present, so a runaway agent can't drain
       *  the human owner's daily quota. Null for cookie sessions and
       *  personal-use (non-service-account) Bearer tokens. */
      tokenId: text('token_id'),
      endpoint: text('endpoint', {
        enum: [
          'suggest',
          'succession',
          'optimize',
          'rationale',
          'allocate',
          'groups',
          'shortNames',
          'inputs',
          'plugin-scan',
          'plugin-search',
          'plugin-batch-scan',
          'scan-label',
          'scan-url',
          'scan-barcode',
          'planting-window',
          'garden-fill',
          'photo-help'
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
        .default(sql`(unixepoch() * 1000)`),
      // ─── Phase 25d v2-addendum (#93, rolled into #89) ─────────────
      /** 'ai' for a successful Claude call, 'fallback' for a row that
       *  EXISTS because aiTry() picked the deterministic path (no key /
       *  over-cap / offline / rate-limit / timeout). Nullable on rows
       *  that pre-date the migration. */
      provenance: text('provenance', { enum: ['ai', 'fallback'] }),
      /** Claude self-reported confidence (0..1) for `provenance='ai'`. */
      confidence: real('confidence'),
      /** Why the deterministic path ran instead of AI. Populated only
       *  when `provenance='fallback'`. */
      fallbackReason: text('fallback_reason', {
        enum: ['no-key', 'over-cap', 'offline', 'rate-limit', 'timeout']
      }),
      /** Wall time the (failed/skipped) AI call would have happened.
       *  Used by /api/audit/re-ask-ai to re-run fallback rows once a
       *  key is configured. */
      attemptedAiAt: integer('attempted_ai_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerCreatedIdx: index('ai_call_log_owner_created_idx').on(table.ownerId, table.createdAt),
      userEndpointCreatedIdx: index('ai_call_log_user_endpoint_created_idx').on(
        table.userId,
        table.endpoint,
        table.createdAt
      ),
      tokenEndpointCreatedIdx: index('ai_call_log_token_endpoint_created_idx').on(
        table.tokenId,
        table.endpoint,
        table.createdAt
      ),
      createdUsdIdx: index('ai_call_log_created_usd_idx').on(table.createdAt, table.usdEstimate)
    })
  )
);

// ─── Phase 25d (#89) — plan_revisions table ─────────────────────────
//
// Every plan-commit / wizard-commit / manual edit writes a revision
// row so the ProvenancePanel can show where the current plan came
// from + audit the chain. `payload_json` is a coarse-grained snapshot
// (full plan at commit time); finer-grained per-field provenance lives
// on the operational event tables (sprayEvents.provenanceJson etc.).

export const planRevisions = tenantScoped(
  sqliteTable(
    'plan_revisions',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      /** Logical plan ID — typically the year + farm identifier; lets
       *  successive revisions of the same plan chain via revisionNumber. */
      planId: text('plan_id').notNull(),
      revisionNumber: integer('revision_number').notNull(),
      source: text('source', { enum: ['wizard', 'manual', 'ai-refinement'] }).notNull(),
      payloadJson: text('payload_json').notNull(),
      parentRevisionId: text('parent_revision_id'),
      createdByUserId: text('created_by_user_id').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerPlanIdx: index('plan_revisions_owner_plan_idx').on(table.ownerId, table.planId),
      ownerCreatedIdx: index('plan_revisions_owner_created_idx').on(table.ownerId, table.createdAt)
    })
  )
);

// ─── Phase 25d (#95) — dedicated scout observations table ─────────────
//
// Standalone observation table so pre-spray scouting + multi-pest field
// walks + the 5-week-sparkline can read real data (was: embedded only
// in insecticide_events.scoutObservationJson). Tenant-scoped per
// CLAUDE.md invariant 6.

export const scoutObservations = tenantScoped(
  sqliteTable(
    'scout_observations',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id),
      cropId: text('crop_id').references(() => crops.id),
      performedById: text('performed_by_id')
        .notNull()
        .references(() => users.id),
      pest: text('pest').notNull(),
      metric: text('metric').notNull(),
      value: real('value').notNull(),
      notes: text('notes'),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerOccurredIdx: index('scout_observations_owner_occurred_idx').on(
        table.ownerId,
        table.occurredAt
      ),
      ownerBlockIdx: index('scout_observations_owner_block_idx').on(table.ownerId, table.blockId),
      ownerPestMetricIdx: index('scout_observations_owner_pest_metric_idx').on(
        table.ownerId,
        table.pest,
        table.metric
      )
    })
  )
);

/** Phase 30G planting journal: notes, observations and photo-help answers.
 *  `photo_ref` holds one downscaled, EXIF-free JPEG data URL (size-capped
 *  by the repo). Journal rows are notes, not regulatory records, so they
 *  go with their planting. */
export const plantingJournal = tenantScoped(
  sqliteTable(
    'planting_journal',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      cropId: text('crop_id')
        .notNull()
        .references(() => crops.id, { onDelete: 'cascade' }),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id, { onDelete: 'cascade' }),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      createdBy: text('created_by').references(() => users.id),
      kind: text('kind', { enum: ['note', 'photo_help', 'observation'] }).notNull(),
      text: text('text').notNull().default(''),
      photoRef: text('photo_ref'),
      /** Phase 33A: the photo in the vault. No SQL FK (A-05); reads accept
       *  either column while `photo_ref` rows move over. */
      photoDocumentId: text('photo_document_id'),
      answerJson: text('answer_json'),
      provenance: text('provenance', { enum: ['manual', 'ai', 'fallback'] }).notNull()
    },
    (table) => ({
      ownerCropCreatedIdx: index('planting_journal_owner_crop_created_idx').on(
        table.ownerId,
        table.cropId,
        table.createdAt
      )
    })
  )
);

// ─── Phase 25c.0 step 6 (#87) / Phase 25d (#89) — dry-run kernel log ──
//
// When env KERNEL_DRY_RUN=1, the new evaluators (fracRotation,
// ipmThreshold, pollinatorBloom) write what-would-have-happened verdicts
// here INSTEAD of failing the spray. After 14 days of clean rows post-
// 25d ship the flag flips off and gates go live.
//
// Tenant-scoped (CLAUDE.md invariant 6) — every row carries owner_id,
// and the cross-tenant property test gets extended in a follow-up.

export const kernelDryRunLog = tenantScoped(
  sqliteTable(
    'kernel_dry_run_log',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      rulesVersion: text('rules_version').notNull(),
      evaluator: text('evaluator', {
        enum: ['fracRotation', 'ipmThreshold', 'pollinatorBloom']
      }).notNull(),
      verdict: text('verdict', { enum: ['ok', 'warn', 'block'] }).notNull(),
      reasonsJson: text('reasons_json').notNull(),
      plannedSprayJson: text('planned_spray_json').notNull(),
      blockId: text('block_id'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerCreatedIdx: index('kernel_dry_run_log_owner_created_idx').on(
        table.ownerId,
        table.createdAt
      ),
      ownerEvaluatorIdx: index('kernel_dry_run_log_owner_evaluator_idx').on(
        table.ownerId,
        table.evaluator
      )
    })
  )
);

// ─── Phase 25d (#89) — wizard chat server-persistence ───────────────────
//
// Pre-#89, the AllocationWizard kept chat transcripts in $state. Reload
// or tab switch lost them. These two tables move the source of truth to
// the server so wizard chat survives reloads and is auditable later.
//
// One `wizard_sessions` row per (ownerId, planId) active wizard run. One
// `wizard_chat_messages` row per turn, append-only, scoped to a session +
// step ('allocation' | 'schedule' | 'inputs').
//
// Both tenant-scoped per CLAUDE.md invariant 6. The cross-tenant property
// test gets extended in the same commit.

export const wizardSessions = tenantScoped(
  sqliteTable(
    'wizard_sessions',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      /** Same scheme as plan_revisions.plan_id — `season-${year}`. Lets a
       *  single active session resume across reloads scoped to the active
       *  plan. */
      planId: text('plan_id').notNull(),
      /** 'active' — chat-eligible session. 'completed' — wizard reached
       *  commit, session sealed; new wizard runs spawn a new session.
       *  'abandoned' — session timed out / user reset; preserved for
       *  audit but not resumed. */
      status: text('status', { enum: ['active', 'completed', 'abandoned'] }).notNull(),
      createdByUserId: text('created_by_user_id').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      /** Bumped on every appended message so the loader can pick the
       *  most-recently-active session when more than one exists. */
      lastActiveAt: integer('last_active_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      completedAt: integer('completed_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerPlanIdx: index('wizard_sessions_owner_plan_idx').on(table.ownerId, table.planId),
      ownerStatusIdx: index('wizard_sessions_owner_status_idx').on(table.ownerId, table.status)
    })
  )
);

export const wizardChatMessages = tenantScoped(
  sqliteTable(
    'wizard_chat_messages',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      sessionId: text('session_id')
        .notNull()
        .references(() => wizardSessions.id, { onDelete: 'cascade' }),
      /** Which wizard step the message belongs to. Allocation chat lives
       *  with the Review step; schedule chat lives with the Schedule
       *  step. Inputs chat is reserved (no in-step refinement loop
       *  shipped yet) but the enum is open so future inputs-step
       *  refinement plugs in without a migration. */
      step: text('step', { enum: ['allocation', 'schedule', 'inputs'] }).notNull(),
      role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
      content: text('content').notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerSessionStepIdx: index('wizard_chat_messages_owner_session_step_idx').on(
        table.ownerId,
        table.sessionId,
        table.step,
        table.createdAt
      )
    })
  )
);

// ─── Sprint 3 (#173 / CT-W-004) — wizard_drafts (Save & resume later) ───
//
// One row per (owner, plan_id). Save & resume later snapshots the
// in-progress wizard step + form state + chat thread; re-opening the
// wizard hydrates from the most-recent draft. Commit + Exit-with-discard
// delete the row. Tenant-scoped per CLAUDE.md invariant 6.

export const wizardDrafts = tenantScoped(
  sqliteTable(
    'wizard_drafts',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      planId: text('plan_id').notNull(),
      step: text('step').notNull(),
      payloadJson: text('payload_json').notNull(),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      createdByUserId: text('created_by_user_id').references(() => users.id)
    },
    (table) => ({
      ownerPlanUq: uniqueIndex('wizard_drafts_owner_plan_uq').on(table.ownerId, table.planId),
      ownerUpdatedIdx: index('wizard_drafts_owner_updated_idx').on(table.ownerId, table.updatedAt)
    })
  )
);

// ─── UC-44 — Season close-out state machine (#349) ─────────────────────
//
// One row per (owner_id, year). Writing the row "closes" that season: the
// shared `SEASON_CLOSED` gate (lib/server/seasonClose.ts) then refuses any
// record-write dated inside the closed year — the FR-09 lock pattern lifted
// to a whole season. `snapshotJson` captures the preflight state at close
// time (planting resolutions + harvest roll-up + pending count + the
// RULES_VERSION stamp, for provenance only — this is an app-layer gate, not
// a safety-kernel rule, so RULES_VERSION is NOT bumped). Reopen within 7
// days clears the close by stamping `reopenedAt`; past the window the close
// is permanent. Tenant-scoped per CLAUDE.md invariant 6.

export const seasonCloseouts = tenantScoped(
  sqliteTable(
    'season_closeouts',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      year: integer('year').notNull(),
      closedAt: integer('closed_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      closedById: text('closed_by_id').references(() => users.id),
      /** JSON snapshot of the preflight state at close time: planting
       *  resolutions, harvest roll-up, pending count, RULES_VERSION. */
      snapshotJson: text('snapshot_json').notNull(),
      /** Non-null once the close has been reopened (within the 7-day
       *  window). A reopened row is treated as "not closed" by the gate. */
      reopenedAt: integer('reopened_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerYearUq: uniqueIndex('season_closeouts_owner_year_uq').on(table.ownerId, table.year),
      ownerClosedIdx: index('season_closeouts_owner_closed_idx').on(table.ownerId, table.closedAt)
    })
  )
);

// ─── Web Push (NFR-06) ───────────────────────────────────────────────────
//
// One row per (owner, browser push endpoint). Subscriptions belong to a user
// but are scoped to the Owner that was active when the user opted in, so a
// helper serving two farms gets one row per farm and alerts never cross
// tenants. `prefsJson` holds the enabled alert kinds (lib/push/prefs.ts).

export const pushSubscriptions = tenantScoped(
  sqliteTable(
    'push_subscriptions',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      userId: text('user_id')
        .notNull()
        .references(() => users.id),
      endpoint: text('endpoint').notNull(),
      p256dh: text('p256dh').notNull(),
      auth: text('auth').notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
      failureCount: integer('failure_count').notNull().default(0),
      prefsJson: text('prefs_json').notNull().default('{}')
    },
    (table) => ({
      ownerUserIdx: index('push_subscriptions_owner_user_idx').on(table.ownerId, table.userId),
      ownerEndpointUq: uniqueIndex('push_subscriptions_owner_endpoint_uq').on(
        table.ownerId,
        table.endpoint
      )
    })
  )
);

/** Sent-log for scheduled push alerts: the (owner, kind, subject) UNIQUE key
 *  makes every alert fire at most once, across scheduler restarts too. */
export const pushDeliveries = tenantScoped(
  sqliteTable(
    'push_deliveries',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      kind: text('kind', {
        enum: [
          'decon-due',
          'lock-window-closing',
          'spring-calibration',
          'frost-tonight',
          'animal-care-due',
          'withdrawal-clears',
          'hold-covers-sale',
          'weekly-digest'
        ]
      }).notNull(),
      subjectId: text('subject_id').notNull(),
      sentAt: integer('sent_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      recipientCount: integer('recipient_count').notNull().default(0)
    },
    (table) => ({
      ownerKindSubjectUq: uniqueIndex('push_deliveries_owner_kind_subject_uq').on(
        table.ownerId,
        table.kind,
        table.subjectId
      )
    })
  )
);

// ─── Email alert consent (opt-in only) ──────────────────────────────────
//
// Field alerts by email are per (Owner, user, alert kind), like push: a
// helper on two farms opts in per farm, and the alerts are about that farm's
// sprayers and records. No row means off. The opt-in keeps when, where from
// and the client IP as the consent record; an opt-out keeps the row.

export const emailAlertConsents = tenantScoped(
  sqliteTable(
    'email_alert_consents',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      category: text('category', {
        enum: [
          'decon-due',
          'lock-window-closing',
          'spring-calibration',
          'frost-tonight',
          'animal-care-due',
          'withdrawal-clears',
          'hold-covers-sale',
          'weekly-digest'
        ]
      }).notNull(),
      status: text('status', { enum: ['opted-in', 'opted-out'] }).notNull(),
      optedInAt: integer('opted_in_at', { mode: 'timestamp_ms' }),
      optedInSource: text('opted_in_source'),
      optedInIp: text('opted_in_ip'),
      optedOutAt: integer('opted_out_at', { mode: 'timestamp_ms' }),
      optedOutSource: text('opted_out_source'),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerUserCategoryUq: uniqueIndex('email_alert_consents_owner_user_category_uq').on(
        table.ownerId,
        table.userId,
        table.category
      ),
      ownerStatusIdx: index('email_alert_consents_owner_status_idx').on(table.ownerId, table.status)
    })
  )
);

/** Provider-side opt-outs and failures, keyed by address. Global, not tenant
 *  data: Pingram reports them per email address or phone number, and an
 *  unsubscribe from an address holds for every farm that address serves. */
export const contactSuppressions = sqliteTable(
  'contact_suppressions',
  {
    id: text('id').primaryKey(),
    address: text('address').notNull(),
    channel: text('channel', { enum: ['email', 'sms'] }).notNull(),
    reason: text('reason', { enum: ['unsubscribe', 'complaint', 'bounce', 'failed'] }).notNull(),
    source: text('source').notNull(),
    eventId: text('event_id'),
    notificationType: text('notification_type'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    addressChannelReasonTypeUq: uniqueIndex(
      'contact_suppressions_address_channel_reason_type_uq'
    ).on(table.address, table.channel, table.reason, sql`coalesce(${table.notificationType}, '')`)
  })
);

/** In-app feedback (#466). Deliberately global, not `tenantScoped`: triage
 *  is a cross-farm superadmin queue and a signed-in user with no farm yet
 *  can still submit. `owner_id` and `user_id` are context only (no FK, so
 *  the row survives a farm or user going away); every read goes through
 *  `unscopedQueryNote` in `lib/db/feedback.ts`. */
export const feedbackSubmissions = sqliteTable(
  'feedback_submissions',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['bug', 'idea', 'other'] }).notNull(),
    message: text('message').notNull(),
    ownerId: text('owner_id'),
    userId: text('user_id'),
    role: text('role'),
    pagePath: text('page_path'),
    appVersion: text('app_version'),
    userAgent: text('user_agent'),
    status: text('status', {
      enum: ['new', 'triaged', 'in-progress', 'done', 'wont-fix']
    })
      .notNull()
      .default('new'),
    adminNotes: text('admin_notes'),
    githubIssueUrl: text('github_issue_url'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  },
  (table) => ({
    statusCreatedIdx: index('feedback_submissions_status_created_idx').on(
      table.status,
      table.createdAt
    ),
    userIdx: index('feedback_submissions_user_idx').on(table.userId)
  })
);

// ─── Phase 32: animals and pets ─────────────────────────────────────────
//
// Records target either one animal or a group (`subject_type` +
// `subject_id`); the polymorphic id has no FK, so every endpoint resolves it
// through `animalSubjectRef` in `lib/server/foreignRefs.ts`.

export const ANIMAL_SUBJECT_TYPES = ['animal', 'group'] as const;
export const ANIMAL_PURPOSES = ['production', 'pet', 'mixed'] as const;

// @hold-fact (C-35: writes run inside the hold guard)
export const animalGroups = tenantScoped(
  sqliteTable(
    'animal_groups',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      name: text('name').notNull(),
      speciesId: text('species_id').notNull(),
      purpose: text('purpose', { enum: ANIMAL_PURPOSES }).notNull().default('production'),
      /** Unnamed members; tagged individuals are counted from `animals`. */
      headCount: integer('head_count'),
      /** Seeded from the species plugin; only the owner changes it (audited in
       *  `animal_flag_changes`). The kernel reads this OR any active member's
       *  flag, whichever is stricter. */
      foodProducing: integer('food_producing', { mode: 'boolean' }).notNull().default(true),
      housingFieldId: text('housing_field_id').references(() => fields.id, {
        onDelete: 'set null'
      }),
      status: text('status', { enum: ['active', 'archived'] })
        .notNull()
        .default('active'),
      notes: text('notes'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerStatusIdx: index('animal_groups_owner_status_idx').on(table.ownerId, table.status),
      ownerHousingIdx: index('animal_groups_owner_housing_idx').on(
        table.ownerId,
        table.housingFieldId
      )
    })
  )
);

// @hold-fact (C-35: writes run inside the hold guard)
export const animals = tenantScoped(
  sqliteTable(
    'animals',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      groupId: text('group_id').references(() => animalGroups.id, { onDelete: 'set null' }),
      speciesId: text('species_id').notNull(),
      breed: text('breed'),
      name: text('name'),
      tag: text('tag'),
      sex: text('sex', { enum: ['female', 'male', 'neutered-male', 'spayed-female', 'unknown'] })
        .notNull()
        .default('unknown'),
      birthDate: integer('birth_date', { mode: 'timestamp_ms' }),
      birthDateEstimated: integer('birth_date_estimated', { mode: 'boolean' })
        .notNull()
        .default(false),
      acquiredDate: integer('acquired_date', { mode: 'timestamp_ms' }),
      acquiredFrom: text('acquired_from'),
      purpose: text('purpose', { enum: ANIMAL_PURPOSES }).notNull().default('production'),
      /** Seeded from the species plugin; only the owner changes it, and each
       *  change writes `animal_flag_changes`. Defaults to the safe side. */
      foodProducing: integer('food_producing', { mode: 'boolean' }).notNull().default(true),
      notForSlaughter: integer('not_for_slaughter', { mode: 'boolean' }).notNull().default(false),
      status: text('status', {
        enum: ['active', 'sold', 'died', 'culled', 'rehomed', 'slaughtered', 'archived']
      })
        .notNull()
        .default('active'),
      statusDate: integer('status_date', { mode: 'timestamp_ms' }),
      statusReason: text('status_reason'),
      housingFieldId: text('housing_field_id').references(() => fields.id, {
        onDelete: 'set null'
      }),
      photoRef: text('photo_ref'),
      /** Phase 33A: the photo in the vault. No SQL FK (A-05). */
      photoDocumentId: text('photo_document_id'),
      notes: text('notes'),
      /** 32D (D2-12): shown on a pet's Animal Card. Free text, owner-typed. */
      microchipId: text('microchip_id'),
      /** 32D (D2-12): "1 cup twice a day", shown on a pet's Animal Card. */
      feedingNote: text('feeding_note'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerStatusIdx: index('animals_owner_status_idx').on(table.ownerId, table.status),
      ownerGroupIdx: index('animals_owner_group_idx').on(table.ownerId, table.groupId),
      ownerHousingIdx: index('animals_owner_housing_idx').on(table.ownerId, table.housingFieldId)
    })
  )
);

// @hold-fact (C-35: writes run inside the hold guard)
/** Where a subject lived and when. `to_ms` is null for the current stay. */
export const animalLocations = tenantScoped(
  sqliteTable(
    'animal_locations',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      subjectType: text('subject_type', { enum: ANIMAL_SUBJECT_TYPES }).notNull(),
      subjectId: text('subject_id').notNull(),
      fieldId: text('field_id')
        .notNull()
        .references(() => fields.id, { onDelete: 'cascade' }),
      fromMs: integer('from_ms', { mode: 'timestamp_ms' }).notNull(),
      toMs: integer('to_ms', { mode: 'timestamp_ms' }),
      movedBy: text('moved_by').references(() => users.id),
      /** The group this stay began by leaving (an individual taken out of a
       *  flock, or a group split off another). */
      fromGroupId: text('from_group_id').references(() => animalGroups.id, {
        onDelete: 'set null'
      }),
      /** The group the subject joined when this stay ended. */
      toGroupId: text('to_group_id').references(() => animalGroups.id, { onDelete: 'set null' }),
      clientRecordId: text('client_record_id'),
      /** RULES_VERSION when the grazing gate ran on the move that opened
       *  this stay; null for moves the gate never saw. */
      rulesVersion: text('rules_version'),
      /** The dated exposure holds the gate found when the move was saved,
       *  kept as a floor so a later data or rules change cannot shorten
       *  them (JSON, `ExposureFloor`). */
      exposureFloor: text('exposure_floor'),
      /** C-35: when the end of this stay was written (a move off, a leave,
       *  a status), for the "recorded <date>" history line. */
      toRecordedAt: integer('to_recorded_at', { mode: 'timestamp_ms' }),
      /** C-35: an undone move leaves a tombstone; its exposure still counts. */
      deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
      deletedBy: text('deleted_by'),
      /** C-35 §5: an owner void of a fresh mistake. A voided stay no longer
       *  counts; `hold_corrections` keeps the diff. */
      voidReason: text('void_reason'),
      voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerSubjectFromIdx: index('animal_locations_owner_subject_from_idx').on(
        table.ownerId,
        table.subjectType,
        table.subjectId,
        table.fromMs
      ),
      ownerFieldFromIdx: index('animal_locations_owner_field_from_idx').on(
        table.ownerId,
        table.fieldId,
        table.fromMs
      )
    })
  )
);

// @hold-fact (C-35: writes run inside the hold guard)
/** Treatments, vaccinations, deworms, vet visits, injuries and notes.
 *  `withdrawal_clear` is the kernel's verdict at write time (JSON of
 *  per-product clear times), stored with `rules_version` like spray records.
 *  Food-producing treatments lock under FR-09 using the stricter of
 *  `food_producing_at_record` and the subject's current flag. */
export const animalHealthEvents = tenantScoped(
  sqliteTable(
    'animal_health_events',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      subjectType: text('subject_type', { enum: ANIMAL_SUBJECT_TYPES }).notNull(),
      subjectId: text('subject_id').notNull(),
      kind: text('kind', {
        enum: ['treatment', 'vaccination', 'deworm', 'vet-visit', 'injury', 'note']
      }).notNull(),
      productPluginId: text('product_plugin_id'),
      productName: text('product_name'),
      /** C-13, C-34: JSON array of the stock bottle's name and active
       *  ingredients, kept apart from the typed name so the prohibited-drug
       *  match reads both. */
      stockProductText: text('stock_product_text'),
      stockItemId: text('stock_item_id').references(() => stockItems.id, { onDelete: 'set null' }),
      lotNumber: text('lot_number'),
      dose: real('dose'),
      doseUnit: text('dose_unit'),
      route: text('route'),
      administeredAt: integer('administered_at', { mode: 'timestamp_ms' }).notNull(),
      courseEndAt: integer('course_end_at', { mode: 'timestamp_ms' }),
      labelUse: text('label_use', { enum: ['label', 'extra-label-vet', 'unknown'] }),
      vetName: text('vet_name'),
      /** JSON of per-product withdrawal the vet directed; can only lengthen. */
      vetDirectedWithdrawal: text('vet_directed_withdrawal'),
      /** C-35: the hold parameters (label intervals) read when this was
       *  recorded. A later data change can only lengthen the hold: the
       *  kernels take the longer of this snapshot and the current data. */
      holdParamsJson: text('hold_params_json'),
      withdrawalClear: text('withdrawal_clear'),
      rulesVersion: text('rules_version'),
      foodProducingAtRecord: integer('food_producing_at_record', { mode: 'boolean' }).notNull(),
      notes: text('notes'),
      performedById: text('performed_by_id').references(() => users.id),
      clientRecordId: text('client_record_id'),
      /** C-35: saved more than 48 hours after the date it records
       *  ("Entered N days late"). A label only; no gate reads it. */
      recordedLate: integer('recorded_late', { mode: 'boolean' }).notNull().default(false),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerSubjectAdministeredIdx: index('animal_health_events_owner_subject_admin_idx').on(
        table.ownerId,
        table.subjectType,
        table.subjectId,
        table.administeredAt
      ),
      ownerAdministeredIdx: index('animal_health_events_owner_admin_idx').on(
        table.ownerId,
        table.administeredAt
      )
    })
  )
);

// @hold-fact (C-35: writes run inside the hold guard)
export const animalProductionLogs = tenantScoped(
  sqliteTable(
    'animal_production_logs',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      subjectType: text('subject_type', { enum: ANIMAL_SUBJECT_TYPES }).notNull(),
      subjectId: text('subject_id').notNull(),
      kind: text('kind', { enum: ['eggs', 'milk', 'weight'] }).notNull(),
      quantity: real('quantity').notNull(),
      unit: text('unit').notNull(),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      use: text('use', {
        enum: ['food', 'sale', 'discard', 'feed-to-animals', 'unknown']
      }).notNull(),
      /** C-06: the strongest food or sale use this log was ever saved as.
       *  A later change to discard never lowers it. */
      declaredUse: text('declared_use', { enum: ['food', 'sale'] }),
      rulesVersion: text('rules_version'),
      performedById: text('performed_by_id').references(() => users.id),
      clientRecordId: text('client_record_id'),
      /** C-35: saved more than 48 hours after the date it records
       *  ("Entered N days late"). A label only; no gate reads it. */
      recordedLate: integer('recorded_late', { mode: 'boolean' }).notNull().default(false),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerSubjectOccurredIdx: index('animal_production_logs_owner_subject_occurred_idx').on(
        table.ownerId,
        table.subjectType,
        table.subjectId,
        table.occurredAt
      )
    })
  )
);

// @hold-fact (C-35: writes run inside the hold guard)
/** Sold, died, culled, rehomed and slaughter changes. A group row may carry
 *  a `head_count_delta` for unnamed members leaving the flock. */
export const animalStatusEvents = tenantScoped(
  sqliteTable(
    'animal_status_events',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      subjectType: text('subject_type', { enum: ANIMAL_SUBJECT_TYPES }).notNull(),
      subjectId: text('subject_id').notNull(),
      status: text('status', {
        enum: ['active', 'sold', 'sold-for-meat', 'slaughtered', 'died', 'culled', 'rehomed']
      }).notNull(),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      reason: text('reason'),
      headCountDelta: integer('head_count_delta'),
      rulesVersion: text('rules_version'),
      recordedById: text('recorded_by_id').references(() => users.id),
      clientRecordId: text('client_record_id'),
      /** C-35: saved more than 48 hours after the date it records
       *  ("Entered N days late"). A label only; no gate reads it. */
      recordedLate: integer('recorded_late', { mode: 'boolean' }).notNull().default(false),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerSubjectOccurredIdx: index('animal_status_events_owner_subject_occurred_idx').on(
        table.ownerId,
        table.subjectType,
        table.subjectId,
        table.occurredAt
      )
    })
  )
);

// @hold-fact (C-35: writes run inside the hold guard)
/** Owner-recorded grazing and haying intervals read from a label, which lift
 *  a `GRAZING_UNKNOWN` block for exactly the attested interval. */
export const grazingAttestations = tenantScoped(
  sqliteTable(
    'grazing_attestations',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      fieldId: text('field_id')
        .notNull()
        .references(() => fields.id, { onDelete: 'cascade' }),
      productPluginId: text('product_plugin_id'),
      /** `<spray|insecticide|fungicide>:<event id>` of the application. */
      sprayEventRef: text('spray_event_ref'),
      grazeDays: integer('graze_days'),
      hayDays: integer('hay_days'),
      /** The label's lactating dairy grazing interval (C-25). */
      lactatingGrazeDays: integer('lactating_graze_days'),
      /** The label's meat-animal removal before slaughter. */
      meatRemovalDays: integer('meat_removal_days'),
      reason: text('reason').notNull(),
      provenance: text('provenance', { enum: ['manual'] })
        .notNull()
        .default('manual'),
      attestedBy: text('attested_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerFieldIdx: index('grazing_attestations_owner_field_idx').on(
        table.ownerId,
        table.fieldId,
        table.createdAt
      )
    })
  )
);

// @hold-fact (C-35: writes run inside the hold guard)
/**
 * C-35 §5: the only way a hold can shorten is an interactive owner voiding
 * a fresh mistake (within 48 hours of entry). Each void writes one row:
 * who, why, the full hold diff and its SHA-256, so the correction is on
 * record for exports and the hash chain.
 */
export const holdCorrections = tenantScoped(
  sqliteTable(
    'hold_corrections',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      recordKind: text('record_kind').notNull(),
      recordId: text('record_id').notNull(),
      userId: text('user_id').references(() => users.id),
      reason: text('reason').notNull(),
      diffJson: text('diff_json').notNull(),
      diffHash: text('diff_hash').notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerCreatedIdx: index('hold_corrections_owner_created_idx').on(
        table.ownerId,
        table.createdAt
      ),
      ownerRecordIdx: index('hold_corrections_owner_record_idx').on(
        table.ownerId,
        table.recordKind,
        table.recordId
      )
    })
  )
);

/** Audit of `food_producing` and horse "not for slaughter" changes. */
export const animalFlagChanges = tenantScoped(
  sqliteTable(
    'animal_flag_changes',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      subjectType: text('subject_type', { enum: ANIMAL_SUBJECT_TYPES }).notNull(),
      subjectId: text('subject_id').notNull(),
      flag: text('flag', {
        enum: ['food_producing', 'not_for_slaughter', 'presumed_lactating']
      }).notNull(),
      oldValue: integer('old_value', { mode: 'boolean' }),
      newValue: integer('new_value', { mode: 'boolean' }).notNull(),
      reason: text('reason').notNull(),
      changedBy: text('changed_by').references(() => users.id),
      changedAt: integer('changed_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerSubjectChangedIdx: index('animal_flag_changes_owner_subject_changed_idx').on(
        table.ownerId,
        table.subjectType,
        table.subjectId,
        table.changedAt
      )
    })
  )
);

/** Recurring (`interval_days`) or one-off (`once_on`) care that materializes
 *  into `tasks` with category `animal-care`, deduped by plan and due date. */
export const animalCarePlans = tenantScoped(
  sqliteTable(
    'animal_care_plans',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      subjectType: text('subject_type', { enum: ANIMAL_SUBJECT_TYPES }).notNull(),
      subjectId: text('subject_id').notNull(),
      kind: text('kind', {
        enum: [
          'vaccination',
          'deworm',
          'treatment',
          'vet-visit',
          'hoof-trim',
          'grooming',
          'shearing',
          'health-check',
          'other'
        ]
      }).notNull(),
      title: text('title').notNull(),
      productPluginId: text('product_plugin_id'),
      intervalDays: integer('interval_days'),
      onceOn: integer('once_on', { mode: 'timestamp_ms' }),
      nextDueAt: integer('next_due_at', { mode: 'timestamp_ms' }),
      leadDays: integer('lead_days').notNull().default(0),
      active: integer('active', { mode: 'boolean' }).notNull().default(true),
      provenance: text('provenance', { enum: ['plugin', 'manual', 'fallback'] }).notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerActiveDueIdx: index('animal_care_plans_owner_active_due_idx').on(
        table.ownerId,
        table.active,
        table.nextDueAt
      ),
      ownerSubjectIdx: index('animal_care_plans_owner_subject_idx').on(
        table.ownerId,
        table.subjectType,
        table.subjectId
      )
    })
  )
);

// ─── Phase 32E: growing season helpers ──────────────────────────────────

/** One row per seed-starting tray. */
export const seedStarts = tenantScoped(
  sqliteTable(
    'seed_starts',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      cropId: text('crop_id')
        .notNull()
        .references(() => crops.id, { onDelete: 'cascade' }),
      sownAt: integer('sown_at', { mode: 'timestamp_ms' }).notNull(),
      trayLabel: text('tray_label'),
      cells: integer('cells'),
      seedsPerCell: integer('seeds_per_cell'),
      locationAreaId: text('location_area_id').references(() => fields.id, {
        onDelete: 'set null'
      }),
      locationText: text('location_text'),
      stockLotId: text('stock_lot_id').references(() => stockLots.id, { onDelete: 'set null' }),
      germinatedCount: integer('germinated_count'),
      germinatedAt: integer('germinated_at', { mode: 'timestamp_ms' }),
      hardenStartedAt: integer('harden_started_at', { mode: 'timestamp_ms' }),
      transplantedAt: integer('transplanted_at', { mode: 'timestamp_ms' }),
      performedById: text('performed_by_id').references(() => users.id),
      clientRecordId: text('client_record_id'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerCropIdx: index('seed_starts_owner_crop_idx').on(table.ownerId, table.cropId),
      ownerSownIdx: index('seed_starts_owner_sown_idx').on(table.ownerId, table.sownAt)
    })
  )
);

/** Season-extension covers per bed. Shifts apply to planning windows only;
 *  stacked covers take the largest shift. */
export const blockProtections = tenantScoped(
  sqliteTable(
    'block_protections',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id, { onDelete: 'cascade' }),
      kind: text('kind', {
        enum: [
          'row-cover',
          'low-tunnel',
          'caterpillar-tunnel',
          'high-tunnel',
          'cold-frame',
          'cloche',
          'greenhouse-unheated',
          'greenhouse-heated',
          'other'
        ]
      }).notNull(),
      springShiftDays: integer('spring_shift_days'),
      fallShiftDays: integer('fall_shift_days'),
      provenance: text('provenance', { enum: ['plugin', 'data', 'manual', 'fallback'] }).notNull(),
      installedOn: integer('installed_on', { mode: 'timestamp_ms' }),
      removedOn: integer('removed_on', { mode: 'timestamp_ms' }),
      seasonYear: integer('season_year'),
      notes: text('notes'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerBlockIdx: index('block_protections_owner_block_idx').on(table.ownerId, table.blockId)
    })
  )
);

/** A light watering log: no lock, not a compliance record, never pruned. */
export const irrigationEvents = tenantScoped(
  sqliteTable(
    'irrigation_events',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      fieldId: text('field_id')
        .notNull()
        .references(() => fields.id, { onDelete: 'cascade' }),
      blockId: text('block_id').references(() => blocks.id, { onDelete: 'set null' }),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      durationMin: integer('duration_min'),
      inches: real('inches'),
      gallons: real('gallons'),
      method: text('method', {
        enum: ['drip', 'soaker', 'sprinkler', 'hand', 'flood', 'other']
      }),
      notes: text('notes'),
      performedById: text('performed_by_id').references(() => users.id),
      clientRecordId: text('client_record_id'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerFieldOccurredIdx: index('irrigation_events_owner_field_occurred_idx').on(
        table.ownerId,
        table.fieldId,
        table.occurredAt
      )
    })
  )
);

/** A manual rain-gauge reading, which overrides station rain for its Area. */
export const rainGaugeReadings = tenantScoped(
  sqliteTable(
    'rain_gauge_readings',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      fieldId: text('field_id')
        .notNull()
        .references(() => fields.id, { onDelete: 'cascade' }),
      readAt: integer('read_at', { mode: 'timestamp_ms' }).notNull(),
      inches: real('inches').notNull(),
      recordedById: text('recorded_by_id').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerFieldReadIdx: index('rain_gauge_readings_owner_field_read_idx').on(
        table.ownerId,
        table.fieldId,
        table.readAt
      )
    })
  )
);

// ─── Phase 32F: farm operations ─────────────────────────────────────────

/** Minutes recorded on Done. Crop, block and field are copied from the task
 *  so season hours survive the task being deleted. */
export const taskTimeEntries = tenantScoped(
  sqliteTable(
    'task_time_entries',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
      userId: text('user_id').references(() => users.id),
      cropId: text('crop_id').references(() => crops.id, { onDelete: 'set null' }),
      blockId: text('block_id').references(() => blocks.id, { onDelete: 'set null' }),
      fieldId: text('field_id').references(() => fields.id, { onDelete: 'set null' }),
      startedAt: integer('started_at', { mode: 'timestamp_ms' }),
      minutes: integer('minutes').notNull(),
      source: text('source', { enum: ['task-close', 'manual', 'timer'] })
        .notNull()
        .default('task-close'),
      note: text('note'),
      clientRecordId: text('client_record_id'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerTaskIdx: index('task_time_entries_owner_task_idx').on(table.ownerId, table.taskId),
      ownerCropIdx: index('task_time_entries_owner_crop_idx').on(table.ownerId, table.cropId),
      ownerUserCreatedIdx: index('task_time_entries_owner_user_created_idx').on(
        table.ownerId,
        table.userId,
        table.createdAt
      )
    })
  )
);

/** Owner-only expenses and income. No lock; `deleted_at` is a soft delete. */
export const ledgerEntries = tenantScoped(
  sqliteTable(
    'ledger_entries',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      kind: text('kind', { enum: ['expense', 'income'] }).notNull(),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      amountCents: integer('amount_cents').notNull(),
      category: text('category'),
      description: text('description'),
      cropId: text('crop_id').references(() => crops.id, { onDelete: 'set null' }),
      blockId: text('block_id').references(() => blocks.id, { onDelete: 'set null' }),
      fieldId: text('field_id').references(() => fields.id, { onDelete: 'set null' }),
      animalId: text('animal_id').references(() => animals.id, { onDelete: 'set null' }),
      animalGroupId: text('animal_group_id').references(() => animalGroups.id, {
        onDelete: 'set null'
      }),
      stockLotId: text('stock_lot_id').references(() => stockLots.id, { onDelete: 'set null' }),
      harvestEventId: text('harvest_event_id').references(() => harvestEvents.id, {
        onDelete: 'set null'
      }),
      enterprise: text('enterprise'),
      quantity: real('quantity'),
      unit: text('unit'),
      provenance: text('provenance', { enum: ['manual', 'data'] })
        .notNull()
        .default('manual'),
      createdById: text('created_by_id').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      deletedAt: integer('deleted_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerOccurredIdx: index('ledger_entries_owner_occurred_idx').on(
        table.ownerId,
        table.occurredAt
      ),
      ownerCropIdx: index('ledger_entries_owner_crop_idx').on(table.ownerId, table.cropId),
      ownerStockLotIdx: index('ledger_entries_owner_stock_lot_idx').on(
        table.ownerId,
        table.stockLotId
      )
    })
  )
);

export const LEDGER_CHANGE_ACTIONS = ['create', 'update', 'delete', 'restore'] as const;

/** F2-9: every change to a ledger entry, written in the same transaction.
 *  Owner-only like the ledger itself; never in `record_deletions`, which
 *  helpers and inspectors can read. */
export const ledgerEntryChanges = tenantScoped(
  sqliteTable(
    'ledger_entry_changes',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      entryId: text('entry_id')
        .notNull()
        .references(() => ledgerEntries.id, { onDelete: 'cascade' }),
      action: text('action', { enum: LEDGER_CHANGE_ACTIONS }).notNull(),
      changedById: text('changed_by_id').references(() => users.id),
      changedAt: integer('changed_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      beforeJson: text('before_json'),
      afterJson: text('after_json')
    },
    (table) => ({
      ownerEntryIdx: index('ledger_entry_changes_owner_entry_idx').on(
        table.ownerId,
        table.entryId,
        table.changedAt
      )
    })
  )
);

// ─── Phase 33A: document vault ──────────────────────────────────────────

export const DOCUMENT_KINDS = [
  'lab-report',
  'certificate',
  'label',
  'receipt',
  'seed-search',
  'forage-test',
  'photo',
  'other',
  'journal-photo',
  'animal-photo'
] as const;
export const PHOTO_DOCUMENT_KINDS = ['journal-photo', 'animal-photo'] as const;
export const DOCUMENT_SUBJECT_TYPES = [
  'soil-test',
  'stock-lot',
  'animal',
  'animal-group',
  'animal-health',
  'field',
  'block',
  'harvest-event',
  'ledger-entry',
  'organic-status',
  'amendment-batch',
  'forage-test',
  'farm'
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type DocumentSubjectType = (typeof DOCUMENT_SUBJECT_TYPES)[number];

/** A stored file. Bytes live in the vault under `storage_key`
 *  (`owners/<ownerId>/<id>`); a deleted row keeps its metadata (V-12). */
export const documents = tenantScoped(
  sqliteTable(
    'documents',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      kind: text('kind', { enum: DOCUMENT_KINDS }).notNull(),
      title: text('title').notNull(),
      mime: text('mime').notNull(),
      byteSize: integer('byte_size').notNull(),
      sha256: text('sha256').notNull(),
      crc32: integer('crc32').notNull(),
      storageKey: text('storage_key').notNull(),
      originalName: text('original_name'),
      uploadedBy: text('uploaded_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
      deletedBy: text('deleted_by').references(() => users.id)
    },
    (table) => ({
      ownerKindCreatedIdx: index('documents_owner_kind_created_idx').on(
        table.ownerId,
        table.kind,
        table.createdAt
      ),
      ownerDeletedIdx: index('documents_owner_deleted_idx').on(table.ownerId, table.deletedAt),
      storageKeyUq: uniqueIndex('documents_storage_key_uq').on(table.storageKey)
    })
  )
);

/** Attaches a document to a subject. `farm` links use the Owner id. */
export const documentLinks = tenantScoped(
  sqliteTable(
    'document_links',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      documentId: text('document_id')
        .notNull()
        .references(() => documents.id, { onDelete: 'cascade' }),
      subjectType: text('subject_type', { enum: DOCUMENT_SUBJECT_TYPES }).notNull(),
      subjectId: text('subject_id').notNull(),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerDocSubjectUq: uniqueIndex('document_links_owner_doc_subject_uq').on(
        table.ownerId,
        table.documentId,
        table.subjectType,
        table.subjectId
      ),
      ownerSubjectIdx: index('document_links_owner_subject_idx').on(
        table.ownerId,
        table.subjectType,
        table.subjectId
      )
    })
  )
);

/** Operations queue of storage prefixes to delete (farm wipes). Global:
 *  read only by `runDbMaintenance`, holds no farm data beyond the prefix,
 *  and is not in the GDPR export. */
export const blobDeletions = sqliteTable('blob_deletions', {
  storagePrefix: text('storage_prefix').primaryKey(),
  requestedAt: integer('requested_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error')
});

// ─── Phase 33B: organic records ─────────────────────────────────────────

export const ORGANIC_SUBJECT_TYPES = ['field', 'block', 'animal', 'group'] as const;
export const ORGANIC_STATUSES = ['organic', 'transitioning', 'not-organic'] as const;
export const SEED_ORGANIC_STATUSES = ['organic', 'untreated', 'treated', 'unknown'] as const;
export const HARVEST_DISPOSITION_KINDS = ['sold', 'kept', 'donated', 'discarded'] as const;

/** Owner-entered organic status history. Append-only; the current status is
 *  the latest `effective_at`, then the latest `created_at`. */
export const organicStatusEvents = tenantScoped(
  sqliteTable(
    'organic_status_events',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      subjectType: text('subject_type', { enum: ORGANIC_SUBJECT_TYPES }).notNull(),
      subjectId: text('subject_id').notNull(),
      status: text('status', { enum: ORGANIC_STATUSES }).notNull(),
      effectiveAt: integer('effective_at', { mode: 'timestamp_ms' }).notNull(),
      certifier: text('certifier'),
      note: text('note'),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerSubjectEffectiveIdx: index('organic_status_events_owner_subject_effective_idx').on(
        table.ownerId,
        table.subjectType,
        table.subjectId,
        table.effectiveAt
      )
    })
  )
);

/** The owner's answer on whether one treatment ends an organic status. */
export const organicTreatmentReviews = tenantScoped(
  sqliteTable(
    'organic_treatment_reviews',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      healthEventId: text('health_event_id')
        .notNull()
        .references(() => animalHealthEvents.id, { onDelete: 'cascade' }),
      outcome: text('outcome', { enum: ['status-lost', 'not-affected'] }).notNull(),
      reason: text('reason').notNull(),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerHealthEventUq: uniqueIndex('organic_treatment_reviews_owner_health_event_uq').on(
        table.ownerId,
        table.healthEventId
      )
    })
  )
);

/** Where a harvest went. Takes the FR-09 lock and tombstones; never a hold
 *  fact. `sold_as_organic` is set only for `sold`. */
export const harvestDispositions = tenantScoped(
  sqliteTable(
    'harvest_dispositions',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      harvestEventId: text('harvest_event_id')
        .notNull()
        .references(() => harvestEvents.id, { onDelete: 'cascade' }),
      kind: text('kind', { enum: HARVEST_DISPOSITION_KINDS }).notNull(),
      quantityHundredths: integer('quantity_hundredths').notNull(),
      unit: text('unit').notNull(),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
      recipient: text('recipient'),
      soldAsOrganic: integer('sold_as_organic', { mode: 'boolean' }),
      ledgerEntryId: text('ledger_entry_id').references(() => ledgerEntries.id, {
        onDelete: 'set null'
      }),
      clientRecordId: text('client_record_id'),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      lockedAt: integer('locked_at', { mode: 'timestamp_ms' })
    },
    (table) => ({
      ownerHarvestIdx: index('harvest_dispositions_owner_harvest_idx').on(
        table.ownerId,
        table.harvestEventId
      ),
      ownerOccurredIdx: index('harvest_dispositions_owner_occurred_idx').on(
        table.ownerId,
        table.occurredAt
      )
    })
  )
);

// ─── Phase 33C: manure and compost carryover chain ─────────────────────

export const AMENDMENT_BATCH_KINDS = ['manure', 'compost', 'bedding-pack'] as const;
export const AMENDMENT_INPUT_TYPES = ['animal', 'group', 'batch', 'stock-lot'] as const;
export const SUPPLIER_STATEMENTS = ['says-none', 'unknown', 'none-asked'] as const;
export const NITRATE_UNITS = ['ppm-nitrate', 'ppm-nitrate-n', 'pct-nitrate', 'pct-kno3'] as const;

/** A manure pile, compost batch or bedding pack. `supplier_statement` is for
 *  `origin = bought` batches only. */
export const amendmentBatches = tenantScoped(
  sqliteTable(
    'amendment_batches',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      kind: text('kind', { enum: AMENDMENT_BATCH_KINDS }).notNull(),
      name: text('name').notNull(),
      origin: text('origin', { enum: ['on-farm', 'bought'] }).notNull(),
      supplier: text('supplier'),
      supplierStatement: text('supplier_statement', { enum: SUPPLIER_STATEMENTS }),
      startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
      closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
      notes: text('notes'),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerStartedIdx: index('amendment_batches_owner_started_idx').on(
        table.ownerId,
        table.startedAt
      )
    })
  )
);

/** What went into a batch. `input_id` names an animal, group, batch or stock
 *  lot by `input_type`; it is checked in `foreignRefs.ts`, not by SQL.
 *  `from_at` is the date added for batch and stock-lot inputs. */
export const amendmentBatchInputs = tenantScoped(
  sqliteTable(
    'amendment_batch_inputs',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      batchId: text('batch_id')
        .notNull()
        .references(() => amendmentBatches.id, { onDelete: 'cascade' }),
      inputType: text('input_type', { enum: AMENDMENT_INPUT_TYPES }).notNull(),
      inputId: text('input_id').notNull(),
      fromAt: integer('from_at', { mode: 'timestamp_ms' }).notNull(),
      toAt: integer('to_at', { mode: 'timestamp_ms' }),
      supplierStatement: text('supplier_statement', { enum: SUPPLIER_STATEMENTS }),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerBatchInputUq: uniqueIndex('amendment_batch_inputs_owner_batch_input_uq').on(
        table.ownerId,
        table.batchId,
        table.inputType,
        table.inputId,
        table.fromAt
      ),
      ownerInputIdx: index('amendment_batch_inputs_owner_input_idx').on(
        table.ownerId,
        table.inputType,
        table.inputId
      )
    })
  )
);

/** A bean or pea test on a batch or a block. One of the two is set. */
export const amendmentBioassays = tenantScoped(
  sqliteTable(
    'amendment_bioassays',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      batchId: text('batch_id').references(() => amendmentBatches.id, { onDelete: 'cascade' }),
      blockId: text('block_id').references(() => blocks.id, { onDelete: 'cascade' }),
      testedAt: integer('tested_at', { mode: 'timestamp_ms' }).notNull(),
      result: text('result', { enum: ['no-damage', 'damage'] }).notNull(),
      note: text('note'),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerBlockIdx: index('amendment_bioassays_owner_block_idx').on(table.ownerId, table.blockId),
      ownerBatchIdx: index('amendment_bioassays_owner_batch_idx').on(table.ownerId, table.batchId)
    })
  )
);

/** The owner dismissing an after-spread carryover line, with a reason (M-08). */
export const amendmentDismissals = tenantScoped(
  sqliteTable(
    'amendment_dismissals',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      fertilityApplicationId: text('fertility_application_id')
        .notNull()
        .references(() => fertilityApplications.id, { onDelete: 'cascade' }),
      blockId: text('block_id')
        .notNull()
        .references(() => blocks.id, { onDelete: 'cascade' }),
      reason: text('reason').notNull(),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerBlockIdx: index('amendment_dismissals_owner_block_idx').on(table.ownerId, table.blockId)
    })
  )
);

/** A forage lab result on a block, hay cutting or feed lot (one is set,
 *  checked in Zod and the repo). The lab's rating wins as `manual`. */
export const forageTests = tenantScoped(
  sqliteTable(
    'forage_tests',
    {
      id: text('id').primaryKey(),
      ownerId: text('owner_id').notNull(),
      blockId: text('block_id').references(() => blocks.id, { onDelete: 'cascade' }),
      hayCuttingId: text('hay_cutting_id').references(() => hayCuttings.id, {
        onDelete: 'cascade'
      }),
      stockLotId: text('stock_lot_id').references(() => stockLots.id, { onDelete: 'cascade' }),
      sampledAt: integer('sampled_at', { mode: 'timestamp_ms' }).notNull(),
      lab: text('lab'),
      nitrateValueHundredths: integer('nitrate_value_hundredths'),
      nitrateUnits: text('nitrate_units', { enum: NITRATE_UNITS }),
      hcnPpmHundredths: integer('hcn_ppm_hundredths'),
      labRatingJson: text('lab_rating_json'),
      documentId: text('document_id').references(() => documents.id, { onDelete: 'set null' }),
      provenance: text('provenance', { enum: ['manual', 'ai', 'fallback'] })
        .notNull()
        .default('manual'),
      createdBy: text('created_by').references(() => users.id),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (table) => ({
      ownerBlockIdx: index('forage_tests_owner_block_idx').on(table.ownerId, table.blockId),
      ownerSampledIdx: index('forage_tests_owner_sampled_idx').on(table.ownerId, table.sampledAt)
    })
  )
);
