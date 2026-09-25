import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HOUR_MS, type HourlyPoint } from '$lib/weather/leafWet';
import {
  assessFhbRisk,
  assessVernalization,
  buildZadoksTimeline,
  climatologyVernalizingFraction,
  currentStageIndex,
  dailyScabFavorableHours,
  DAY_MS,
  dateAtZadoks,
  fhbLevel,
  FHB_WINDOW_HOURS,
  inferGrowthHabit,
  isScabFavorableHour,
  springYearFor,
  stageForDaysFromPlanting,
  zadoksNumber,
  type SmallGrainPluginInput
} from './smallGrain';

const SRW: SmallGrainPluginInput = {
  pluginId: 'wheat-soft-red-winter',
  displayName: 'Wheat — Soft Red Winter',
  daysToMaturity: { min: 240, max: 270 },
  growthStageTable: {
    system: 'zadoks',
    referenceDtmDays: 240,
    stages: [
      {
        code: 'Z10',
        name: 'Coleoptile',
        daysFromPlanting: { min: 5, max: 14 },
        bodyKind: 'vegetative'
      },
      {
        code: 'Z20',
        name: 'Tillering',
        daysFromPlanting: { min: 30, max: 60 },
        bodyKind: 'vegetative'
      },
      {
        code: 'Z65',
        name: 'Anthesis',
        daysFromPlanting: { min: 160, max: 190 },
        bodyKind: 'reproductive'
      }
    ],
    harvestTargets: []
  }
};
const HRW_NO_TABLE: SmallGrainPluginInput = {
  pluginId: 'wheat-hard-white-winter',
  displayName: 'Wheat — Hard White Winter',
  daysToMaturity: { min: 240, max: 280 }
};
const SPRING: SmallGrainPluginInput = {
  pluginId: 'wheat-hard-red-spring',
  displayName: 'Wheat — Hard Red Spring',
  daysToMaturity: { min: 95, max: 110 }
};

const OCT8 = Date.UTC(2025, 9, 8, 12);

function pt(t: number, over: Partial<HourlyPoint> = {}): HourlyPoint {
  return {
    t,
    tempF: 65,
    dewpointF: 50,
    rhPct: 60,
    popPct: 5,
    precipMm: 0,
    windMph: 5,
    ...over
  };
}

describe('zadoksNumber / stageForDaysFromPlanting', () => {
  it('parses codes', () => {
    expect(zadoksNumber('Z65')).toBe(65);
    expect(zadoksNumber('Z30-Z89')).toBe(30);
    expect(zadoksNumber('z9')).toBe(9);
    expect(zadoksNumber('V6')).toBeNull();
  });
  it('finds the band containing a day count', () => {
    const s = [
      { stage: 'Z10', daysFromPlanting: { min: 5, max: 14 } },
      { stage: 'Z20', daysFromPlanting: { min: 30, max: 60 } }
    ];
    expect(stageForDaysFromPlanting(s, 40)?.stage).toBe('Z20');
    expect(stageForDaysFromPlanting(s, 20)).toBeNull();
  });
});

describe('inferGrowthHabit', () => {
  it.each([
    [SRW, 'winter'],
    [HRW_NO_TABLE, 'winter'],
    [SPRING, 'spring'],
    [
      { pluginId: 'emmer-vernal', displayName: 'Emmer', daysToMaturity: { min: 100, max: 130 } },
      'spring'
    ],
    [
      {
        pluginId: 'rye-grain-aroostook',
        displayName: 'Rye',
        daysToMaturity: { min: 240, max: 290 }
      },
      'winter'
    ],
    [
      { pluginId: 'oats-grain-jerry', displayName: 'Oats', daysToMaturity: { min: 90, max: 110 } },
      'spring'
    ]
  ] as const)('%o → %s', (p, habit) => {
    expect(inferGrowthHabit(p)).toBe(habit);
  });
});

describe('buildZadoksTimeline', () => {
  it('winter habit: plugin fall stages + typical spring calendar anchors', () => {
    const tl = buildZadoksTimeline(SRW, OCT8);
    expect(tl.find((s) => s.code === 'Z10')?.provenance).toBe('plugin');
    const z61 = tl.find((s) => s.code === 'Z61')!;
    expect(z61.provenance).toBe('fallback');
    expect(new Date(z61.startMs).toISOString().slice(0, 10)).toBe('2026-05-12');
    expect(tl.some((s) => s.code === 'Z65' && s.provenance === 'plugin')).toBe(false);
    expect(tl[tl.length - 1].code).toBe('Z92');
    expect(tl[tl.length - 1].decision).toBe('harvest');
    expect(tl.find((s) => s.decision === 'fhb-window')?.code).toBe('Z61');
    expect(tl.find((s) => s.decision === 'herbicide-cutoff')?.code).toBe('Z30');
    expect(tl.find((s) => s.decision === 'flag-leaf')?.code).toBe('Z39');
    expect(tl.find((s) => s.decision === 'heading')?.code).toBe('Z55');
  });

  it('winter habit without a plugin table is all typical', () => {
    const tl = buildZadoksTimeline(HRW_NO_TABLE, OCT8);
    expect(tl.every((s) => s.provenance === 'fallback')).toBe(true);
    expect(tl[0].code).toBe('Z00');
  });

  it('spring habit scales typical offsets by DTM', () => {
    const plant = Date.UTC(2026, 2, 20, 12);
    const tl = buildZadoksTimeline(SPRING, plant);
    const z92 = tl.find((s) => s.code === 'Z92')!;
    expect(Math.round((z92.startMs - plant) / DAY_MS)).toBe(103);
  });

  it('spring-sown winter crop still yields a strictly increasing timeline', () => {
    const tl = buildZadoksTimeline(HRW_NO_TABLE, Date.UTC(2026, 3, 1, 12));
    for (let i = 1; i < tl.length; i++) expect(tl[i].startMs).toBeGreaterThan(tl[i - 1].startMs);
  });

  it('springYearFor rolls fall sowings into the next year', () => {
    expect(springYearFor(OCT8)).toBe(2026);
    expect(springYearFor(Date.UTC(2026, 1, 1))).toBe(2026);
  });

  it('property: dates strictly increase with Zadoks number for any sowing date + plugin', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
        fc.constantFrom(SRW, HRW_NO_TABLE, SPRING),
        (plant, plugin) => {
          const tl = buildZadoksTimeline(plugin, plant);
          for (let i = 1; i < tl.length; i++) {
            if (tl[i].zadoks <= tl[i - 1].zadoks) return false;
            if (tl[i].startMs <= tl[i - 1].startMs) return false;
          }
          return true;
        }
      )
    );
  });

  it('property: current stage is monotonic in date', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
        fc.constantFrom(SRW, HRW_NO_TABLE, SPRING),
        fc.integer({ min: -30, max: 400 }),
        fc.integer({ min: 0, max: 200 }),
        (plant, plugin, d1, dd) => {
          const tl = buildZadoksTimeline(plugin, plant);
          const a = currentStageIndex(tl, plant + d1 * DAY_MS);
          const b = currentStageIndex(tl, plant + (d1 + dd) * DAY_MS);
          return b >= a;
        }
      )
    );
  });

  it('currentStageIndex is -1 before sowing', () => {
    const tl = buildZadoksTimeline(SRW, OCT8);
    expect(currentStageIndex(tl, OCT8 - DAY_MS)).toBe(-1);
  });

  it('dateAtZadoks interpolates between stages', () => {
    const tl = buildZadoksTimeline(HRW_NO_TABLE, OCT8);
    const z55 = tl.find((s) => s.code === 'Z55')!.startMs;
    const z61 = tl.find((s) => s.code === 'Z61')!.startMs;
    const z58 = dateAtZadoks(tl, 58)!;
    expect(z58).toBeGreaterThan(z55);
    expect(z58).toBeLessThan(z61);
    expect(dateAtZadoks(tl, 61)).toBe(z61);
    expect(dateAtZadoks(tl, 99)).toBeNull();
    expect(dateAtZadoks([], 61)).toBeNull();
  });
});

describe('FHB proxy', () => {
  const anthesis = Date.UTC(2026, 4, 12, 12);
  const winStart = anthesis - FHB_WINDOW_HOURS * HOUR_MS;
  const windowHours = (fn: (i: number) => Partial<HourlyPoint>) =>
    Array.from({ length: FHB_WINDOW_HOURS }, (_, i) => pt(winStart + i * HOUR_MS, fn(i)));

  it('favorable hour needs wet + 59–86 °F', () => {
    expect(isScabFavorableHour(pt(0, { rhPct: 95, tempF: 70 }))).toBe(true);
    expect(isScabFavorableHour(pt(0, { rhPct: 95, tempF: 50 }))).toBe(false);
    expect(isScabFavorableHour(pt(0, { rhPct: 95, tempF: 90 }))).toBe(false);
    expect(isScabFavorableHour(pt(0, { rhPct: 60, precipMm: 1, tempF: 70 }))).toBe(true);
    expect(isScabFavorableHour(pt(0, { rhPct: 60, tempF: 70 }))).toBe(false);
    expect(isScabFavorableHour(pt(0, { rhPct: 95, tempF: null }))).toBe(false);
  });

  it('levels', () => {
    expect(fhbLevel(0)).toBe('low');
    expect(fhbLevel(24)).toBe('moderate');
    expect(fhbLevel(48)).toBe('high');
  });

  it('no anthesis → no-anthesis', () => {
    expect(
      assessFhbRisk({ anthesisMs: null, hours: [], provenance: 'data', nowMs: anthesis }).status
    ).toBe('no-anthesis');
  });

  it('fallback weather → no-data', () => {
    const r = assessFhbRisk({
      anthesisMs: anthesis,
      hours: windowHours(() => ({ rhPct: 99 })),
      provenance: 'fallback',
      nowMs: winStart
    });
    expect(r.status).toBe('no-data');
    expect(r.level).toBeNull();
  });

  it('window beyond the forecast → too-early', () => {
    const r = assessFhbRisk({
      anthesisMs: anthesis,
      hours: [pt(winStart - 30 * DAY_MS)],
      provenance: 'data',
      nowMs: winStart - 30 * DAY_MS
    });
    expect(r.status).toBe('too-early');
  });

  it('well after anthesis → past', () => {
    const r = assessFhbRisk({
      anthesisMs: anthesis,
      hours: windowHours(() => ({})),
      provenance: 'data',
      nowMs: anthesis + 10 * DAY_MS
    });
    expect(r.status).toBe('past');
  });

  it('thin overlap → insufficient-data', () => {
    const r = assessFhbRisk({
      anthesisMs: anthesis,
      hours: windowHours(() => ({})).slice(0, 10),
      provenance: 'data',
      nowMs: winStart
    });
    expect(r.status).toBe('insufficient-data');
  });

  it('scales to a full window and assigns a level', () => {
    const wet = assessFhbRisk({
      anthesisMs: anthesis,
      hours: windowHours((i) => (i % 2 === 0 ? { rhPct: 95 } : {})),
      provenance: 'data',
      nowMs: winStart
    });
    expect(wet.status).toBe('assessed');
    expect(wet.index).toBe(84);
    expect(wet.level).toBe('high');
    const half = assessFhbRisk({
      anthesisMs: anthesis,
      hours: windowHours((i) => (i % 2 === 0 ? { rhPct: 95 } : {})).slice(0, 48),
      provenance: 'data',
      nowMs: winStart
    });
    expect(half.coveredHours).toBe(48);
    expect(half.index).toBe(84);
    const dry = assessFhbRisk({
      anthesisMs: anthesis,
      hours: windowHours(() => ({})),
      provenance: 'data',
      nowMs: winStart
    });
    expect(dry.level).toBe('low');
    expect(dry.meanTempF).toBe(65);
  });

  it('property: risk index is non-decreasing as hours turn wet at fixed temperature', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: FHB_WINDOW_HOURS, maxLength: FHB_WINDOW_HOURS }),
        fc.integer({ min: 0, max: FHB_WINDOW_HOURS - 1 }),
        fc.integer({ min: 40, max: 95 }),
        (wetFlags, flip, tempF) => {
          const mk = (flags: boolean[]) =>
            flags.map((w, i) => pt(winStart + i * HOUR_MS, { tempF, rhPct: w ? 95 : 60 }));
          const before = assessFhbRisk({
            anthesisMs: anthesis,
            hours: mk(wetFlags),
            provenance: 'data',
            nowMs: winStart
          });
          const more = wetFlags.slice();
          more[flip] = true;
          const after = assessFhbRisk({
            anthesisMs: anthesis,
            hours: mk(more),
            provenance: 'data',
            nowMs: winStart
          });
          return after.index >= before.index;
        }
      )
    );
  });

  it('daily favorable-hour buckets', () => {
    const days = dailyScabFavorableHours(windowHours((i) => (i < 24 ? { rhPct: 95 } : {})));
    expect(days.reduce((a, d) => a + d.favorableHours, 0)).toBe(24);
    expect(days.reduce((a, d) => a + d.coveredHours, 0)).toBe(FHB_WINDOW_HOURS);
  });
});

describe('vernalization', () => {
  it('spring habit → not required', () => {
    const v = assessVernalization({
      habit: 'spring',
      plantMs: OCT8,
      nowMs: OCT8 + 100 * DAY_MS,
      hours: [],
      provenance: 'fallback'
    });
    expect(v.required).toBe(false);
    expect(v.status).toBe('not-required');
  });

  it('not planted yet', () => {
    const v = assessVernalization({
      habit: 'winter',
      plantMs: OCT8,
      nowMs: OCT8 - DAY_MS,
      hours: [],
      provenance: 'fallback'
    });
    expect(v.status).toBe('not-planted');
    expect(v.progress).toBe(0);
  });

  it('climatology completes a mid-October Loudoun sowing by spring', () => {
    const v = assessVernalization({
      habit: 'winter',
      plantMs: OCT8,
      nowMs: Date.UTC(2026, 2, 15),
      hours: [],
      provenance: 'fallback'
    });
    expect(v.status).toBe('complete');
    expect(v.progress).toBe(1);
    expect(v.provenance).toBe('fallback');
    expect(v.dataDays).toBe(0);
  });

  it('stops accumulating after the May 1 season end', () => {
    const at = (nowMs: number) =>
      assessVernalization({
        habit: 'winter',
        plantMs: OCT8,
        nowMs,
        hours: [],
        provenance: 'fallback'
      }).accumulatedDays;
    expect(at(Date.UTC(2026, 8, 25))).toBe(at(Date.UTC(2026, 4, 2)));
  });

  it('early winter is in progress', () => {
    const v = assessVernalization({
      habit: 'winter',
      plantMs: OCT8,
      nowMs: Date.UTC(2025, 10, 10),
      hours: [],
      provenance: 'fallback'
    });
    expect(v.status).toBe('in-progress');
    expect(v.progress).toBeGreaterThan(0);
    expect(v.progress).toBeLessThan(1);
  });

  it('feed hours replace climatology and forecast hours project ahead', () => {
    const now = Date.UTC(2025, 11, 1, 0);
    const hours = Array.from({ length: 96 }, (_, i) =>
      pt(now - 48 * HOUR_MS + i * HOUR_MS, { tempF: 40 })
    );
    const v = assessVernalization({
      habit: 'winter',
      plantMs: OCT8,
      nowMs: now,
      hours,
      provenance: 'data'
    });
    expect(v.dataDays).toBe(2);
    expect(v.projectedDays).toBeCloseTo(v.accumulatedDays + 2, 1);
  });

  it('spring sowing of a winter crop is flagged at risk', () => {
    const plant = Date.UTC(2026, 2, 20);
    const v = assessVernalization({
      habit: 'winter',
      plantMs: plant,
      nowMs: plant + 20 * DAY_MS,
      hours: [],
      provenance: 'fallback'
    });
    expect(v.springPlanted).toBe(true);
    expect(v.status).toBe('at-risk');
  });

  it('climatology fraction is a bounded, peaked function', () => {
    expect(climatologyVernalizingFraction(41)).toBe(1);
    expect(climatologyVernalizingFraction(80)).toBe(0);
    expect(climatologyVernalizingFraction(0)).toBe(0);
    expect(climatologyVernalizingFraction(55)).toBeGreaterThan(0);
    expect(climatologyVernalizingFraction(55)).toBeLessThan(1);
  });

  it('property: progress in [0,1] and non-decreasing in now', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
        fc.integer({ min: -10, max: 300 }),
        fc.integer({ min: 0, max: 120 }),
        fc.array(fc.integer({ min: 0, max: 70 }), { minLength: 0, maxLength: 72 }),
        (plant, d1, dd, temps) => {
          const t1 = plant + d1 * DAY_MS;
          const t2 = t1 + dd * DAY_MS;
          const hours = temps.map((tempF, i) => pt(t1 + i * HOUR_MS, { tempF }));
          const a = assessVernalization({
            habit: 'winter',
            plantMs: plant,
            nowMs: t1,
            hours,
            provenance: 'data'
          });
          const b = assessVernalization({
            habit: 'winter',
            plantMs: plant,
            nowMs: t2,
            hours,
            provenance: 'data'
          });
          const inRange = (x: number) => x >= 0 && x <= 1;
          return (
            inRange(a.progress) &&
            inRange(b.progress) &&
            inRange(a.projectedProgress) &&
            b.progress >= a.progress &&
            b.accumulatedDays >= a.accumulatedDays
          );
        }
      ),
      { numRuns: 60 }
    );
  });
});
