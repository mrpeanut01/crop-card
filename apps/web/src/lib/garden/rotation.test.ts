import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CompanionPlugin } from '$lib/plugins/schemas';
import { adjacentBeds, bedRect } from './geometry';
import {
  bedHistory,
  companionHints,
  familyLabel,
  ROTATION_HISTORY_YEARS,
  rotationWarnings
} from './rotation';
import type {
  BedHistoryEntry,
  BedLayout,
  OccupancyInterval,
  PlacedPlanting,
  PlantingStatus
} from './types';

const day = (m: number, d: number, y = 2026) => Date.UTC(y, m - 1, d);

function entry(
  cropId: string,
  seasonYear: number,
  cropFamily: string,
  status: PlantingStatus = 'harvested',
  plantingDateMs: number | null = Date.UTC(seasonYear, 4, 1)
): BedHistoryEntry {
  return {
    cropId,
    cropPluginId: `${cropFamily}-plugin`,
    varietyDisplayName: cropId,
    cropFamily,
    archetype: 'continuous-harvest-fruit',
    status,
    plantingDateMs,
    harvestedAtMs: null,
    seasonYear
  };
}

const LOOKBACK = { solanaceae: 3, brassica: 3, cucurbit: 2, legume: 2 };

describe('familyLabel', () => {
  it('names families in plain words', () => {
    expect(familyLabel('solanaceae')).toBe('Tomato family');
    expect(familyLabel('cover-legume')).toBe('Legume cover crops');
    expect(familyLabel('stone-fruit')).toBe('Stone fruit');
    expect(familyLabel('')).toBe('This family');
  });
});

describe('bedHistory', () => {
  it('keeps four seasons back plus this one, newest first', () => {
    const out = bedHistory(
      [
        entry('old', 2021, 'legume'),
        entry('a', 2022, 'legume'),
        entry('b', 2025, 'solanaceae', 'harvested', day(4, 1, 2025)),
        entry('c', 2025, 'leafy-green', 'harvested', day(6, 1, 2025)),
        entry('d', 2026, 'brassica'),
        entry('future', 2027, 'brassica'),
        entry('undated', 2025, 'root', 'failed', null)
      ],
      2026
    );
    expect(out.map((e) => e.cropId)).toEqual(['d', 'c', 'b', 'undated', 'a']);
    expect(ROTATION_HISTORY_YEARS).toBe(4);
  });

  it('is sorted by season, newest first, and inside the window', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 2015, max: 2030 }), { maxLength: 20 }),
        fc.integer({ min: 2018, max: 2028 }),
        (years, season) => {
          const out = bedHistory(
            years.map((y, i) => entry(`c${i}`, y, 'root')),
            season
          );
          for (let i = 1; i < out.length; i++) {
            expect(out[i - 1].seasonYear).toBeGreaterThanOrEqual(out[i].seasonYear);
          }
          for (const e of out) {
            expect(e.seasonYear).toBeLessThanOrEqual(season);
            expect(e.seasonYear).toBeGreaterThanOrEqual(season - ROTATION_HISTORY_YEARS);
          }
        }
      )
    );
  });
});

describe('rotationWarnings', () => {
  const history = [entry('tomatoes', 2025, 'solanaceae'), entry('squash', 2025, 'cucurbit')];

  it('warns amber for peppers after last year’s tomatoes', () => {
    expect(rotationWarnings('bed3', 'Bed 3', history, 'solanaceae', 2026, LOOKBACK)).toEqual([
      {
        blockId: 'bed3',
        family: 'solanaceae',
        severity: 'warn',
        lastSeasonYear: 2025,
        lookbackYears: 3,
        message:
          'Tomato family grew here in 2025. Rotating away for 3 years cuts disease carryover.'
      }
    ]);
  });

  it('suggests for a shorter plant-back window', () => {
    const [w] = rotationWarnings('bed3', 'Bed 3', history, 'cucurbit', 2026, LOOKBACK);
    expect(w.severity).toBe('suggest');
    expect(w.lookbackYears).toBe(2);
  });

  it('is quiet outside the window and for other families', () => {
    expect(rotationWarnings('bed3', 'Bed 3', history, 'solanaceae', 2028, LOOKBACK)).toEqual([]);
    expect(rotationWarnings('bed3', 'Bed 3', history, 'legume', 2026, LOOKBACK)).toEqual([]);
    expect(rotationWarnings('bed3', 'Bed 3', [], 'solanaceae', 2026, LOOKBACK)).toEqual([]);
  });

  it('counts an earlier planting this season as last season', () => {
    const [w] = rotationWarnings(
      'bed3',
      'Bed 3',
      [entry('spring', 2026, 'solanaceae', 'active')],
      'solanaceae',
      2026,
      LOOKBACK
    );
    expect(w.severity).toBe('warn');
    expect(w.lastSeasonYear).toBe(2026);
    expect(w.message).toBe(
      'Tomato family grew here earlier this season. Rotating away for 3 years cuts disease carryover.'
    );
  });

  it('lets one-year families follow themselves in the same season', () => {
    expect(
      rotationWarnings('b', 'B', [entry('lettuce', 2026, 'leafy-green')], 'leafy-green', 2026, {})
    ).toEqual([]);
    const [w] = rotationWarnings(
      'b',
      'B',
      [entry('beans', 2026, 'legume')],
      'legume',
      2026,
      LOOKBACK
    );
    expect(w.message).toBe(
      'Bean family grew here earlier this season. Rotating away for 2 years cuts disease carryover.'
    );
  });

  it('ignores failed plantings and reports the most recent repeat', () => {
    expect(
      rotationWarnings(
        'b',
        'B',
        [entry('x', 2025, 'solanaceae', 'failed')],
        'solanaceae',
        2026,
        LOOKBACK
      )
    ).toEqual([]);
    const [w] = rotationWarnings(
      'b',
      'B',
      [entry('x', 2023, 'solanaceae'), entry('y', 2025, 'solanaceae')],
      'solanaceae',
      2026,
      LOOKBACK
    );
    expect(w.lastSeasonYear).toBe(2025);
  });

  it('warns exactly when the gap is inside the plant-back window', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2018, max: 2026 }),
        fc.integer({ min: 1, max: 5 }),
        (year, lookback) => {
          const out = rotationWarnings('b', 'B', [entry('x', year, 'brassica')], 'brassica', 2026, {
            brassica: lookback
          });
          const gap = 2026 - Math.min(year, 2025);
          expect(out.length).toBe(gap < lookback ? 1 : 0);
          if (out.length) expect(out[0].severity).toBe(lookback >= 3 ? 'warn' : 'suggest');
        }
      )
    );
  });
});

function bed(blockId: string, x: number, y: number, w: number, l: number): BedLayout {
  return {
    blockId,
    name: blockId,
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: w,
    lengthFt: l,
    rotationDeg: 0,
    rect: bedRect(x, y, w, l, 0)
  };
}

function planting(
  cropId: string,
  blockId: string,
  cropPluginId: string,
  cropFamily: string
): PlacedPlanting {
  return {
    cropId,
    blockId,
    cropPluginId,
    varietyDisplayName: cropPluginId,
    cropFamily,
    status: 'planned',
    plantingDateMs: day(5, 1),
    harvestedAtMs: null,
    footprint: null,
    spacing: { inRowIn: 12, rowIn: 12, pattern: 'square', source: 'fallback' },
    plantCount: null,
    plantCountProvenance: null,
    groupId: null,
    groupSystemKind: null
  };
}

function interval(cropId: string, blockId: string, start: number, end: number): OccupancyInterval {
  return {
    cropId,
    blockId,
    startMs: start,
    harvestStartMs: start,
    harvestEndMs: end,
    endMs: end,
    footprint: null,
    actual: false
  };
}

function companion(over: Partial<CompanionPlugin>): CompanionPlugin {
  return {
    pluginId: 'c',
    displayName: 'C',
    version: '1.0.0',
    type: 'companion',
    goodWith: [],
    badWith: [],
    ...over
  } as CompanionPlugin;
}

describe('companionHints', () => {
  const beds = [
    bed('bed1', 2, 3, 3, 90),
    bed('bed2', 9, 3, 3, 90),
    bed('bed3', 16, 3, 3, 90),
    bed('bed4', 23, 3, 3, 90)
  ];
  const adjacency = adjacentBeds(beds);
  const beansOnions = companion({
    pluginId: 'beans-onions-fixture',
    badWith: ['bean-bush', 'onion-yellow'],
    benefit: 'Onions stunt beans.'
  });
  const alyssum = companion({
    pluginId: 'alyssum-lettuce-aphid',
    primaryFamily: 'leafy-green',
    goodWith: ['lettuce-buttercrunch', 'lettuce-red-sails'],
    members: [{ family: 'broadleaf-companion', role: 'insectary', plantingOffsetDays: -14 }],
    benefit: 'Hoverflies eat aphids.'
  });
  const season = (id: string, b: string) => interval(id, b, day(5, 1), day(8, 1));

  it('flags beans next to onions in the adjacent bed as keep apart', () => {
    const plantings = [
      planting('beans', 'bed2', 'bean-bush', 'legume'),
      planting('onions', 'bed3', 'onion-yellow', 'allium')
    ];
    const hints = companionHints(
      beds,
      plantings,
      [season('beans', 'bed2'), season('onions', 'bed3')],
      [beansOnions],
      adjacency
    );
    expect(hints).toEqual([
      {
        relation: 'keep-apart',
        companionPluginId: 'beans-onions-fixture',
        a: { blockId: 'bed2', cropId: 'beans', cropPluginId: 'bean-bush' },
        b: { blockId: 'bed3', cropId: 'onions', cropPluginId: 'onion-yellow' },
        sameBed: false,
        benefit: 'Onions stunt beans.'
      }
    ]);
  });

  it('says nothing for beds too far apart or plantings that never share time', () => {
    const far = [
      planting('beans', 'bed1', 'bean-bush', 'legume'),
      planting('onions', 'bed4', 'onion-yellow', 'allium')
    ];
    expect(
      companionHints(
        beds,
        far,
        [season('beans', 'bed1'), season('onions', 'bed4')],
        [beansOnions],
        adjacency
      )
    ).toEqual([]);
    const apart = [
      planting('beans', 'bed2', 'bean-bush', 'legume'),
      planting('onions', 'bed3', 'onion-yellow', 'allium')
    ];
    expect(
      companionHints(
        beds,
        apart,
        [
          interval('beans', 'bed2', day(3, 1), day(5, 1)),
          interval('onions', 'bed3', day(5, 1), day(9, 1))
        ],
        [beansOnions],
        adjacency
      )
    ).toEqual([]);
  });

  it('pairs good neighbours by goodWith, or by goodWith plus a member family', () => {
    const plantings = [
      planting('lettuce', 'bed1', 'lettuce-buttercrunch', 'leafy-green'),
      planting('sails', 'bed1', 'lettuce-red-sails', 'leafy-green'),
      planting('alyssum', 'bed2', 'alyssum-carpet', 'broadleaf-companion'),
      planting('carrot', 'bed2', 'carrot-danvers', 'root')
    ];
    const hints = companionHints(
      beds,
      plantings,
      plantings.map((p) => season(p.cropId, p.blockId)),
      [alyssum],
      adjacency
    );
    expect(hints.map((h) => [h.relation, h.a.cropId, h.b.cropId, h.sameBed])).toEqual([
      ['good-neighbor', 'lettuce', 'sails', true],
      ['good-neighbor', 'alyssum', 'lettuce', false],
      ['good-neighbor', 'alyssum', 'sails', false]
    ]);
    expect(hints[0].benefit).toBe('Hoverflies eat aphids.');
  });

  it('never pairs two plantings of the same crop, and sorts keep apart first', () => {
    const plantings = [
      planting('l1', 'bed1', 'lettuce-buttercrunch', 'leafy-green'),
      planting('l2', 'bed1', 'lettuce-buttercrunch', 'leafy-green'),
      planting('beans', 'bed1', 'bean-bush', 'legume'),
      planting('onions', 'bed1', 'onion-yellow', 'allium'),
      planting('sails', 'bed1', 'lettuce-red-sails', 'leafy-green')
    ];
    const hints = companionHints(
      beds,
      plantings,
      plantings.map((p) => season(p.cropId, p.blockId)),
      [alyssum, beansOnions],
      adjacency
    );
    expect(hints[0].relation).toBe('keep-apart');
    expect(hints.some((h) => h.a.cropPluginId === h.b.cropPluginId)).toBe(false);
    expect(hints.filter((h) => h.relation === 'good-neighbor')).toHaveLength(2);
  });

  it('skips plantings with no interval or outside the Area', () => {
    const plantings = [
      planting('beans', 'bed2', 'bean-bush', 'legume'),
      planting('onions', 'elsewhere', 'onion-yellow', 'allium')
    ];
    expect(
      companionHints(
        beds,
        plantings,
        [season('beans', 'bed2'), season('onions', 'elsewhere')],
        [beansOnions],
        [['bed2', 'elsewhere']]
      )
    ).toEqual([]);
    expect(companionHints(beds, plantings, [], [beansOnions], adjacency)).toEqual([]);
  });
});

describe('companionHints with two-sided keepApart', () => {
  const beds = [
    bed('bed1', 2, 3, 3, 90),
    bed('bed2', 9, 3, 3, 90),
    bed('bed3', 16, 3, 3, 90),
    bed('bed4', 23, 3, 3, 90)
  ];
  const adjacency = adjacentBeds(beds);
  const sideA = ['tomato-celebrity-f1', 'tomato-san-marzano'];
  const sideB = ['potato-kennebec', 'potato-yukon-gold'];
  const blight = companion({
    pluginId: 'tomato-potato-fixture',
    keepApart: [{ a: sideA, b: sideB, reason: 'Late blight spreads between them' }]
  });
  const season = (id: string, b: string) => interval(id, b, day(5, 1), day(8, 1));

  it('flags a tomato next to a potato with the entry reason', () => {
    const plantings = [
      planting('pot', 'bed3', 'potato-kennebec', 'solanaceae'),
      planting('tom', 'bed2', 'tomato-celebrity-f1', 'solanaceae')
    ];
    expect(
      companionHints(
        beds,
        plantings,
        [season('tom', 'bed2'), season('pot', 'bed3')],
        [blight],
        adjacency
      )
    ).toEqual([
      {
        relation: 'keep-apart',
        companionPluginId: 'tomato-potato-fixture',
        a: { blockId: 'bed3', cropId: 'pot', cropPluginId: 'potato-kennebec' },
        b: { blockId: 'bed2', cropId: 'tom', cropPluginId: 'tomato-celebrity-f1' },
        sameBed: false,
        benefit: 'Late blight spreads between them'
      }
    ]);
  });

  it('never flags two crops from the same side', () => {
    const plantings = [
      planting('t1', 'bed2', 'tomato-celebrity-f1', 'solanaceae'),
      planting('t2', 'bed2', 'tomato-san-marzano', 'solanaceae'),
      planting('p1', 'bed3', 'potato-kennebec', 'solanaceae'),
      planting('p2', 'bed3', 'potato-yukon-gold', 'solanaceae')
    ];
    const hints = companionHints(
      beds,
      plantings,
      plantings.map((p) => season(p.cropId, p.blockId)),
      [blight],
      adjacency
    );
    expect(hints).toHaveLength(4);
    for (const h of hints) {
      expect(h.relation).toBe('keep-apart');
      expect(sideA.includes(h.a.cropPluginId)).not.toBe(sideA.includes(h.b.cropPluginId));
    }
  });

  it('says nothing when the beds are far apart or the plantings never share time', () => {
    const far = [
      planting('tom', 'bed1', 'tomato-celebrity-f1', 'solanaceae'),
      planting('pot', 'bed4', 'potato-kennebec', 'solanaceae')
    ];
    expect(
      companionHints(beds, far, [season('tom', 'bed1'), season('pot', 'bed4')], [blight], adjacency)
    ).toEqual([]);
    const near = [
      planting('tom', 'bed2', 'tomato-celebrity-f1', 'solanaceae'),
      planting('pot', 'bed3', 'potato-kennebec', 'solanaceae')
    ];
    expect(
      companionHints(
        beds,
        near,
        [
          interval('pot', 'bed3', day(3, 15), day(5, 20)),
          interval('tom', 'bed2', day(5, 20), day(9, 1))
        ],
        [blight],
        adjacency
      )
    ).toEqual([]);
  });

  it('fires for exactly the cross-side pairs (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...sideA, ...sideB),
        fc.constantFrom(...sideA, ...sideB),
        fc.boolean(),
        (x, y, sameBed) => {
          fc.pre(x !== y);
          const plantings = [
            planting('x', 'bed2', x, 'solanaceae'),
            planting('y', sameBed ? 'bed2' : 'bed3', y, 'solanaceae')
          ];
          const hints = companionHints(
            beds,
            plantings,
            plantings.map((p) => season(p.cropId, p.blockId)),
            [blight],
            adjacency
          );
          const cross = sideA.includes(x) !== sideA.includes(y);
          expect(hints.length).toBe(cross ? 1 : 0);
        }
      )
    );
  });
});
