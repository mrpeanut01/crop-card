import { describe, expect, it } from 'vitest';
import type { SoilTest } from '$lib/db/fertility';
import { nCreditFromSoilTestLbPerAcre } from '$lib/plan/inputsPlan';
import { buildSoilTestBody, sampledOnToMs, type SoilTestFormValues } from './soilTestForm';

const NOW = Date.UTC(2026, 8, 27, 12);

function values(over: Partial<SoilTestFormValues> = {}): SoilTestFormValues {
  return {
    blockId: 'b1',
    sampledOn: '2026-04-02',
    lab: '  Virginia Tech  ',
    extractionMethod: 'mehlich-1',
    unitsBasis: 'lb-per-acre',
    ph: 5.9,
    bufferPh: null,
    organicMatterPct: 2.4,
    nitrate: null,
    nutrients: { p: 30, k: 150, ca: null, mg: 110 },
    ratings: { p: 'medium', k: '', ca: '', mg: 'high' },
    ...over
  };
}

describe('buildSoilTestBody', () => {
  it('keeps what was typed, trims the lab and drops blanks', () => {
    const out = buildSoilTestBody(values(), NOW);
    expect(out).toEqual({
      ok: true,
      body: {
        blockId: 'b1',
        sampledAt: sampledOnToMs('2026-04-02'),
        unitsBasis: 'lb-per-acre',
        lab: 'Virginia Tech',
        extractionMethod: 'mehlich-1',
        ph: 5.9,
        organicMatterPct: 2.4,
        phosphorusPpm: 30,
        potassiumPpm: 150,
        mgPpm: 110,
        labRatings: { p: 'medium', mg: 'high' }
      }
    });
  });

  it('carries nitrate through to the Inputs Plan N credit', () => {
    const ppm = buildSoilTestBody(values({ unitsBasis: 'ppm', nitrate: 20 }), NOW);
    expect(ppm).toMatchObject({ ok: true, body: { nitratePpm: 20 } });
    if (!ppm.ok) return;
    const credit = nCreditFromSoilTestLbPerAcre(ppm.body as unknown as SoilTest);
    expect(credit).toBe((20 - 8) * 4);

    const lb = buildSoilTestBody(values({ nitrate: 40 }), NOW);
    if (!lb.ok) throw new Error('expected ok');
    expect(nCreditFromSoilTestLbPerAcre(lb.body as unknown as SoilTest)).toBe((20 - 8) * 4);

    const onlyNitrate = buildSoilTestBody(
      values({
        ph: null,
        organicMatterPct: null,
        nitrate: 12,
        nutrients: { p: null, k: null, ca: null, mg: null }
      }),
      NOW
    );
    expect(onlyNitrate.ok).toBe(true);
  });

  it('asks for a place, a date and at least one reading', () => {
    expect(buildSoilTestBody(values({ blockId: '' }), NOW).ok).toBe(false);
    expect(buildSoilTestBody(values({ sampledOn: '' }), NOW).ok).toBe(false);
    expect(buildSoilTestBody(values({ sampledOn: '2027-05-01' }), NOW).ok).toBe(false);
    const empty = buildSoilTestBody(
      values({
        ph: null,
        organicMatterPct: null,
        nutrients: { p: null, k: null, ca: null, mg: null }
      }),
      NOW
    );
    expect(empty).toEqual({
      ok: false,
      error: 'Enter at least one number from the report, such as pH.'
    });
  });

  it('refuses an impossible pH or a negative nutrient in plain words', () => {
    expect(buildSoilTestBody(values({ ph: 15 }), NOW)).toEqual({
      ok: false,
      error: 'pH is a number between 0 and 14.'
    });
    expect(
      buildSoilTestBody(values({ nutrients: { p: -1, k: null, ca: null, mg: null } }), NOW)
    ).toMatchObject({ ok: false });
  });

  it('parses the date input to local noon', () => {
    const ms = sampledOnToMs('2026-04-02')!;
    const d = new Date(ms);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 3, 2, 12]);
    expect(sampledOnToMs('04/02/2026')).toBeNull();
  });
});
