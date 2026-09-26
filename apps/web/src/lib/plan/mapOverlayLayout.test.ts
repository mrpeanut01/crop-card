import { describe, expect, it } from 'vitest';
import { layoutMapOverlay, outerRings } from './mapOverlayLayout';

function square(lon: number, lat: number, d: number): string {
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + d, lat],
        [lon + d, lat + d],
        [lon, lat + d],
        [lon, lat]
      ]
    ]
  });
}

describe('outerRings', () => {
  it('reads Polygon, MultiPolygon and Feature wrappers', () => {
    expect(outerRings(square(-77.5, 39, 0.001))).toHaveLength(1);
    const multi = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [
        JSON.parse(square(0, 0, 1)).coordinates,
        JSON.parse(square(2, 2, 1)).coordinates
      ]
    });
    expect(outerRings(multi)).toHaveLength(2);
    const feature = JSON.stringify({ type: 'Feature', geometry: JSON.parse(square(0, 0, 1)) });
    expect(outerRings(feature)).toHaveLength(1);
  });

  it('returns nothing for missing, malformed or degenerate geometry', () => {
    expect(outerRings(undefined)).toEqual([]);
    expect(outerRings('{nope')).toEqual([]);
    expect(outerRings(JSON.stringify({ type: 'Point', coordinates: [0, 0] }))).toEqual([]);
    expect(
      outerRings(
        JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 1]
            ]
          ]
        })
      )
    ).toEqual([]);
  });
});

describe('layoutMapOverlay', () => {
  it('draws field and block outlines from geometry with north up', () => {
    const layout = layoutMapOverlay(
      [{ id: 'f1', name: 'East Field', geometryGeojson: square(-77.5, 39.0, 0.002) }],
      [
        {
          id: 'north',
          name: 'Block 1',
          fieldId: 'f1',
          geometryGeojson: square(-77.4995, 39.0015, 0.0004)
        },
        {
          id: 'south',
          name: 'Block 2',
          fieldId: 'f1',
          geometryGeojson: square(-77.4995, 39.0001, 0.0004)
        },
        { id: 'loose', name: 'Block 3', fieldId: 'f1' }
      ]
    );
    expect(layout.mode).toBe('geometry');
    expect(layout.fields.map((f) => f.id)).toEqual(['f1']);
    expect(layout.blocks.map((b) => b.id)).toEqual(['north', 'south']);
    expect(layout.undrawn).toEqual([{ id: 'loose', name: 'Block 3' }]);

    const north = layout.blocks.find((b) => b.id === 'north')!;
    const south = layout.blocks.find((b) => b.id === 'south')!;
    expect(north.labelY).toBeLessThan(south.labelY);

    const field = layout.fields[0];
    const xs = field.rings[0].map((p) => p[0]);
    const ys = field.rings[0].map((p) => p[1]);
    const wM = Math.max(...xs) - Math.min(...xs);
    const hM = Math.max(...ys) - Math.min(...ys);
    // 0.002° square at 39°N is ~173 m wide and ~223 m tall.
    expect(wM).toBeGreaterThan(165);
    expect(wM).toBeLessThan(180);
    expect(hM).toBeGreaterThan(215);
    expect(hM).toBeLessThan(230);

    for (const s of [...layout.fields, ...layout.blocks]) {
      for (const [x, y] of s.rings.flat()) {
        expect(x).toBeGreaterThanOrEqual(layout.minX - 1e-6);
        expect(x).toBeLessThanOrEqual(layout.minX + layout.width + 1e-6);
        expect(y).toBeGreaterThanOrEqual(layout.minY - 1e-6);
        expect(y).toBeLessThanOrEqual(layout.minY + layout.height + 1e-6);
      }
    }
  });

  it('falls back to the dimension sketch when nothing is mapped', () => {
    const layout = layoutMapOverlay(
      [{ id: 'f1', name: 'Home', widthFt: 200, lengthFt: 300 }],
      [
        { id: 'b1', name: 'Block 1', fieldId: 'f1', widthFt: 50, lengthFt: 100 },
        { id: 'b2', name: 'Block 2', fieldId: 'f1' }
      ]
    );
    expect(layout.mode).toBe('sketch');
    expect(layout.fields).toHaveLength(1);
    expect(layout.blocks.map((b) => b.id)).toEqual(['b1']);
    expect(layout.undrawn).toEqual([{ id: 'b2', name: 'Block 2' }]);
  });

  it('reports mode none when there is nothing to draw', () => {
    const layout = layoutMapOverlay([{ id: 'f1', name: 'Home' }], [{ id: 'b1', name: 'Block 1' }]);
    expect(layout.mode).toBe('none');
    expect(layout.undrawn).toHaveLength(1);
  });
});
