import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { haversineMeters } from '$lib/geo/area';
import {
  boxAround,
  boxCenter,
  boxSizeM,
  compassFrom,
  geojsonShape,
  imageToLonLat,
  localFrame,
  lonLatToImage,
  photoExtentAround,
  photoExtentFor,
  pointInRing,
  rectOf,
  rectShapeDist,
  segmentShapeDist,
  toLocal,
  toLonLat,
  validBox,
  type XY
} from './geometry';
import type { LonLat } from './types';

const lat = fc.double({ min: -70, max: 70, noNaN: true });
const lon = fc.double({ min: -179, max: 179, noNaN: true });
const unit = fc.double({ min: 0, max: 1, noNaN: true });
const side = fc.double({ min: 8, max: 400, noNaN: true });

describe('aerial photo frame', () => {
  it('image position to lon/lat and back is the identity', () => {
    fc.assert(
      fc.property(lat, lon, side, unit, unit, (la, lo, s, x, y) => {
        const extent = photoExtentAround([lo, la], s);
        const [x2, y2] = lonLatToImage(extent, imageToLonLat(extent, x, y));
        expect(x2).toBeCloseTo(x, 6);
        expect(y2).toBeCloseTo(y, 6);
      })
    );
  });

  it('lon/lat inside the photo to image position and back is the identity', () => {
    fc.assert(
      fc.property(lat, lon, side, unit, unit, (la, lo, s, x, y) => {
        const extent = photoExtentAround([lo, la], s);
        const p = imageToLonLat(extent, x, y);
        const q = imageToLonLat(extent, ...lonLatToImage(extent, p));
        expect(q[0]).toBeCloseTo(p[0], 9);
        expect(q[1]).toBeCloseTo(p[1], 9);
      })
    );
  });

  it('covers a square of ground: the same metres east to west and north to south', () => {
    fc.assert(
      fc.property(lat, lon, side, (la, lo, s) => {
        const extent = photoExtentAround([lo, la], s);
        const west = imageToLonLat(extent, 0, 0.5);
        const east = imageToLonLat(extent, 1, 0.5);
        const north = imageToLonLat(extent, 0.5, 0);
        const south = imageToLonLat(extent, 0.5, 1);
        const ew = haversineMeters(west, east);
        const ns = haversineMeters(north, south);
        expect(ew / s).toBeGreaterThan(0.99);
        expect(ew / s).toBeLessThan(1.01);
        expect(ns / s).toBeGreaterThan(0.99);
        expect(ns / s).toBeLessThan(1.01);
      })
    );
  });

  it('is north up with the centre in the middle', () => {
    const center: LonLat = [-77.7, 39.08];
    const extent = photoExtentAround(center, 200);
    const mid = imageToLonLat(extent, 0.5, 0.5);
    expect(mid[0]).toBeCloseTo(center[0], 9);
    expect(mid[1]).toBeCloseTo(center[1], 9);
    expect(imageToLonLat(extent, 0.5, 0)[1]).toBeGreaterThan(center[1]);
    expect(imageToLonLat(extent, 0.5, 1)[1]).toBeLessThan(center[1]);
    expect(imageToLonLat(extent, 1, 0.5)[0]).toBeGreaterThan(center[0]);
    expect(imageToLonLat(extent, 0, 0.5)[0]).toBeLessThan(center[0]);
  });

  it('the photo for a box covers every corner of the box', () => {
    fc.assert(
      fc.property(lat, lon, side, side, (la, lo, w, h) => {
        const box = boxAround([lo, la], w, h);
        const extent = photoExtentFor(box);
        expect(extent.groundM).toBeCloseTo(Math.max(w, h), 4);
        for (const corner of [
          [box.minLon, box.minLat],
          [box.maxLon, box.maxLat]
        ] as LonLat[]) {
          const [x, y] = lonLatToImage(extent, corner);
          expect(x).toBeGreaterThan(-0.02);
          expect(x).toBeLessThan(1.02);
          expect(y).toBeGreaterThan(-0.02);
          expect(y).toBeLessThan(1.02);
        }
      })
    );
  });
});

describe('local frame and boxes', () => {
  it('local metres and lon/lat round trip', () => {
    fc.assert(
      fc.property(
        lat,
        lon,
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (la, lo, x, y) => {
          const f = localFrame([lo, la]);
          const [x2, y2] = toLocal(f, toLonLat(f, [x, y]));
          expect(x2).toBeCloseTo(x, 5);
          expect(y2).toBeCloseTo(y, 5);
        }
      )
    );
  });

  it('boxAround gives the asked ground size and centre', () => {
    const box = boxAround([-77.7, 39.08], 60, 40);
    const size = boxSizeM(box);
    expect(size.widthM).toBeCloseTo(60, 6);
    expect(size.heightM).toBeCloseTo(40, 6);
    expect(boxCenter(box)[0]).toBeCloseTo(-77.7, 9);
    expect(validBox(box)).toBe(true);
    expect(validBox({ ...box, minLon: box.maxLon })).toBe(false);
    expect(validBox({ ...box, minLat: Number.NaN })).toBe(false);
  });
});

describe('flat geometry', () => {
  const square: XY[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10]
  ];

  it('point in ring', () => {
    expect(pointInRing([5, 5], square)).toBe(true);
    expect(pointInRing([15, 5], square)).toBe(false);
  });

  it('segment to shape distance is zero when it touches and positive otherwise', () => {
    expect(segmentShapeDist([-5, 5], [15, 5], { type: 'polygon', ring: square })).toBe(0);
    expect(segmentShapeDist([-5, 20], [15, 20], { type: 'polygon', ring: square })).toBeCloseTo(10);
    expect(segmentShapeDist([0, 0], [10, 0], { type: 'circle', c: [5, 3], r: 2 })).toBeCloseTo(1);
    expect(segmentShapeDist([0, 0], [10, 0], { type: 'circle', c: [5, 1], r: 2 })).toBe(0);
    expect(
      segmentShapeDist([0, 5], [10, 5], {
        type: 'line',
        pts: [
          [5, 0],
          [5, 3]
        ],
        hw: 1
      })
    ).toBeCloseTo(1);
  });

  it('rectangle to shape distance sees a shape inside the rectangle', () => {
    const r = rectOf([0, 0], 10, 10);
    expect(rectShapeDist(r, { type: 'circle', c: [0, 0], r: 1 })).toBe(0);
    expect(rectShapeDist(r, { type: 'circle', c: [10, 0], r: 2 })).toBeCloseTo(3);
    expect(rectShapeDist(rectOf([5, 5], 2, 2), { type: 'polygon', ring: square })).toBe(0);
  });

  it('names the compass direction', () => {
    expect(compassFrom([0, 0], [0, 5])).toBe('n');
    expect(compassFrom([0, 0], [5, 0])).toBe('e');
    expect(compassFrom([0, 0], [0, -5])).toBe('s');
    expect(compassFrom([0, 0], [-5, -5])).toBe('sw');
  });
});

describe('geojsonShape', () => {
  it('reads polygons, lines and points, bare or wrapped', () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0]
    ];
    expect(geojsonShape(JSON.stringify({ type: 'Polygon', coordinates: [ring] }))?.type).toBe(
      'polygon'
    );
    expect(
      geojsonShape(
        JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } })
      )?.type
    ).toBe('polygon');
    expect(
      geojsonShape(JSON.stringify({ type: 'LineString', coordinates: [ring[0], ring[1]] }))
    ).toEqual({ type: 'line', points: [ring[0], ring[1]] });
    expect(geojsonShape(JSON.stringify({ type: 'Point', coordinates: [3, 4] }))).toEqual({
      type: 'line',
      points: [[3, 4]]
    });
  });

  it('is null for anything else', () => {
    for (const raw of [null, '', 'nope', '{}', '{"type":"Polygon","coordinates":[[[0,"a"]]]}']) {
      expect(geojsonShape(raw)).toBeNull();
    }
  });
});
