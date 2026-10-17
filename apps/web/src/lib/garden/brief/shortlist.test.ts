import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { HERB_PLUGIN_IDS } from '$lib/garden/herbs';
import { filterSprayAdvice } from '$lib/journal/photoHelp';
import { getRegistry } from '$lib/server/registry';
import { sprayTermsFor } from '$lib/server/sprayTerms';
import {
  BRIEF_CUISINES,
  BRIEF_WHY,
  MAX_SHORTLIST,
  type BriefAnswers,
  type BriefReason
} from './schema';
import {
  CUISINE_HERBS,
  WHY_HERBS,
  allDeterministicBecauseLines,
  becauseText,
  deterministicReason,
  deterministicShortlist
} from './shortlist';

let terms: string[];

beforeAll(async () => {
  terms = sprayTermsFor(await getRegistry());
}, 60_000);

const a = <T>(value: T) => ({ value, notSure: false, provenance: 'manual' as const });

const reasonArb: fc.Arbitrary<BriefReason> = fc.oneof(
  fc.constantFrom(...BRIEF_CUISINES).map((cuisine) => ({ kind: 'cuisine' as const, cuisine })),
  fc.constantFrom(...BRIEF_WHY).map((why) => ({ kind: 'why' as const, why })),
  fc.constant({ kind: 'wanted' as const }),
  fc.constant({ kind: 'suggested' as const })
);

describe('editorial tables (R-19)', () => {
  it('name only herbs from the ruled list (R-3)', () => {
    const all = [...Object.values(CUISINE_HERBS), ...Object.values(WHY_HERBS)].flat();
    expect(all.filter((id) => !HERB_PLUGIN_IDS.includes(id))).toEqual([]);
  });

  it('cover every cuisine and goal the form offers', () => {
    expect(Object.keys(CUISINE_HERBS).sort()).toEqual([...BRIEF_CUISINES].sort());
    expect(Object.keys(WHY_HERBS).sort()).toEqual([...BRIEF_WHY].sort());
  });

  it('every because sentence passes the spray-advice guard with the real terms', () => {
    for (const line of allDeterministicBecauseLines()) {
      expect(filterSprayAdvice(line, terms), line).toEqual({ text: line, removed: false });
    }
  });

  it('any mix of reasons reads cleanly in English and Spanish (property)', () => {
    fc.assert(
      fc.property(fc.array(reasonArb, { maxLength: 8 }), fc.constantFrom('en', 'es'), (rs, loc) => {
        const text = becauseText(rs, loc);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/\{\w+\}/);
        expect(filterSprayAdvice(text, terms).removed).toBe(false);
      }),
      { numRuns: 300 }
    );
  });
});

describe('becauseText', () => {
  it('joins cuisines and keeps English byte-identical without a locale', () => {
    const rs: BriefReason[] = [
      { kind: 'cuisine', cuisine: 'italian' },
      { kind: 'cuisine', cuisine: 'french' },
      { kind: 'cuisine', cuisine: 'indian' }
    ];
    expect(becauseText(rs)).toBe('Picked for Italian, French and Indian cooking.');
    expect(becauseText(rs, 'en')).toBe(becauseText(rs));
    expect(becauseText(rs, 'es')).toBe('Elegida para la cocina italiana, francesa y india.');
  });

  it('reads tea once whether it came from the cuisine or the goal', () => {
    expect(
      becauseText([
        { kind: 'cuisine', cuisine: 'tea-drinks' },
        { kind: 'why', why: 'tea' }
      ])
    ).toBe('Picked for tea and drinks.');
  });

  it('puts "You asked for this one" first', () => {
    expect(becauseText([{ kind: 'why', why: 'gifts' }, { kind: 'wanted' }])).toBe(
      'You asked for this one. Picked for gifts.'
    );
  });
});

describe('deterministicShortlist', () => {
  it('is empty with no answers', () => {
    expect(deterministicShortlist({})).toEqual({ rows: [], sunWarning: false });
  });

  it('tags table rows fallback and typed herbs manual, typed herbs first', () => {
    const answers: BriefAnswers = {
      cuisines: a(['italian']),
      wanted: a(['lemon-balm'])
    };
    const { rows } = deterministicShortlist(answers);
    expect(rows[0]).toMatchObject({ cropPluginId: 'lemon-balm', provenance: 'manual' });
    expect(rows[0].because).toBe('You asked for this one.');
    expect(rows.slice(1).every((r) => r.provenance === 'fallback')).toBe(true);
    expect(rows.find((r) => r.cropPluginId === 'basil-genovese')?.because).toBe(
      'Picked for Italian cooking.'
    );
  });

  it('removes herbs the owner never uses, even ones they typed', () => {
    const { rows } = deterministicShortlist({
      cuisines: a(['italian']),
      wanted: a(['basil-genovese']),
      avoid: a(['basil-genovese', 'sage-broadleaf'])
    });
    const ids = rows.map((r) => r.cropPluginId);
    expect(ids).not.toContain('basil-genovese');
    expect(ids).not.toContain('sage-broadleaf');
  });

  it('ranks herbs with more reasons higher and caps at 12', () => {
    const { rows } = deterministicShortlist({
      cuisines: a([...BRIEF_CUISINES]),
      why: a([...BRIEF_WHY])
    });
    expect(rows).toHaveLength(MAX_SHORTLIST);
    expect(rows[0].cropPluginId).toBe('mint-spearmint');
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].reasons!.length).toBeGreaterThanOrEqual(rows[i].reasons!.length);
    }
  });

  it('drops ids that are not herbs or not in the farm library', () => {
    const { rows } = deterministicShortlist(
      { wanted: a(['tomato-brandywine', 'chervil']), cuisines: a(['french']) },
      (id) => id !== 'chervil'
    );
    const ids = rows.map((r) => r.cropPluginId);
    expect(ids).not.toContain('tomato-brandywine');
    expect(ids).not.toContain('chervil');
  });

  it('never filters by sun; shade only raises the warning (R-19)', () => {
    const base = { cuisines: a(['italian' as const]) };
    const full = deterministicShortlist({ ...base, sun: a('full' as const) });
    const shade = deterministicShortlist({ ...base, sun: a('shade' as const) });
    expect(shade.rows).toEqual(full.rows);
    expect(full.sunWarning).toBe(false);
    expect(shade.sunWarning).toBe(true);
    expect(deterministicShortlist({ ...base, sun: a('half-day' as const) }).sunWarning).toBe(true);
  });

  it('every row is unique, a herb and never avoided (property)', () => {
    fc.assert(
      fc.property(
        fc.subarray([...BRIEF_CUISINES]),
        fc.subarray([...BRIEF_WHY]),
        fc.subarray([...HERB_PLUGIN_IDS], { maxLength: 6 }),
        fc.subarray([...HERB_PLUGIN_IDS], { maxLength: 6 }),
        (cuisines, why, wanted, avoid) => {
          const { rows } = deterministicShortlist({
            cuisines: a(cuisines),
            why: a(why),
            wanted: a(wanted),
            avoid: a(avoid)
          });
          const ids = rows.map((r) => r.cropPluginId);
          expect(new Set(ids).size).toBe(ids.length);
          expect(rows.length).toBeLessThanOrEqual(MAX_SHORTLIST);
          for (const r of rows) {
            expect(HERB_PLUGIN_IDS).toContain(r.cropPluginId);
            expect(avoid).not.toContain(r.cropPluginId);
            expect(r.provenance).toBe(wanted.includes(r.cropPluginId) ? 'manual' : 'fallback');
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('deterministicReason', () => {
  it('falls back to "Suggested for your garden." for a herb no table names', () => {
    expect(deterministicReason('lovage', {})).toEqual({
      reasons: [{ kind: 'suggested' }],
      because: 'Suggested for your garden.'
    });
    expect(deterministicReason('basil-genovese', { cuisines: a(['italian']) }).because).toBe(
      'Picked for Italian cooking.'
    );
  });
});
