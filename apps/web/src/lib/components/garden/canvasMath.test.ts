import { describe, expect, it } from 'vitest';
import { rectFt } from '$lib/garden/geometry';
import type { BedLayout } from '$lib/garden/types';
import {
  MAX_PX_PER_FT,
  bedLocalToCanvas,
  clampView,
  fitText,
  fitView,
  padRect,
  plantDots,
  zoomView
} from './canvasMath';

const bed = (rotationDeg: BedLayout['rotationDeg']): BedLayout => ({
  blockId: 'b',
  name: 'Bed',
  kind: 'bed',
  bedStyle: 'raised',
  widthFt: 4,
  lengthFt: 8,
  rotationDeg,
  rect: rotationDeg === 90 || rotationDeg === 270 ? rectFt(10, 10, 8, 4) : rectFt(10, 10, 4, 8)
});

describe('canvasMath', () => {
  it('maps a bed corner through every quarter turn', () => {
    expect(bedLocalToCanvas(bed(0), 0, 0)).toEqual([10, 10]);
    expect(bedLocalToCanvas(bed(90), 0, 0)).toEqual([18, 10]);
    expect(bedLocalToCanvas(bed(180), 0, 0)).toEqual([14, 18]);
    expect(bedLocalToCanvas(bed(270), 0, 0)).toEqual([10, 14]);
  });

  it('places one dot per plant inside the footprint', () => {
    const dots = plantDots({ x_in: 0, y_in: 0, w_in: 48, l_in: 96 }, bed(0), {
      inRowIn: 30,
      rowIn: 48,
      pattern: 'square',
      source: 'plugin'
    });
    expect(dots).toHaveLength(3);
    for (const [x, y] of dots) {
      expect(x).toBeGreaterThan(10);
      expect(x).toBeLessThan(14);
      expect(y).toBeGreaterThan(10);
      expect(y).toBeLessThan(18);
    }
  });

  it('caps dots on a huge planting', () => {
    const dots = plantDots(
      { x_in: 0, y_in: 0, w_in: 36, l_in: 1080 },
      { ...bed(0), lengthFt: 90 },
      {
        inRowIn: 2,
        rowIn: 2,
        pattern: 'square',
        source: 'plugin'
      }
    );
    expect(dots.length).toBeLessThanOrEqual(240);
  });

  it('zooms between the whole Area and 96 px per foot, staying inside it', () => {
    const fit = fitView(20, 30);
    const out = zoomView(fit, 0.5, 10, 15, fit, 400);
    expect(out).toEqual(fit);
    let v = fit;
    for (let i = 0; i < 30; i++) v = zoomView(v, 2, 0, 0, fit, 400);
    expect(400 / v.w).toBeCloseTo(MAX_PX_PER_FT, 5);
    expect(v.x).toBeGreaterThanOrEqual(fit.x);
    expect(clampView({ ...v, x: 500, y: 500 }, fit).x).toBeLessThanOrEqual(fit.x + fit.w - v.w);
  });

  it('cuts labels to fit with an ellipsis', () => {
    expect(fitText('Bed 1', 10, 0.5)).toBe('Bed 1');
    expect(fitText('Tomato Celebrity F1', 3, 0.5)).toBe('Tomato Cel…');
    expect(fitText('Tomato', 0.5, 0.5)).toBe('');
  });

  it('pads small hit areas to the minimum', () => {
    expect(padRect(rectFt(5, 5, 1, 1), 3)).toEqual({ x: 4, y: 4, w: 3, h: 3 });
    expect(padRect(rectFt(5, 5, 4, 8), 3)).toEqual({ x: 5, y: 5, w: 4, h: 8 });
  });
});
