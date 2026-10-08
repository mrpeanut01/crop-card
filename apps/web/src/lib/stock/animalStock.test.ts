import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  animalHealthMeta,
  feedMeta,
  feedUseAmount,
  feedUseNote,
  formatNada,
  isBareNadaNumber,
  isFeedCategory,
  matchHealthPluginByNada,
  nadaFromInput,
  normalizeNada,
  onHandLb,
  parseFeedUseNote,
  parseMedLabelJson,
  sanitizeAnimalDraft,
  scoopChoices,
  withMetaSection
} from './animalStock';
import { toStorage } from './units';

describe('feed metadata', () => {
  it('reads lb per bag and scoop, tagging the scoop manual', () => {
    const json = JSON.stringify({ feed: { lbPerBag: 50, scoopLb: 1.5 } });
    expect(feedMeta(json)).toEqual({ lbPerBag: 50, scoopLb: 1.5, scoopProvenance: 'manual' });
  });

  it('ignores junk and non-positive numbers', () => {
    expect(feedMeta('not json')).toEqual({});
    expect(feedMeta(JSON.stringify({ feed: { lbPerBag: -3, scoopLb: 'x' } }))).toEqual({});
  });

  it('merges a section without losing other keys', () => {
    const seed = JSON.stringify({ seedMeta: { spacing: 12 } });
    const merged = withMetaSection(seed, 'feed', { lbPerBag: 40 });
    expect(JSON.parse(merged!)).toEqual({ seedMeta: { spacing: 12 }, feed: { lbPerBag: 40 } });
  });

  it('drops an empty section and returns undefined when nothing is left', () => {
    const json = JSON.stringify({ feed: { lbPerBag: 40 } });
    expect(withMetaSection(json, 'feed', {})).toBeUndefined();
  });

  it('knows the feed categories', () => {
    expect(isFeedCategory('feed')).toBe(true);
    expect(isFeedCategory('bedding')).toBe(true);
    expect(isFeedCategory('animal-health')).toBe(false);
  });
});

describe('feedUseAmount', () => {
  const bag = (lbPerBag?: number) => ({
    defaultUnit: 'bag',
    metadataJson: lbPerBag ? JSON.stringify({ feed: { lbPerBag } }) : undefined
  });

  it('converts pounds into bags with the owner lb per bag', () => {
    expect(feedUseAmount(bag(50), 5)).toEqual({ ok: true, amount: 0.1, unit: 'bag' });
  });

  it('refuses a bag item with no lb per bag', () => {
    const r = feedUseAmount(bag(), 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NEEDS_LB_PER_BAG');
  });

  it('converts pounds into bales only with the owner lb per bale (#765)', () => {
    const bale = (lbPerBale?: number) => ({
      defaultUnit: 'bale',
      metadataJson: lbPerBale ? JSON.stringify({ feed: { lbPerBale } }) : undefined
    });
    expect(feedUseAmount(bale(40), 20)).toEqual({ ok: true, amount: 0.5, unit: 'bale' });
    const r = feedUseAmount(bale(), 20, 'en');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NEEDS_LB_PER_BAG');
      expect(r.message).toMatch(/one bale/);
    }
    expect(feedMeta(JSON.stringify({ feed: { lbPerBale: 0 } })).lbPerBale).toBeUndefined();
  });

  it('passes pounds straight through for weight units', () => {
    expect(feedUseAmount({ defaultUnit: 'kg' }, 2)).toEqual({ ok: true, amount: 2, unit: 'lb' });
  });

  it('uses the fixed size of the named bag units', () => {
    const r = feedUseAmount({ defaultUnit: 'bag-50lb' }, 25);
    expect(r).toEqual({ ok: true, amount: 0.5, unit: 'bag-50lb' });
  });

  it('refuses a count unit', () => {
    const r = feedUseAmount({ defaultUnit: 'count' }, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNIT_NOT_WEIGHT');
  });

  it('stores a use in hundredths of a bag that round-trips within half a hundredth', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 200, noNaN: true }),
        fc.double({ min: 5, max: 100, noNaN: true }),
        (lb, lbPerBag) => {
          const r = feedUseAmount(bag(lbPerBag), lb);
          if (!r.ok) return false;
          const hundredths = toStorage(r.amount, r.unit, 'bag')!;
          return Math.abs(hundredths / 100 - lb / lbPerBag) <= 0.005 + 1e-9;
        }
      )
    );
  });

  it('shows on-hand pounds for bag and weight items', () => {
    expect(onHandLb(bag(50), 2)).toBe(100);
    expect(onHandLb({ defaultUnit: 'lb' }, 7)).toBe(7);
    expect(onHandLb(bag(), 2)).toBeNull();
  });
});

describe('scoops and notes', () => {
  it('offers 1, 2 and 3 scoops only when a scoop is set', () => {
    expect(scoopChoices(undefined)).toEqual([]);
    expect(scoopChoices(1.25)).toEqual([
      { scoops: 1, lb: 1.25 },
      { scoops: 2, lb: 2.5 },
      { scoops: 3, lb: 3.75 }
    ]);
  });

  it('links a use to its subject through the note and reads it back', () => {
    const note = feedUseNote({ type: 'group', id: 'g1' });
    expect(note).toBe('animal-feed:group:g1');
    expect(parseFeedUseNote(note)).toEqual({ type: 'group', id: 'g1' });
    expect(feedUseNote(null)).toBe('animal-feed');
    expect(parseFeedUseNote('animal-feed')).toBeNull();
  });
});

describe('NADA numbers', () => {
  it.each([
    ['NADA 141-061', { kind: 'NADA', number: '141-061' }],
    ['ANADA #200-420', { kind: 'ANADA', number: '200-420' }],
    ['nada141061', { kind: 'NADA', number: '141-061' }],
    ['NADA No. 141 061', { kind: 'NADA', number: '141-061' }]
  ])('normalizes %s', (raw, want) => {
    expect(normalizeNada(raw)).toEqual(want);
  });

  it.each(['', 'EPA 123-45', 'NADA 14-061', 'NADA 141-0611', 'hello'])('rejects %s', (raw) => {
    expect(normalizeNada(raw)).toBeNull();
  });

  it('formats a number the way labels print it', () => {
    expect(formatNada({ kind: 'ANADA', number: '200-420' })).toBe('ANADA 200-420');
  });

  it('reads the approval number back from metadata with its provenance', () => {
    const json = JSON.stringify({
      animalHealth: { nada: { kind: 'NADA', number: '141-061', provenance: 'ai' } }
    });
    expect(animalHealthMeta(json).nada).toEqual({
      kind: 'NADA',
      number: '141-061',
      provenance: 'ai'
    });
  });
});

describe('parseMedLabelJson', () => {
  it('keeps the name and NADA only', () => {
    const raw = JSON.stringify({
      displayName: 'Example Dewormer',
      nada: 'NADA 141-061',
      withdrawal: { meatDays: 7 },
      species: ['cattle'],
      dose: '1 mL per 10 lb'
    });
    expect(parseMedLabelJson(raw)).toEqual({
      found: true,
      displayName: 'Example Dewormer',
      nada: { kind: 'NADA', number: '141-061' }
    });
  });

  it('never carries a withdrawal field for any input', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const out = parseMedLabelJson(JSON.stringify(obj)) as unknown as Record<string, unknown>;
        return Object.keys(out).every((k) => ['found', 'displayName', 'nada'].includes(k));
      })
    );
  });

  it('is not found with no name or unparseable text', () => {
    expect(parseMedLabelJson('no json here').found).toBe(false);
    expect(parseMedLabelJson('{"nada":"NADA 141-061"}').found).toBe(false);
  });
});

describe('matchHealthPluginByNada', () => {
  const plugins = [
    { pluginId: 'a', displayName: 'A', approval: { kind: 'NADA', number: '141-061' } },
    { pluginId: 'b', displayName: 'B', approval: { kind: 'ANADA', number: '141-061' } },
    { pluginId: 'c', displayName: 'C' }
  ];

  it('matches kind and number exactly', () => {
    expect(matchHealthPluginByNada({ kind: 'NADA', number: '141-061' }, plugins)?.pluginId).toBe(
      'a'
    );
    expect(matchHealthPluginByNada({ kind: 'NADA', number: '141-062' }, plugins)).toBeNull();
  });

  it('suggests nothing when two products share the number', () => {
    const dup = [...plugins, { ...plugins[0], pluginId: 'a2' }];
    expect(matchHealthPluginByNada({ kind: 'NADA', number: '141-061' }, dup)).toBeNull();
  });
});

describe('sanitizeAnimalDraft', () => {
  it('drops the library link, category and notes from a med draft', () => {
    const out = sanitizeAnimalDraft('animal-health', {
      source: 'ai',
      displayName: 'Dewormer',
      pluginId: 'some-plugin',
      category: 'herbicide',
      notes: 'Withdrawal 7 days',
      nada: { kind: 'NADA', number: '141-061' }
    });
    expect(out).toEqual({
      source: 'ai',
      displayName: 'Dewormer',
      nada: { kind: 'NADA', number: '141-061' }
    });
  });

  it('leaves other types alone', () => {
    const d = { source: 'ai' as const, pluginId: 'x' };
    expect(sanitizeAnimalDraft('pesticide', d)).toBe(d);
  });
});

describe('movement words in Spanish', () => {
  it('keeps English output and translates for es', async () => {
    const { movementLabel, movementReasonText } = await import('./animalStock');
    const { stockCategoryLabel } = await import('./categories');
    expect(movementLabel('animal-feed')).toBe('Fed');
    expect(movementLabel('animal-feed', 'es')).toBe('Alimentado');
    expect(movementLabel('mystery', 'es')).toBe('mystery');
    expect(movementReasonText('spray-event')).toBe('spray-event');
    expect(movementReasonText('spray-event', 'es')).toBe('aplicación');
    expect(stockCategoryLabel('animal-health')).toBe('animal-health');
    expect(stockCategoryLabel('fuel', 'es')).toBe('combustible');
  });
});

describe('nadaFromInput (#697)', () => {
  const linked = { kind: 'NADA' as const, number: '128-620' };

  it('reads a full number as before', () => {
    expect(nadaFromInput('ANADA 200-437', linked)).toEqual({ kind: 'ANADA', number: '200-437' });
  });

  it('takes the linked product kind for a bare number only when the numbers match', () => {
    expect(nadaFromInput('128-620', linked)).toEqual({ kind: 'NADA', number: '128-620' });
    expect(nadaFromInput('128620', linked)).toEqual({ kind: 'NADA', number: '128-620' });
    expect(nadaFromInput('141-061', linked)).toBeNull();
    expect(nadaFromInput('128-620', null)).toBeNull();
  });

  it('knows a bare number from a malformed one', () => {
    expect(isBareNadaNumber('128-620')).toBe(true);
    expect(isBareNadaNumber(' 128 620 ')).toBe(true);
    expect(isBareNadaNumber('NADA 12')).toBe(false);
    expect(isBareNadaNumber('12-620')).toBe(false);
  });
});
