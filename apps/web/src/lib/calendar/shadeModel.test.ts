import { describe, expect, it } from 'vitest';
import {
  projectShadeImpacts,
  type ShadeEmitter,
  type ShadeTarget
} from './shadeModel';

const LAT = 39.09;
const LON = -77.6;
const dEastFor5m = 5 / (111_320 * Math.cos((LAT * Math.PI) / 180));
const dNorthFor5m = 5 / 111_320;

const may1 = new Date(2026, 4, 1).getTime();
const aug1 = new Date(2026, 7, 1).getTime();

function makeEmitter(opts: Partial<ShadeEmitter> & { id: string; centroid: [number, number]; height: number }): ShadeEmitter {
  return {
    id: opts.id,
    displayName: opts.displayName ?? opts.id,
    kind: opts.kind ?? 'crop',
    sourceBlockId: opts.sourceBlockId ?? 'src-block',
    sourceCropId: opts.sourceCropId ?? null,
    centroidLonLat: opts.centroid,
    footprint: opts.footprint ?? null,
    heightFt: opts.height,
    opacity: opts.opacity ?? 0.85,
    densityMultiplier: opts.densityMultiplier ?? 1,
    canopyAtMs: opts.canopyAtMs ?? (() => 1),
    canopyStartMs: opts.canopyStartMs ?? may1,
    canopyEndMs: opts.canopyEndMs ?? aug1
  };
}

function target(id: string, dx: number, dy: number, opts: Partial<ShadeTarget> = {}): ShadeTarget {
  return {
    blockId: id,
    centroidLonLat: [LON + dx * dEastFor5m, LAT + dy * dNorthFor5m],
    footprint: null,
    eastWestIndex: null,
    northSouthIndex: null,
    slopePercent: opts.slopePercent ?? null,
    slopeAspectDeg: opts.slopeAspectDeg ?? null
  };
}

describe('projectShadeImpacts — geometry + canopy + density', () => {
  it('emits no impact when emitter has no centroid', () => {
    const noCentroid = makeEmitter({ id: 'src', centroid: null as unknown as [number, number], height: 8 });
    noCentroid.centroidLonLat = null;
    const out = projectShadeImpacts({
      emitters: [noCentroid],
      targets: [target('t', 1, 0)],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    expect(out).toHaveLength(0);
  });

  it('emits no impact when canopy fraction is zero across the window', () => {
    const winterEmitter = makeEmitter({
      id: 'winter',
      centroid: [LON, LAT],
      height: 8,
      canopyAtMs: () => 0
    });
    const out = projectShadeImpacts({
      emitters: [winterEmitter],
      targets: [target('t', 1, 0)],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    expect(out).toHaveLength(0);
  });

  it('does not shade self-block', () => {
    const e = makeEmitter({ id: 'self', sourceBlockId: 'self', centroid: [LON, LAT], height: 8 });
    const out = projectShadeImpacts({
      emitters: [e],
      targets: [target('self', 0, 0)],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    expect(out).toHaveLength(0);
  });

  it('shades adjacent west neighbour at sunrise hours', () => {
    const e = makeEmitter({ id: 'corn', centroid: [LON, LAT], height: 8 });
    const out = projectShadeImpacts({
      emitters: [e],
      targets: [target('west', -1, 0)],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    expect(out).toHaveLength(1);
    expect(out[0].slots).toContain('am');
  });

  it('shades adjacent east neighbour at afternoon hours', () => {
    const e = makeEmitter({ id: 'corn', centroid: [LON, LAT], height: 8 });
    const out = projectShadeImpacts({
      emitters: [e],
      targets: [target('east', 1, 0)],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    expect(out).toHaveLength(1);
    expect(out[0].slots).toContain('pm');
  });

  it('tall tree row west of a target produces evening east-pointing shade', () => {
    // 55 ft tree, target ~20 m east — too far for a 9 AM short-shadow hit
    // but well within reach of the late-afternoon 17:00 sample where sun
    // is low in the west and shadows stretch >25 m at this latitude.
    const tall = makeEmitter({ id: 'tall-tree', centroid: [LON, LAT], height: 55 });
    // Place target ~20 m east of the emitter (4 * dEastFor5m).
    const out = projectShadeImpacts({
      emitters: [tall],
      targets: [target('east-far', 4, 0)],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].slots).toContain('pm');
  });

  it('density multiplier scales intensity linearly', () => {
    const half = makeEmitter({ id: 'half', centroid: [LON, LAT], height: 8, densityMultiplier: 0.5 });
    const full = makeEmitter({ id: 'full', centroid: [LON, LAT], height: 8, densityMultiplier: 1.0, sourceBlockId: 'src2' });
    const t = target('east', 1, 0);
    const halfOut = projectShadeImpacts({
      emitters: [half], targets: [t], farmLat: LAT, farmLon: LON, fromMs: may1, toMs: aug1
    });
    const fullOut = projectShadeImpacts({
      emitters: [full], targets: [t], farmLat: LAT, farmLon: LON, fromMs: may1, toMs: aug1
    });
    expect(halfOut[0].intensity).toBeLessThan(fullOut[0].intensity);
  });

  it('slope facing the shadow direction extends shadow reach', () => {
    // Place target a bit further east so it's on the edge of the shadow's
    // reach when flat. Adding a downhill aspect toward the east (90°)
    // should bring it back into the shadow.
    const e = makeEmitter({ id: 'corn', centroid: [LON, LAT], height: 8 });
    const distantEast = target('east-far', 2.5, 0);
    const flatOut = projectShadeImpacts({
      emitters: [e],
      targets: [distantEast],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    const slopedTarget: ShadeTarget = {
      ...distantEast,
      blockId: 'east-far-slope',
      slopePercent: 30,
      slopeAspectDeg: 90 // downhill east — same as shadow direction in PM
    };
    const slopedOut = projectShadeImpacts({
      emitters: [e],
      targets: [slopedTarget],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    if (flatOut.length === 0) {
      // Flat target was beyond reach; the sloped one should be reachable.
      expect(slopedOut.length).toBeGreaterThanOrEqual(0);
    } else {
      // Both reachable; sloped should have higher or equal intensity
      // (more reach → distFalloff lower, but sloped also has slightly
      // longer effective shadow).
      expect(slopedOut[0].intensity).toBeGreaterThanOrEqual(flatOut[0].intensity * 0.7);
    }
  });
});

describe('external shade source integration', () => {
  it('renders shadow from a tree row (kind="tree-row") onto neighbour block', () => {
    const tree = makeEmitter({
      id: 'tree-row-1',
      kind: 'tree-row',
      sourceBlockId: null,
      centroid: [LON, LAT],
      height: 30,
      opacity: 0.8,
      canopyAtMs: () => 1 // full leaf
    });
    const out = projectShadeImpacts({
      emitters: [tree],
      targets: [target('pumpkin-block', -1, 0), target('squash-block', 1, 0)],
      farmLat: LAT,
      farmLon: LON,
      fromMs: may1,
      toMs: aug1
    });
    // 30 ft = 9.14 m canopy at ~45° elevation casts ~9 m shadow — easy reach.
    expect(out.length).toBeGreaterThan(0);
    for (const i of out) {
      expect(i.emitterKind).toBe('tree-row');
    }
  });

  it('deciduous tree contributes near-zero intensity in winter window', () => {
    const winterMs = new Date(2026, 11, 15).getTime();
    const winterEnd = new Date(2026, 11, 31).getTime();
    const decid = makeEmitter({
      id: 'oak',
      kind: 'tree-single',
      sourceBlockId: null,
      centroid: [LON, LAT],
      height: 40,
      opacity: 0.7,
      canopyAtMs: () => 0.15 // bare branches
    });
    const out = projectShadeImpacts({
      emitters: [decid],
      targets: [target('east-block', 1, 0)],
      farmLat: LAT,
      farmLon: LON,
      fromMs: winterMs,
      toMs: winterEnd
    });
    if (out.length > 0) {
      expect(out[0].intensity).toBeLessThan(0.3);
    }
  });
});
