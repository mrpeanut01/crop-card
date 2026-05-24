/**
 * Lifecycle tests — verify retire/unretire toggle state correctly and
 * that uninstall refuses with a populated reference summary when an
 * event row references the plugin, writes a tombstone otherwise.
 *
 * Uses synthetic plugins to avoid touching the seeded catalog. Lives
 * entirely against the live DB + filesystem so it exercises the real
 * code path the endpoint hits.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { blocks, equipment, fields, pluginVersions, sprayEvents, users } from '$lib/db/schema';
import {
  PluginLifecycleError,
  countReferences,
  retirePlugin,
  uninstallPlugin,
  unretirePlugin
} from './pluginLifecycle';
import { appendVersion, currentVersionOf, historyOf } from '$lib/db/pluginVersions';

const TEST_OWNER_ID = 'owner_home_farm';
const SYSTEM_USER_ID = 'system';
const TEST_BLOCK_ID = 'lifecycle-test-block';
const TEST_SPRAYER_ID = 'lifecycle-test-sprayer';
const TEST_FIELD_ID = 'lifecycle-test-field';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginsRoot = process.env.PLUGINS_DIR ?? path.resolve(here, '../../../../../plugins');

function uniqId(): string {
  return `lifecycle-test-${randomUUID().slice(0, 8)}`;
}

async function seedFakeCropPlugin(id: string, hash = 'a'.repeat(64)): Promise<string> {
  const filePath = path.join(pluginsRoot, 'crops', `${id}.json`);
  const payload = {
    pluginId: id,
    type: 'crop',
    displayName: 'Test ' + id,
    version: '1.0.0',
    pluginSchemaVersion: '1.1',
    cropFamily: 'corn'
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  appendVersion({
    pluginId: id,
    version: '1.0.0',
    kind: 'crop',
    hash,
    payloadJson: JSON.stringify(payload),
    changeReason: 'test-seed'
  });
  return filePath;
}

async function fileAt(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const created: string[] = [];

beforeAll(() => {
  // Ensure the FK targets used by spray-event inserts + tombstone rows exist
  // in the fresh /tmp/cropcard-test.db. onConflictDoNothing is fine for the
  // owner-home-farm row that migrations already create.
  db.insert(users)
    .values({ id: SYSTEM_USER_ID, email: 'system@cropcard.local' })
    .onConflictDoNothing()
    .run();
  db.insert(fields)
    .values({
      id: TEST_FIELD_ID,
      ownerId: TEST_OWNER_ID,
      name: 'Lifecycle Test Field'
    })
    .onConflictDoNothing()
    .run();
  db.insert(blocks)
    .values({
      id: TEST_BLOCK_ID,
      ownerId: TEST_OWNER_ID,
      fieldId: TEST_FIELD_ID,
      name: 'Lifecycle Test Block'
    })
    .onConflictDoNothing()
    .run();
  db.insert(equipment)
    .values({
      id: TEST_SPRAYER_ID,
      ownerId: TEST_OWNER_ID,
      type: 'sprayer',
      label: 'Lifecycle Test Sprayer'
    })
    .onConflictDoNothing()
    .run();
});

afterAll(async () => {
  // Best-effort cleanup of test artifacts.
  for (const id of created) {
    db.delete(pluginVersions).where(eq(pluginVersions.pluginId, id)).run();
    for (const p of [
      path.join(pluginsRoot, 'crops', `${id}.json`),
      path.join(pluginsRoot, '_retired', 'crops', `${id}.json`)
    ]) {
      try {
        await unlink(p);
      } catch {
        /* not there */
      }
    }
  }
});

describe('retirePlugin / unretirePlugin', () => {
  it('moves the file to _retired/ and sets retired_at on the current row', async () => {
    const id = uniqId();
    created.push(id);
    const livePath = await seedFakeCropPlugin(id);
    const retiredPath = path.join(pluginsRoot, '_retired', 'crops', `${id}.json`);

    expect(await fileAt(livePath)).toBe(true);
    expect(currentVersionOf(id)?.retiredAt).toBeUndefined();

    await retirePlugin(id);

    expect(await fileAt(livePath)).toBe(false);
    expect(await fileAt(retiredPath)).toBe(true);
    expect(currentVersionOf(id)?.retiredAt).toBeDefined();
  });

  it('restores via unretire', async () => {
    const id = uniqId();
    created.push(id);
    const livePath = await seedFakeCropPlugin(id);
    await retirePlugin(id);
    await unretirePlugin(id);

    expect(await fileAt(livePath)).toBe(true);
    expect(currentVersionOf(id)?.retiredAt).toBeUndefined();
  });

  it('throws not-found on an unknown pluginId', async () => {
    await expect(retirePlugin('does-not-exist-' + randomUUID().slice(0, 6))).rejects.toBeInstanceOf(
      PluginLifecycleError
    );
  });

  it('is a no-op when already retired (no error)', async () => {
    const id = uniqId();
    created.push(id);
    await seedFakeCropPlugin(id);
    await retirePlugin(id);
    // Second retire should not throw.
    await retirePlugin(id);
    expect(currentVersionOf(id)?.retiredAt).toBeDefined();
  });
});

describe('countReferences', () => {
  it('returns zero across all tables for a brand-new plugin', () => {
    const id = uniqId();
    const refs = countReferences(id, 'crop');
    expect(refs.total).toBe(0);
    expect(refs.sprayEvents).toBe(0);
    expect(refs.insecticideEvents).toBe(0);
    expect(refs.fungicideEvents).toBe(0);
    expect(refs.cropRows).toBe(0);
  });

  it('counts spray-event references via the pluginHashesJson LIKE probe', () => {
    const id = `lifecycle-ref-${randomUUID().slice(0, 8)}`;
    const eventId = randomUUID();
    // Insert a spray event whose pluginHashesJson mentions our pluginId.
    db.insert(sprayEvents)
      .values({
        id: eventId,
        ownerId: TEST_OWNER_ID,
        blockId: TEST_BLOCK_ID,
        sprayerId: TEST_SPRAYER_ID,
        performedById: SYSTEM_USER_ID,
        occurredAt: new Date(Date.now()),
        productsJson: '[]',
        conditionsJson: '{}',
        rulesVersion: '0.3.0-safety-kernel',
        pluginHashesJson: JSON.stringify({ [id]: 'deadbeef' })
      })
      .run();
    try {
      const refs = countReferences(id, 'herbicide');
      expect(refs.sprayEvents).toBe(1);
      expect(refs.total).toBe(1);
    } finally {
      db.delete(sprayEvents).where(eq(sprayEvents.id, eventId)).run();
    }
  });
});

describe('uninstallPlugin', () => {
  it('writes a tombstone row + deletes the file when no events reference the plugin', async () => {
    const id = uniqId();
    created.push(id);
    const livePath = await seedFakeCropPlugin(id);

    const result = await uninstallPlugin(id, { changedByUserId: 'system' });
    expect(result.pluginId).toBe(id);
    expect(result.removedRows).toBeGreaterThan(0);
    expect(result.tombstoneId).toBeTruthy();

    expect(await fileAt(livePath)).toBe(false);

    const history = historyOf(id);
    expect(history.length).toBe(1);
    expect(history[0].changeReason).toBe('uninstall');
    expect(history[0].payloadJson).toBe('');
    expect(history[0].retiredAt).toBeDefined();
  });

  it('refuses with 409-style error + reference counts when events reference the plugin', async () => {
    const id = `lifecycle-blocked-${randomUUID().slice(0, 8)}`;
    created.push(id);
    await seedFakeCropPlugin(id);

    const eventId = randomUUID();
    db.insert(sprayEvents)
      .values({
        id: eventId,
        ownerId: TEST_OWNER_ID,
        blockId: TEST_BLOCK_ID,
        sprayerId: TEST_SPRAYER_ID,
        performedById: SYSTEM_USER_ID,
        occurredAt: new Date(Date.now()),
        productsJson: '[]',
        conditionsJson: '{}',
        rulesVersion: '0.3.0-safety-kernel',
        pluginHashesJson: JSON.stringify({ [id]: 'cafebabe' })
      })
      .run();

    try {
      await expect(uninstallPlugin(id, { changedByUserId: 'system' })).rejects.toMatchObject({
        code: 'still-referenced',
        references: expect.objectContaining({ sprayEvents: 1, total: 1 })
      });
    } finally {
      db.delete(sprayEvents).where(eq(sprayEvents.id, eventId)).run();
    }
  });
});
