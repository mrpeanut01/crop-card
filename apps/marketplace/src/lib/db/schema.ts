/**
 * Drizzle schema for the standalone plugin marketplace.
 *
 * Six tables, all single-tenant (the marketplace is a global catalog,
 * not multi-org). Trust is captured per credential via `trustLevel`.
 *
 * - `app_credentials`     — Bearer tokens issued to consuming apps.
 * - `plugin_listings`     — one row per pluginId; tracks latest approved.
 * - `plugin_versions`     — append-only history of every uploaded version.
 * - `admin_users`         — magic-link allowlist for the admin UI.
 * - `admin_login_tokens`  — short-lived single-use login tokens.
 * - `audit_log`           — every mutation (uploads, approvals, revocations).
 *
 * No tenant scoping — see CLAUDE.md invariant 6 (that applies to apps/web).
 * Trust gating is enforced in server code via `trustLevel` on the calling
 * credential plus `reviewStatus` on the version row.
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch() * 1000)`;

// ─── App credentials (Bearer tokens for consuming apps) ─────────────────

export const appCredentials = sqliteTable(
  'app_credentials',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    trustLevel: text('trust_level', { enum: ['trusted', 'community'] })
      .notNull()
      .default('community'),
    /** sha256(plaintext). Plaintext is shown to the operator once on issuance
     *  and never persisted. Lookups are constant-time by hash. */
    credentialHash: text('credential_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    requestCount: integer('request_count').notNull().default(0),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
  },
  (t) => ({
    credHashIdx: uniqueIndex('app_credentials_hash_idx').on(t.credentialHash)
  })
);

// ─── Plugin listings (one row per pluginId) ──────────────────────────────

export const pluginListings = sqliteTable(
  'plugin_listings',
  {
    pluginId: text('plugin_id').primaryKey(),
    type: text('type', {
      enum: ['crop', 'herbicide', 'insecticide', 'fungicide', 'fertilizer', 'companion']
    }).notNull(),
    displayName: text('display_name').notNull(),
    /** Latest version with `reviewStatus = 'approved'`. NULL until first approval. */
    latestApprovedVersion: text('latest_approved_version'),
    latestApprovedHash: text('latest_approved_hash'),
    /** The credential that first uploaded this pluginId. */
    sourceCredentialId: text('source_credential_id').references(() => appCredentials.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now)
  },
  (t) => ({
    typeIdx: index('plugin_listings_type_idx').on(t.type),
    updatedAtIdx: index('plugin_listings_updated_idx').on(t.updatedAt)
  })
);

// ─── Plugin versions (append-only history) ──────────────────────────────

export const pluginVersions = sqliteTable(
  'plugin_versions',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    version: text('version').notNull(),
    /** sha256 of canonical-JSON(payload). Powers content-addressed fetch. */
    hash: text('hash').notNull(),
    /** Full plugin JSON as text. Single-tenant catalog — fine to inline. */
    payload: text('payload').notNull(),
    uploadedAt: integer('uploaded_at', { mode: 'timestamp_ms' }).notNull().default(now),
    uploadedByCredentialId: text('uploaded_by_credential_id')
      .notNull()
      .references(() => appCredentials.id),
    reviewStatus: text('review_status', {
      enum: ['approved', 'pending_review', 'rejected']
    })
      .notNull()
      .default('pending_review'),
    reviewedByAdminId: text('reviewed_by_admin_id').references(() => adminUsers.id),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    reviewNotes: text('review_notes'),
    /** JSON blob of scan results (ClamAV verdict, injection flags, etc.) per Sub-task E. */
    scanResults: text('scan_results')
  },
  (t) => ({
    pluginIdIdx: index('plugin_versions_plugin_id_idx').on(t.pluginId),
    pluginHashIdx: uniqueIndex('plugin_versions_plugin_hash_idx').on(t.pluginId, t.hash),
    statusIdx: index('plugin_versions_status_idx').on(t.reviewStatus)
  })
);

// ─── Admin users (operator allowlist for the admin UI) ──────────────────

export const adminUsers = sqliteTable(
  'admin_users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' })
  },
  (t) => ({
    emailIdx: uniqueIndex('admin_users_email_idx').on(t.email)
  })
);

// ─── Admin login tokens (single-use magic links) ────────────────────────

export const adminLoginTokens = sqliteTable(
  'admin_login_tokens',
  {
    id: text('id').primaryKey(),
    /** sha256(plaintext token). Plaintext only travels via the magic-link URL. */
    tokenHash: text('token_hash').notNull(),
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => adminUsers.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    redeemedAt: integer('redeemed_at', { mode: 'timestamp_ms' })
  },
  (t) => ({
    tokenHashIdx: uniqueIndex('admin_login_tokens_hash_idx').on(t.tokenHash)
  })
);

// ─── Audit log (every mutation, append-only) ────────────────────────────

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorType: text('actor_type', { enum: ['app', 'admin', 'system'] }).notNull(),
    /** appCredentials.id or adminUsers.id or null for 'system'. */
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetTable: text('target_table'),
    targetId: text('target_id'),
    /** Free-form JSON for diffs / scan reasons / reject notes. */
    payload: text('payload'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
  },
  (t) => ({
    actorIdx: index('audit_log_actor_idx').on(t.actorType, t.actorId),
    createdAtIdx: index('audit_log_created_idx').on(t.createdAt)
  })
);
