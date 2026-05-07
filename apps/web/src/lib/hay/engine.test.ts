import { describe, expect, it } from 'vitest';
import {
  canAdvance,
  evaluateBaleDecision,
  evaluateMowDecision,
  isTerminal,
  nextStep,
  statusAfter
} from './engine';
import type { ForecastDay, HayOperationsSpec } from './types';

const alfalfaSpec: HayOperationsSpec = {
  steps: ['mow', 'ted', 'rake', 'bale', 'store'],
  weatherWindowDays: 3,
  baleMoistureGate: {
    'small-square': {
      warnAbovePct: 18,
      dangerAbovePct: 22,
      warnBelowPct: 14,
      dangerBelowPct: 12,
      optimumPercent: { min: 14, max: 18 }
    },
    'large-round': {
      warnAbovePct: 16,
      dangerAbovePct: 20
    }
  }
};

function dryDays(n: number): ForecastDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-06-0${i + 1}`,
    popPct: 5,
    highF: 78,
    lowF: 60
  }));
}

describe('evaluateMowDecision', () => {
  it('passes a clean 3-day dry forecast', () => {
    const d = evaluateMowDecision({ spec: alfalfaSpec, forecast: dryDays(3) });
    expect(d.ok).toBe(true);
  });

  it('rejects when day-2 forecast shows >30% rain', () => {
    const f = dryDays(3);
    f[1] = { ...f[1], popPct: 60 };
    const d = evaluateMowDecision({ spec: alfalfaSpec, forecast: f });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.violations[0].code).toBe('WEATHER_RAIN_RISK');
      expect(d.violations[0].detail?.wetDays).toBeDefined();
    }
  });

  it('rejects when forecast is shorter than weatherWindowDays', () => {
    const d = evaluateMowDecision({ spec: alfalfaSpec, forecast: dryDays(2) });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.violations[0].code).toBe('WEATHER_INSUFFICIENT_FORECAST');
    }
  });

  it('soft-warns on multiple cool nights even when dry', () => {
    const f = dryDays(3).map((d) => ({ ...d, lowF: 45 }));
    const d = evaluateMowDecision({ spec: alfalfaSpec, forecast: f });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.warnings.length).toBeGreaterThan(0);
      expect(d.warnings[0].severity).toBe('warn');
    }
  });

  it('honors a custom rainRiskPct (e.g., bumped to 40 for tighter regions)', () => {
    const f = dryDays(3);
    f[1] = { ...f[1], popPct: 35 };
    const strict = evaluateMowDecision({ spec: alfalfaSpec, forecast: f, rainRiskPct: 30 });
    const lax = evaluateMowDecision({ spec: alfalfaSpec, forecast: f, rainRiskPct: 40 });
    expect(strict.ok).toBe(false);
    expect(lax.ok).toBe(true);
  });
});

describe('evaluateBaleDecision', () => {
  it('passes mid-band moisture for the chosen bale type', () => {
    const d = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'small-square',
      moisturePct: 16
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.warnings).toEqual([]);
  });

  it('blocks moisture above the danger threshold (fire risk)', () => {
    const d = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'small-square',
      moisturePct: 24
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.violations[0].code).toBe('MOISTURE_TOO_HIGH');
  });

  it('soft-warns moisture in the warn band (over warn, under danger)', () => {
    const d = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'small-square',
      moisturePct: 20
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.warnings).toHaveLength(1);
      expect(d.warnings[0].code).toBe('MOISTURE_TOO_HIGH');
      expect(d.warnings[0].severity).toBe('warn');
    }
  });

  it('blocks moisture below the danger-low threshold (leaf shatter)', () => {
    const d = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'small-square',
      moisturePct: 10
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.violations[0].code).toBe('MOISTURE_TOO_LOW');
  });

  it('refuses when moisture reading is missing', () => {
    const d = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'small-square',
      moisturePct: null
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.violations[0].code).toBe('MOISTURE_MISSING');
  });

  it('soft-warns when the bale type has no plugin gate', () => {
    const d = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'large-square',
      moisturePct: 17
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.warnings[0].code).toBe('BALE_TYPE_NOT_GATED');
  });
});

describe('state-machine helpers', () => {
  const steps = alfalfaSpec.steps;

  it('nextStep walks through the declared steps[]', () => {
    expect(nextStep(steps, 'mowing')).toBe('ted');
    expect(nextStep(steps, 'tedding')).toBe('rake');
    expect(nextStep(steps, 'raking')).toBe('bale');
    expect(nextStep(steps, 'baling')).toBe('store');
    expect(nextStep(steps, 'complete')).toBeNull();
    expect(nextStep(steps, 'aborted')).toBeNull();
  });

  it('skips steps the plugin omits (e.g., no ted step)', () => {
    const noTed: typeof steps = ['mow', 'rake', 'bale', 'store'];
    expect(nextStep(noTed, 'mowing')).toBe('rake');
  });

  it('canAdvance only allows the next declared step', () => {
    expect(canAdvance(steps, 'mowing', 'ted')).toBe(true);
    expect(canAdvance(steps, 'mowing', 'bale')).toBe(false);
  });

  it('statusAfter maps each step to its status, store → complete', () => {
    expect(statusAfter('mow')).toBe('mowing');
    expect(statusAfter('ted')).toBe('tedding');
    expect(statusAfter('store')).toBe('complete');
  });

  it('isTerminal recognizes complete + aborted', () => {
    expect(isTerminal('complete')).toBe(true);
    expect(isTerminal('aborted')).toBe(true);
    expect(isTerminal('mowing')).toBe(false);
  });
});
