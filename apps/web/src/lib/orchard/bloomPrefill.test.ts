import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { orchardCalendarPluginSchema } from '$lib/plugins/schemas';
import {
  BLOOM_PREFILL_STAGE_IDS,
  bloomPrefillFromMarks,
  parseStageMarks,
  prefillBloomStatus
} from './calendar';

// OC-3, tested as a safety boundary: a stage mark may only pre-fill the
// insecticide form's bloom answer as `in-bloom`. No calendar input, valid
// or not, may ever produce `not-in-bloom`.

const mark = (stageId: string, markedAt = 1_780_000_000_000) => ({
  stageId,
  markedAt,
  markedBy: 'u1'
});

describe('bloomPrefillFromMarks (OC-3)', () => {
  it('a pink, white bud or bloom mark starts the answer at in bloom', () => {
    for (const id of ['pink', 'white-bud', 'bloom']) {
      expect(bloomPrefillFromMarks({ cal: mark(id) })).toMatchObject({
        status: 'in-bloom',
        stageId: id,
        calendarId: 'cal'
      });
    }
  });

  it('any other stage, petal fall included, prefills nothing', () => {
    for (const id of ['dormant', 'tight-cluster', 'petal-fall', 'first-cover', 'shuck-split']) {
      expect(bloomPrefillFromMarks({ cal: mark(id) })).toBeNull();
    }
    expect(bloomPrefillFromMarks(null)).toBeNull();
    expect(bloomPrefillFromMarks('{oops')).toBeNull();
    expect(bloomPrefillFromMarks(JSON.stringify({ cal: mark('bloom') }))?.status).toBe('in-bloom');
  });

  it('takes the newest bloom mark among a block calendars', () => {
    expect(
      bloomPrefillFromMarks({ a: mark('pink', 10), b: mark('bloom', 20), c: mark('dormant', 30) })
    ).toMatchObject({ calendarId: 'b', stageId: 'bloom', markedAt: 20 });
  });

  it('never yields anything but in-bloom or null, for any input at all', () => {
    const stageId = fc.oneof(
      fc.constantFrom('pink', 'bloom', 'white-bud', 'petal-fall', 'not-in-bloom', 'unknown', ''),
      fc.string()
    );
    const markArb = fc.record(
      {
        stageId: fc.oneof(stageId, fc.anything()),
        markedAt: fc.oneof(fc.integer(), fc.double(), fc.anything()),
        markedBy: fc.oneof(fc.string(), fc.anything())
      },
      { requiredKeys: [] }
    );
    const input = fc.oneof(
      fc.anything(),
      fc.dictionary(fc.string(), fc.oneof(markArb, fc.anything())),
      fc.dictionary(fc.string(), markArb).map((d) => JSON.stringify(d))
    );
    fc.assert(
      fc.property(input, fc.boolean(), (raw, blooming) => {
        const out = bloomPrefillFromMarks(raw);
        if (out !== null) {
          expect(out.status).toBe('in-bloom');
          expect(BLOOM_PREFILL_STAGE_IDS.has(out.stageId)).toBe(true);
        }
        const status = prefillBloomStatus({ bloomWindowSaysBlooming: blooming, stageMark: out });
        expect(['in-bloom', 'unknown']).toContain(status);
        expect(status).not.toBe('not-in-bloom');
        if (blooming || out) expect(status).toBe('in-bloom');
      }),
      { numRuns: 2000 }
    );
  });

  it('a forged stage mark object cannot say not-in-bloom', () => {
    const forged = { status: 'not-in-bloom', stageId: 'bloom', calendarId: 'x', markedAt: 1 };
    expect(
      prefillBloomStatus({
        bloomWindowSaysBlooming: false,
        stageMark: forged as unknown as Parameters<typeof prefillBloomStatus>[0]['stageMark']
      })
    ).toBe('unknown');
  });

  it('parseStageMarks drops anything malformed', () => {
    expect(parseStageMarks({ a: { stageId: 'pink' }, b: mark('bloom'), c: 7 })).toEqual({
      b: mark('bloom')
    });
  });
});

describe('the calendar code never sets not-in-bloom (OC-3)', () => {
  const ORCHARD_DIR = __dirname;
  const sources = [
    ...readdirSync(ORCHARD_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => path.join(ORCHARD_DIR, f)),
    path.resolve(__dirname, '../server/orchardCalendar.server.ts'),
    path.resolve(__dirname, '../db/orchardCalendar.ts'),
    path.resolve(__dirname, '../../routes/plan/orchard/[cropId]/+page.svelte'),
    path.resolve(__dirname, '../../routes/plan/orchard/[cropId]/+page.server.ts')
  ];

  it.each(sources)('%s', (file) => {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/not-in-bloom/);
  });

  it('the insecticide form only feeds the calendar into prefillBloomStatus', () => {
    const page = readFileSync(
      path.resolve(__dirname, '../../routes/spray/insecticide/+page.svelte'),
      'utf8'
    );
    expect(page).toMatch(/prefillBloomStatus\(/);
    expect(page.match(/stageBloom/g)?.length).toBeGreaterThan(0);
    for (const line of page.split('\n').filter((l) => /stageBloom/.test(l))) {
      expect(line).not.toMatch(/not-in-bloom/);
    }
  });
});

describe('the prefill stages match the shipped calendars', () => {
  const dir = path.resolve(__dirname, '../../../../../plugins/orchard-calendars');
  const calendars = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) =>
      orchardCalendarPluginSchema.parse(JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
    );

  it('every pink, white bud or bloom stage in a shipped calendar is on the list', () => {
    const missing = calendars.flatMap((c) =>
      c.stages
        .filter(
          (s) => /^(pink|bloom|white-bud)$/.test(s.id) || /^(pink|bloom|white bud)$/i.test(s.name)
        )
        .filter((s) => !BLOOM_PREFILL_STAGE_IDS.has(s.id))
        .map((s) => `${c.pluginId}.${s.id}`)
    );
    expect(missing).toEqual([]);
    expect(calendars.some((c) => c.stages.some((s) => s.id === 'white-bud'))).toBe(true);
  });

  it('petal fall is never a prefill stage', () => {
    expect(BLOOM_PREFILL_STAGE_IDS.has('petal-fall')).toBe(false);
  });
});
