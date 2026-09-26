import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { footprintsOverlap } from './geometry';
import { intervalsOverlapInTime, ONE_DAY_MS, plantingOccupancy } from './occupancy';
import { resolveSpacing } from './plantCount';
import { MAX_SUCCESSIONS, proposeSuccession, type SuccessionInput } from './succession';
import type { Footprint, GardenCrop, OccupancyInterval, PlacedPlanting } from './types';

const day = (m: number, d: number, y = 2026) => Date.UTC(y, m - 1, d);
const FROST = day(10, 24);

const salanova: GardenCrop = {
  pluginId: 'lettuce-salanova-mix',
  displayName: 'Salanova Mix',
  cropFamily: 'leafy-green',
  archetype: 'cut-and-come-again-leafy',
  daysToMaturity: { min: 55, max: 60 },
  defaultRowSpacingInches: 12,
  plantingGuide: { rowSpacingIn: 12, inRowSpacingIn: { min: 8, max: 10 } }
};

const tomato: GardenCrop = {
  pluginId: 'tomato-celebrity-f1',
  displayName: 'Tomato Celebrity F1',
  cropFamily: 'solanaceae',
  archetype: 'continuous-harvest-fruit',
  daysToMaturity: { min: 70, max: 75 }
};

const tunnelBed = { blockId: 'bed1', widthFt: 3, lengthFt: 90 };

function anchorOf(crop: GardenCrop, over: Partial<PlacedPlanting> = {}): PlacedPlanting {
  return {
    cropId: 'anchor',
    blockId: 'bed1',
    cropPluginId: crop.pluginId,
    varietyDisplayName: crop.displayName,
    cropFamily: crop.cropFamily,
    status: 'planned',
    plantingDateMs: day(3, 1),
    harvestedAtMs: null,
    footprint: { x_in: 0, y_in: 0, w_in: 36, l_in: 180 },
    spacing: resolveSpacing(crop, 'square'),
    plantCount: 60,
    plantCountProvenance: 'data',
    groupId: null,
    groupSystemKind: null,
    ...over
  };
}

function input(over: Partial<SuccessionInput> = {}): SuccessionInput {
  const anchor = over.anchor ?? anchorOf(salanova);
  const crop = 'crop' in over ? over.crop : salanova;
  const own = plantingOccupancy(anchor, crop, { firstFallFrostMs: FROST });
  return {
    anchor,
    crop,
    bed: tunnelBed,
    count: 5,
    intervals: own ? [own] : [],
    firstFallFrostMs: FROST,
    ...over
  };
}

describe('proposeSuccession', () => {
  it('matches the tunnel scenario: five more sowings every 14 days fill the 90 ft bed', () => {
    const p = proposeSuccession(input());
    expect(p.intervalDays).toBe(14);
    expect(p.intervalSource).toBe('family');
    expect(p.sowings.map((s) => s.plantingDateMs)).toEqual([
      day(3, 15),
      day(3, 29),
      day(4, 12),
      day(4, 26),
      day(5, 10)
    ]);
    expect(p.sowings.map((s) => s.footprint?.y_in)).toEqual([180, 360, 540, 720, 900]);
    expect(p.sowings.every((s) => s.conflict === null && s.plantCount === 60)).toBe(true);
    expect(p.reason).toBe('Sow again every 14 days. All 5 sowings fit.');
  });

  it('says why a 0-day family is planted once', () => {
    const p = proposeSuccession(input({ anchor: anchorOf(tomato), crop: tomato }));
    expect(p.sowings).toEqual([]);
    expect(p.intervalDays).toBe(0);
    expect(p.reason).toBe("Tomato Celebrity F1 doesn't usually succession-sow here. Plant once.");
  });

  it('takes a typed interval as manual, even for a plant-once family', () => {
    const p = proposeSuccession(
      input({
        anchor: anchorOf(tomato, { footprint: null }),
        crop: tomato,
        intervalDays: 21,
        count: 1,
        intervals: []
      })
    );
    expect(p.intervalSource).toBe('manual');
    expect(p.sowings).toHaveLength(1);
    expect(p.sowings[0].plantingDateMs).toBe(day(3, 22));
  });

  it('needs a planting date', () => {
    const p = proposeSuccession(input({ anchor: anchorOf(salanova, { plantingDateMs: null }) }));
    expect(p.sowings).toEqual([]);
    expect(p.reason).toBe('Give Salanova Mix a planting date first.');
  });

  it('flags sowings that would not mature before frost', () => {
    const p = proposeSuccession(
      input({
        anchor: anchorOf(salanova, { plantingDateMs: day(8, 1) }),
        count: 3,
        intervalDays: 21
      })
    );
    expect(p.sowings.map((s) => s.conflict === null)).toEqual([true, false, false]);
    expect(p.sowings[1].conflict).toBe(
      'Sown Sep 12, it would not mature before the first fall frost on Oct 24.'
    );
    expect(p.reason).toContain('1 of 3 sowings fit.');
  });

  it('flags sowings with no room', () => {
    const smallBed = { blockId: 'bed1', widthFt: 3, lengthFt: 30 };
    const p = proposeSuccession(input({ bed: smallBed, count: 3 }));
    expect(p.sowings.map((s) => s.conflict)).toEqual([
      null,
      'No room in this bed on Mar 29.',
      'No room in this bed on Apr 12.'
    ]);
  });

  it('treats an unplaced occupant as filling the bed', () => {
    const other: OccupancyInterval = {
      cropId: 'other',
      blockId: 'bed1',
      startMs: day(3, 10),
      harvestStartMs: day(5, 1),
      harvestEndMs: day(6, 1),
      endMs: day(6, 11),
      footprint: null,
      actual: false
    };
    const base = input();
    const p = proposeSuccession({ ...base, intervals: [...base.intervals, other], count: 1 });
    expect(p.sowings[0].conflict).toBe('No room in this bed on Mar 15.');
  });

  it('keeps a typed plant count', () => {
    const p = proposeSuccession(
      input({
        anchor: anchorOf(salanova, { plantCount: 40, plantCountProvenance: 'manual' }),
        count: 1
      })
    );
    expect(p.sowings[0].plantCount).toBe(40);
  });

  it('clamps the count to 1 through MAX_SUCCESSIONS - 1', () => {
    expect(proposeSuccession(input({ count: 50 })).sowings).toHaveLength(MAX_SUCCESSIONS - 1);
    expect(proposeSuccession(input({ count: 0 })).sowings).toHaveLength(1);
  });

  it('never proposes a sowing that shares space and time with anything else', () => {
    const fpArb = fc.record({
      x_in: fc.constant(0),
      y_in: fc.integer({ min: 0, max: 170 }).map((n) => n * 6),
      w_in: fc.constant(36),
      l_in: fc.integer({ min: 1, max: 40 }).map((n) => n * 6)
    });
    const otherArb = fc.record({
      start: fc.integer({ min: 0, max: 200 }),
      len: fc.integer({ min: 1, max: 120 }),
      fp: fpArb
    });
    fc.assert(
      fc.property(
        fc.array(otherArb, { maxLength: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 60 }).map((n) => n * 6),
        (others, count, interval, anchorLen) => {
          const anchor = anchorOf(salanova, {
            footprint: { x_in: 0, y_in: 0, w_in: 36, l_in: anchorLen }
          });
          const base = input({ anchor });
          const existing: OccupancyInterval[] = [
            ...base.intervals,
            ...others.map((o, i) => ({
              cropId: `o${i}`,
              blockId: 'bed1',
              startMs: day(1, 1) + o.start * ONE_DAY_MS,
              harvestStartMs: day(1, 1) + o.start * ONE_DAY_MS,
              harvestEndMs: day(1, 1) + (o.start + o.len) * ONE_DAY_MS,
              endMs: day(1, 1) + (o.start + o.len) * ONE_DAY_MS,
              footprint: o.fp as Footprint,
              actual: false
            }))
          ];
          const p = proposeSuccession({
            ...base,
            intervals: existing,
            count,
            intervalDays: interval
          });
          const placed: OccupancyInterval[] = [];
          for (const s of p.sowings) {
            if (s.conflict) continue;
            const occ = plantingOccupancy(
              {
                ...anchor,
                cropId: `s${s.index}`,
                plantingDateMs: s.plantingDateMs,
                footprint: s.footprint
              },
              salanova,
              { firstFallFrostMs: FROST }
            )!;
            expect(s.footprint).not.toBeNull();
            expect(s.footprint!.w_in).toBe(36);
            expect(s.footprint!.l_in).toBe(anchorLen);
            expect(s.footprint!.y_in + s.footprint!.l_in).toBeLessThanOrEqual(1080);
            for (const e of [...existing, ...placed]) {
              if (!intervalsOverlapInTime(e, occ)) continue;
              expect(footprintsOverlap(e.footprint!, s.footprint!)).toBe(false);
            }
            placed.push(occ);
          }
        }
      )
    );
  });
});
