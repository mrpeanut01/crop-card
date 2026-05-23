import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { pluginListings, pluginVersions } from '$lib/db/schema';

/**
 * Liveness probe + catalog summary. No auth required — used by load
 * balancers and operators for quick "is the marketplace up" checks.
 *
 * Counts are computed live; the marketplace stays small enough (single-
 * tenant catalog) that aggregate(*) on these tables is sub-millisecond.
 */
export async function GET() {
  let pluginCount = 0;
  let pendingReviewCount = 0;
  let dbStatus: 'ok' | 'unavailable' = 'ok';

  try {
    const db = getDb();
    const [plugins] = db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM ${pluginListings}`);
    const [pending] = db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM ${pluginVersions} WHERE review_status = 'pending_review'`
    );
    pluginCount = plugins?.n ?? 0;
    pendingReviewCount = pending?.n ?? 0;
  } catch (err) {
    dbStatus = 'unavailable';
    console.error('[health] db query failed', err);
  }

  return json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    db: dbStatus,
    version: '0.0.1',
    pluginCount,
    pendingReviewCount,
    uptime: process.uptime()
  });
}
