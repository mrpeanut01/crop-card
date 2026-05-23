/**
 * Admin review actions for pending plugin versions. Both approve and
 * reject write to plugin_versions, update the listing if appropriate,
 * and emit an audit_log row.
 */

import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { appCredentials, pluginListings, pluginVersions } from '$lib/db/schema';
import { audit } from './audit';

export type TrustLevel = 'trusted' | 'community';

export interface PendingVersionRow {
  id: string;
  pluginId: string;
  version: string;
  hash: string;
  type: string | null;
  displayName: string | null;
  uploadedAt: number;
  uploadedByCredentialId: string;
  uploadedByLabel: string | null;
  uploadedByTrustLevel: TrustLevel | null;
  scanResults: unknown;
  payload: unknown;
  currentApprovedVersion: string | null;
  currentApprovedHash: string | null;
}

export function listPendingVersions(): PendingVersionRow[] {
  const db = getDb();
  const rows = db
    .select({
      v: pluginVersions,
      l: pluginListings,
      c: appCredentials
    })
    .from(pluginVersions)
    .leftJoin(pluginListings, eq(pluginListings.pluginId, pluginVersions.pluginId))
    .leftJoin(appCredentials, eq(appCredentials.id, pluginVersions.uploadedByCredentialId))
    .where(eq(pluginVersions.reviewStatus, 'pending_review'))
    .orderBy(desc(pluginVersions.uploadedAt))
    .all();
  return rows.map(({ v, l, c }) => ({
    id: v.id,
    pluginId: v.pluginId,
    version: v.version,
    hash: v.hash,
    type: l?.type ?? null,
    displayName: l?.displayName ?? null,
    uploadedAt: v.uploadedAt.getTime(),
    uploadedByCredentialId: v.uploadedByCredentialId,
    uploadedByLabel: c?.label ?? null,
    uploadedByTrustLevel: c?.trustLevel ?? null,
    scanResults: safeParse(v.scanResults),
    payload: safeParse(v.payload),
    currentApprovedVersion: l?.latestApprovedVersion ?? null,
    currentApprovedHash: l?.latestApprovedHash ?? null
  }));
}

export function approveVersion(input: {
  versionId: string;
  adminUserId: string;
  notes?: string;
}): { ok: boolean; reason?: string } {
  const db = getDb();
  const row = db.select().from(pluginVersions).where(eq(pluginVersions.id, input.versionId)).get();
  if (!row) return { ok: false, reason: 'unknown version' };
  if (row.reviewStatus !== 'pending_review') {
    return { ok: false, reason: `version is ${row.reviewStatus}, not pending_review` };
  }
  const now = new Date();
  db.update(pluginVersions)
    .set({
      reviewStatus: 'approved',
      reviewedByAdminId: input.adminUserId,
      reviewedAt: now,
      reviewNotes: input.notes ?? null
    })
    .where(eq(pluginVersions.id, input.versionId))
    .run();
  // If this version is newer than the current approved, promote.
  const listing = db
    .select()
    .from(pluginListings)
    .where(eq(pluginListings.pluginId, row.pluginId))
    .get();
  if (
    listing &&
    (!listing.latestApprovedVersion || semverGte(row.version, listing.latestApprovedVersion))
  ) {
    db.update(pluginListings)
      .set({
        latestApprovedVersion: row.version,
        latestApprovedHash: row.hash,
        updatedAt: now
      })
      .where(eq(pluginListings.pluginId, row.pluginId))
      .run();
  }
  audit({
    actorType: 'admin',
    actorId: input.adminUserId,
    action: 'plugin.version.approved',
    targetTable: 'plugin_versions',
    targetId: input.versionId,
    payload: { pluginId: row.pluginId, version: row.version, hash: row.hash, notes: input.notes }
  });
  return { ok: true };
}

export function rejectVersion(input: {
  versionId: string;
  adminUserId: string;
  notes: string;
}): { ok: boolean; reason?: string } {
  if (!input.notes || input.notes.trim().length === 0) {
    return { ok: false, reason: 'reject requires a note' };
  }
  const db = getDb();
  const row = db.select().from(pluginVersions).where(eq(pluginVersions.id, input.versionId)).get();
  if (!row) return { ok: false, reason: 'unknown version' };
  if (row.reviewStatus !== 'pending_review') {
    return { ok: false, reason: `version is ${row.reviewStatus}, not pending_review` };
  }
  const now = new Date();
  db.update(pluginVersions)
    .set({
      reviewStatus: 'rejected',
      reviewedByAdminId: input.adminUserId,
      reviewedAt: now,
      reviewNotes: input.notes
    })
    .where(eq(pluginVersions.id, input.versionId))
    .run();
  audit({
    actorType: 'admin',
    actorId: input.adminUserId,
    action: 'plugin.version.rejected',
    targetTable: 'plugin_versions',
    targetId: input.versionId,
    payload: { pluginId: row.pluginId, version: row.version, notes: input.notes }
  });
  return { ok: true };
}

export function setCredentialTrust(input: {
  credentialId: string;
  trustLevel: TrustLevel;
  adminUserId: string;
}): { ok: boolean; reason?: string } {
  const db = getDb();
  const cred = db
    .select()
    .from(appCredentials)
    .where(eq(appCredentials.id, input.credentialId))
    .get();
  if (!cred) return { ok: false, reason: 'unknown credential' };
  db.update(appCredentials)
    .set({ trustLevel: input.trustLevel })
    .where(eq(appCredentials.id, input.credentialId))
    .run();
  audit({
    actorType: 'admin',
    actorId: input.adminUserId,
    action: 'credential.trust_changed',
    targetTable: 'app_credentials',
    targetId: input.credentialId,
    payload: { from: cred.trustLevel, to: input.trustLevel, label: cred.label }
  });
  return { ok: true };
}

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Minimal semver compare — enough to know if `a >= b`. Handles
 *  `MAJOR.MINOR.PATCH`; falls back to string compare on parse failure. */
function semverGte(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a >= b;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return true;
}

function parseSemver(s: string): [number, number, number] | null {
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
