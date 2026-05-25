/**
 * Repository test for `plugin_versions`. Verifies:
 *   - bumpPatch + isVersionAhead semantics
 *   - appendVersion: supersedes prior current row, is idempotent on (pluginId, hash)
 *   - currentVersionOf + historyOf return the expected shape
 *   - getByHash resolves a known hash
 *   - retire / unretire toggles the retired_at timestamp on the current row
 *
 * The catalog is global so no tenant context is needed. We use a synthetic
 * pluginId so we don't collide with the on-disk catalog backfill.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  appendVersion,
  bumpPatch,
  currentVersionOf,
  deleteVersion,
  getByHash,
  historyOf,
  isVersionAhead,
  retire,
  setSupersededAt,
  unretire
} from './pluginVersions';

function uniqId(): string {
  return `test-plugin-${randomUUID().slice(0, 8)}`;
}

function fakeHash(seed: string): string {
  return seed.padEnd(64, '0').slice(0, 64);
}

describe('semver helpers', () => {
  it('bumpPatch increments the patch segment', () => {
    expect(bumpPatch('1.0.0')).toBe('1.0.1');
    expect(bumpPatch('2.5.9')).toBe('2.5.10');
  });

  it('bumpPatch falls back to 1.0.0 on malformed input', () => {
    expect(bumpPatch('')).toBe('1.0.0');
    expect(bumpPatch('foo')).toBe('1.0.0');
    expect(bumpPatch('1.2')).toBe('1.0.0');
  });

  it('isVersionAhead is a strict three-segment compare', () => {
    expect(isVersionAhead('1.0.1', '1.0.0')).toBe(true);
    expect(isVersionAhead('1.1.0', '1.0.9')).toBe(true);
    expect(isVersionAhead('2.0.0', '1.99.99')).toBe(true);
    expect(isVersionAhead('1.0.0', '1.0.0')).toBe(false);
    expect(isVersionAhead('1.0.0', '1.0.1')).toBe(false);
  });
});

describe('appendVersion', () => {
  it('writes the first row and reads back through currentVersionOf', () => {
    const id = uniqId();
    const hash = fakeHash('a');
    appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash,
      payloadJson: JSON.stringify({ pluginId: id, version: '1.0.0' })
    });
    const cur = currentVersionOf(id);
    expect(cur?.version).toBe('1.0.0');
    expect(cur?.hash).toBe(hash);
    expect(cur?.supersededAt).toBeUndefined();
  });

  it('supersedes the prior current row on subsequent inserts', () => {
    const id = uniqId();
    appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash: fakeHash('p1'),
      payloadJson: '{}'
    });
    appendVersion({
      pluginId: id,
      version: '1.0.1',
      kind: 'crop',
      hash: fakeHash('p2'),
      payloadJson: '{}'
    });
    const cur = currentVersionOf(id);
    expect(cur?.version).toBe('1.0.1');
    const history = historyOf(id);
    expect(history.length).toBe(2);
    const old = history.find((r) => r.version === '1.0.0');
    expect(old?.supersededAt).toBeDefined();
  });

  it('is idempotent on (pluginId, hash) — re-inserting same hash returns existing row', () => {
    const id = uniqId();
    const hash = fakeHash('idem');
    const first = appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash,
      payloadJson: '{}'
    });
    const second = appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash,
      payloadJson: '{}'
    });
    expect(second.id).toBe(first.id);
    expect(historyOf(id).length).toBe(1);
  });

  it('getByHash resolves a known (pluginId, hash) pair', () => {
    const id = uniqId();
    const hash = fakeHash('lookup');
    appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'herbicide',
      hash,
      payloadJson: '{"x":1}'
    });
    const row = getByHash(id, hash);
    expect(row?.payloadJson).toBe('{"x":1}');
    expect(getByHash(id, fakeHash('nope'))).toBeUndefined();
  });
});

describe('retire / unretire', () => {
  it('toggles retiredAt on the current row only', () => {
    const id = uniqId();
    appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash: fakeHash('r'),
      payloadJson: '{}'
    });
    expect(retire(id)).toBe(true);
    expect(currentVersionOf(id)?.retiredAt).toBeDefined();
    expect(unretire(id)).toBe(true);
    expect(currentVersionOf(id)?.retiredAt).toBeUndefined();
  });

  it('returns false when no rows exist for the plugin', () => {
    expect(retire(`does-not-exist-${randomUUID().slice(0, 6)}`)).toBe(false);
  });
});

describe('deleteVersion + setSupersededAt', () => {
  it('deleteVersion removes the row by id and returns true; missing id returns false', () => {
    const id = uniqId();
    const v = appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash: fakeHash('d1'),
      payloadJson: '{}'
    });
    expect(deleteVersion(v.id)).toBe(true);
    expect(currentVersionOf(id)).toBeUndefined();
    expect(deleteVersion(`missing-${randomUUID()}`)).toBe(false);
  });

  it('setSupersededAt overrides the value on a specific row, including back-to-null', () => {
    const id = uniqId();
    appendVersion({
      pluginId: id,
      version: '1.0.0',
      kind: 'crop',
      hash: fakeHash('s1'),
      payloadJson: '{}'
    });
    const v2 = appendVersion({
      pluginId: id,
      version: '1.0.1',
      kind: 'crop',
      hash: fakeHash('s2'),
      payloadJson: '{}'
    });
    // v2 is now current (supersededAt = null on it, defined on v1)
    expect(currentVersionOf(id)?.id).toBe(v2.id);
    // Mark v2 superseded as of an arbitrary timestamp
    const t = Date.now();
    expect(setSupersededAt(v2.id, t)).toBe(true);
    // Both rows now have a supersededAt → no current row
    expect(currentVersionOf(id)).toBeUndefined();
    // Clear v2 back to null — it becomes current again
    expect(setSupersededAt(v2.id, null)).toBe(true);
    expect(currentVersionOf(id)?.id).toBe(v2.id);
  });
});
