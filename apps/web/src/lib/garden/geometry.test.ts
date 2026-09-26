import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  adjacentBeds,
  BED_PRESETS,
  bedRect,
  canvasFromArea,
  clampFootprint,
  clampToArea,
  DEFAULT_CANVAS_FT,
  fitFootprint,
  footprintBounds,
  footprintsOverlap,
  freeSpot,
  hitTest,
  MIN_BED_FT,
  nudge,
  overlappingBeds,
  placeFootprint,
  pointFt,
  pointInBedIn,
  rectFt,
  rectsOverlap,
  resize,
  rotate90,
  snap,
  snapRect
} from './geometry';
import type { AreaCanvas, BedLayout, Footprint, RectFt, Rotation } from './types';

function canvas(widthFt: number, lengthFt: number): AreaCanvas {
  return canvasFromArea({ id: 'a1', name: 'Garden', widthFt, lengthFt, geojson: null });
}

function bed(
  blockId: string,
  x: number,
  y: number,
  widthFt: number,
  lengthFt: number,
  rotationDeg: Rotation = 0
): BedLayout {
  return {
    blockId,
    name: blockId,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt,
    lengthFt,
    rotationDeg,
    rect: bedRect(x, y, widthFt, lengthFt, rotationDeg)
  };
}

const halfFt = (min: number, max: number) =>
  fc.integer({ min: min * 2, max: max * 2 }).map((n) => n / 2);
const rotation = fc.constantFrom<Rotation>(0, 90, 180, 270);

function inside(r: RectFt, c: AreaCanvas): boolean {
  const e = 1e-9;
  return r.x >= -e && r.y >= -e && r.x + r.w <= c.widthFt + e && r.y + r.l <= c.lengthFt + e;
}

function isMultiple(v: number, step: number): boolean {
  return Math.abs(v / step - Math.round(v / step)) < 1e-9;
}

describe('BED_PRESETS', () => {
  it('match the spec table', () => {
    expect(BED_PRESETS['raised-4x8']).toMatchObject({ widthFt: 4, lengthFt: 8, kind: 'bed' });
    expect(BED_PRESETS['row-30in']).toMatchObject({ widthFt: 2.5, lengthFt: 20 });
    expect(BED_PRESETS['container-5gal']).toMatchObject({ kind: 'container', widthFt: 1 });
  });
});

describe('snap', () => {
  it('rounds half away from zero to 6 in', () => {
    expect(snap(1.25)).toBe(1.5);
    expect(snap(1.2)).toBe(1);
    expect(snap(-1.25)).toBe(-1.5);
    expect(snap(0.1)).toBe(0);
    expect(Object.is(snap(-0.1), 0)).toBe(true);
    expect(snap(9, 6)).toBe(12);
    expect(snap(8.9, 6)).toBe(6);
  });

  it('returns 0 for non-finite input', () => {
    expect(snap(Number.NaN)).toBe(0);
    expect(snap(Infinity)).toBe(0);
  });

  it('gives multiples of 0.5 ft within a quarter foot, and is idempotent', () => {
    fc.assert(
      fc.property(fc.double({ min: -5000, max: 5000, noNaN: true }), (v) => {
        const s = snap(v);
        expect(isMultiple(s, 0.5)).toBe(true);
        expect(Math.abs(s - v)).toBeLessThanOrEqual(0.25 + 1e-9);
        expect(snap(s)).toBe(s);
      })
    );
  });

  it('snapRect keeps at least one step each way', () => {
    const r = snapRect(rectFt(1.1, 2.3, 0.1, 3.8));
    expect(r).toEqual({ x: 1, y: 2.5, w: 0.5, l: 4 });
  });
});

describe('canvasFromArea', () => {
  it('uses the typed Size first', () => {
    const c = canvasFromArea({ id: 'a', name: 'K', widthFt: 20, lengthFt: 30, geojson: null });
    expect(c).toMatchObject({ widthFt: 20, lengthFt: 30, source: 'dimensions', hasNorth: false });
  });

  it('falls back to the polygon bounding box in feet with north up', () => {
    const lat = 39.0;
    const dLat = 96 / 364_000;
    const dLon = 30 / (364_000 * Math.cos((lat * Math.PI) / 180));
    const ring = [
      [-77.5, lat],
      [-77.5 + dLon, lat],
      [-77.5 + dLon, lat + dLat],
      [-77.5, lat + dLat],
      [-77.5, lat]
    ];
    const c = canvasFromArea({
      id: 'a',
      name: 'Tunnel',
      widthFt: null,
      lengthFt: null,
      geojson: JSON.stringify({ type: 'Polygon', coordinates: [ring] })
    });
    expect(c.source).toBe('polygon-bbox');
    expect(c.hasNorth).toBe(true);
    expect(c.widthFt).toBeGreaterThanOrEqual(29.5);
    expect(c.widthFt).toBeLessThanOrEqual(31);
    expect(c.lengthFt).toBeGreaterThanOrEqual(95);
    expect(c.lengthFt).toBeLessThanOrEqual(97.5);
    expect(isMultiple(c.widthFt, 0.5)).toBe(true);
  });

  it('defaults to 20 x 30 ft with no Size and no polygon', () => {
    for (const geojson of [null, 'not json', '{"type":"Point","coordinates":[0,0]}']) {
      const c = canvasFromArea({ id: 'a', name: 'G', widthFt: null, lengthFt: 0, geojson });
      expect(c).toMatchObject({ ...DEFAULT_CANVAS_FT, source: 'default', hasNorth: false });
    }
  });
});

describe('bedRect', () => {
  it('swaps width and length at 90 and 270', () => {
    expect(bedRect(1, 2, 4, 8, 0)).toEqual({ x: 1, y: 2, w: 4, l: 8 });
    expect(bedRect(1, 2, 4, 8, 90)).toEqual({ x: 1, y: 2, w: 8, l: 4 });
    expect(bedRect(1, 2, 4, 8, 180)).toEqual({ x: 1, y: 2, w: 4, l: 8 });
    expect(bedRect(1, 2, 4, 8, 270)).toEqual({ x: 1, y: 2, w: 8, l: 4 });
  });
});

describe('clampToArea', () => {
  it('leaves a bed that already fits alone', () => {
    expect(clampToArea(rectFt(2, 3, 4, 8), canvas(20, 30))).toEqual(rectFt(2, 3, 4, 8));
  });

  it('refuses a bed bigger than the Area', () => {
    expect(clampToArea(rectFt(0, 0, 21, 8), canvas(20, 30))).toBeNull();
  });

  it('always lands inside and moves the least distance', () => {
    fc.assert(
      fc.property(
        halfFt(1, 200),
        halfFt(1, 200),
        halfFt(-300, 300),
        halfFt(-300, 300),
        halfFt(0.5, 200),
        halfFt(0.5, 200),
        (cw, cl, x, y, w, l) => {
          const c = canvas(cw, cl);
          const r = clampToArea(rectFt(x, y, w, l), c);
          if (w > c.widthFt || l > c.lengthFt) {
            expect(r).toBeNull();
            return;
          }
          expect(r).not.toBeNull();
          expect(inside(r!, c)).toBe(true);
          expect(r!.w).toBe(w);
          expect(r!.l).toBe(l);
          if (x >= 0 && x + w <= c.widthFt) expect(r!.x).toBe(x);
          if (y >= 0 && y + l <= c.lengthFt) expect(r!.y).toBe(y);
        }
      )
    );
  });
});

describe('nudge', () => {
  it('moves by whole 6 in steps', () => {
    const b = nudge(bed('b1', 2, 3, 4, 8), 0.4, -0.2, canvas(20, 30));
    expect(b.rect).toMatchObject({ x: 2.5, y: 3 });
  });

  it('stops at the far wall of a 96 ft tunnel', () => {
    const b = nudge(bed('b1', 2, 3, 3, 90), 0, 50, canvas(30, 96));
    expect(b.rect.y + b.rect.l).toBe(96);
  });

  it('stays inside for any move', () => {
    fc.assert(
      fc.property(halfFt(-100, 100), halfFt(-100, 100), (dx, dy) => {
        const c = canvas(20, 30);
        const b = nudge(bed('b1', 4, 4, 4, 8), dx, dy, c);
        expect(inside(b.rect, c)).toBe(true);
        expect(isMultiple(b.rect.x, 0.5) && isMultiple(b.rect.y, 0.5)).toBe(true);
      })
    );
  });
});

describe('rotate90', () => {
  it('turns about the centre and swaps the box', () => {
    const b = rotate90(bed('b1', 2, 3, 4, 8), canvas(20, 30))!;
    expect(b.rotationDeg).toBe(90);
    expect(b.widthFt).toBe(4);
    expect(b.lengthFt).toBe(8);
    expect(b.rect).toEqual({ x: 0, y: 5, w: 8, l: 4 });
  });

  it('refuses a turn that cannot fit', () => {
    expect(rotate90(bed('b1', 0, 0, 3, 90), canvas(30, 96))).toBeNull();
  });

  it('clamps a turn near the edge back inside', () => {
    const c = canvas(20, 30);
    const b = rotate90(bed('b1', 0, 0, 2, 10), c)!;
    expect(inside(b.rect, c)).toBe(true);
    expect(b.rect.w).toBe(10);
  });

  it('four turns are the identity when there is room', () => {
    fc.assert(
      fc.property(halfFt(1, 20), halfFt(1, 20), rotation, (w, l, rot) => {
        const c = canvas(100, 100);
        let b: BedLayout = bed('b1', 40, 40, w, l, rot);
        const start = b;
        for (let i = 0; i < 4; i++) {
          const next = rotate90(b, c);
          expect(next).not.toBeNull();
          b = next!;
        }
        expect(b.rotationDeg).toBe(start.rotationDeg);
        expect(b.rect).toEqual(start.rect);
      })
    );
  });

  it('keeps the bed inside the Area and on the grid', () => {
    fc.assert(
      fc.property(halfFt(1, 20), halfFt(1, 20), halfFt(0, 40), halfFt(0, 40), (w, l, x, y) => {
        const c = canvas(40, 40);
        const start = clampToArea(bedRect(x, y, w, l, 0), c)!;
        const b = rotate90(bed('b1', start.x, start.y, w, l), c);
        if (!b) return;
        expect(inside(b.rect, c)).toBe(true);
        expect(isMultiple(b.rect.x, 0.5) && isMultiple(b.rect.y, 0.5)).toBe(true);
      })
    );
  });
});

describe('resize', () => {
  it('snaps, keeps the 1 ft minimum and clamps to the wall', () => {
    const c = canvas(20, 30);
    const b = resize(bed('b1', 2, 3, 4, 8), rectFt(2, 3, 0.2, 40), c);
    expect(b.rect).toEqual({ x: 2, y: 3, w: MIN_BED_FT, l: 27 });
    expect(b.widthFt).toBe(1);
    expect(b.lengthFt).toBe(27);
  });

  it('maps canvas size back to the bed frame when turned', () => {
    const b = resize(bed('b1', 2, 3, 4, 8, 90), rectFt(2, 3, 10.2, 3.3), canvas(20, 30));
    expect(b.rect).toEqual({ x: 2, y: 3, w: 10, l: 3.5 });
    expect(b.widthFt).toBe(3.5);
    expect(b.lengthFt).toBe(10);
  });

  it('always stays inside with sizes at least 1 ft', () => {
    fc.assert(
      fc.property(
        halfFt(-10, 60),
        halfFt(-10, 60),
        fc.double({ min: -5, max: 80, noNaN: true }),
        fc.double({ min: -5, max: 80, noNaN: true }),
        rotation,
        (x, y, w, l, rot) => {
          const c = canvas(20, 30);
          const b = resize(bed('b1', 2, 3, 4, 8, rot), rectFt(x, y, w, l), c);
          expect(inside(b.rect, c)).toBe(true);
          expect(b.widthFt).toBeGreaterThanOrEqual(MIN_BED_FT);
          expect(b.lengthFt).toBeGreaterThanOrEqual(MIN_BED_FT);
          expect(bedRect(b.rect.x, b.rect.y, b.widthFt, b.lengthFt, rot)).toEqual(b.rect);
        }
      )
    );
  });
});

describe('hit testing and overlap', () => {
  const beds = [bed('b1', 2, 3, 4, 8), bed('b2', 6, 3, 4, 8)];

  it('returns the topmost bed under the point', () => {
    expect(hitTest(pointFt(3, 4), beds)).toBe('b1');
    expect(hitTest(pointFt(6, 4), beds)).toBe('b2');
    expect(hitTest(pointFt(15, 20), beds)).toBeNull();
  });

  it('does not count shared edges as overlap', () => {
    expect(rectsOverlap(beds[0].rect, beds[1].rect)).toBe(false);
    expect(rectsOverlap(rectFt(0, 0, 4, 4), rectFt(3.5, 3.5, 2, 2))).toBe(true);
  });

  it('lists overlapping beds except the one being moved', () => {
    expect(overlappingBeds(rectFt(5, 5, 2, 2), beds)).toEqual(['b1', 'b2']);
    expect(overlappingBeds(beds[0].rect, beds, 'b1')).toEqual([]);
  });

  it('overlap is symmetric', () => {
    const r = fc.record({
      x: halfFt(0, 20),
      y: halfFt(0, 20),
      w: halfFt(0.5, 10),
      l: halfFt(0.5, 10)
    });
    fc.assert(
      fc.property(r, r, (a, b) => {
        const ra = rectFt(a.x, a.y, a.w, a.l);
        const rb = rectFt(b.x, b.y, b.w, b.l);
        expect(rectsOverlap(ra, rb)).toBe(rectsOverlap(rb, ra));
        expect(rectsOverlap(ra, ra)).toBe(true);
      })
    );
  });
});

function bruteFreeSpot(
  w: number,
  l: number,
  beds: readonly BedLayout[],
  c: AreaCanvas
): RectFt | null {
  for (let y = 0; y + l <= c.lengthFt + 1e-9; y += 0.5) {
    for (let x = 0; x + w <= c.widthFt + 1e-9; x += 0.5) {
      const r = rectFt(x, y, w, l);
      if (!beds.some((b) => rectsOverlap(r, b.rect))) return r;
    }
  }
  return null;
}

describe('freeSpot', () => {
  it('places the first bed at the top-left', () => {
    expect(freeSpot(4, 8, 0, [], canvas(20, 30))).toEqual(rectFt(0, 0, 4, 8));
  });

  it('puts a duplicate right of the original', () => {
    const b1 = bed('b1', 2, 3, 4, 8);
    expect(freeSpot(4, 8, 0, [b1], canvas(20, 30), b1.rect)).toEqual(rectFt(6, 3, 4, 8));
  });

  it('falls back to rows when the original row is full', () => {
    const b1 = bed('b1', 0, 0, 20, 8);
    expect(freeSpot(4, 8, 0, [b1], canvas(20, 30), b1.rect)).toEqual(rectFt(0, 8, 4, 8));
  });

  it('returns null when the Area is full or the bed is too big', () => {
    expect(freeSpot(4, 8, 0, [bed('b1', 0, 0, 20, 30)], canvas(20, 30))).toBeNull();
    expect(freeSpot(4, 40, 0, [], canvas(20, 30))).toBeNull();
  });

  it('matches a brute-force grid scan and never overlaps', () => {
    const bedArb = fc.record({
      x: halfFt(0, 10),
      y: halfFt(0, 10),
      w: halfFt(0.5, 5),
      l: halfFt(0.5, 5)
    });
    fc.assert(
      fc.property(
        fc.array(bedArb, { maxLength: 6 }),
        halfFt(0.5, 6),
        halfFt(0.5, 6),
        (raw, w, l) => {
          const c = canvas(12, 12);
          const beds = raw.map((r, i) => bed(`b${i}`, r.x, r.y, r.w, r.l));
          const got = freeSpot(w, l, 0, beds, c);
          expect(got).toEqual(bruteFreeSpot(w, l, beds, c));
          if (got) {
            expect(inside(got, c)).toBe(true);
            expect(overlappingBeds(got, beds)).toEqual([]);
          }
        }
      )
    );
  });
});

describe('adjacentBeds', () => {
  it('pairs beds within 4 ft, ids sorted', () => {
    const beds = [
      bed('z', 0, 0, 3, 90),
      bed('a', 7, 0, 3, 90),
      bed('m', 14, 0, 3, 90),
      bed('far', 0, 95, 1, 1)
    ];
    expect(adjacentBeds(beds)).toEqual([
      ['a', 'm'],
      ['a', 'z']
    ]);
    expect(adjacentBeds(beds, 11)).toContainEqual(['m', 'z']);
  });

  it('measures corner gaps diagonally', () => {
    expect(adjacentBeds([bed('a', 0, 0, 1, 1), bed('b', 3.5, 3.5, 1, 1)])).toEqual([['a', 'b']]);
    expect(adjacentBeds([bed('a', 0, 0, 1, 1), bed('b', 5, 0, 1, 1)])).toEqual([['a', 'b']]);
    expect(adjacentBeds([bed('a', 0, 0, 1, 1), bed('b', 4, 4, 1, 1)])).toEqual([]);
  });
});

describe('footprints', () => {
  const fpArb = fc.record({
    x_in: fc.double({ min: -50, max: 200, noNaN: true }),
    y_in: fc.double({ min: -50, max: 200, noNaN: true }),
    w_in: fc.double({ min: 0.1, max: 300, noNaN: true }),
    l_in: fc.double({ min: 0.1, max: 300, noNaN: true })
  });

  it('clampFootprint snaps to 6 in (12 for square foot) and stays in the bed', () => {
    fc.assert(
      fc.property(fpArb, halfFt(1, 12), halfFt(1, 12), fc.boolean(), (fp, bw, bl, sfg) => {
        const step = sfg ? 12 : 6;
        const out = clampFootprint(fp, { widthFt: bw, lengthFt: bl }, sfg);
        expect(out.w_in).toBeGreaterThanOrEqual(Math.min(step, bw * 12));
        expect(out.l_in).toBeGreaterThanOrEqual(Math.min(step, bl * 12));
        expect(out.x_in).toBeGreaterThanOrEqual(0);
        expect(out.y_in).toBeGreaterThanOrEqual(0);
        expect(out.x_in + out.w_in).toBeLessThanOrEqual(bw * 12 + 1e-9);
        expect(out.y_in + out.l_in).toBeLessThanOrEqual(bl * 12 + 1e-9);
        for (const v of [out.x_in, out.y_in, out.w_in, out.l_in]) {
          expect(isMultiple(v, step)).toBe(true);
        }
      })
    );
  });

  it('footprintsOverlap ignores shared edges', () => {
    const a: Footprint = { x_in: 0, y_in: 0, w_in: 36, l_in: 180 };
    expect(footprintsOverlap(a, { x_in: 0, y_in: 180, w_in: 36, l_in: 180 })).toBe(false);
    expect(footprintsOverlap(a, { x_in: 6, y_in: 174, w_in: 6, l_in: 12 })).toBe(true);
  });

  it('a whole-bed footprint covers the bed box at every rotation', () => {
    for (const rot of [0, 90, 180, 270] as Rotation[]) {
      const b = bed('b1', 3, 5, 4, 8, rot);
      expect(footprintBounds({ x_in: 0, y_in: 0, w_in: 48, l_in: 96 }, b)).toEqual(b.rect);
    }
  });

  it('turning a bed carries its footprints with it', () => {
    const fp: Footprint = { x_in: 0, y_in: 0, w_in: 12, l_in: 24 };
    expect(footprintBounds(fp, bed('b1', 0, 0, 4, 8, 0))).toEqual(rectFt(0, 0, 1, 2));
    expect(footprintBounds(fp, bed('b1', 0, 0, 4, 8, 90))).toEqual(rectFt(6, 0, 2, 1));
    expect(footprintBounds(fp, bed('b1', 0, 0, 4, 8, 180))).toEqual(rectFt(3, 6, 1, 2));
    expect(footprintBounds(fp, bed('b1', 0, 0, 4, 8, 270))).toEqual(rectFt(0, 3, 2, 1));
  });

  it('pointInBedIn inverts the bed transform', () => {
    fc.assert(
      fc.property(
        rotation,
        fc.integer({ min: 0, max: 47 }),
        fc.integer({ min: 0, max: 95 }),
        (rot, u, v) => {
          const b = bed('b1', 3, 5, 4, 8, rot);
          const fp: Footprint = { x_in: u, y_in: v, w_in: 1, l_in: 1 };
          const r = footprintBounds(fp, b);
          const back = pointInBedIn(pointFt(r.x + r.w / 2, r.y + r.l / 2), b)!;
          expect(back.xIn).toBeCloseTo(u + 0.5, 6);
          expect(back.yIn).toBeCloseTo(v + 0.5, 6);
        }
      )
    );
    expect(pointInBedIn(pointFt(0, 0), bed('b1', 3, 5, 4, 8))).toBeNull();
  });
});

describe('fitFootprint and placeFootprint', () => {
  const tunnelBed = { widthFt: 3, lengthFt: 90 };

  it('fits the wanted size into the free space nearest the tap', () => {
    const taken: Footprint[] = [{ x_in: 0, y_in: 0, w_in: 36, l_in: 180 }];
    expect(fitFootprint(tunnelBed, { w_in: 36, l_in: 180 }, taken, { xIn: 18, yIn: 90 })).toEqual({
      x_in: 0,
      y_in: 180,
      w_in: 36,
      l_in: 180
    });
    expect(fitFootprint(tunnelBed, { w_in: 36, l_in: 180 }, taken, { xIn: 18, yIn: 1000 })).toEqual(
      { x_in: 0, y_in: 900, w_in: 36, l_in: 180 }
    );
  });

  it('shrinks to fit a smaller gap', () => {
    const b = { widthFt: 4, lengthFt: 8 };
    const taken: Footprint[] = [{ x_in: 0, y_in: 0, w_in: 48, l_in: 72 }];
    expect(fitFootprint(b, { w_in: 48, l_in: 48 }, taken)).toEqual({
      x_in: 0,
      y_in: 72,
      w_in: 48,
      l_in: 24
    });
    expect(placeFootprint(b, { w_in: 48, l_in: 48 }, taken)).toBeNull();
  });

  it('returns null when the bed is full', () => {
    const b = { widthFt: 4, lengthFt: 8 };
    expect(
      fitFootprint(b, { w_in: 12, l_in: 12 }, [{ x_in: 0, y_in: 0, w_in: 48, l_in: 96 }])
    ).toBeNull();
  });

  it('never overlaps what is taken and stays in the bed', () => {
    const fpArb = fc.record({
      x_in: fc.integer({ min: 0, max: 16 }).map((n) => n * 6),
      y_in: fc.integer({ min: 0, max: 16 }).map((n) => n * 6),
      w_in: fc.integer({ min: 1, max: 8 }).map((n) => n * 6),
      l_in: fc.integer({ min: 1, max: 8 }).map((n) => n * 6)
    });
    fc.assert(
      fc.property(
        fc.array(fpArb, { maxLength: 5 }),
        fc.integer({ min: 1, max: 120 }),
        fc.integer({ min: 1, max: 120 }),
        fc.option(
          fc.record({ xIn: fc.integer({ min: 0, max: 96 }), yIn: fc.integer({ min: 0, max: 96 }) }),
          { nil: undefined }
        ),
        (taken, w, l, at) => {
          const b = { widthFt: 8, lengthFt: 8 };
          const got = fitFootprint(b, { w_in: w, l_in: l }, taken, at);
          if (!got) return;
          expect(got.x_in + got.w_in).toBeLessThanOrEqual(96);
          expect(got.y_in + got.l_in).toBeLessThanOrEqual(96);
          for (const t of taken) expect(footprintsOverlap(got, t)).toBe(false);
        }
      )
    );
  });
});
