import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SITE_FINDER_FIXTURE_ANSWER } from '$lib/server/aiFixture/siteFinder';
import {
  AI_FEATURE_KINDS,
  AI_MIN_RADIUS_M,
  MAX_AI_ANSWER_CHARS,
  MAX_AI_FEATURES,
  MAX_AI_NOTE,
  MAX_AI_REASON,
  MAX_AI_SPOTS,
  parseAiReading,
  seenFeatures,
  validateAiReading
} from './aiAnswer';
import { lonLatToImage, photoExtentAround } from './geometry';

const TERMS = ['roundup', 'sevin'];
const good = {
  features: [
    { kind: 'tree', x: 0.2, y: 0.3, radius: 0.05, note: 'Large tree with a wide crown' },
    { kind: 'tree-line', x: 0.1, y: 0.1, x2: 0.9, y2: 0.1 },
    { kind: 'building', x: 0.8, y: 0.8, radius: 0.04 },
    { kind: 'open-lawn', x: 0.5, y: 0.5, radius: 0.2, note: 'Open grass away from the driveway' }
  ],
  spots: [{ x: 0.5, y: 0.5, reason: 'Open ground in the middle with nothing tall to the south.' }],
  caveats: 'The photo may be a few years old.'
};
const refusal = (raw: unknown) => {
  const out = validateAiReading(raw, TERMS);
  return out.ok ? 'ok' : out.reason;
};
const withFeature = (f: unknown) => ({ features: [f], spots: [] });
const withSpot = (s: unknown) => ({ features: [], spots: [s] });

describe('validateAiReading', () => {
  it('accepts a well formed reading and the e2e fixture answer', () => {
    const out = validateAiReading(good, TERMS);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.reading.features).toHaveLength(4);
      expect(out.reading.spots[0].reason).toContain('Open ground');
      expect(out.reading.caveats).toBe('The photo may be a few years old.');
    }
    expect(validateAiReading(SITE_FINDER_FIXTURE_ANSWER, TERMS).ok).toBe(true);
    expect(validateAiReading({ features: [], spots: [] }).ok).toBe(true);
  });

  it('refuses anything that is not the shape asked for', () => {
    expect(refusal(null)).toBe('not-an-object');
    expect(refusal([])).toBe('not-an-object');
    expect(refusal('text')).toBe('not-an-object');
    expect(refusal({ features: [] })).toBe('not-a-list');
    expect(refusal({ features: {}, spots: [] })).toBe('not-a-list');
    expect(refusal({ ...good, extra: 1 })).toBe('unknown-field');
    expect(refusal(withFeature('tree'))).toBe('not-an-object');
    expect(refusal(withFeature({ kind: 'tree', x: 0.1, y: 0.1, heightFt: 40 }))).toBe(
      'unknown-field'
    );
    expect(refusal(withSpot({ x: 0.1, y: 0.1, reason: 'Fine.', score: 9 }))).toBe('unknown-field');
  });

  it('refuses counts over the caps', () => {
    const f = { kind: 'tree', x: 0.1, y: 0.1 };
    const s = { x: 0.1, y: 0.1, reason: 'Open ground.' };
    expect(refusal({ features: Array(MAX_AI_FEATURES + 1).fill(f), spots: [] })).toBe('too-many');
    expect(refusal({ features: [], spots: Array(MAX_AI_SPOTS + 1).fill(s) })).toBe('too-many');
    expect(
      refusal({ features: Array(MAX_AI_FEATURES).fill(f), spots: Array(MAX_AI_SPOTS).fill(s) })
    ).toBe('ok');
  });

  it('refuses a position or size outside the photo', () => {
    for (const bad of [-0.01, 1.01, Number.NaN, Infinity, '0.5', null, undefined]) {
      expect(refusal(withFeature({ kind: 'tree', x: bad, y: 0.5 })), String(bad)).toBe(
        'bad-coordinate'
      );
      expect(refusal(withSpot({ x: 0.5, y: bad, reason: 'Open.' })), String(bad)).toBe(
        'bad-coordinate'
      );
    }
    expect(refusal(withFeature({ kind: 'tree', x: 0.5, y: 0.5, radius: 0 }))).toBe('bad-size');
    expect(refusal(withFeature({ kind: 'tree', x: 0.5, y: 0.5, radius: 0.51 }))).toBe('bad-size');
    expect(refusal(withFeature({ kind: 'tree', x: 0.5, y: 0.5, radius: '0.1' }))).toBe('bad-size');
    expect(refusal(withFeature({ kind: 'tree-line', x: 0.5, y: 0.5, x2: 0.7 }))).toBe(
      'bad-coordinate'
    );
    expect(refusal(withFeature({ kind: 'tree-line', x: 0.5, y: 0.5, x2: 0.7, y2: 1.2 }))).toBe(
      'bad-coordinate'
    );
  });

  it('refuses an unknown kind and bad text', () => {
    expect(refusal(withFeature({ kind: 'septic', x: 0.5, y: 0.5 }))).toBe('bad-kind');
    expect(refusal(withFeature({ kind: 'tree', x: 0.5, y: 0.5, note: 7 }))).toBe('bad-text');
    expect(
      refusal(withFeature({ kind: 'tree', x: 0.5, y: 0.5, note: 'x'.repeat(MAX_AI_NOTE + 1) }))
    ).toBe('bad-text');
    expect(refusal(withSpot({ x: 0.5, y: 0.5, reason: '' }))).toBe('bad-text');
    expect(refusal(withSpot({ x: 0.5, y: 0.5 }))).toBe('bad-text');
    expect(refusal(withSpot({ x: 0.5, y: 0.5, reason: 'y'.repeat(MAX_AI_REASON + 1) }))).toBe(
      'bad-text'
    );
    expect(refusal(withSpot({ x: 0.5, y: 0.5, reason: '<b>Open</b> ground' }))).toBe('bad-text');
    expect(refusal({ features: [], spots: [], caveats: 5 })).toBe('bad-text');
  });

  it('one spray-worded text drops the whole reading', () => {
    for (const text of [
      'Spray Roundup here before planting',
      'Apply 2 oz per gallon of herbicide along the fence',
      'Treat the lawn with Sevin first',
      'Use a fungicide on this area'
    ]) {
      expect(refusal(withFeature({ kind: 'other', x: 0.5, y: 0.5, note: text })), text).toBe(
        'spray-text'
      );
      expect(refusal(withSpot({ x: 0.5, y: 0.5, reason: text })), text).toBe('spray-text');
      expect(refusal({ features: [], spots: [], caveats: text }), text).toBe('spray-text');
      expect(
        refusal({ ...good, spots: [...good.spots, { x: 0.1, y: 0.1, reason: text }] }),
        text
      ).toBe('spray-text');
    }
  });

  it('plain siting words pass the guard', () => {
    for (const text of [
      'Large tree casting shade to the north',
      'Open lawn that looks sunny most of the day',
      'Gravel driveway',
      'Low ground that looks darker and may hold water',
      'House with a porch on the south side'
    ]) {
      expect(refusal(withFeature({ kind: 'other', x: 0.5, y: 0.5, note: text })), text).toBe('ok');
    }
  });

  it('never accepts a reading with an out-of-range number, whatever the model sends', () => {
    const num = fc.oneof(
      fc.double(),
      fc.integer(),
      fc.constant(null),
      fc.string(),
      fc.constant(undefined)
    );
    const feature = fc.record(
      {
        kind: fc.oneof(fc.constantFrom(...AI_FEATURE_KINDS), fc.string()),
        x: num,
        y: num,
        radius: num,
        x2: num,
        y2: num,
        note: fc.oneof(fc.string(), fc.constant(undefined), fc.integer())
      },
      { requiredKeys: [] }
    );
    const spot = fc.record(
      { x: num, y: num, reason: fc.oneof(fc.string(), fc.integer()) },
      { requiredKeys: [] }
    );
    fc.assert(
      fc.property(
        fc.record(
          {
            features: fc.oneof(fc.array(feature, { maxLength: 45 }), fc.anything()),
            spots: fc.oneof(fc.array(spot, { maxLength: 5 }), fc.anything()),
            caveats: fc.oneof(fc.string(), fc.anything())
          },
          { requiredKeys: [] }
        ),
        (raw) => {
          const out = validateAiReading(raw, TERMS);
          if (!out.ok) return;
          const inUnit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
          expect(out.reading.features.length).toBeLessThanOrEqual(MAX_AI_FEATURES);
          expect(out.reading.spots.length).toBeLessThanOrEqual(MAX_AI_SPOTS);
          for (const f of out.reading.features) {
            expect(AI_FEATURE_KINDS).toContain(f.kind);
            expect(inUnit(f.x) && inUnit(f.y)).toBe(true);
            if (f.radius !== undefined) expect(f.radius > 0 && f.radius <= 0.5).toBe(true);
            if (f.x2 !== undefined) expect(inUnit(f.x2) && inUnit(f.y2 as number)).toBe(true);
            if (f.note !== undefined) expect(f.note.length).toBeLessThanOrEqual(MAX_AI_NOTE);
          }
          for (const s of out.reading.spots) {
            expect(inUnit(s.x) && inUnit(s.y)).toBe(true);
            expect(s.reason.length).toBeGreaterThan(0);
            expect(s.reason.length).toBeLessThanOrEqual(MAX_AI_REASON);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        expect(() => validateAiReading(raw, TERMS)).not.toThrow();
      })
    );
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => parseAiReading(text, TERMS)).not.toThrow();
      })
    );
  });
});

describe('parseAiReading', () => {
  const json = JSON.stringify(good);

  it('reads bare JSON and JSON in a code fence', () => {
    expect(parseAiReading(json, TERMS).ok).toBe(true);
    expect(parseAiReading('```json\n' + json + '\n```', TERMS).ok).toBe(true);
    expect(parseAiReading('  ' + json + '\n', TERMS).ok).toBe(true);
  });

  it('refuses prose around the JSON, broken JSON and an oversize answer', () => {
    for (const text of [
      'Here is what I see: ' + json,
      json + ' Hope that helps!',
      json.slice(0, -2),
      '',
      'I cannot tell.',
      '[' + json + ']'
    ]) {
      expect(parseAiReading(text, TERMS)).toEqual({ ok: false, reason: 'not-json' });
    }
    const big = JSON.stringify({ ...good, caveats: 'z'.repeat(MAX_AI_ANSWER_CHARS) });
    expect(parseAiReading(big, TERMS)).toEqual({ ok: false, reason: 'not-json' });
  });
});

describe('seenFeatures', () => {
  const extent = photoExtentAround([-77.7, 39.08], 100);

  it('places what Claude saw on the ground, tagged ai with no height', () => {
    const out = validateAiReading(good, TERMS);
    if (!out.ok) throw new Error('fixture');
    const seen = seenFeatures(out.reading, extent);
    expect(seen.map((s) => s.id)).toEqual(['ai1', 'ai2', 'ai3', 'ai4']);
    const [x, y] = lonLatToImage(extent, seen[0].center);
    expect(x).toBeCloseTo(0.2, 6);
    expect(y).toBeCloseTo(0.3, 6);
    const tree = seen[0].obstacle!;
    expect(tree).toMatchObject({ kind: 'tree', heightFt: null, provenance: 'ai' });
    expect(tree.shape).toMatchObject({ type: 'circle', radiusM: 5 });
    expect(seen[1].obstacle?.shape.type).toBe('line');
    expect(seen[2].obstacle?.kind).toBe('building');
    expect(seen[3].obstacle).toBeNull();
    expect(seen[3].note).toBe('Open grass away from the driveway');
  });

  it('gives a tiny or missing radius a minimum size', () => {
    const seen = seenFeatures(
      { features: [{ kind: 'tree', x: 0.5, y: 0.5, radius: 0.001 }], spots: [] },
      extent
    );
    expect(seen[0].obstacle?.shape).toMatchObject({ type: 'circle', radiusM: AI_MIN_RADIUS_M });
  });
});
