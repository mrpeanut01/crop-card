import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  NO_SECTION_TEXT,
  SPRAY_REDIRECT,
  asksForSprayAdvice,
  careSectionsFor,
  filterSprayAdvice,
  filterSprayAdviceItems,
  growerFacingText,
  isSprayAdvice,
  sprayProductTerms,
  topicFor
} from './photoHelp';
import { questionText } from './model';

const SECTIONS = [
  { title: 'Water', items: ['Water deeply once a week.'] },
  { title: 'Stake and prune', items: ['Pinch suckers.'] },
  { title: 'Harvest cues', items: ['Shoulders turn dusky purple'] },
  { title: 'Common problems', items: ['Yellow lower leaves: remove them.'] }
];

describe('topicFor', () => {
  it('maps each chip to its Care Guide topic', () => {
    expect(topicFor('ready')).toBe('harvest');
    expect(topicFor('prune')).toBe('prune');
    expect(topicFor('leaves')).toBe('problems');
  });

  it('reads free text for a topic and falls back to general', () => {
    expect(topicFor('other', 'Are these ripe yet?')).toBe('harvest');
    expect(topicFor('other', 'Should I pinch the suckers?')).toBe('prune');
    expect(topicFor('other', 'Brown spots on the leaves')).toBe('problems');
    expect(topicFor('other', 'Hello there')).toBe('general');
  });
});

describe('careSectionsFor', () => {
  it('returns the matching Care Guide sections', () => {
    expect(careSectionsFor(SECTIONS, 'harvest')).toEqual([SECTIONS[2]]);
    expect(careSectionsFor(SECTIONS, 'prune')).toEqual([SECTIONS[1]]);
    expect(careSectionsFor(SECTIONS, 'problems')).toEqual([SECTIONS[3]]);
    expect(careSectionsFor(SECTIONS, 'general').map((s) => s.title)).toEqual([
      'Harvest cues',
      'Common problems',
      'Water'
    ]);
  });

  it('says so plainly when the guide has nothing on the topic', () => {
    expect(careSectionsFor([], 'harvest')).toEqual([
      { title: 'Care guide', items: [NO_SECTION_TEXT.harvest], provenance: 'fallback' }
    ]);
    expect(careSectionsFor([{ title: 'Harvest cues', items: [] }], 'harvest')[0].title).toBe(
      'Care guide'
    );
  });
});

describe('spray advice guard', () => {
  it.each([
    'Spray neem oil every 7 days.',
    'Use a copper fungicide at the first sign.',
    'Mix 2 tbsp per gallon of water.',
    'Apply 1.5 fl oz per acre.',
    'Try Sevin dust on the leaves.',
    'Bt kills the caterpillars.',
    'Check the REI before you go back in.',
    'A horticultural oil will smother them.',
    'An insecticidal soap works well.',
    'Chlorothalonil controls early blight.'
  ])('flags %s', (s) => {
    expect(isSprayAdvice(s)).toBe(true);
  });

  it.each([
    'Pick when the shoulders turn dusky purple.',
    'Remove the yellow lower leaves and mulch.',
    'Water at the base in the morning.',
    'Pinch the suckers between the stem and the branch.',
    'Copper-colored leaves can mean cold nights.',
    'Hand-pick the hornworms at dusk.',
    'Add 2 inches of compost.'
  ])('lets %s through', (s) => {
    expect(isSprayAdvice(s)).toBe(false);
  });

  it('drops only the spray sentences from an answer', () => {
    const out = filterSprayAdvice(
      'These look ready. Spray them with neem every week to stop pests. Pick them tomorrow morning.'
    );
    expect(out).toEqual({ text: 'These look ready. Pick them tomorrow morning.', removed: true });
    expect(filterSprayAdvice('Pick them now.')).toEqual({ text: 'Pick them now.', removed: false });
    expect(filterSprayAdvice('Use 2 oz per gallon of spinosad.')).toEqual({
      text: '',
      removed: true
    });
  });

  it('never lets a rate or product through, however the answer is padded', () => {
    const products = ['neem', 'spinosad', 'Sevin', 'copper fungicide', 'Roundup', 'Daconil'];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('Pick it.', 'Water well.', 'Mulch the bed.'), { maxLength: 4 }),
        fc.constantFrom(...products),
        fc.integer({ min: 1, max: 20 }),
        (safe, product, n) => {
          const advice = `Use ${n} tbsp per gallon of ${product}.`;
          const out = filterSprayAdvice([...safe, advice, ...safe].join(' '));
          expect(out.removed).toBe(true);
          expect(out.text).not.toMatch(new RegExp(product, 'i'));
          expect(out.text).not.toMatch(/per gallon/i);
        }
      )
    );
  });

  it('knows when the question itself asks for spray advice', () => {
    expect(asksForSprayAdvice('What should I spray on these?')).toBe(true);
    expect(asksForSprayAdvice('Which product kills aphids?')).toBe(true);
    expect(asksForSprayAdvice('How much do I mix per gallon?')).toBe(true);
    expect(asksForSprayAdvice(questionText('leaves', ''))).toBe(false);
    expect(asksForSprayAdvice(questionText('ready', 'the big one'))).toBe(false);
  });

  const LIBRARY = sprayProductTerms([
    { displayName: 'Entrust SC (Corteva spinosad — OMRI)', activeIngredients: ['spinosad'] },
    { displayName: 'Actara (Syngenta thiamethoxam)', activeIngredients: ['thiamethoxam'] },
    { displayName: 'Admire Pro (Bayer imidacloprid)', activeIngredients: ['imidacloprid'] },
    {
      displayName: 'Coragen (FMC chlorantraniliprole)',
      activeIngredients: ['chlorantraniliprole']
    },
    { displayName: 'Serenade ASO (Bayer Bacillus subtilis — OMRI)' },
    { displayName: 'Warrior II with Zeon (Syngenta lambda-cyhalothrin)' },
    { displayName: 'Assail 30SG (UPL acetamiprid)' },
    { displayName: 'Confirm 2F (tebufenozide)', activeIngredients: ['tebufenozide'] },
    {
      displayName: 'Roundup PowerMAX 3 (Ruveon; formerly Bayer)',
      activeIngredients: ['glyphosate potassium salt']
    }
  ]);

  it('builds brand and active-ingredient terms from the plugin library', () => {
    expect(LIBRARY).toEqual(
      expect.arrayContaining([
        '^Entrust',
        'actara',
        'admire pro',
        '^Admire',
        'coragen',
        'chlorantraniliprole',
        'glyphosate',
        '=Confirm',
        '^Warrior'
      ])
    );
  });

  it.each([
    'Entrust will clean up those caterpillars fast.',
    'Actara or Admire Pro would knock the aphids back.',
    'Dust the leaves with sulfur in the cool morning.',
    'Apply copper every week while it stays wet.',
    'Mix 2 tablespoons of dish soap in a gallon of water and wet the leaves.',
    'Use 1 tablespoon per quart of water.',
    'Serenade is a good biological choice here.',
    'Dust with diatomaceous earth around the stems.',
    'Try Captan for scab.',
    'Coragen works on hornworms.',
    'Hit them with Warrior.',
    'I would reach for Assail here.',
    'You could Confirm it with tebufenozide.',
    'A kaolin clay film keeps beetles off.',
    'Copper for fire blight.'
  ])('catches library and household spray advice: %s', (s) => {
    expect(isSprayAdvice(s, LIBRARY)).toBe(true);
    expect(filterSprayAdvice(`Pick them by hand. ${s}`, LIBRARY)).toEqual({
      text: 'Pick them by hand.',
      removed: true
    });
  });

  it.each([
    'Confirm the fruit is soft before you pick.',
    'I admire how fast these grew.',
    'Switch to watering in the morning.',
    'Water each plant with a gallon a week.'
  ])('leaves everyday words alone: %s', (s) => {
    expect(isSprayAdvice(s, LIBRARY)).toBe(false);
  });

  it.each([
    'What should I put on these to kill the aphids?',
    'Would Entrust fix the worms?',
    'what should I treat this with',
    'Can I dust it with sulfur?',
    'What can I put on these beetles and at what rate?',
    'What should I use to kill the armyworms, and how much per acre?',
    'What is the application rate?',
    'How do I get rid of the slugs?'
  ])('sends %s to the Spray flow', (q) => {
    expect(asksForSprayAdvice(q, LIBRARY)).toBe(true);
  });

  it.each([
    'Is it ready to pick?',
    'Where do I prune the suckers?',
    'Why are the lower leaves turning yellow?',
    'How much should I water each week?'
  ])('answers %s as a growing question', (q) => {
    expect(asksForSprayAdvice(q, LIBRARY)).toBe(false);
  });

  it('never lets a library brand through, however the answer is padded', () => {
    const brands = ['Entrust', 'Actara', 'Admire Pro', 'Coragen', 'Serenade', 'Warrior'];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('Pick it.', 'Water well.', 'Mulch the bed.'), { maxLength: 4 }),
        fc.constantFrom(...brands),
        fc.constantFrom('works well', 'will fix it', 'is the one to use'),
        (safe, brand, tail) => {
          const out = filterSprayAdvice([...safe, `${brand} ${tail}.`, ...safe].join(' '), LIBRARY);
          expect(out.removed).toBe(true);
          expect(out.text).not.toContain(brand);
        }
      )
    );
  });

  it('keeps grower text free of spray advice and plugin-author notes', () => {
    expect(
      growerFacingText(
        'Indeterminate heirloom, requires staking. Susceptible to early/late blight; preventive copper or chlorothalonil per UMD vegetable guide. Phase 11 trait override: declares native halosulfuron tolerance so Sandea is permitted despite the sulfonylurea family-kill default.',
        LIBRARY
      )
    ).toBe('Indeterminate heirloom, requires staking.');
    expect(growerFacingText('Copper for fire blight.', LIBRARY)).toBe('');
  });

  it('filters list items and keeps the redirect itself clear of the filter path', () => {
    expect(filterSprayAdviceItems(['Pick often.', 'Spray weekly.'])).toEqual(['Pick often.']);
    expect(SPRAY_REDIRECT).toMatch(/Spray flow/);
    expect(SPRAY_REDIRECT).not.toMatch(/—/);
  });
});
