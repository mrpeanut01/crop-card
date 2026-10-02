import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CARRYOVER_SECTION,
  CARRYOVER_TESTS_SECTION,
  buildCarryoverLines,
  carryoverHref,
  countingBioassay,
  linesForBlocks,
  withCarryover,
  type BioassayFact,
  type CarryoverLine
} from './areaCarryover';
import type { CardModel } from '$lib/cards/model';
import type { CarryoverState } from '$lib/amendments/carryover';

const TZ = 'America/New_York';
const day = (y: number, m: number, d: number, h = 16) => Date.UTC(y, m - 1, d, h);

const spread = {
  applicationId: 'app1',
  blockId: 'blk1',
  batchId: 'bat1',
  occurredAt: day(2026, 5, 1)
};

function facts(over: Partial<Parameters<typeof buildCarryoverLines>[0]> = {}) {
  return {
    spreads: [spread],
    states: new Map<string, CarryoverState>([['bat1', 'may-carry']]),
    batchNames: new Map([['bat1', 'Goat pile']]),
    newestInputAt: new Map([['bat1', day(2026, 4, 20)]]),
    bioassays: [] as BioassayFact[],
    dismissedApplicationIds: new Set<string>(),
    timeZone: TZ,
    ...over
  };
}

const test = (o: Partial<BioassayFact>): BioassayFact => ({
  id: 't',
  batchId: null,
  blockId: 'blk1',
  testedAt: day(2026, 5, 20, 4),
  createdAt: 1,
  result: 'no-damage',
  ...o
});

const card: CardModel = {
  kind: 'area',
  key: 'ar_x',
  kicker: 'Garden',
  title: 'Garden',
  facts: [],
  sections: [{ title: 'Notes', items: ['n'] }],
  asOf: 0,
  provenance: [{ source: 'data' }],
  href: '/x'
};

describe('buildCarryoverLines (M-47, M-48)', () => {
  it('writes the may-carry line with the batch and spread date', () => {
    const out = buildCarryoverLines(facts());
    expect(out.blk1).toEqual([
      {
        blockId: 'blk1',
        applicationId: 'app1',
        batchId: 'bat1',
        tone: 'warn',
        provenance: 'data',
        text: 'Got Goat pile on May 1, 2026, which may carry a weed killer that harms tomatoes, beans, peas and other broadleaf crops. Consider a pea or bean test before planting.'
      }
    ]);
  });

  it('shows nothing for a none-on-file batch or a dismissed application', () => {
    expect(
      buildCarryoverLines(facts({ states: new Map([['bat1', 'none-on-file' as const]]) }))
    ).toEqual({});
    expect(buildCarryoverLines(facts({ dismissedApplicationIds: new Set(['app1']) }))).toEqual({});
  });

  it('a no-damage block test mutes it; a later damage test brings the warning back', () => {
    const muted = buildCarryoverLines(facts({ bioassays: [test({})] })).blk1[0];
    expect(muted.tone).toBe('muted');
    expect(muted.text).toBe(
      'Got Goat pile on May 1, 2026. Your pea or bean test on May 20, 2026 showed no damage.'
    );
    const damaged = buildCarryoverLines(
      facts({
        bioassays: [test({}), test({ id: 'u', result: 'damage', testedAt: day(2026, 5, 25, 4) })]
      })
    ).blk1[0];
    expect(damaged.tone).toBe('warn');
    expect(damaged.text).toContain(
      'Oregon State Extension says the material is likely contaminated.'
    );
  });

  it('a block test before the spread day or a batch test before the newest input does not count', () => {
    expect(
      countingBioassay(spread, [test({ testedAt: day(2026, 4, 30, 4) })], undefined, TZ)
    ).toBeNull();
    expect(
      countingBioassay(spread, [test({ testedAt: day(2026, 5, 1, 4) })], undefined, TZ)
    ).not.toBeNull();
    const batchTest = test({ blockId: null, batchId: 'bat1', testedAt: day(2026, 4, 10, 4) });
    expect(countingBioassay(spread, [batchTest], day(2026, 4, 20), TZ)).toBeNull();
    expect(
      countingBioassay(
        spread,
        [{ ...batchTest, testedAt: day(2026, 4, 21, 4) }],
        day(2026, 4, 20),
        TZ
      )
    ).not.toBeNull();
  });

  it('the latest test wins, ties broken by entry time', () => {
    const a = test({ id: 'a', result: 'damage', createdAt: 1 });
    const b = test({ id: 'b', result: 'no-damage', createdAt: 2 });
    expect(countingBioassay(spread, [a, b], undefined, TZ)?.id).toBe('b');
  });

  it('never says safe or clear, and uses no em dash, over any states and tests', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<CarryoverState>('may-carry', 'not-known', 'none-on-file'),
        fc.array(fc.constantFrom<'no-damage' | 'damage'>('no-damage', 'damage'), { maxLength: 3 }),
        (state, results) => {
          const out = buildCarryoverLines(
            facts({
              states: new Map([['bat1', state]]),
              bioassays: results.map((r, i) =>
                test({ id: `t${i}`, result: r, testedAt: day(2026, 5, 10 + i, 4) })
              )
            })
          );
          for (const l of Object.values(out).flat()) {
            expect(l.text).not.toMatch(/\bsafe\b|\bclear\b|—/i);
            if (results.at(-1) === 'damage') expect(l.tone).toBe('warn');
          }
        }
      )
    );
  });
});

describe('withCarryover', () => {
  const line = (blockId: string, tone: 'warn' | 'muted', text: string): CarryoverLine => ({
    blockId,
    applicationId: `${blockId}-${text}`,
    batchId: 'b',
    tone,
    text,
    provenance: 'data'
  });

  it('is unchanged with no lines', () => {
    expect(withCarryover(card, [])).toBe(card);
  });

  it('adds warn and muted sections ahead of the rest, and is idempotent', () => {
    const lines = [line('a', 'warn', 'W'), line('a', 'muted', 'M')];
    const once = withCarryover(card, lines);
    expect(once.sections.map((s) => s.title)).toEqual([
      CARRYOVER_SECTION,
      CARRYOVER_TESTS_SECTION,
      'Notes'
    ]);
    expect(once.sections[0].safety).toBe(true);
    expect(once.provenance).toContainEqual({ source: 'data', detail: 'your records' });
    expect(withCarryover(once, lines).sections).toEqual(once.sections);
  });

  it('caps the Area Card at three lines with block names, then "and n more"', () => {
    const lines = ['1', '2', '3', '4', '5'].map((n) => line(`b${n}`, 'warn', `L${n}`));
    const out = withCarryover(card, lines, {
      max: 3,
      blockNames: new Map([['b1', 'Bed 1']]),
      link: true
    });
    expect(out.sections[0].items).toEqual(['Bed 1: L1', 'L2', 'L3', 'and 2 more']);
    expect(out.links?.map((l) => l.href)).toEqual([
      carryoverHref('b1'),
      carryoverHref('b2'),
      carryoverHref('b3')
    ]);
    expect(out.links?.[0].label).toBe('Pea test or dismiss: Bed 1');
  });

  it('linesForBlocks keeps block order', () => {
    const by = { x: [line('x', 'warn', 'X')], y: [line('y', 'warn', 'Y')] };
    expect(linesForBlocks(by, ['y', 'x']).map((l) => l.text)).toEqual(['Y', 'X']);
    expect(linesForBlocks(null, ['x'])).toEqual([]);
  });
});
