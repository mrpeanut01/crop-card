/**
 * LRU cache test for `getPluginByHash`. We seed a synthetic version row,
 * confirm the helper finds it, then confirm the cache short-circuits
 * subsequent DB-less calls (by deleting the row and seeing the helper
 * return the cached value until reset).
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { _resetPluginByHashCache, getPluginByHash } from './pluginByHash';
import { appendVersion } from '$lib/db/pluginVersions';
import { db } from '$lib/db/client';
import { pluginVersions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

function uniqId(): string {
  return `test-byhash-${randomUUID().slice(0, 8)}`;
}

describe('getPluginByHash', () => {
  it('resolves a seeded row by (pluginId, hash)', () => {
    _resetPluginByHashCache();
    const id = uniqId();
    const hash = 'a'.repeat(64);
    appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash,
      payloadJson: JSON.stringify({ pluginId: id, version: '1.0.0', type: 'crop' })
    });
    const row = getPluginByHash(id, hash);
    expect(row?.pluginId).toBe(id);
    expect(row?.version).toBe('1.0.0');
  });

  it('returns null for an unknown (pluginId, hash) pair', () => {
    _resetPluginByHashCache();
    expect(getPluginByHash(uniqId(), 'b'.repeat(64))).toBeNull();
  });

  it('caches positive lookups across calls', () => {
    _resetPluginByHashCache();
    const id = uniqId();
    const hash = 'c'.repeat(64);
    appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash,
      payloadJson: '{}'
    });
    expect(getPluginByHash(id, hash)).not.toBeNull();

    db.delete(pluginVersions)
      .where(and(eq(pluginVersions.pluginId, id), eq(pluginVersions.hash, hash)))
      .run();

    expect(getPluginByHash(id, hash)).not.toBeNull();

    _resetPluginByHashCache();
    expect(getPluginByHash(id, hash)).toBeNull();
  });
});
