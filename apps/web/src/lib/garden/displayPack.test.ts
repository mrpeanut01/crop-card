import { describe, expect, it } from 'vitest';
import { displayFootprints, wantedFootprintSize } from './displayPack';
import { familyGlyph, ALL_GLYPHS } from './familyGlyph';
import { footprintsOverlap } from './geometry';
import type { BedLayout, OccupancyInterval, PlantSpacing } from './types';

const bed: BedLayout = {
  blockId: 'b1',
  name: 'Bed 1',
  kind: 'bed',
  widthFt: 4,
  lengthFt: 8,
  rotationDeg: 0,
  bedStyle: 'raised',
  rect: { x: 0, y: 0, w: 4, l: 8 }
} as BedLayout;

const spacing: PlantSpacing = { inRowIn: 12, rowIn: 12, pattern: 'square', source: 'plugin' };

const iv = (cropId: string, startMs: number, endMs: number, footprint = null as never) =>
  ({
    cropId,
    blockId: 'b1',
    startMs,
    harvestStartMs: endMs,
    harvestEndMs: endMs,
    endMs,
    footprint,
    actual: false
  }) as OccupancyInterval;

const planting = (cropId: string, footprint: unknown = null, plantCount: number | null = null) => ({
  cropId,
  blockId: 'b1',
  cropPluginId: 'x',
  footprint: footprint as never,
  plantCount,
  spacing
});

describe('displayFootprints (#481)', () => {
  it('packs unplaced plantings around placed ones that share the time, without saving', () => {
    const placed = { x_in: 0, y_in: 0, w_in: 48, l_in: 24 };
    const out = displayFootprints(
      [bed],
      [planting('a', placed), planting('b'), planting('c')],
      [iv('a', 0, 100, placed as never), iv('b', 10, 90), iv('c', 20, 80)]
    );
    expect(out.has('a')).toBe(false);
    const b = out.get('b')!;
    const c = out.get('c')!;
    expect(footprintsOverlap(b, placed)).toBe(false);
    expect(footprintsOverlap(c, placed)).toBe(false);
    expect(footprintsOverlap(b, c)).toBe(false);
  });

  it('reuses space once the earlier planting is out of the ground', () => {
    const out = displayFootprints(
      [bed],
      [planting('early'), planting('late')],
      [iv('early', 0, 50), iv('late', 60, 120)]
    );
    expect(out.get('late')).toEqual(out.get('early'));
  });

  it('skips a planting with no time in the ground and one that cannot fit', () => {
    const full = { x_in: 0, y_in: 0, w_in: 48, l_in: 96 };
    const out = displayFootprints(
      [bed],
      [planting('full', full), planting('squeezed'), planting('undated')],
      [iv('full', 0, 100, full as never), iv('squeezed', 10, 20)]
    );
    expect(out.size).toBe(0);
  });

  it('asks for room for the planned count, else the bed width by 2 ft', () => {
    expect(wantedFootprintSize({ plantCount: null, spacing, cropPluginId: 'x' }, bed)).toEqual({
      w_in: 48,
      l_in: 24
    });
    const sized = wantedFootprintSize({ plantCount: 8, spacing, cropPluginId: 'x' }, bed);
    expect(sized.w_in).toBe(48);
    expect(sized.l_in).toBeGreaterThanOrEqual(24);
  });
});

describe('familyGlyph', () => {
  it('maps crop families to a small set of icons with a plain label', () => {
    expect(familyGlyph('brassica').key).toBe('brassica');
    expect(familyGlyph('cover-legume').key).toBe('legume');
    expect(familyGlyph('solanaceae').label).toBe('Tomato and pepper family');
    expect(familyGlyph('unknown').key).toBe('flower');
    expect(familyGlyph(null).key).toBe('flower');
    for (const g of ALL_GLYPHS) expect(g.d).toMatch(/^M/);
  });
});
