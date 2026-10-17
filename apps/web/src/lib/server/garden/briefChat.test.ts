import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { HERB_PLUGIN_IDS } from '$lib/garden/herbs';
import { filterSprayAdvice, isSprayAdvice } from '$lib/journal/photoHelp';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';
import { sprayTermsFor } from '$lib/server/sprayTerms';
import { MAX_SHORTLIST, type BriefAnswers } from '$lib/garden/brief/schema';
import {
  FIXTURE_BRIEF_BECAUSE,
  FIXTURE_BRIEF_UNKNOWN_ID,
  GARDEN_BRIEF_FIXTURE_MARKER,
  fixtureBriefAnswer
} from '../aiFixture/gardenBrief';
import {
  GARDEN_BRIEF_MARKER,
  buildBriefPrompt,
  herbFacts,
  validateBriefAnswer,
  type BriefPromptInput
} from './briefChat';
import { briefHerbCheck } from './briefStore';

let terms: string[];
let known: (id: string) => boolean;
let crops: CropPlugin[];

beforeAll(async () => {
  const registry = await getRegistry();
  terms = sprayTermsFor(registry);
  known = briefHerbCheck(registry);
  crops = registry.crops();
}, 60_000);

const a = <T>(value: T) => ({ value, notSure: false, provenance: 'manual' as const });

function input(answers: BriefAnswers = {}): BriefPromptInput {
  return {
    answers,
    farm: {
      zone: '7a',
      frost: { lastSpring: '2027-04-20', firstFall: '2027-10-20' },
      areaKinds: ['garden']
    },
    herbs: herbFacts(crops),
    history: [{ role: 'user', text: 'I like pasta.' }],
    message: 'What should I grow?'
  };
}

describe('buildBriefPrompt', () => {
  it('starts with the fixture marker on its own line and lists only herbs', () => {
    expect(GARDEN_BRIEF_MARKER).toBe(GARDEN_BRIEF_FIXTURE_MARKER);
    const prompt = buildBriefPrompt(input({ avoid: a(['sage-broadleaf']) }));
    expect(prompt.split('\n')[0]).toBe(GARDEN_BRIEF_MARKER);
    expect(prompt).toContain('hardiness zone 7a');
    expect(prompt).toContain('Herbs they never use (never suggest these): Sage');
    expect(prompt).toMatch(/Never give amounts, rates, measurements/);
    const lines = prompt.split('\n');
    const start = lines.findIndex((l) => l.startsWith('Herb library'));
    const end = lines.indexOf('', start);
    const ids = lines.slice(start + 1, end).map((l) => /^- ([a-z0-9-]+): /.exec(l)?.[1]);
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.every((id) => !!id && HERB_PLUGIN_IDS.includes(id))).toBe(true);
  });
});

describe('validateBriefAnswer', () => {
  it('refuses anything that is not the JSON shape asked for', () => {
    expect(validateBriefAnswer(null, { answers: {}, known, sprayTerms: terms })).toBeNull();
    expect(
      validateBriefAnswer({ reply: 'hi' }, { answers: {}, known, sprayTerms: terms })
    ).toBeNull();
  });

  it('drops unknown ids, non-herbs, repeats and avoided herbs', () => {
    const out = validateBriefAnswer(
      {
        reply: 'Here you go.',
        followUp: 'sun',
        shortlist: [
          { cropPluginId: 'basil-genovese', because: 'Great with tomatoes.' },
          { cropPluginId: 'not-a-plugin', because: 'x' },
          { cropPluginId: 'tomato-brandywine', because: 'x' },
          { cropPluginId: 'basil-genovese', because: 'again' },
          { cropPluginId: 'sage-broadleaf', because: 'x' }
        ]
      },
      { answers: { avoid: a(['sage-broadleaf']) }, known, sprayTerms: terms }
    )!;
    expect(out.rows.map((r) => r.cropPluginId)).toEqual(['basil-genovese']);
    expect(out.rows[0]).toEqual({
      cropPluginId: 'basil-genovese',
      because: 'Great with tomatoes.',
      provenance: 'ai'
    });
    expect(out.droppedRows).toBe(4);
    expect(out.followUp).toBe('sun');
    expect(out.reply).toBe('Here you go.');
  });

  it('caps an over-long shortlist at 12', () => {
    const shortlist = HERB_PLUGIN_IDS.map((id) => ({ cropPluginId: id, because: 'Nice herb.' }));
    const out = validateBriefAnswer(
      { reply: 'ok', shortlist: shortlist.slice(0, 40) },
      { answers: {}, known, sprayTerms: terms }
    )!;
    expect(out.rows).toHaveLength(MAX_SHORTLIST);
    expect(out.droppedRows).toBe(Math.min(40, shortlist.length) - MAX_SHORTLIST);
  });

  it('keeps typed herbs first and manual even when Claude leaves them out', () => {
    const out = validateBriefAnswer(
      { reply: 'ok', shortlist: [{ cropPluginId: 'chervil', because: 'Soft and fresh.' }] },
      { answers: { wanted: a(['lemon-balm']) }, known, sprayTerms: terms }
    )!;
    expect(out.rows.map((r) => [r.cropPluginId, r.provenance])).toEqual([
      ['lemon-balm', 'manual'],
      ['chervil', 'ai']
    ]);
  });

  it('replaces a sentence the guard drops with the deterministic reason (R-26)', () => {
    const lines = [
      'Spray it with neem oil every week.',
      'Garlic oil made with it is lovely.',
      'Use 1 cup per quart of water.'
    ];
    const ids = ['basil-genovese', 'oregano-greek', 'parsley-italian-flat-leaf'];
    const out = validateBriefAnswer(
      {
        reply: 'ok',
        shortlist: ids.map((id, i) => ({ cropPluginId: id, because: lines[i] }))
      },
      { answers: { cuisines: a(['italian']) }, known, sprayTerms: terms }
    )!;
    for (const line of lines) {
      if (!isSprayAdvice(line, terms)) continue;
      const row = out.rows[lines.indexOf(line)];
      expect(row.because).toBe('Picked for Italian cooking.');
      expect(row.reasons).toEqual([{ kind: 'cuisine', cuisine: 'italian' }]);
      expect(row.provenance).toBe('ai');
    }
    expect(out.replacedSentences).toBeGreaterThanOrEqual(1);
  });

  it('every row Claude can return carries a line that passes the guard (property)', () => {
    const sentence = fc.oneof(
      fc.constantFrom(
        'Spray it with neem oil every week.',
        'Garlic oil made with it is lovely.',
        'Use 1 cup per quart of water.',
        'Mix 2 tbsp per gallon and spray at dusk.',
        'Great in pesto.',
        ''
      ),
      fc.string({ maxLength: 60 })
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            cropPluginId: fc.constantFrom(...HERB_PLUGIN_IDS, 'junk'),
            because: sentence
          }),
          { maxLength: 20 }
        ),
        (shortlist) => {
          const out = validateBriefAnswer(
            { reply: 'ok', shortlist },
            { answers: {}, known, sprayTerms: terms }
          )!;
          expect(out.rows.length).toBeLessThanOrEqual(MAX_SHORTLIST);
          for (const r of out.rows) {
            expect(r.because.length).toBeGreaterThan(0);
            expect(filterSprayAdvice(r.because, terms).removed).toBe(false);
          }
        }
      ),
      { numRuns: 150 }
    );
  });

  it('drops a reply that gives spray advice', () => {
    const out = validateBriefAnswer(
      { reply: 'Spray with neem oil.', shortlist: [{ cropPluginId: 'chives-common' }] },
      { answers: {}, known, sprayTerms: terms }
    )!;
    expect(out.reply).toBeNull();
    expect(out.rows[0].because).toBe('Suggested for your garden.');
  });
});

describe('fixture Claude answer', () => {
  it('is request-shaped and exercises every server check', () => {
    const prompt = buildBriefPrompt(input({ avoid: a(['anise-hyssop']) }));
    const raw = JSON.parse(fixtureBriefAnswer(prompt));
    const ids = raw.shortlist.map((r: { cropPluginId: string }) => r.cropPluginId);
    expect(ids).toContain(FIXTURE_BRIEF_UNKNOWN_ID);
    expect(ids).not.toContain('anise-hyssop');
    const out = validateBriefAnswer(raw, {
      answers: { avoid: a(['anise-hyssop']) },
      known,
      sprayTerms: terms
    })!;
    expect(out.rows).toHaveLength(3);
    expect(out.rows.slice(0, 2).every((r) => r.because === FIXTURE_BRIEF_BECAUSE)).toBe(true);
    expect(out.rows[2].because).toBe('Suggested for your garden.');
    expect(out.droppedRows).toBe(1);
    expect(out.followUp).toBe('cuisines');
  });
});
