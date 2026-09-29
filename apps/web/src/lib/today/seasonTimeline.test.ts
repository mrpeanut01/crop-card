import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildSeasonTimeline,
  seasonOfPlanting,
  seasonWindow,
  seasonYears,
  type SeasonTimelineInput
} from './seasonTimeline';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();
const FROST = { lastSpring: '04-15', firstFall: '10-20' };

function input(over: Partial<SeasonTimelineInput> = {}): SeasonTimelineInput {
  return {
    year: 2026,
    activePlanningYear: 2027,
    frost: FROST,
    plantings: [],
    events: [],
    records: [],
    tasks: [],
    now: d(2026, 7, 1),
    ...over
  };
}

describe('season bounds', () => {
  it('runs from the prior rollover to its own, eight weeks before each fall frost', () => {
    const w = seasonWindow(2026, FROST);
    expect(w.prepStartMs).toBe(d(2025, 8, 25));
    expect(w.nextPrepMs).toBe(d(2026, 8, 25));
    expect(seasonWindow(2027, FROST).prepStartMs).toBe(w.nextPrepMs);
  });

  it('a planting belongs to its planting year, an undated plan to the planning year', () => {
    expect(seasonOfPlanting(d(2026, 5, 1), 2027)).toBe(2026);
    expect(seasonOfPlanting(null, 2027)).toBe(2027);
  });

  it('a planting made after the rollover belongs to next season, as on /plan', () => {
    expect(seasonOfPlanting(d(2026, 8, 24), 2027, FROST)).toBe(2026);
    expect(seasonOfPlanting(d(2026, 8, 25), 2027, FROST)).toBe(2027);
    expect(seasonOfPlanting(d(2026, 8, 30), 2027, null)).toBe(2027);
    expect(seasonOfPlanting(d(2026, 6, 15), 2027, null)).toBe(2026);
  });

  it('offers every year with data, the current year and the planning year, newest first', () => {
    expect(
      seasonYears({
        yearsWithPlantings: [2024, 2026],
        setupYears: [2025],
        activePlanningYear: 2027,
        now: d(2026, 9, 29)
      })
    ).toEqual([2027, 2026, 2025, 2024]);
  });
});

describe('buildSeasonTimeline', () => {
  const tomato = {
    id: 'p1',
    name: 'Tomato',
    blockId: 'b1',
    blockName: 'North bed',
    plantingDate: d(2026, 5, 10),
    status: 'active'
  };

  it('one row per planting, with a frost band on top', () => {
    const t = buildSeasonTimeline(
      input({
        plantings: [
          tomato,
          { ...tomato, id: 'old', plantingDate: d(2025, 5, 1) },
          { ...tomato, id: 'plan', plantingDate: null, status: 'planned' }
        ]
      })
    );
    expect(t.rows.map((r) => r.plantingId)).toEqual(['p1']);
    expect(t.band).toEqual({ startMs: d(2026, 4, 15), endMs: d(2026, 10, 20), source: 'frost' });
    expect(t.fromMs).toBe(d(2025, 8, 25));
    expect(t.toMs).toBe(d(2026, 10, 20));
  });

  it('recorded work is solid, planned and suggested work dashed, and the grow span ends at harvest', () => {
    const t = buildSeasonTimeline(
      input({
        plantings: [tomato],
        events: [
          {
            kind: 'harvest-window',
            blockId: 'b1',
            cropId: 'p1',
            startMs: d(2026, 8, 1),
            endMs: d(2026, 9, 15),
            title: 'Harvest tomato'
          },
          {
            kind: 'emergence',
            blockId: 'b1',
            cropId: 'p1',
            startMs: d(2026, 5, 17),
            endMs: d(2026, 5, 17),
            title: 'Emerges'
          }
        ],
        records: [
          { kind: 'spray', blockId: 'b1', occurredAt: d(2026, 6, 1), label: 'Fungicide spray' },
          { kind: 'spray', blockId: 'b1', occurredAt: d(2026, 4, 1), label: 'Before planting' },
          { kind: 'harvest', blockId: 'b9', occurredAt: d(2026, 8, 3), label: 'Other block' }
        ],
        tasks: [
          {
            title: 'Cultivate',
            kind: 'primary',
            cropId: 'p1',
            category: 'till',
            scheduledFor: d(2026, 6, 10),
            completedAt: d(2026, 6, 11)
          },
          {
            title: 'Side-dress',
            kind: 'primary',
            blockId: 'b1',
            category: 'fertilize',
            scheduledFor: d(2026, 7, 5)
          },
          {
            title: 'Skipped',
            kind: 'primary',
            cropId: 'p1',
            category: 'spray',
            scheduledFor: d(2026, 7, 6),
            abortedAt: d(2026, 7, 6)
          },
          {
            title: 'Scout',
            kind: 'primary',
            cropId: 'p1',
            category: 'scout',
            scheduledFor: d(2026, 7, 7)
          }
        ]
      })
    );
    const row = t.rows.find((r) => r.plantingId === 'p1')!;
    const spans = row.spans.map((s) => [s.kind, s.recorded, s.label]);
    expect(spans).toEqual([
      ['grow', true, 'Growing'],
      ['plant', true, 'Planted'],
      ['spray', true, 'Fungicide spray'],
      ['till', true, 'Cultivate'],
      ['fertilize', false, 'Side-dress'],
      ['harvest', false, 'Harvest tomato']
    ]);
    const grow = row.spans[0];
    expect(grow.endMs).toBe(d(2026, 9, 15));
    expect(row.spans.find((s) => s.kind === 'harvest')?.suggestion).toBe(0);
    expect(t.rows.find((r) => r.blockWork)?.spans.map((s) => s.label)).toEqual(['Before planting']);
  });

  it('a future planting is dashed, and with no frost dates the band comes from the plantings', () => {
    const t = buildSeasonTimeline(
      input({
        frost: null,
        now: d(2026, 3, 1),
        plantings: [{ ...tomato, status: 'planned' }],
        events: [
          {
            kind: 'harvest-window',
            blockId: 'b1',
            cropId: 'p1',
            startMs: d(2026, 8, 1),
            endMs: d(2026, 8, 20),
            title: 'Harvest'
          }
        ]
      })
    );
    expect(t.rows[0].spans.every((s) => !s.recorded)).toBe(true);
    expect(t.band).toEqual({ startMs: d(2026, 5, 10), endMs: d(2026, 8, 20), source: 'plantings' });
    expect(t.prepStartMs).toBe(d(2025, 7, 1));
  });

  it('block records stop at the next planting on the same block', () => {
    const t = buildSeasonTimeline(
      input({
        plantings: [
          { ...tomato, id: 'spring', plantingDate: d(2026, 3, 20), name: 'Peas' },
          { ...tomato, id: 'summer', plantingDate: d(2026, 6, 15), name: 'Beans' }
        ],
        records: [
          { kind: 'spray', blockId: 'b1', occurredAt: d(2026, 5, 1), label: 'Early' },
          { kind: 'spray', blockId: 'b1', occurredAt: d(2026, 7, 1), label: 'Late' }
        ]
      })
    );
    const labels = (id: string) =>
      t.rows
        .find((r) => r.plantingId === id)!
        .spans.filter((s) => s.kind === 'spray')
        .map((s) => s.label);
    expect(labels('spring')).toEqual(['Early']);
    expect(labels('summer')).toEqual(['Late']);
  });

  it('the range always covers the season window and every span', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -400, max: 700 }), { maxLength: 6 }), (offsets) => {
        const t = buildSeasonTimeline(
          input({
            plantings: [tomato],
            records: offsets.map((o, i) => ({
              kind: 'spray' as const,
              blockId: 'b1',
              cropId: 'p1',
              occurredAt: tomato.plantingDate + o * 86_400_000,
              label: `r${i}`
            }))
          })
        );
        expect(t.fromMs).toBeLessThanOrEqual(t.prepStartMs);
        expect(t.toMs).toBeGreaterThanOrEqual(t.nextPrepMs);
        for (const s of t.rows.flatMap((r) => r.spans)) {
          expect(s.startMs).toBeGreaterThanOrEqual(t.fromMs);
          expect(s.endMs).toBeLessThanOrEqual(t.toMs);
          expect(s.endMs).toBeGreaterThanOrEqual(s.startMs);
        }
      })
    );
  });
});

describe('block field work (#467 review)', () => {
  const tomato = {
    id: 'tom',
    name: 'Tomato',
    blockId: 'A',
    blockName: 'Block A',
    plantingDate: d(2026, 5, 1),
    status: 'planned'
  };

  it('shows till, burndown and pre-plant feed on the block before its planting', () => {
    const t = buildSeasonTimeline(
      input({
        plantings: [tomato],
        records: [
          { kind: 'spray', blockId: 'A', occurredAt: d(2026, 4, 15), label: 'Herbicide spray' },
          {
            kind: 'fertilize',
            blockId: 'A',
            occurredAt: d(2026, 4, 20),
            label: 'Fertilizer applied'
          }
        ],
        tasks: [
          {
            title: 'Till',
            kind: 'primary',
            blockId: 'A',
            scheduledFor: d(2026, 4, 1),
            category: 'till'
          }
        ]
      })
    );
    const work = t.rows.find((r) => r.blockWork);
    expect(work).toMatchObject({ plantingId: 'block:A', name: 'Field work', blockName: 'Block A' });
    expect(work!.spans.map((s) => s.kind)).toEqual(['till', 'spray', 'fertilize']);
    expect(t.rows[0].blockWork).toBe(true);
    const row = t.rows.find((r) => r.plantingId === 'tom')!;
    expect(row.spans.some((s) => s.kind === 'till' || s.kind === 'spray')).toBe(false);
  });

  it('gives a tilled fallow block its own row', () => {
    const t = buildSeasonTimeline(
      input({
        blockNames: new Map([['F', 'Fallow field']]),
        tasks: [
          {
            title: 'Till',
            kind: 'primary',
            blockId: 'F',
            scheduledFor: d(2026, 3, 10),
            completedAt: d(2026, 3, 10),
            category: 'till'
          }
        ]
      })
    );
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ blockWork: true, blockName: 'Fallow field' });
    expect(t.rows[0].spans[0]).toMatchObject({ kind: 'till', recorded: true });
  });

  it('never repeats work a planting row already holds, and stays inside the prep window', () => {
    const t = buildSeasonTimeline(
      input({
        plantings: [tomato],
        records: [
          { kind: 'spray', blockId: 'A', occurredAt: d(2026, 6, 1), label: 'After planting' },
          { kind: 'spray', blockId: 'A', occurredAt: d(2025, 6, 1), label: 'Last season' },
          { kind: 'spray', blockId: 'A', occurredAt: d(2026, 9, 1), label: 'Next prep' }
        ]
      })
    );
    expect(t.rows.filter((r) => r.blockWork)).toHaveLength(0);
  });

  it('leaves unnamed work to another season crop still in the ground', () => {
    const garlic = {
      id: 'gar',
      name: 'Garlic',
      blockId: 'G',
      blockName: 'Block G',
      plantingDate: d(2025, 8, 1),
      status: 'planted'
    };
    const t = buildSeasonTimeline(
      input({
        otherPlantings: [garlic],
        records: [
          { kind: 'fertilize', blockId: 'G', occurredAt: d(2026, 3, 1), label: 'Spring feed' }
        ]
      })
    );
    expect(t.rows).toHaveLength(0);
    const after = buildSeasonTimeline(
      input({
        otherPlantings: [{ ...garlic, harvestedAt: d(2026, 2, 1) }],
        records: [
          { kind: 'fertilize', blockId: 'G', occurredAt: d(2026, 3, 1), label: 'Spring feed' }
        ]
      })
    );
    expect(after.rows).toHaveLength(1);
  });
});
