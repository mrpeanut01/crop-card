import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { companionPluginSchema } from './schemas';
import {
  companionIndex,
  keepApartMatch,
  unresolvedKeepApartIds,
  type CompanionRelationSource
} from './companionRelations';

const A = ['tomato-a', 'tomato-b', 'tomato-c'];
const B = ['potato-a', 'potato-b'];

const blight: CompanionRelationSource = {
  pluginId: 'blight',
  goodWith: [],
  badWith: [],
  keepApart: [{ a: A, b: B, reason: 'Late blight', source: 'WVU' }]
};

describe('keepApartMatch', () => {
  it('fires across sides in either order, with the reason and source', () => {
    for (const x of A)
      for (const y of B) {
        expect(keepApartMatch(blight, x, y)).toEqual({ reason: 'Late blight', source: 'WVU' });
        expect(keepApartMatch(blight, y, x)).toEqual({ reason: 'Late blight', source: 'WVU' });
      }
  });

  it('never fires within a side, for a crop with itself, or for unlisted crops', () => {
    fc.assert(
      fc.property(fc.constantFrom(...A), fc.constantFrom(...A), (x, y) => {
        expect(keepApartMatch(blight, x, y)).toBeNull();
      })
    );
    fc.assert(
      fc.property(fc.constantFrom(...B), fc.constantFrom(...B), (x, y) => {
        expect(keepApartMatch(blight, x, y)).toBeNull();
      })
    );
    expect(keepApartMatch(blight, 'tomato-a', 'basil')).toBeNull();
  });

  it('reads badWith as every listed crop against every other', () => {
    const c: CompanionRelationSource = {
      pluginId: 'bo',
      goodWith: [],
      badWith: ['bean', 'onion', 'garlic'],
      benefit: 'Alliums stunt beans'
    };
    expect(keepApartMatch(c, 'bean', 'onion')).toEqual({
      reason: 'Alliums stunt beans',
      source: null
    });
    expect(keepApartMatch(c, 'onion', 'garlic')).not.toBeNull();
    expect(keepApartMatch(c, 'bean', 'bean')).toBeNull();
    expect(keepApartMatch(c, 'bean', 'corn')).toBeNull();
  });
});

describe('companionIndex', () => {
  it('links each cross-side pair both ways and no same-side pair', () => {
    const idx = companionIndex([blight]);
    for (const x of A) expect([...idx[x].badWith].sort()).toEqual([...B].sort());
    for (const y of B) expect([...idx[y].badWith].sort()).toEqual([...A].sort());
    for (const id of [...A, ...B]) expect(idx[id].goodWith).toEqual([]);
  });

  it('treats goodWith and badWith as cliques and never pairs goodWith with badWith', () => {
    const idx = companionIndex([
      { pluginId: 'mix', goodWith: ['corn', 'bean'], badWith: ['fennel', 'dill'] }
    ]);
    expect(idx.corn).toEqual({ goodWith: ['bean'], badWith: [] });
    expect(idx.fennel).toEqual({ goodWith: [], badWith: ['dill'] });
    expect(idx.bean.badWith).toEqual([]);
  });

  it('is symmetric and agrees with keepApartMatch (property)', () => {
    const id = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f');
    const plugin = fc.record({
      pluginId: fc.constant('p'),
      goodWith: fc.array(id, { maxLength: 4 }),
      badWith: fc.array(id, { maxLength: 4 }),
      keepApart: fc.array(
        fc.record({
          a: fc.array(id, { minLength: 1, maxLength: 3 }),
          b: fc.array(id, { minLength: 1, maxLength: 3 }),
          reason: fc.constant('r')
        }),
        { maxLength: 2 }
      )
    });
    fc.assert(
      fc.property(fc.array(plugin, { maxLength: 3 }), (plugins) => {
        const idx = companionIndex(plugins);
        for (const [x, e] of Object.entries(idx)) {
          for (const y of e.badWith) {
            expect(y).not.toBe(x);
            expect(idx[y].badWith).toContain(x);
            expect(plugins.some((p) => keepApartMatch(p, x, y))).toBe(true);
          }
          for (const y of e.goodWith) expect(idx[y].goodWith).toContain(x);
        }
      })
    );
  });
});

describe('unresolvedKeepApartIds', () => {
  it('lists members that are not crop plugins, once each', () => {
    const c: CompanionRelationSource = {
      pluginId: 'x',
      goodWith: [],
      badWith: [],
      keepApart: [
        { a: ['tomato-a', 'ghost'], b: ['potato-a'], reason: 'r' },
        { a: ['ghost'], b: ['potato-a'], reason: 'r' }
      ]
    };
    const known = new Set(['tomato-a', 'potato-a']);
    expect(unresolvedKeepApartIds([c], (id) => known.has(id))).toEqual([
      { pluginId: 'x', cropPluginId: 'ghost' }
    ]);
  });
});

describe('companionPluginSchema keepApart', () => {
  const base = { pluginId: 'kp', type: 'companion', displayName: 'KP', version: '1.0.0' };

  it('accepts a two-sided pair and keeps keepApart optional', () => {
    expect(companionPluginSchema.safeParse(base).success).toBe(true);
    const ok = companionPluginSchema.safeParse({
      ...base,
      keepApart: [{ a: ['tomato-a'], b: ['potato-a'], reason: 'Late blight' }]
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a crop on both sides, an empty side, a missing reason or a bad id', () => {
    const bad = [
      { a: ['tomato-a'], b: ['tomato-a', 'potato-a'], reason: 'r' },
      { a: [], b: ['potato-a'], reason: 'r' },
      { a: ['tomato-a'], b: ['potato-a'] },
      { a: ['Not An Id'], b: ['potato-a'], reason: 'r' }
    ];
    for (const k of bad) {
      expect(companionPluginSchema.safeParse({ ...base, keepApart: [k] }).success).toBe(false);
    }
  });
});
