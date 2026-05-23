/**
 * Boot-time provisioning. Runs once per process on first request that
 * touches the DB (idempotent — safe to call from the request hook).
 *
 * - If MARKETPLACE_SEED_CREDENTIAL is set AND no credentials exist, the
 *   env value is registered as a `trusted` credential labeled `seed`.
 *   This is the bootstrap path: the operator pastes the value into
 *   docker-compose / Bicep / .env, restarts, then revokes after minting
 *   real credentials via /admin/sources.
 * - If MARKETPLACE_ADMIN_EMAILS is set, each comma-separated email gets
 *   an admin_users row provisioned so the first sign-in works without
 *   a separate "create admin" step.
 *
 * Warnings only — never throws. A misconfigured env shouldn't crash boot.
 */

import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { adminUsers, appCredentials } from '$lib/db/schema';

let didBootstrap = false;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function ensureBootstrapped(): void {
  if (didBootstrap) return;
  didBootstrap = true;

  const db = getDb();

  // Seed app credential
  const seed = process.env.MARKETPLACE_SEED_CREDENTIAL?.trim();
  if (seed && seed !== 'unset') {
    try {
      const credRow = db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM app_credentials`);
      const count = credRow[0]?.n ?? 0;
      if (count === 0) {
        if (!seed.startsWith('ccm_')) {
          console.warn(
            '[bootstrap] MARKETPLACE_SEED_CREDENTIAL must start with "ccm_"; skipping'
          );
        } else {
          db.insert(appCredentials)
            .values({
              id: 'cred_seed',
              label: 'seed',
              trustLevel: 'trusted',
              credentialHash: sha256Hex(seed),
              createdAt: new Date(),
              requestCount: 0
            })
            .run();
          console.log('[bootstrap] seeded credential cred_seed (trusted)');
        }
      }
    } catch (err) {
      console.error('[bootstrap] seed credential failed', err);
    }
  } else {
    try {
      const credRow = db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM app_credentials`);
      if ((credRow[0]?.n ?? 0) === 0) {
        console.warn(
          '[bootstrap] no MARKETPLACE_SEED_CREDENTIAL set and app_credentials is empty; mint via /admin/sources after signing in'
        );
      }
    } catch (err) {
      console.error('[bootstrap] credential check failed', err);
    }
  }

  // Seed admin users
  const adminEmails = (process.env.MARKETPLACE_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) {
    console.warn('[bootstrap] MARKETPLACE_ADMIN_EMAILS empty — no one can sign in to /admin');
  }
  for (const email of adminEmails) {
    try {
      const existing = db.select().from(adminUsers).where(eq(adminUsers.email, email)).get();
      if (!existing) {
        const id = `adm_seed_${sha256Hex(email).slice(0, 8)}`;
        db.insert(adminUsers).values({ id, email }).run();
        console.log(`[bootstrap] provisioned admin user ${email}`);
      }
    } catch (err) {
      console.error(`[bootstrap] admin user upsert failed for ${email}`, err);
    }
  }
}
