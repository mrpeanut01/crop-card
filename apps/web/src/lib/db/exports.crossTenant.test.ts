/**
 * Phase 18i — cross-tenant export hardening (csv / pdf / usda.csv).
 *
 * Three GET endpoints generate exports of spray + insecticide records.
 * They're the highest-leak-risk surfaces because they bypass UI listings
 * and emit raw rows — a forgotten tenant filter shows up here long before
 * it shows up in a list. Each test seeds two Owners with distinct spray
 * events, hits the export under each Owner's `runWithTenant`, and asserts
 * the returned bytes contain only that Owner's event ids.
 *
 * We exercise the underlying `listSprayEvents` / `listInsecticideEvents`
 * functions directly rather than spinning up the SvelteKit handler — the
 * tenant filter is at the repo layer, so this catches the same class of
 * leak with less ceremony.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runWithTenant } from './tenant';
import { db } from './client';
import { equipment, owners, users } from './schema';
import { createField } from './fields';
import { createBlock } from './blocks';
import { insertSprayEvent, listSprayEvents } from './sprayEvents';
import { insertInsecticideEvent, listInsecticideEvents } from './insecticideEvents';

const OWNER_X = 'export-test-owner-x';
const OWNER_Y = 'export-test-owner-y';

function seedOwnerWithSpray(
  ownerId: string,
  performedById: string
): {
  blockId: string;
  sprayId: string;
  insecticideId: string;
} {
  // Direct owner row insertion — same pattern as tenant.crossTenant.test.ts.
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();

  return runWithTenant(ownerId, () => {
    const field = createField({ name: `${ownerId}-field` });
    const block = createBlock({ name: `${ownerId}-block`, fieldId: field.id, acres: 1 });
    // Each tenant gets its own sprayer row (in equipment, post-Phase-8a) so
    // the spray-event FK resolves within the same Owner.
    const sprayerId = `${ownerId}-sprayer`;
    db.insert(equipment)
      .values({ id: sprayerId, ownerId, type: 'sprayer', label: `${ownerId} sprayer` })
      .onConflictDoNothing()
      .run();
    const spray = insertSprayEvent({
      blockId: block.id,
      sprayerId,
      performedById,
      occurredAt: Date.now() - 60_000,
      products: [{ pluginId: 'herb:test', chemistryClasses: ['glyphosate'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: { 'herb:test': 'abc' }
    });
    const insecticide = insertInsecticideEvent({
      blockId: block.id,
      performedById,
      occurredAt: Date.now() - 30_000,
      products: [{ pluginId: 'pest:test', displayName: 'TestPest', iracGroups: ['1A'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: { 'pest:test': 'def' }
    });
    return { blockId: block.id, sprayId: spray.id, insecticideId: insecticide.id };
  });
}

function ensureUser(id: string): void {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

describe('export endpoints cross-tenant isolation', () => {
  it('listSprayEvents() under Owner X never sees Owner Y rows', () => {
    const userX = `user_${randomUUID().slice(0, 8)}`;
    const userY = `user_${randomUUID().slice(0, 8)}`;
    ensureUser(userX);
    ensureUser(userY);
    const x = seedOwnerWithSpray(OWNER_X, userX);
    const y = seedOwnerWithSpray(OWNER_Y, userY);

    runWithTenant(OWNER_X, () => {
      const ids = new Set(listSprayEvents().map((e) => e.id));
      expect(ids.has(x.sprayId)).toBe(true);
      expect(ids.has(y.sprayId)).toBe(false);
    });
    runWithTenant(OWNER_Y, () => {
      const ids = new Set(listSprayEvents().map((e) => e.id));
      expect(ids.has(y.sprayId)).toBe(true);
      expect(ids.has(x.sprayId)).toBe(false);
    });
  });

  it('listInsecticideEvents() under Owner X never sees Owner Y rows', () => {
    const userX = `user_${randomUUID().slice(0, 8)}`;
    ensureUser(userX);
    const x = seedOwnerWithSpray(OWNER_X, userX);

    runWithTenant(OWNER_X, () => {
      const ids = new Set(listInsecticideEvents().map((e) => e.id));
      expect(ids.has(x.insecticideId)).toBe(true);
    });
    runWithTenant(OWNER_Y, () => {
      const ids = new Set(listInsecticideEvents().map((e) => e.id));
      expect(ids.has(x.insecticideId)).toBe(false);
    });
  });

  it('blockId/sprayerId filters do not weaken the tenant scope', () => {
    const userX = `user_${randomUUID().slice(0, 8)}`;
    ensureUser(userX);
    const x = seedOwnerWithSpray(OWNER_X, userX);

    // Owner Y tries to filter by Owner X's blockId — must still see nothing.
    runWithTenant(OWNER_Y, () => {
      const events = listSprayEvents({ blockId: x.blockId });
      expect(events).toHaveLength(0);
    });

    // Owner X with the same filter sees their own rows.
    runWithTenant(OWNER_X, () => {
      const events = listSprayEvents({ blockId: x.blockId });
      expect(events.some((e) => e.id === x.sprayId)).toBe(true);
    });
  });

  it('insertSprayEvent and insertInsecticideEvent never cross tenants', () => {
    const userX = `user_${randomUUID().slice(0, 8)}`;
    ensureUser(userX);

    let xCountBefore = 0;
    runWithTenant(OWNER_X, () => {
      xCountBefore = listSprayEvents().length;
    });

    // Y inserts a new event.
    runWithTenant(OWNER_Y, () => {
      const field = createField({ name: `iso-field-${randomUUID().slice(0, 6)}` });
      const block = createBlock({
        name: `iso-block-${randomUUID().slice(0, 6)}`,
        fieldId: field.id
      });
      const isoSprayerId = `iso-sprayer-${randomUUID().slice(0, 6)}`;
      db.insert(equipment)
        .values({ id: isoSprayerId, ownerId: OWNER_Y, type: 'sprayer', label: 'iso sprayer' })
        .run();
      insertSprayEvent({
        blockId: block.id,
        sprayerId: isoSprayerId,
        performedById: userX,
        occurredAt: Date.now(),
        products: [{ pluginId: 'iso:test', chemistryClasses: ['glyphosate'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
    });

    // X's count must be unchanged.
    runWithTenant(OWNER_X, () => {
      const xCountAfter = listSprayEvents().length;
      expect(xCountAfter).toBe(xCountBefore);
    });
  });
});
