/**
 * Read-side helpers for the marketplace catalog. Pure query helpers —
 * no auth, no mutation. The route handlers gate access; this module
 * just runs the DB calls.
 */

import { and, desc, eq, gt, like, sql } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { pluginListings, pluginVersions } from '$lib/db/schema';

export interface PluginListingRow {
  pluginId: string;
  type: 'crop' | 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer' | 'companion';
  displayName: string;
  latestApprovedVersion: string | null;
  latestApprovedHash: string | null;
  updatedAt: number;
}

export interface PluginVersionRow {
  id: string;
  pluginId: string;
  version: string;
  hash: string;
  payload: unknown;
  uploadedAt: number;
  uploadedByCredentialId: string;
  reviewStatus: 'approved' | 'pending_review' | 'rejected';
  reviewedByAdminId: string | null;
  reviewedAt: number | null;
  reviewNotes: string | null;
  scanResults: unknown;
}

const TYPES = ['crop', 'herbicide', 'insecticide', 'fungicide', 'fertilizer', 'companion'] as const;
export type PluginType = (typeof TYPES)[number];

function isType(s: string): s is PluginType {
  return (TYPES as readonly string[]).includes(s);
}

/**
 * Cursor encoding: base64url of `${updatedAt}|${pluginId}`. Stable
 * ordering (updatedAt DESC, pluginId DESC as tie-breaker) plus the
 * cursor lets the client resume past any new inserts in the window.
 */
function encodeCursor(updatedAt: number, pluginId: string): string {
  return Buffer.from(`${updatedAt}|${pluginId}`).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): { updatedAt: number; pluginId: string } | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const [u, p] = decoded.split('|');
    const updatedAt = Number(u);
    if (!Number.isFinite(updatedAt) || !p) return null;
    return { updatedAt, pluginId: p };
  } catch {
    return null;
  }
}

export function listApprovedPlugins(input: {
  type?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}): { plugins: PluginListingRow[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const db = getDb();
  const conditions = [sql`${pluginListings.latestApprovedVersion} IS NOT NULL`];
  if (input.type && isType(input.type)) {
    conditions.push(eq(pluginListings.type, input.type));
  }
  if (input.q && input.q.length >= 1) {
    conditions.push(like(pluginListings.displayName, `%${input.q}%`));
  }
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    conditions.push(
      sql`(${pluginListings.updatedAt} < ${new Date(cursor.updatedAt)} OR (${pluginListings.updatedAt} = ${new Date(cursor.updatedAt)} AND ${pluginListings.pluginId} > ${cursor.pluginId}))`
    );
  }

  const rows = db
    .select()
    .from(pluginListings)
    .where(and(...conditions))
    .orderBy(desc(pluginListings.updatedAt), pluginListings.pluginId)
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.updatedAt.getTime(), last.pluginId) : null;
  return {
    plugins: page.map((row) => ({
      pluginId: row.pluginId,
      type: row.type,
      displayName: row.displayName,
      latestApprovedVersion: row.latestApprovedVersion,
      latestApprovedHash: row.latestApprovedHash,
      updatedAt: row.updatedAt.getTime()
    })),
    nextCursor
  };
}

export function getLatestApproved(pluginId: string): PluginVersionRow | null {
  const db = getDb();
  const listing = db
    .select()
    .from(pluginListings)
    .where(eq(pluginListings.pluginId, pluginId))
    .get();
  if (!listing || !listing.latestApprovedVersion || !listing.latestApprovedHash) return null;
  return getByHash(pluginId, listing.latestApprovedHash);
}

export function getByHash(pluginId: string, hash: string): PluginVersionRow | null {
  const row = getDb()
    .select()
    .from(pluginVersions)
    .where(and(eq(pluginVersions.pluginId, pluginId), eq(pluginVersions.hash, hash)))
    .get();
  if (!row || row.reviewStatus !== 'approved') return null;
  return mapVersion(row);
}

export function listApprovedVersions(pluginId: string): PluginVersionRow[] {
  return getDb()
    .select()
    .from(pluginVersions)
    .where(and(eq(pluginVersions.pluginId, pluginId), eq(pluginVersions.reviewStatus, 'approved')))
    .orderBy(desc(pluginVersions.uploadedAt))
    .all()
    .map(mapVersion);
}

export interface FeedEvent {
  pluginId: string;
  version: string;
  hash: string;
  action: 'created' | 'updated';
  at: number;
}

/**
 * Incremental sync. Returns approved versions ordered by reviewedAt ASC
 * (so clients see them in chronological order). The cursor is the most
 * recent `at` they've already seen.
 */
export function feedSince(input: { since?: string; limit?: number }): {
  events: FeedEvent[];
  nextCursor: string | null;
} {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const db = getDb();
  const conditions = [eq(pluginVersions.reviewStatus, 'approved')];
  const cursor = decodeCursor(input.since);
  if (cursor) {
    conditions.push(gt(pluginVersions.reviewedAt, new Date(cursor.updatedAt)));
  }
  const rows = db
    .select()
    .from(pluginVersions)
    .where(and(...conditions))
    .orderBy(pluginVersions.reviewedAt, pluginVersions.id)
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  // Determine action per row: first approved version for this pluginId = 'created', else 'updated'.
  // Single query: gather min(reviewedAt) per pluginId, compare.
  const firstApprovedByPluginId = new Map<string, number>();
  const pluginIds = new Set(page.map((r) => r.pluginId));
  for (const pid of pluginIds) {
    const first = db
      .select({ at: sql<Date>`MIN(${pluginVersions.reviewedAt})`.as('at') })
      .from(pluginVersions)
      .where(and(eq(pluginVersions.pluginId, pid), eq(pluginVersions.reviewStatus, 'approved')))
      .get();
    if (first?.at) {
      const at = first.at instanceof Date ? first.at.getTime() : Number(first.at);
      firstApprovedByPluginId.set(pid, at);
    }
  }
  const events: FeedEvent[] = page.map((row) => {
    const reviewedAt = row.reviewedAt ? row.reviewedAt.getTime() : row.uploadedAt.getTime();
    const firstAt = firstApprovedByPluginId.get(row.pluginId) ?? reviewedAt;
    return {
      pluginId: row.pluginId,
      version: row.version,
      hash: row.hash,
      action: reviewedAt === firstAt ? 'created' : 'updated',
      at: reviewedAt
    };
  });
  const last = events[events.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.at, last.pluginId) : null;
  return { events, nextCursor };
}

function mapVersion(row: {
  id: string;
  pluginId: string;
  version: string;
  hash: string;
  payload: string;
  uploadedAt: Date;
  uploadedByCredentialId: string;
  reviewStatus: 'approved' | 'pending_review' | 'rejected';
  reviewedByAdminId: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  scanResults: string | null;
}): PluginVersionRow {
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload);
  } catch (err) {
    console.error(`[plugins] malformed payload for ${row.pluginId}@${row.version}`, err);
  }
  let scanResults: unknown = null;
  if (row.scanResults) {
    try {
      scanResults = JSON.parse(row.scanResults);
    } catch (err) {
      console.error(`[plugins] malformed scan_results for ${row.pluginId}@${row.version}`, err);
    }
  }
  return {
    id: row.id,
    pluginId: row.pluginId,
    version: row.version,
    hash: row.hash,
    payload,
    uploadedAt: row.uploadedAt.getTime(),
    uploadedByCredentialId: row.uploadedByCredentialId,
    reviewStatus: row.reviewStatus,
    reviewedByAdminId: row.reviewedByAdminId,
    reviewedAt: row.reviewedAt ? row.reviewedAt.getTime() : null,
    reviewNotes: row.reviewNotes,
    scanResults
  };
}
