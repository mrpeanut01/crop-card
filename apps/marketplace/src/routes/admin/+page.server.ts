import type { PageServerLoad } from './$types';
import { sql } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { requireAdmin } from '$lib/server/auth';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event);
  const db = getDb();
  const [approved] = db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM plugin_versions WHERE review_status = 'approved'`
  );
  const [pending] = db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM plugin_versions WHERE review_status = 'pending_review'`
  );
  const [rejected] = db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM plugin_versions WHERE review_status = 'rejected'`
  );
  const [creds] = db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM app_credentials WHERE revoked_at IS NULL`
  );
  return {
    counts: {
      approved: approved?.n ?? 0,
      pendingReview: pending?.n ?? 0,
      rejected: rejected?.n ?? 0,
      activeCredentials: creds?.n ?? 0
    },
    admin: event.locals.admin
  };
};
