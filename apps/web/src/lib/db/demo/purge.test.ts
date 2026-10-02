// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sqliteHandle } from '../client';
import { blobDeletions, helperAssignments, owners, userHints, users } from '../schema';
import { seedPhase33 } from '../phase33.fixtures';
import { ownerStoragePrefix } from '../documents';
import { DEMO_EMAIL_DOMAIN, DEMO_OWNER_PREFIX, DEMO_TTL_MS } from '$lib/demo/identity';
import { purgeDemoOwner, purgeExpiredDemoOwners } from './purge';

function ownerTables(): string[] {
  return (
    sqliteHandle()
      .prepare(
        `SELECT m.name AS name FROM sqlite_master m, pragma_table_info(m.name) p
         WHERE m.type = 'table' AND p.name = 'owner_id'`
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function rowsFor(ownerId: string): number {
  let n = 0;
  for (const t of ownerTables()) {
    n += (
      sqliteHandle()
        .prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE owner_id = ?`)
        .get(ownerId) as {
        n: number;
      }
    ).n;
  }
  return n;
}

function makeOwner(id: string, email: string, createdAt = Date.now()): string {
  const userId = `u-${randomUUID()}`;
  db.insert(users)
    .values({ id: userId, email, createdAt: new Date(createdAt) })
    .run();
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active', createdAt: new Date(createdAt) })
    .run();
  db.insert(helperAssignments)
    .values({
      ownerId: id,
      userId,
      roleWithinOwner: 'owner',
      status: 'active',
      createdAt: new Date(createdAt)
    })
    .run();
  db.insert(userHints).values({ userId, hintKey: 'alpha_welcome', seenAt: new Date() }).run();
  return userId;
}

describe('purgeDemoOwner', () => {
  it('refuses any owner id that is not a demo id', () => {
    for (const id of [
      'owner_home_farm',
      'owner_abc',
      'owner_demo_',
      'xowner_demo_1',
      'owner-demo_1'
    ]) {
      expect(() => purgeDemoOwner(id)).toThrow(/not a demo owner/);
    }
  });

  it('erases every row of the demo farm and its demo user, and leaves other farms alone', () => {
    const demo = `${DEMO_OWNER_PREFIX}${randomUUID().slice(0, 8)}`;
    const real = `owner_${randomUUID().slice(0, 8)}`;
    const demoUser = makeOwner(demo, `v-${randomUUID()}@${DEMO_EMAIL_DOMAIN}`);
    const realUser = makeOwner(real, `grower-${randomUUID()}@example.com`);
    seedPhase33(demo, 'purge-demo');
    seedPhase33(real, 'purge-real');
    const realBefore = rowsFor(real);
    expect(rowsFor(demo)).toBeGreaterThan(20);

    purgeDemoOwner(demo);

    expect(rowsFor(demo)).toBe(0);
    expect(db.select().from(owners).where(eq(owners.id, demo)).get()).toBeUndefined();
    expect(db.select().from(users).where(eq(users.id, demoUser)).get()).toBeUndefined();
    expect(db.select().from(userHints).where(eq(userHints.userId, demoUser)).all()).toEqual([]);
    expect(
      db
        .select()
        .from(blobDeletions)
        .where(eq(blobDeletions.storagePrefix, ownerStoragePrefix(demo)))
        .get()
    ).toBeDefined();
    expect(rowsFor(real)).toBe(realBefore);
    expect(db.select().from(users).where(eq(users.id, realUser)).get()).toBeDefined();
    expect(sqliteHandle().pragma('foreign_key_check')).toEqual([]);
  });

  it('never deletes a real user who also belonged to the demo farm', () => {
    const demo = `${DEMO_OWNER_PREFIX}${randomUUID().slice(0, 8)}`;
    makeOwner(demo, `v-${randomUUID()}@${DEMO_EMAIL_DOMAIN}`);
    const realUser = `u-${randomUUID()}`;
    db.insert(users)
      .values({ id: realUser, email: `helper-${randomUUID()}@example.com` })
      .run();
    db.insert(helperAssignments)
      .values({ ownerId: demo, userId: realUser, roleWithinOwner: 'helper', status: 'active' })
      .run();
    purgeDemoOwner(demo);
    expect(db.select().from(users).where(eq(users.id, realUser)).get()).toBeDefined();
  });
});

describe('purgeExpiredDemoOwners', () => {
  it('removes only demo farms older than the demo lifetime', () => {
    const now = Date.now();
    const old = `${DEMO_OWNER_PREFIX}${randomUUID().slice(0, 8)}`;
    const fresh = `${DEMO_OWNER_PREFIX}${randomUUID().slice(0, 8)}`;
    const oldReal = `owner_${randomUUID().slice(0, 8)}`;
    makeOwner(old, `v-${randomUUID()}@${DEMO_EMAIL_DOMAIN}`, now - DEMO_TTL_MS - 60_000);
    makeOwner(fresh, `v-${randomUUID()}@${DEMO_EMAIL_DOMAIN}`, now - 60_000);
    makeOwner(oldReal, `old-${randomUUID()}@example.com`, now - 10 * DEMO_TTL_MS);

    purgeExpiredDemoOwners(now, 1000);

    expect(db.select().from(owners).where(eq(owners.id, old)).get()).toBeUndefined();
    expect(db.select().from(owners).where(eq(owners.id, fresh)).get()).toBeDefined();
    expect(db.select().from(owners).where(eq(owners.id, oldReal)).get()).toBeDefined();
  });
});
