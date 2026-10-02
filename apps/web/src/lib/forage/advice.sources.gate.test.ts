import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORAGE_ADVICE, FROST_LOOKBACK_DAYS } from './advice';
import { isPageReaderSource } from './hazardSources';
import { NITRATE_CONVERSION_ENTRY, NO3N_TO_NO3, NO3_TO_NO3N } from './interpret';

interface Source {
  url: string;
  publisher: string;
  date: string;
  quote: string;
  note?: string;
}
const FILE = path.resolve(__dirname, '../../../scripts/forage-toxicity-sources.json');
const entries = (
  JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Record<string, { sources: Source[] }> }
).entries;

const numbersIn = (s: string): number[] =>
  (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));

describe('forage advice is tied to its quotes (M-57)', () => {
  for (const advice of Object.values(FORAGE_ADVICE)) {
    it(`${advice.id} rests on a PDF source whose quote holds every number`, () => {
      const entry = entries[advice.entryKey];
      expect(entry, advice.entryKey).toBeDefined();
      const source = entry.sources[advice.sourceIndex];
      expect(source, `${advice.entryKey}[${advice.sourceIndex}]`).toBeDefined();
      expect(isPageReaderSource(source)).toBe(false);
      expect(source.url).toBe(advice.url);
      expect(source.publisher.startsWith(advice.publisher)).toBe(true);
      const quoted = numbersIn(source.quote);
      for (const n of numbersIn(advice.text)) expect(quoted, advice.text).toContain(n);
      const firstWord = advice.publisher.split(' ')[0];
      expect(advice.text.startsWith(firstWord)).toBe(true);
    });
  }

  it('the frost lookback is the longest number in the PDF frost source', () => {
    const src =
      entries[FORAGE_ADVICE.frostWait.entryKey].sources[FORAGE_ADVICE.frostWait.sourceIndex];
    expect(Math.max(...numbersIn(src.quote))).toBe(FROST_LOOKBACK_DAYS);
  });

  it('the nitrate conversion factors are quoted', () => {
    const quotes = entries[NITRATE_CONVERSION_ENTRY].sources
      .filter((s) => !isPageReaderSource(s))
      .map((s) => numbersIn(s.quote))
      .flat();
    expect(quotes).toContain(NO3_TO_NO3N);
    expect(quotes).toContain(NO3N_TO_NO3);
  });

  it('no advice text says safe or clear', () => {
    for (const a of Object.values(FORAGE_ADVICE)) {
      expect(a.text).not.toMatch(/\bsafe\b|\bclear\b|—/i);
    }
  });
});
