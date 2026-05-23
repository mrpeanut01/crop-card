/**
 * Persist a scanned plugin version. Decides approved vs pending_review
 * based on credential trust + scan verdict, upserts the listing, and
 * audit-logs the result.
 *
 * Idempotent on (pluginId, hash): a re-upload of byte-identical content
 * is a no-op that returns the existing row.
 */

import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { pluginListings, pluginVersions } from '$lib/db/schema';
import type { AppCredential } from './appCreds';
import type { ScanResult } from './scan';
import type { Plugin } from '@cropcard/plugin-validation';
import { audit } from './audit';

export interface PersistOutcome {
  status: 'created' | 'noChange';
  versionId: string;
  pluginId: string;
  version: string;
  hash: string;
  reviewStatus: 'approved' | 'pending_review';
  /** True when the prompt-injection heuristic forced quarantine despite
   *  a trusted credential. UI surfaces this to set expectations. */
  quarantinedByHeuristic: boolean;
}

export function persistVersion(input: {
  scan: ScanResult & { plugin: Plugin; hash: string };
  credential: AppCredential;
  // 'forceApprove' is used by the admin re-approve flow (Sub-task F)
  forceApprove?: boolean;
}): PersistOutcome {
  const { scan, credential } = input;
  const plugin = scan.plugin;
  const pluginId = plugin.pluginId;
  const version = plugin.version;
  const hash = scan.hash;
  const db = getDb();

  // Idempotency: existing row with same hash → no-op.
  const existing = db
    .select()
    .from(pluginVersions)
    .where(and(eq(pluginVersions.pluginId, pluginId), eq(pluginVersions.hash, hash)))
    .get();
  if (existing) {
    return {
      status: 'noChange',
      versionId: existing.id,
      pluginId,
      version: existing.version,
      hash,
      reviewStatus: existing.reviewStatus === 'rejected' ? 'pending_review' : existing.reviewStatus,
      quarantinedByHeuristic: false
    };
  }

  const quarantinedByHeuristic = scan.verdict === 'quarantine';
  const trustedApprove = credential.trustLevel === 'trusted' && !quarantinedByHeuristic;
  const reviewStatus: 'approved' | 'pending_review' =
    input.forceApprove || trustedApprove ? 'approved' : 'pending_review';

  const versionId = `pv_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const now = new Date();

  db.insert(pluginVersions)
    .values({
      id: versionId,
      pluginId,
      version,
      hash,
      payload: JSON.stringify(plugin),
      uploadedAt: now,
      uploadedByCredentialId: credential.id,
      reviewStatus,
      reviewedByAdminId: null,
      reviewedAt: reviewStatus === 'approved' && trustedApprove ? now : null,
      reviewNotes: null,
      scanResults: JSON.stringify(scan.scanResults)
    })
    .run();

  // Upsert listing.
  const listing = db.select().from(pluginListings).where(eq(pluginListings.pluginId, pluginId)).get();
  if (!listing) {
    db.insert(pluginListings)
      .values({
        pluginId,
        type: plugin.type,
        displayName: plugin.displayName,
        latestApprovedVersion: reviewStatus === 'approved' ? version : null,
        latestApprovedHash: reviewStatus === 'approved' ? hash : null,
        sourceCredentialId: credential.id,
        createdAt: now,
        updatedAt: now
      })
      .run();
  } else if (reviewStatus === 'approved') {
    db.update(pluginListings)
      .set({
        displayName: plugin.displayName,
        latestApprovedVersion: version,
        latestApprovedHash: hash,
        updatedAt: now
      })
      .where(eq(pluginListings.pluginId, pluginId))
      .run();
  } else {
    // Touch updatedAt so /admin/review surfaces it.
    db.update(pluginListings)
      .set({ updatedAt: now })
      .where(eq(pluginListings.pluginId, pluginId))
      .run();
  }

  audit({
    actorType: 'app',
    actorId: credential.id,
    action: reviewStatus === 'approved' ? 'plugin.uploaded.approved' : 'plugin.uploaded.pending',
    targetTable: 'plugin_versions',
    targetId: versionId,
    payload: {
      pluginId,
      version,
      hash,
      trustLevel: credential.trustLevel,
      quarantinedByHeuristic,
      scanFlags: {
        promptInjection: scan.scanResults.promptInjection.length,
        structural: scan.scanResults.structural.length,
        injection: scan.scanResults.injection.length
      }
    }
  });

  return {
    status: 'created',
    versionId,
    pluginId,
    version,
    hash,
    reviewStatus,
    quarantinedByHeuristic
  };
}
