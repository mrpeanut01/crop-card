import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as before from './__reference__/quoteNumbersPre';
import {
  fractionForms,
  numberWord,
  statesAmount,
  statesDays,
  statesInches,
  statesPhiDays
} from './quoteNumbers';
import { parsePplsFile, pplsBaseStem } from '../../../scripts/lib/pplsFile.mjs';
import { pplsLabelRegistration } from './earlierRegistration';

const SCRIPTS = path.resolve(__dirname, '../../../scripts');

/** Every distinct string in the sources files that holds a figure. */
function sourceQuotes(): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (/\d|½|¼|¾|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(v))
        out.add(v);
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const f of readdirSync(SCRIPTS)
    .filter((x) => x.endsWith('-sources.json'))
    .sort()) {
    walk(JSON.parse(readFileSync(path.join(SCRIPTS, f), 'utf8')));
  }
  return [...out];
}

/** The numbers worth asking a quote about: those it prints, their neighbours,
 *  the same span in weeks or feet, quarter steps and a fixed spread. */
function candidates(quote: string): number[] {
  const set = new Set<number>([0, -0, 0.25, 0.5, 0.75, 1, 1.5, 7, 14, 21, 70, 77, 84, -7, -14]);
  for (const m of quote.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    for (const v of [
      n,
      n + 1,
      n - 1,
      n * 7,
      n / 7,
      n * 12,
      n / 12,
      n + 0.25,
      n + 0.5,
      n + 0.75,
      -n
    ])
      set.add(v);
  }
  for (let w = 1; w <= 12; w++) {
    for (const v of [w, w * 6, w * 7, w * 12]) set.add(v);
  }
  return [...set];
}

const HELPERS = [
  ['statesDays', before.statesDays, statesDays],
  ['statesInches', before.statesInches, statesInches],
  ['statesPhiDays', before.statesPhiDays, statesPhiDays],
  ['statesAmount', before.statesAmount, statesAmount]
] as const;

describe('shared quote-number helpers read every source quote as before', () => {
  const quotes = sourceQuotes();

  it.each(HELPERS)(
    '%s',
    (_name, old, now) => {
      const diffs: string[] = [];
      for (const q of quotes) {
        for (const n of candidates(q)) {
          if (old(q, n) !== now(q, n)) diffs.push(`${n}: ${q.slice(0, 80)}`);
        }
      }
      expect(quotes.length).toBeGreaterThan(1000);
      expect(diffs).toEqual([]);
      // Measured 1.3 to 5.6 s locally per helper (statesInches is the slowest).
    },
    60_000
  );

  it.each(HELPERS)('%s on generated quotes', (_name, old, now) => {
    const token = fc.constantFrom(
      ...[' ', '-', '–', '/', '.', ',', 'day', 'days', 'week', 'weeks', 'feet', 'foot', 'inch'],
      ...['inches', 'the day of harvest', 'up to the day of harvest', '½', '¼', '¾', '1/2'],
      ...['3/4', 'one', 'two', 'three', 'seven', 'ten', 'twelve', 'zero', 'apart', 'rows'],
      ...['0', '1', '2', '3', '4', '6', '7', '12', '14', '21', '24', '36', '1.5', '0.5', '18']
    );
    const n = fc.oneof(
      fc.integer({ min: -30, max: 120 }),
      fc.integer({ min: -8, max: 160 }).map((x) => x / 4),
      fc.integer({ min: 0, max: 40 }).map((x) => x / 10)
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 12 }), n, (parts, value) => {
        const q = parts.join('');
        expect(now(q, value)).toBe(old(q, value));
      }),
      { numRuns: 5000 }
    );
  });
});

describe('quote-number phrasings each gate accepts', () => {
  it.each([
    ['7 days', 7, true],
    ['seven days', 7, false],
    ['one week', 7, true],
    ['two weeks', 14, true],
    ['14-day interval', 14, true],
    ['3-4 weeks', 21, true],
    ['14 days', 15, false],
    ['two weeks', 15, false],
    ['the day of harvest', 0, false]
  ] as const)('statesDays(%j, %d) is %s', (q, n, ok) => {
    expect(statesDays(q, n)).toBe(ok);
  });

  it.each([
    ['7 days', 7, true],
    ['seven days', 7, false],
    ['two weeks', 14, true],
    ['2-week PHI', 14, true],
    ['14-day', 14, true],
    ['May be applied the day of harvest.', 0, true],
    ['up to and including the day of harvest', 0, true],
    ['the day of harvest', 1, false],
    ['two weeks', 15, false],
    ['twelve weeks', 84, false]
  ] as const)('statesPhiDays(%j, %d) is %s', (q, n, ok) => {
    expect(statesPhiDays(q, n)).toBe(ok);
  });

  it.each([
    ['1/2 pint', 0.5, true],
    ['½ pint', 0.5, true],
    ['0.5 pint', 0.5, true],
    ['1 1/2 pints', 1.5, true],
    ['1½ pints', 1.5, true],
    ['1-1/2 pints', 1.5, false],
    ['11/2 pint', 0.5, false],
    ['2 pints', 0.5, false]
  ] as const)('statesAmount(%j, %d) is %s', (q, n, ok) => {
    expect(statesAmount(q, n)).toBe(ok);
  });

  it.each([
    ['rows 1/2 inch apart', 0.5, true],
    ['½ inch', 0.5, true],
    ['0.5 in', 0.5, true],
    ['1-1/2 in between plants', 1.5, true],
    ['two feet between the rows', 24, true],
    ['2 ft rows', 24, true],
    ['1½ ft', 18, true],
    ['six to twelve-inches apart', 6, true],
    ['six to twelve-inches apart', 12, true],
    ['1,000 in', 1000, true],
    ['18 in', 8, false]
  ] as const)('statesInches(%j, %d) is %s', (q, n, ok) => {
    expect(statesInches(q, n)).toBe(ok);
  });

  it('number words and fraction forms', () => {
    expect(numberWord(7, 10)).toBe('seven');
    expect(numberWord(11, 10)).toBeUndefined();
    expect(numberWord(12, 12)).toBe('twelve');
    expect(numberWord(0, 10)).toBeUndefined();
    expect(numberWord(0, 10, 0)).toBe('zero');
    expect(numberWord(1.5, 12)).toBeUndefined();
    expect(fractionForms(0.5)).toEqual(['1/2', '½']);
    expect(fractionForms(0.3)).toBeUndefined();
  });
});

const PPLS = 'https://www3.epa.gov/pesticides/chem_search/ppls/';

describe('PPLS label file names', () => {
  it('reads a base registration file', () => {
    expect(parsePplsFile(`${PPLS}066330-00276-20090911.pdf`)).toEqual({
      registration: '66330-276',
      base: '66330-276',
      distributor: null,
      stamped: '2009-09-11'
    });
  });

  it('reads a distributor file', () => {
    expect(parsePplsFile(`${PPLS}001381-00146-34704-20200101.pdf?x=1#p2`)).toEqual({
      registration: '1381-146-34704',
      base: '1381-146',
      distributor: '34704',
      stamped: '2020-01-01'
    });
    expect(pplsLabelRegistration(`${PPLS}001381-00146-34704-20200101.pdf`)).toEqual({
      registration: '1381-146',
      stamped: '2020-01-01'
    });
  });

  it('gives null for a malformed or non-PPLS name', () => {
    for (const bad of [
      `${PPLS}066330-00276.pdf`,
      `${PPLS}066330-00276-2009091.pdf`,
      `${PPLS}066330-00276-20090911.txt`,
      `${PPLS}OR070014-20241008.pdf`,
      `${PPLS}1-2-3-4-20200101.pdf`,
      'https://example.com/066330-00276-20090911.pdf',
      undefined,
      42
    ]) {
      expect(parsePplsFile(bad)).toBeNull();
    }
  });

  it('agrees with the old app parser on base files', () => {
    const name = fc
      .tuple(
        fc.integer({ min: 0, max: 999999 }),
        fc.integer({ min: 0, max: 99999 }),
        fc.date({ min: new Date('1990-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
      )
      .map(
        ([c, p, d]) =>
          `${PPLS}${String(c).padStart(6, '0')}-${String(p).padStart(5, '0')}-${d
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, '')}.pdf`
      );
    fc.assert(
      fc.property(name, (url) => {
        expect(pplsLabelRegistration(url)).toEqual(before.pplsLabelRegistration(url));
      })
    );
  });

  it('builds the base stem and refuses anything else', () => {
    expect(pplsBaseStem('100-1182')).toBe('000100-01182');
    expect(pplsBaseStem('1381-146-34704')).toBeNull();
    expect(pplsBaseStem('n/a')).toBeNull();
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(pplsBaseStem(s)).toBe(before.pplsStem(s));
      })
    );
  });
});
