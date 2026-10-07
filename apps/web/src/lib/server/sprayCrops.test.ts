import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  plantingPlannedAt,
  plantingStandsForBloom,
  resolveSprayCrops,
  standingCropPluginIds
} from './sprayCrops';
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
          { cropPluginId: 'd', plantingDate: now - 10, status: 'harvested', harvestedAt: now - 5 },
          { cropPluginId: 'e', plantingDate: now - 1, status: 'planned' },
          { cropPluginId: 'f', plantingDate: now - 10, status: 'archived', archivedAt: now - 5 }
        ],
        now
      )
    ).toEqual(['a', 'e']);
  });

  it('#637: a harvested crop drops out from its harvest, so the block is pre-plant again', () => {
    const plantings = [
      { cropPluginId: 'corn', plantingDate: now - 200, status: 'harvested', harvestedAt: now - 50 },
      { cropPluginId: 'bean', plantingDate: now + 20, status: 'planned' }
    ];
    expect(standingCropPluginIds(plantings, now)).toEqual([]);
    expect(plantings.filter((p) => plantingPlannedAt(p, now)).map((p) => p.cropPluginId)).toEqual([
      'bean'
    ]);
  });

  it('#637: a backdated record still sees a crop that was in the ground on its date', () => {
    const plantings = [
      { cropPluginId: 'corn', plantingDate: now - 200, status: 'harvested', harvestedAt: now - 50 }
    ];
    expect(standingCropPluginIds(plantings, now - 60)).toEqual(['corn']);
    expect(standingCropPluginIds(plantings, now - 50)).toEqual([]);
  });

  it('#637: keeps failed plantings and gone ones with no date on file', () => {
    expect(
      standingCropPluginIds(
        [
          { cropPluginId: 'a', plantingDate: now - 1, status: 'failed' },
          { cropPluginId: 'b', plantingDate: now - 1, status: 'harvested' },
          { cropPluginId: 'c', plantingDate: now - 1, status: 'archived', archivedAt: null }
        ],
        now
      )
    ).toEqual(['a', 'b', 'c']);
  });

  it('never drops a planting that stood at the spray time (property)', () => {
    const status = fc.constantFrom('planned', 'active', 'harvested', 'archived', 'failed');
    const stamp = fc.option(fc.integer({ min: 0, max: 2_000 }), { nil: null });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000 }),
        status,
        stamp,
        stamp,
        fc.integer({ min: 0, max: 2_000 }),
        (plantingDate, st, harvestedAt, archivedAt, at) => {
          const p = { cropPluginId: 'x', plantingDate, status: st, harvestedAt, archivedAt };
          const stood =
            plantingDate <= at &&
            [harvestedAt, archivedAt].every(
              (t) => t == null || t > at || !['harvested', 'archived'].includes(st)
            );
          const gone =
            plantingDate <= at &&
            ['harvested', 'archived'].includes(st) &&
            [harvestedAt, archivedAt].some((t) => t != null && t <= at);
          expect(standingCropPluginIds([p], at).length === 1).toBe(stood && !gone);
          if (plantingDate > at) expect(standingCropPluginIds([p], at)).toEqual([]);
        }
      )
    );
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

describe('plantingStandsForBloom (#676)', () => {
  const statusArb = fc.constantFrom('planned', 'active', 'harvested', 'failed', 'archived');
  const stampArb = fc.option(fc.integer({ min: 0, max: 1_000 }), { nil: null });
  const plantingArb = fc.record({
    cropPluginId: fc.constant('squash'),
    plantingDate: stampArb,
    status: statusArb,
    harvestedAt: stampArb,
    archivedAt: stampArb
  });

  it('never counts a planting that is not in the ground yet', () => {
    fc.assert(
      fc.property(plantingArb, fc.integer({ min: 0, max: 1_000 }), (p, at) => {
        if (p.plantingDate == null || p.plantingDate > at) {
          expect(plantingStandsForBloom(p, at)).toBe(false);
        }
      })
    );
  });

  it('only a harvest or archive dated on or before the spray removes a planted crop', () => {
    fc.assert(
      fc.property(plantingArb, fc.integer({ min: 0, max: 1_000 }), (p, at) => {
        if (p.plantingDate == null || p.plantingDate > at) return;
        const gone =
          (p.status === 'harvested' || p.status === 'archived') &&
          [p.harvestedAt, p.archivedAt].some((t) => t != null && t <= at);
        expect(plantingStandsForBloom(p, at)).toBe(!gone);
      })
    );
  });

  it('a failed planting still counts', () => {
    expect(
      plantingStandsForBloom({ cropPluginId: 'x', plantingDate: 1, status: 'failed' }, 10)
    ).toBe(true);
  });
});
