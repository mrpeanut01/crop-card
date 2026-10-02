import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  isValidYmd,
  parseSourcesChecked,
  seedSearchFlag,
  SEED_ORGANIC_STATUSES,
  sortChecks,
  type SeedSourcing
} from './seedSourcing';
import { seedSourcingPatchSchema } from './apiSchemas';

const check = { supplier: 'High Mowing', checkedAt: '2026-02-01', result: 'Out of stock' };

describe('parseSourcesChecked', () => {
  it('reads a valid list', () => {
    expect(parseSourcesChecked(JSON.stringify([check]))).toEqual([check]);
  });

  it('yields [] for null, bad JSON and non-arrays', () => {
    for (const v of [null, undefined, '', '{', '{"a":1}', '"x"', '42']) {
      expect(parseSourcesChecked(v)).toEqual([]);
    }
  });

  it('drops bad items and keeps good ones', () => {
    const json = JSON.stringify([
      check,
      null,
      { supplier: '', checkedAt: '2026-01-01', result: 'x' },
      { supplier: 'A', checkedAt: 'yesterday', result: 'x' },
      { supplier: 'A', checkedAt: '2026-01-01' },
      { ...check, extra: 1 }
    ]);
    expect(parseSourcesChecked(json)).toEqual([check, check]);
  });

  it('never throws on any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(Array.isArray(parseSourcesChecked(s))).toBe(true);
      })
    );
  });
});

describe('seedSearchFlag (B-39)', () => {
  const base: SeedSourcing = { status: null, sourcesChecked: [], unavailabilityNote: null };

  it('flags an unanswered lot as not recorded', () => {
    expect(seedSearchFlag(base)).toBe('not-recorded');
    expect(seedSearchFlag({ ...base, sourcesChecked: [check] })).toBe('not-recorded');
  });

  it('flags non-organic lots with no checks as no search on file', () => {
    for (const status of ['untreated', 'treated', 'unknown'] as const) {
      expect(seedSearchFlag({ ...base, status })).toBe('no-search-on-file');
      expect(seedSearchFlag({ ...base, status, sourcesChecked: [check] })).toBeNull();
    }
  });

  it('never flags organic seed', () => {
    expect(seedSearchFlag({ ...base, status: 'organic' })).toBeNull();
  });

  it('only ever returns a flag or null, for every status', () => {
    for (const status of [null, ...SEED_ORGANIC_STATUSES]) {
      for (const sourcesChecked of [[], [check]]) {
        expect([null, 'not-recorded', 'no-search-on-file']).toContain(
          seedSearchFlag({ ...base, status, sourcesChecked })
        );
      }
    }
  });
});

describe('isValidYmd and sortChecks', () => {
  it('accepts real calendar days only', () => {
    expect(isValidYmd('2024-02-29')).toBe(true);
    expect(isValidYmd('2026-02-29')).toBe(false);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('2026-1-01')).toBe(false);
  });

  it('puts the newest check first without changing the input', () => {
    const list = [check, { ...check, checkedAt: '2026-03-01' }];
    expect(sortChecks(list).map((c) => c.checkedAt)).toEqual(['2026-03-01', '2026-02-01']);
    expect(list[0].checkedAt).toBe('2026-02-01');
  });
});

describe('seedSourcingPatchSchema', () => {
  it('turns a blank note into null', () => {
    const out = seedSourcingPatchSchema.parse({
      status: 'unknown',
      sourcesChecked: [],
      unavailabilityNote: '  '
    });
    expect(out.unavailabilityNote).toBeNull();
  });

  it('requires every field', () => {
    expect(seedSourcingPatchSchema.safeParse({ status: 'organic' }).success).toBe(false);
  });
});
