import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BRIEF_SUN } from './schema';
import { orderBySun, sunFit, sunIsLimited, sunLine, type HerbSunNeed } from './sun';
import { deterministicShortlist } from './shortlist';

const NEEDS: readonly (HerbSunNeed | null)[] = ['full', 'part', 'shade', null];

describe('sunFit', () => {
  it('reads a herb that wants more sun than the spot gets as a mismatch', () => {
    expect(sunFit('full', 'half-day')).toBe('mismatch');
    expect(sunFit('full', 'shade')).toBe('mismatch');
    expect(sunFit('part', 'shade')).toBe('mismatch');
    expect(sunFit('part', 'half-day')).toBe('match');
    expect(sunFit('shade', 'shade')).toBe('match');
    expect(sunFit('full', 'full')).toBe('match');
    expect(sunFit('full', null)).toBe('match');
    expect(sunFit(null, 'shade')).toBe('unknown');
  });

  it('only half a day or shade is a limited spot', () => {
    expect(BRIEF_SUN.filter((s) => sunIsLimited(s))).toEqual(['half-day', 'shade']);
    expect(sunIsLimited(null)).toBe(false);
  });
});

describe('orderBySun', () => {
  const rowsArb = fc.uniqueArray(
    fc.record({ cropPluginId: fc.stringMatching(/^[a-z]{1,8}$/), need: fc.constantFrom(...NEEDS) }),
    { selector: (r) => r.cropPluginId, maxLength: 12 }
  );

  it('never removes or adds a row, and keeps the order when the spot gets full sun', () => {
    fc.assert(
      fc.property(rowsArb, fc.constantFrom(...BRIEF_SUN, null), (rows, answer) => {
        const needOf = (id: string) => rows.find((r) => r.cropPluginId === id)?.need;
        const out = orderBySun(rows, answer, needOf);
        expect([...out].sort((a, b) => a.cropPluginId.localeCompare(b.cropPluginId))).toEqual(
          [...rows].sort((a, b) => a.cropPluginId.localeCompare(b.cropPluginId))
        );
        if (!sunIsLimited(answer)) expect(out).toEqual(rows);
      })
    );
  });

  it('puts matches first, then unknown, then mismatches, each in its old order', () => {
    fc.assert(
      fc.property(
        rowsArb,
        fc.constantFrom('half-day' as const, 'shade' as const),
        (rows, answer) => {
          const needOf = (id: string) => rows.find((r) => r.cropPluginId === id)?.need;
          const rank = { match: 0, unknown: 1, mismatch: 2 };
          const out = orderBySun(rows, answer, needOf);
          const ranks = out.map((r) => rank[sunFit(r.need, answer)]);
          expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
          for (const k of [0, 1, 2]) {
            const ids = (list: typeof rows) =>
              list.filter((r) => rank[sunFit(r.need, answer)] === k).map((r) => r.cropPluginId);
            expect(ids(out)).toEqual(ids(rows));
          }
        }
      )
    );
  });
});

describe('sunLine', () => {
  it('says what each need wants, and the mismatch wording when the spot is too shady', () => {
    expect(sunLine('full', 'full')).toBe('Wants full sun.');
    expect(sunLine('part', null)).toBe('Takes part shade.');
    expect(sunLine('shade', 'shade')).toBe('Grows in shade.');
    expect(sunLine('full', 'half-day')).toBe('Wants full sun, more than this spot gets.');
    expect(sunLine('part', 'shade')).toBe('Takes part shade, but not mostly shade.');
    expect(sunLine(null, 'shade')).toBeNull();
    expect(sunLine('full', 'shade', 'es')).toBe(
      'Necesita sol pleno, más del que recibe este lugar.'
    );
  });
});

describe('deterministicShortlist with sun needs', () => {
  const needs: Record<string, HerbSunNeed> = {
    'basil-genovese': 'full',
    'mint-spearmint': 'part',
    'parsley-italian-flat-leaf': 'part'
  };

  it('keeps every herb, typed ones included, and lists sun lovers last in a shady spot', () => {
    const answers = {
      wanted: { value: ['basil-genovese'], notSure: false, provenance: 'manual' as const },
      why: { value: ['cooking' as const], notSure: false, provenance: 'manual' as const },
      sun: { value: 'half-day' as const, notSure: false, provenance: 'manual' as const }
    };
    const plain = deterministicShortlist(answers);
    const sorted = deterministicShortlist(
      answers,
      () => true,
      (id) => needs[id]
    );
    expect(sorted.sunWarning).toBe(true);
    expect(sorted.rows.map((r) => r.cropPluginId).sort()).toEqual(
      plain.rows.map((r) => r.cropPluginId).sort()
    );
    const ids = sorted.rows.map((r) => r.cropPluginId);
    expect(ids).toContain('basil-genovese');
    expect(ids.indexOf('mint-spearmint')).toBeLessThan(ids.indexOf('basil-genovese'));
    expect(ids[ids.length - 1]).toBe('basil-genovese');
  });

  it('changes nothing in full sun', () => {
    const answers = {
      why: { value: ['cooking' as const], notSure: false, provenance: 'manual' as const },
      sun: { value: 'full' as const, notSure: false, provenance: 'manual' as const }
    };
    expect(
      deterministicShortlist(
        answers,
        () => true,
        (id) => needs[id]
      ).rows
    ).toEqual(deterministicShortlist(answers).rows);
  });
});
