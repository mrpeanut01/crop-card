import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  confidentLibraryMatch,
  nameTokens,
  rankLibraryMatches,
  searchLibrary,
  type LibraryOption
} from './libraryMatch';

const CROPS_DIR = resolve(__dirname, '../../../../../plugins/crops');
const crops: LibraryOption[] = readdirSync(CROPS_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(CROPS_DIR, f), 'utf8')))
  .map((p: { pluginId: string; displayName: string }) => ({ id: p.pluginId, name: p.displayName }));

function top(name: string): string | undefined {
  return rankLibraryMatches(name, crops)[0]?.id;
}

describe('nameTokens', () => {
  it('folds plurals, synonyms and pack words', () => {
    expect([...nameTokens('Cherokee Purple Heirloom Tomatoes Seeds (Organic, F1) 50 ct')]).toEqual([
      'cherokee',
      'purple',
      'tomato'
    ]);
    expect([...nameTokens('Courgette')]).toEqual(['zucchini']);
    expect([...nameTokens('Pak Choi')]).toEqual(['bok', 'choy']);
    expect([...nameTokens('Non-GMO Pelleted Carrots 1/2 lb')]).toEqual(['carrot']);
    expect([...nameTokens('Radishes, Berries')]).toEqual(['radish', 'berry']);
  });

  it('keeps words that end in -ss, -us or -is', () => {
    expect([...nameTokens('Asparagus Swiss Chard')]).toEqual(['asparagus', 'swiss', 'chard']);
  });
});

describe('rankLibraryMatches against the real crop library (#472)', () => {
  it('matches a web-page seed name with marketing words to its variety', () => {
    expect(top('Cherokee Purple Heirloom Tomato Seeds')).toBe('tomato-cherokee-purple');
    expect(top('Organic Genovese Basil, Pelleted')).toBe('basil-genovese');
  });

  it('matches through synonyms', () => {
    expect(top('Courgette Black Beauty')).toBe('zucchini-black-beauty');
    expect(top('Pak Choi')).toBe('bok-choy-white-stem');
    expect(top('Coriander Santo')).toBe('cilantro-santo');
  });

  it('lands an unknown variety on its crop kind', () => {
    const id = top('Mortgage Lifter Red Beefsteak Tomato Seeds');
    expect(id?.startsWith('tomato')).toBe(true);
  });

  it('returns nothing for a pesticide name', () => {
    expect(rankLibraryMatches('Roundup PowerMAX', crops)).toEqual([]);
  });

  it('returns at most three matches, best first', () => {
    const m = rankLibraryMatches('Tomato', crops);
    expect(m.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < m.length; i++) expect(m[i - 1].score).toBeGreaterThanOrEqual(m[i].score);
  });

  it('scores an exact name 1', () => {
    const m = rankLibraryMatches('Tomato Cherokee Purple', crops);
    expect(m[0]).toMatchObject({ id: 'tomato-cherokee-purple', score: 1 });
  });
});

describe('searchLibrary', () => {
  const opts: LibraryOption[] = [
    { id: 'tomato-cherokee-purple', name: 'Tomato — Cherokee Purple (heirloom)' },
    { id: 'tomato-sungold', name: 'Tomato Sungold F1' },
    { id: 'basil-genovese', name: 'Basil — Genovese' },
    { id: 'zucchini-black-beauty', name: 'Zucchini Black Beauty' }
  ];

  it('prefix-matches every typed word', () => {
    expect(searchLibrary('tom cher', opts).map((o) => o.id)).toEqual(['tomato-cherokee-purple']);
    expect(searchLibrary('tom', opts).map((o) => o.id)).toEqual([
      'tomato-cherokee-purple',
      'tomato-sungold'
    ]);
  });

  it('finds synonyms and plurals', () => {
    expect(searchLibrary('courgette', opts).map((o) => o.id)).toEqual(['zucchini-black-beauty']);
    expect(searchLibrary('tomatoes', opts)).toHaveLength(2);
  });

  it('lists everything in name order for an empty query', () => {
    expect(searchLibrary('', opts, 2).map((o) => o.id)).toEqual([
      'basil-genovese',
      'tomato-cherokee-purple'
    ]);
  });
});

describe('confidentLibraryMatch against the real crop library (#472 review)', () => {
  const pick = (name: string) => confidentLibraryMatch(name, crops)?.name;

  it('never binds a generic or partly matching name to one variety', () => {
    expect(pick('Lettuce mix')).toBeUndefined();
    expect(pick('Garlic')).toBeUndefined();
    expect(pick('Blue Lake pole bean')).toBeUndefined();
    expect(pick('Tomato')).toBeUndefined();
    expect(pick('Mystery Squash Mix')).toBeUndefined();
  });

  it('still binds a name that clearly means one entry', () => {
    expect(confidentLibraryMatch('Cherokee Purple Heirloom Tomato Seeds', crops)?.id).toBe(
      'tomato-cherokee-purple'
    );
    expect(pick('Provider Bush Bean')).toBe('Bush Bean — Provider');
    expect(pick('Blue Lake 274 bush bean')).toBe('Bush Bean Blue Lake 274');
    expect(confidentLibraryMatch('Pak Choi', crops)?.id).toBe('bok-choy-white-stem');
  });
});
