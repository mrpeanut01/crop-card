/**
 * NFR-05 retention-alert window (#345).
 *
 * `recordsApproachingRetention` must fire only inside the 30-day pre-expiry
 * window (records aged ~700–730 days). A record aged well past the full 2-year
 * retention window must NOT be returned — the prior implementation had no lower
 * bound and surfaced long-expired rows alongside the genuinely-approaching ones.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { runWithTenant } from './tenant';
import { db } from './client';
import { equipment, owners, users } from './schema';
import { createField } from './fields';
import { createBlock } from './blocks';
import {
  insertSprayEvent,
  recordsApproachingRetention,
  RETENTION_WINDOW_MS,
  RETENTION_ALERT_WINDOW_MS
} from './sprayEvents';

const OWNER = 'retention-test-owner';
const DAY = 24 * 60 * 60 * 1000;

function ensureOwner(ownerId: string): void {
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();
}

function ensureUser(id: string): void {
  db.insert(users)
    .values({ id, email: `${id}@retention.test` })
    .onConflictDoNothing()
    .run();
}

function seedSpray(ownerId: string, occurredAt: number): string {
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `${ownerId}-field-${randomUUID().slice(0, 6)}` });
    const block = createBlock({
      name: `${ownerId}-block-${randomUUID().slice(0, 6)}`,
      fieldId: field.id,
      acres: 1
    });
    const sprayerId = `${ownerId}-sprayer-${randomUUID().slice(0, 6)}`;
    db.insert(equipment)
      .values({ id: sprayerId, ownerId, type: 'sprayer', label: `${ownerId} sprayer` })
      .run();
    return insertSprayEvent({
      blockId: block.id,
      sprayerId,
      performedById: 'u-retention',
      occurredAt,
      products: [{ pluginId: 'herb:test', chemistryClasses: ['glyphosate'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: { 'herb:test': 'abc' }
    }).id;
  });
}

describe('recordsApproachingRetention window (#345)', () => {
  it('returns a record inside the 30-day pre-expiry window and excludes long-expired rows', () => {
    ensureOwner(OWNER);
    ensureUser('u-retention');
    const now = Date.now();

    // Inside the alert window: aged ~715 days (700 < age < 730).
    const inWindowAt = now - (RETENTION_WINDOW_MS - RETENTION_ALERT_WINDOW_MS / 2);
    // Long-expired: aged ~800 days, well past the full retention window.
    const longExpiredAt = now - (RETENTION_WINDOW_MS + 70 * DAY);
    // Fresh: aged ~30 days, nowhere near retention.
    const freshAt = now - 30 * DAY;

    const inWindowId = seedSpray(OWNER, inWindowAt);
    const longExpiredId = seedSpray(OWNER, longExpiredAt);
    const freshId = seedSpray(OWNER, freshAt);

    const approaching = runWithTenant(OWNER, () => recordsApproachingRetention(now));
    const ids = new Set(approaching.map((e) => e.id));

    expect(ids.has(inWindowId)).toBe(true);
    expect(ids.has(longExpiredId)).toBe(false);
    expect(ids.has(freshId)).toBe(false);
  });
});
