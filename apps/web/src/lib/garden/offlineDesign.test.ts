import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { designFromSnapshot } from './design';
import { designerDataFromSnapshot } from './offlineDesign';

describe('designerDataFromSnapshot', () => {
  it('rebuilds the designer read-only from the saved snapshot', () => {
    const snap = sampleSnapshot();
    const data = designerDataFromSnapshot(snap, 'f_garden', { seasonYear: 2026, role: 'owner' })!;
    expect(data).toMatchObject({
      offline: true,
      canEdit: false,
      role: 'owner',
      areaKind: 'garden',
      seasons: [2026],
      activeYear: 2026,
      recipes: [],
      companions: []
    });
    expect(data.design.readOnly).toBe(true);
    expect(data.design.readOnlyReason).toBe('offline');
    expect(data.design.asOf).toBe(snap.generatedAt);
    expect(data.design).toEqual(
      designFromSnapshot(snap, 'f_garden', { seasonYear: 2026, readOnlyReason: 'offline' })
    );
  });

  it('keeps each bed’s history and a catalog of the crops already in the Area', () => {
    const data = designerDataFromSnapshot(sampleSnapshot(), 'f_garden', {
      seasonYear: 2026,
      role: 'helper'
    })!;
    const ids = new Set(data.design.plantings.map((p) => p.cropId));
    const history = Object.values(data.history).flat();
    expect(new Set(history.map((h) => h.cropId))).toEqual(ids);
    for (const [blockId, entries] of Object.entries(data.history)) {
      for (const h of entries) {
        expect(data.design.plantings.find((p) => p.cropId === h.cropId)?.blockId).toBe(blockId);
      }
    }
    expect(data.catalog.map((c) => c.pluginId).sort()).toEqual(
      Object.keys(data.design.crops).sort()
    );
    for (const c of data.catalog) expect(data.lookbackByFamily[c.cropFamily]).toBeGreaterThan(0);
  });

  it('is null for an Area that is not a garden or is not in the snapshot', () => {
    const snap = sampleSnapshot();
    expect(designerDataFromSnapshot(snap, 'f_hay', { seasonYear: 2026, role: 'owner' })).toBeNull();
    expect(designerDataFromSnapshot(snap, 'nope', { seasonYear: 2026, role: 'owner' })).toBeNull();
  });

  it('never offers editing, whatever the role or season', () => {
    const snap = sampleSnapshot();
    fc.assert(
      fc.property(
        fc.constantFrom('owner', 'helper', 'inspector'),
        fc.integer({ min: 2000, max: 2100 }),
        (role, seasonYear) => {
          const data = designerDataFromSnapshot(snap, 'f_garden', { seasonYear, role })!;
          expect(data.canEdit).toBe(false);
          expect(data.design.readOnly).toBe(true);
          expect(data.design.seasonYear).toBe(seasonYear);
        }
      )
    );
  });
});
