import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveSprayCrops, standingCropPluginIds } from './sprayCrops';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';

const FAMILIES: Record<string, CropFamily> = {
  pumpkin: 'cucurbit' as CropFamily,
  bean: 'legume' as CropFamily,
  corn: 'corn' as CropFamily
};
const registry = {
  cropFamilyOf: (id: string) => FAMILIES[id],
  cropTraitsOf: () => [] as string[]
};

describe('standingCropPluginIds', () => {
  const now = 1_000_000_000;
  it('keeps dated plantings in the ground and drops plans and finished ones', () => {
    expect(
      standingCropPluginIds(
        [
          { cropPluginId: 'a', plantingDate: now - 1, status: 'active' },
          { cropPluginId: 'b', plantingDate: now + 1, status: 'active' },
          { cropPluginId: 'c', plantingDate: null, status: 'planned' },
          { cropPluginId: 'd', plantingDate: now - 1, status: 'harvested' },
          { cropPluginId: 'e', plantingDate: now - 1, status: 'planned' }
        ],
        now
      )
    ).toEqual(['a', 'e']);
  });
});

describe('resolveSprayCrops', () => {
  it('adds the crops on file to a pre-plant body', () => {
    const out = resolveSprayCrops(
      { primary: { cropPluginId: '__pre-plant__' } },
      ['pumpkin'],
      registry
    );
    expect(out.primary.cropFamily).toBe('cucurbit');
  });

  it('lets the registry family win over the client family', () => {
    const out = resolveSprayCrops(
      { primary: { cropPluginId: 'bean', cropFamily: 'corn' as CropFamily } },
      [],
      registry
    );
    expect(out.primary.cropFamily).toBe('legume');
  });

  it('puts the measured height on the corn', () => {
    const out = resolveSprayCrops(
      { primary: { cropPluginId: 'bean', heightInches: 12 } },
      ['corn'],
      registry
    );
    expect(out.primary).toMatchObject({ cropPluginId: 'corn', heightInches: 12 });
  });

  it('never judges fewer crops than the client or the block names', () => {
    const ids = fc.constantFrom('pumpkin', 'bean', 'corn', 'mystery', '__pre-plant__');
    fc.assert(
      fc.property(ids, fc.array(ids), fc.array(ids), (primary, co, standing) => {
        const out = resolveSprayCrops(
          {
            primary: { cropPluginId: primary },
            coPlanted: co.map((cropPluginId) => ({ cropPluginId }))
          },
          standing,
          registry
        );
        const judged = new Set([out.primary, ...out.coPlanted].map((c) => c.cropPluginId));
        for (const id of [primary, ...co, ...standing]) {
          if (registry.cropFamilyOf(id)) expect(judged.has(id)).toBe(true);
        }
        for (const c of [out.primary, ...out.coPlanted]) {
          if (registry.cropFamilyOf(c.cropPluginId)) {
            expect(c.cropFamily).toBe(registry.cropFamilyOf(c.cropPluginId));
          }
        }
      })
    );
  });
});
