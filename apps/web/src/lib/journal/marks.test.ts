import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_MARK_LABEL,
  MAX_PHOTO_MARKS,
  isUnsafeMarkLabel,
  parseMarks,
  readMarksAnswer
} from './marks';
import { PHOTO_MARK_KINDS } from './model';
import { namesDiagnosis, namesTreatment } from './markGuard';
import { BYPASS_PHRASINGS } from './markLabels.fixtures';
import { sprayProductTerms } from './photoHelp';

const LIB = sprayProductTerms([
  { displayName: 'Daconil Weather Stik', activeIngredients: ['chlorothalonil'] },
  { displayName: 'Pristine (BASF)', activeIngredients: ['pyraclostrobin', 'boscalid'] },
  { displayName: 'Mancozeb 75DF', activeIngredients: ['mancozeb'] }
]);

const good = { kind: 'cut', x: 0.4, y: 0.3, label: 'Cut above this leaf pair' };

const SPRAY_LABELS = [
  'Spray neem here',
  'Copper on these spots',
  'Daconil this branch',
  'Mix 2 tbsp per gallon',
  'Apply every 7 days',
  'Dust with sulfur',
  'sp_r_a_y this leaf',
  'Treat these leaves'
];

const SAFE_LABELS = [
  'Cut above this leaf pair',
  'Pinch the tip',
  'Harvest these top leaves',
  'Leave this stem',
  'Pinch off the flower buds',
  'Cut back by a third',
  'Leave the lower leaves',
  'Harvest from the outside'
];

describe('parseMarks', () => {
  it('keeps a valid set and trims labels', () => {
    const out = parseMarks(
      [good, { kind: 'harvest', x: 0, y: 1, w: 0.5, label: '  Harvest   these ' }],
      LIB
    );
    expect(out).toEqual({
      ok: true,
      marks: [good, { kind: 'harvest', x: 0, y: 1, w: 0.5, label: 'Harvest these' }]
    });
  });

  it('accepts every ruled kind and an empty list', () => {
    const labels: Record<(typeof PHOTO_MARK_KINDS)[number], string> = {
      cut: 'Cut above this leaf pair',
      pinch: 'Pinch the tip',
      harvest: 'Harvest these top leaves',
      leave: 'Leave this stem',
      problem: 'Yellow lower leaves'
    };
    for (const kind of PHOTO_MARK_KINDS) {
      expect(parseMarks([{ ...good, kind, label: labels[kind] }], LIB).ok, kind).toBe(true);
    }
    expect(PHOTO_MARK_KINDS).toContain('problem');
    expect(parseMarks([], LIB)).toEqual({ ok: true, marks: [] });
  });

  it('refuses the whole set on one bad mark', () => {
    const cases: Array<[unknown, string]> = [
      [{ marks: [] }, 'not-a-list'],
      [Array.from({ length: MAX_PHOTO_MARKS + 1 }, () => good), 'too-many'],
      [[good, null], 'not-an-object'],
      [[good, { ...good, kind: 'spray' }], 'bad-kind'],
      [[good, { ...good, label: 'Cut out the blight' }], 'diagnosis-label'],
      [[good, { ...good, kind: 'problem', label: 'Pinch these off' }], 'treatment-label'],
      [[good, { ...good, x: 1.01 }], 'bad-coordinate'],
      [[good, { ...good, y: -0.1 }], 'bad-coordinate'],
      [[good, { ...good, x: Number.NaN }], 'bad-coordinate'],
      [[good, { ...good, x: '0.5' }], 'bad-coordinate'],
      [[good, { ...good, w: 0 }], 'bad-size'],
      [[good, { ...good, h: 1.2 }], 'bad-size'],
      [[good, { ...good, x: 0.8, w: 0.3 }], 'bad-size'],
      [[good, { ...good, label: '   ' }], 'bad-label'],
      [[good, { ...good, label: 'x'.repeat(MAX_MARK_LABEL + 1) }], 'bad-label'],
      [[good, { ...good, label: 7 }], 'bad-label'],
      [[good, { ...good, label: 'Spray neem here' }], 'spray-label']
    ];
    for (const [raw, reason] of cases) {
      expect(parseMarks(raw, LIB), JSON.stringify(raw)).toEqual({ ok: false, reason });
    }
  });

  it('allows exactly the maximum and a 40 character label', () => {
    expect(
      parseMarks(
        Array.from({ length: MAX_PHOTO_MARKS }, () => good),
        LIB
      ).ok
    ).toBe(true);
    expect(parseMarks([{ ...good, label: 'a'.repeat(MAX_MARK_LABEL) }], LIB).ok).toBe(true);
  });

  it.each(SAFE_LABELS)('lets the cultural label %s through', (label) => {
    expect(isUnsafeMarkLabel(label, LIB)).toBe(false);
    expect(parseMarks([{ ...good, label }], LIB).ok).toBe(true);
  });

  it.each(SPRAY_LABELS)('refuses the spray label %s', (label) => {
    expect(parseMarks([{ ...good, label }], LIB)).toEqual({ ok: false, reason: 'spray-label' });
  });

  it('runs the 41 bypass phrasings through the label guard', () => {
    expect(BYPASS_PHRASINGS).toHaveLength(41);
    for (const phrase of BYPASS_PHRASINGS) {
      expect(isUnsafeMarkLabel(phrase, LIB), phrase).toBe(true);
      const out = parseMarks([good, { ...good, label: phrase }], LIB);
      expect(out.ok, phrase).toBe(false);
      if (!out.ok) {
        expect(out.reason).toBe(phrase.length > MAX_MARK_LABEL ? 'bad-label' : 'spray-label');
      }
    }
  });

  it('never returns a mark out of range, over the limit or with a spray label', () => {
    const coord = fc.oneof(
      fc.double({ min: -0.5, max: 1.5, noNaN: false }),
      fc.constantFrom(0, 1, 0.5)
    );
    const mark = fc.record(
      {
        kind: fc.constantFrom('cut', 'pinch', 'harvest', 'leave', 'problem', 'spray'),
        x: coord,
        y: coord,
        w: coord,
        h: coord,
        label: fc.oneof(fc.constantFrom(...SAFE_LABELS, ...SPRAY_LABELS), fc.string())
      },
      { requiredKeys: ['kind', 'x', 'y', 'label'] }
    );
    fc.assert(
      fc.property(fc.array(mark, { maxLength: 16 }), (raw) => {
        const out = parseMarks(raw, LIB);
        if (!out.ok) return;
        expect(out.marks).toHaveLength(raw.length);
        expect(out.marks.length).toBeLessThanOrEqual(MAX_PHOTO_MARKS);
        for (const m of out.marks) {
          expect((PHOTO_MARK_KINDS as readonly string[]).includes(m.kind)).toBe(true);
          for (const v of [m.x, m.y]) expect(v >= 0 && v <= 1).toBe(true);
          if (m.w !== undefined) expect(m.w > 0 && m.x + m.w <= 1 + 1e-9).toBe(true);
          if (m.h !== undefined) expect(m.h > 0 && m.y + m.h <= 1 + 1e-9).toBe(true);
          expect(m.label.length).toBeGreaterThan(0);
          expect(m.label.length).toBeLessThanOrEqual(MAX_MARK_LABEL);
          expect(isUnsafeMarkLabel(m.label, LIB)).toBe(false);
          expect(namesDiagnosis(m.label)).toBe(false);
          if (m.kind === 'problem') expect(namesTreatment(m.label)).toBe(false);
        }
      })
    );
  });

  it('refuses any set that holds one spray label, wherever it sits', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...SAFE_LABELS), { maxLength: 5 }),
        fc.constantFrom(...SPRAY_LABELS),
        fc.array(fc.constantFrom(...SAFE_LABELS), { maxLength: 5 }),
        (before, bad, after) => {
          const raw = [...before, bad, ...after].map((label) => ({ ...good, label }));
          expect(parseMarks(raw, LIB)).toEqual({ ok: false, reason: 'spray-label' });
        }
      )
    );
  });
});

describe('readMarksAnswer', () => {
  it('reads the JSON even inside a code fence', () => {
    const text = '```json\n{"steps":["Cut here.","  Pinch  that. "],"marks":[1]}\n```';
    expect(readMarksAnswer(text)).toEqual({ steps: ['Cut here.', 'Pinch that.'], marks: [1] });
  });

  it('is null without an object holding a steps list', () => {
    expect(readMarksAnswer('Cut above a leaf pair.')).toBeNull();
    expect(readMarksAnswer('{"steps": "Cut"}')).toBeNull();
    expect(readMarksAnswer('{not json}')).toBeNull();
    expect(readMarksAnswer('[1, 2]')).toBeNull();
  });

  it('drops non-string and empty steps and keeps marks as given', () => {
    expect(readMarksAnswer('{"steps":["A.",3,"",null,"B."]}')).toEqual({
      steps: ['A.', 'B.'],
      marks: undefined
    });
  });
});
