/**
 * Sprint E integration: alfalfa multi-step cutting flow against the actual
 * alfalfa-vernema plugin in plugins/crops/. Exercises the engine + repo
 * working together (no HTTP layer; this isolates the kernel + persistence).
 */

import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory, PluginRegistry } from '$lib/plugins';
import {
  evaluateBaleDecision,
  evaluateMowDecision,
  nextStep,
  type ForecastDay,
  type HayOperationsSpec,
  type HayStep
} from '$lib/hay';

const PLUGINS_DIR = path.resolve(__dirname, '../../../../plugins');

describe('Alfalfa multi-step cutting — engine path', () => {
  let registry: PluginRegistry;
  let alfalfaSpec: HayOperationsSpec;

  beforeAll(async () => {
    registry = new PluginRegistry();
    await loadPluginsFromDirectory(registry, PLUGINS_DIR);
    const alfalfa = registry.get('alfalfa-vernema')?.plugin;
    expect(alfalfa?.type).toBe('crop');
    if (alfalfa?.type === 'crop' && alfalfa.hayOperations) {
      alfalfaSpec = {
        steps: [...alfalfa.hayOperations.steps],
        weatherWindowDays: alfalfa.hayOperations.weatherWindowDays,
        cuttingsPerSeason: alfalfa.hayOperations.cuttingsPerSeason,
        cutIntervalDays: alfalfa.hayOperations.cutIntervalDays,
        mowTrigger: alfalfa.hayOperations.mowTrigger,
        baleMoistureGate: alfalfa.hayOperations.baleMoistureGate,
        storageTempWatchF: alfalfa.hayOperations.storageTempWatchF
      };
    }
  });

  it('exposes the alfalfa hayOperations spec from the loaded plugin', () => {
    expect(alfalfaSpec).toBeDefined();
    expect(alfalfaSpec.steps).toEqual(['mow', 'ted', 'rake', 'bale', 'store']);
    expect(alfalfaSpec.weatherWindowDays).toBe(3);
  });

  it('mow decision passes a clean 3-day forecast', () => {
    const forecast: ForecastDay[] = [
      { date: '2026-06-01', popPct: 5, highF: 78, lowF: 60 },
      { date: '2026-06-02', popPct: 10, highF: 80, lowF: 62 },
      { date: '2026-06-03', popPct: 5, highF: 82, lowF: 64 }
    ];
    const d = evaluateMowDecision({ spec: alfalfaSpec, forecast });
    expect(d.ok).toBe(true);
  });

  it('mow decision rejects a wet day in the window', () => {
    const forecast: ForecastDay[] = [
      { date: '2026-06-01', popPct: 5, highF: 78, lowF: 60 },
      { date: '2026-06-02', popPct: 70, highF: 75, lowF: 60 },
      { date: '2026-06-03', popPct: 5, highF: 80, lowF: 62 }
    ];
    const d = evaluateMowDecision({ spec: alfalfaSpec, forecast });
    expect(d.ok).toBe(false);
  });

  it('walks the full state machine: mowing → tedding → raking → baling → complete', () => {
    let status: 'mowing' | 'tedding' | 'raking' | 'baling' | 'complete' = 'mowing';
    expect(nextStep(alfalfaSpec.steps as HayStep[], status)).toBe('ted');
    status = 'tedding';
    expect(nextStep(alfalfaSpec.steps as HayStep[], status)).toBe('rake');
    status = 'raking';
    expect(nextStep(alfalfaSpec.steps as HayStep[], status)).toBe('bale');
    status = 'baling';
    expect(nextStep(alfalfaSpec.steps as HayStep[], status)).toBe('store');
    status = 'complete';
    expect(nextStep(alfalfaSpec.steps as HayStep[], status)).toBeNull();
  });

  it('bale gate uses the small-square thresholds when that bale type is selected', () => {
    const ok = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'small-square',
      moisturePct: 16
    });
    expect(ok.ok).toBe(true);

    const tooWet = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'small-square',
      moisturePct: 23
    });
    expect(tooWet.ok).toBe(false);

    // The shipped alfalfa-vernema plugin doesn't declare warnBelow / dangerBelow
    // for small-square (just optimumPercent.min = 14). Verify a low reading
    // returns ok=true with no warnings — adding low-band gates is plugin-author work.
    const lowOk = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'small-square',
      moisturePct: 11
    });
    expect(lowOk.ok).toBe(true);
  });

  it('bale gate uses the round-bale thresholds when that bale type is selected (different limits)', () => {
    const ok = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'large-round',
      moisturePct: 14
    });
    expect(ok.ok).toBe(true);

    // 17% is fine on small-square but exceeds large-round's warn threshold.
    const warnRound = evaluateBaleDecision({
      spec: alfalfaSpec,
      baleType: 'large-round',
      moisturePct: 17
    });
    expect(warnRound.ok).toBe(true);
    if (warnRound.ok) expect(warnRound.warnings.length).toBe(1);
  });
});
