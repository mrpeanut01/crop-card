// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pestModelPluginSchema, SPRAY_WORDS, type PestModelPlugin } from '$lib/plugins/schemas';
import type { Accumulation } from '$lib/climate/degreeDays';
import { E2E_TRAP_MODEL } from './pestModel.fixtures';
import {
  acceptsManualBiofix,
  biofixSettingKey,
  modelApplies,
  modelStatus,
  parseStoredBiofix,
  resolveBiofix,
  shortDay,
  showOnScout,
  showOnToday,
  totalLine,
  watchForLines,
  type ResolvedBiofix
} from './pestModels';

const trap = pestModelPluginSchema.parse(E2E_TRAP_MODEL);
const calendar: PestModelPlugin = pestModelPluginSchema.parse({
  ...E2E_TRAP_MODEL,
  pluginId: 'test-calendar-model',
  biofix: { kind: 'calendar-date', date: '03-01' }
});
const jan1: PestModelPlugin = pestModelPluginSchema.parse({
  ...E2E_TRAP_MODEL,
  pluginId: 'test-jan1-model',
  biofix: { kind: 'january-1' }
});
const trapWithFallback: PestModelPlugin = pestModelPluginSchema.parse({
  ...E2E_TRAP_MODEL,
  pluginId: 'test-trap-fallback',
  biofix: { kind: 'first-trap-catch', date: '05-15' }
});

const acc = (total: number, missing = 0, through = '2026-07-01'): Accumulation => ({
  totalLowerBound: total,
  missingDays: missing,
  throughYmd: through
});
const bf = (ymd: string | null, provenance: ResolvedBiofix['provenance'] = 'manual') =>
  ({ kind: 'first-trap-catch', ymd, provenance, recordedBy: null }) as ResolvedBiofix;

describe('biofix', () => {
  it('keys settings per model and year', () => {
    expect(biofixSettingKey('svb', 2026)).toBe('pest_biofix.svb.2026');
  });

  it('parses only well-formed stored values', () => {
    expect(parseStoredBiofix(null)).toBeNull();
    expect(parseStoredBiofix('not json')).toBeNull();
    expect(parseStoredBiofix(JSON.stringify({ date: '2026-02-30' }))).toBeNull();
    expect(parseStoredBiofix(JSON.stringify({ date: '2026-06-02', byUserId: 'u', at: 5 }))).toEqual(
      { date: '2026-06-02', byUserId: 'u', at: 5 }
    );
  });

  it('january-1 counts from Jan 1 as plugin data', () => {
    expect(resolveBiofix(jan1, 2026, null)).toMatchObject({
      ymd: '2026-01-01',
      provenance: 'plugin'
    });
  });

  it('calendar-date uses the model date as fallback and ignores a stored catch', () => {
    const stored = { date: '2026-04-01', byUserId: 'u', at: 1 };
    expect(resolveBiofix(calendar, 2026, stored)).toMatchObject({
      ymd: '2026-03-01',
      provenance: 'fallback'
    });
  });

  it('trap catch wins as manual, else the fallback date, else no count', () => {
    const stored = { date: '2026-06-10', byUserId: 'helper-1', at: 1 };
    expect(resolveBiofix(trapWithFallback, 2026, stored)).toMatchObject({
      ymd: '2026-06-10',
      provenance: 'manual',
      recordedBy: 'helper-1'
    });
    expect(resolveBiofix(trapWithFallback, 2026, null)).toMatchObject({
      ymd: '2026-05-15',
      provenance: 'fallback'
    });
    expect(resolveBiofix(trap, 2026, null)).toMatchObject({ ymd: null, provenance: null });
  });

  it('a catch from another year is ignored', () => {
    const stored = { date: '2025-06-10', byUserId: null, at: 1 };
    expect(resolveBiofix(trap, 2026, stored).ymd).toBeNull();
  });

  it('only trap-catch models take a manual biofix', () => {
    expect(acceptsManualBiofix(trap)).toBe(true);
    expect(acceptsManualBiofix(calendar)).toBe(false);
    expect(acceptsManualBiofix(jan1)).toBe(false);
  });
});

describe('modelStatus', () => {
  const today = '2026-07-02';

  it('asks for traps when there is no biofix', () => {
    const s = modelStatus(trap, null, bf(null, null), today);
    expect(s.state).toBe('no-biofix');
    expect(showOnScout(s)).toBe(true);
    expect(showOnToday(s)).toBe(false);
    expect(watchForLines(s, bf(null, null))).toEqual([
      'Set traps. Record your first catch to start the count.'
    ]);
  });

  it('waits for a future biofix', () => {
    const s = modelStatus(trap, null, bf('2026-08-01', 'fallback'), today);
    expect(s.state).toBe('before-biofix');
    expect(watchForLines(s, bf('2026-08-01', 'fallback'))).toEqual(['Counting starts Aug 1.']);
  });

  it('says so when no readings are in yet', () => {
    const s = modelStatus(trap, acc(0, 0, null as never), bf('2026-07-01'), today);
    expect(s.state).toBe('no-data');
    expect(s.reached).toBe('unknown');
  });

  it('before the first stage without gaps is not reached', () => {
    const s = modelStatus(trap, acc(40), bf('2026-06-01'), today);
    expect(s).toMatchObject({ state: 'counting', stage: null, reached: false, inWindow: false });
    expect(s.next).toMatchObject({ remaining: 60, uncertain: false });
    expect(showOnScout(s)).toBe(true);
    expect(showOnToday(s)).toBe(false);
  });

  it('far from the first stage stays off the strip until 100 degree days out', () => {
    const late = pestModelPluginSchema.parse({
      ...E2E_TRAP_MODEL,
      stages: [{ ...E2E_TRAP_MODEL.stages[0], gddFrom: 300, gddTo: 500 }]
    });
    expect(showOnScout(modelStatus(late, acc(199), bf('2026-06-01'), today))).toBe(false);
    expect(showOnScout(modelStatus(late, acc(200), bf('2026-06-01'), today))).toBe(true);
  });

  it('with gaps and short of the first stage it cannot tell yet', () => {
    const s = modelStatus(trap, acc(80, 3), bf('2026-06-01'), today);
    expect(s.reached).toBe('unknown');
    const lines = watchForLines(s, bf('2026-06-01'));
    expect(lines[0]).toBe('At least 80 degree days since Jun 1, 3 days missing, through Jul 1.');
    expect(lines[1]).toBe("Eggs on stems: can't tell yet, 3 days missing.");
  });

  it('a lower bound past the stage start counts as reached even with gaps', () => {
    const s = modelStatus(trap, acc(150, 2), bf('2026-06-01'), today);
    expect(s).toMatchObject({ reached: true, inWindow: true });
    expect(s.stage?.key).toBe('eggs');
    expect(showOnToday(s)).toBe(true);
  });

  it('an open-ended last stage stays in window', () => {
    const s = modelStatus(trap, acc(900), bf('2026-06-01'), today);
    expect(s.stage?.key).toBe('larvae');
    expect(s.inWindow).toBe(true);
    expect(s.next).toBeNull();
  });

  it('a closed window that has passed says so', () => {
    const closed = pestModelPluginSchema.parse({
      ...E2E_TRAP_MODEL,
      stages: [E2E_TRAP_MODEL.stages[0]]
    });
    const s = modelStatus(closed, acc(500), bf('2026-06-01'), today);
    expect(s.inWindow).toBe(false);
    expect(watchForLines(s, bf('2026-06-01')).at(-1)).toBe(
      'Eggs on stems window has passed for this year.'
    );
  });

  it('the stage is the latest one started, and reached never goes back as the total grows', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (a, d) => {
          const s1 = modelStatus(trap, acc(a), bf('2026-06-01'), today);
          const s2 = modelStatus(trap, acc(a + d), bf('2026-06-01'), today);
          const rank = (k: string | undefined) => (k === undefined ? -1 : k === 'eggs' ? 0 : 1);
          expect(rank(s2.stage?.key)).toBeGreaterThanOrEqual(rank(s1.stage?.key));
          if (s1.reached === true) expect(s2.reached).toBe(true);
        }
      )
    );
  });
});

describe('copy', () => {
  it('never uses spray words, whatever the state', () => {
    const states: Array<[Accumulation | null, ResolvedBiofix]> = [
      [null, bf(null, null)],
      [null, bf('2026-08-01', 'fallback')],
      [acc(0, 0, null as never), bf('2026-06-01')],
      [acc(20), bf('2026-06-01')],
      [acc(80, 3), bf('2026-06-01')],
      [acc(150, 1), bf('2026-06-01')],
      [acc(900), bf('2026-06-01')]
    ];
    for (const [a, b] of states) {
      const s = modelStatus(trap, a, b, '2026-07-02');
      for (const line of watchForLines(s, b)) expect(line).not.toMatch(SPRAY_WORDS);
      expect(line2(totalLine(s, b))).not.toMatch(SPRAY_WORDS);
    }
  });

  it('formats days and pluralises', () => {
    expect(shortDay('2026-09-27')).toBe('Sep 27');
    const s = modelStatus(trap, acc(1, 1), bf('2026-06-01'), '2026-07-02');
    expect(totalLine(s, bf('2026-06-01'))).toBe(
      'At least 1 degree day since Jun 1, 1 day missing, through Jul 1.'
    );
  });
});

describe('modelApplies', () => {
  it('needs a planted host family', () => {
    expect(modelApplies(trap, new Set(['cucurbit']))).toBe(true);
    expect(modelApplies(trap, new Set(['brassica']))).toBe(false);
  });
});

function line2(s: string | null): string {
  return s ?? '';
}
