/**
 * #323 — FR-21 / UC-14: bale-gate `danger`-severity moisture violations
 * (>dangerAbovePct fire risk) are NON-overridable. `overrideBaleGate:true`
 * may only clear `warn` severity. This test drives the PATCH handler with
 * the real hay kernel (evaluateBaleDecision) so the danger-branch is
 * exercised end-to-end; only the DB repos + auth + registry are mocked.
 *
 * Mock fns are declared via vi.hoisted() so the vi.mock factories (which
 * hoist above module-level consts) can reference them.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const { getCutting, advanceCutting, currentUser, getRegistry } = vi.hoisted(() => ({
  getCutting: vi.fn(),
  advanceCutting: vi.fn((_id: string, patch: Record<string, unknown>) => ({ id: _id, ...patch })),
  currentUser: vi.fn(() => null),
  getRegistry: vi.fn()
}));

vi.mock('$lib/db/hayCuttings', () => ({
  getCutting,
  advanceCutting,
  abortCutting: vi.fn()
}));
vi.mock('$lib/server/auth', () => ({ currentUser }));
vi.mock('$lib/server/registry', () => ({ getRegistry }));

import { PATCH } from './[id]/+server';

const HAY_OPERATIONS = {
  steps: ['mow', 'ted', 'rake', 'bale', 'store'],
  weatherWindowDays: 3,
  cuttingsPerSeason: 3,
  cutIntervalDays: 30,
  baleMoistureGate: {
    'small-square': { warnAbovePct: 18, dangerAbovePct: 22, warnBelowPct: 14, dangerBelowPct: 12 }
  }
};

function primeRegistry() {
  getRegistry.mockResolvedValue({
    get: () => ({ plugin: { type: 'crop', hayOperations: HAY_OPERATIONS } })
  });
}

// Cutting sits in `raking` so the next step is `bale`.
function rakingCutting() {
  return {
    id: 'cut-1',
    cropPluginId: 'alfalfa',
    status: 'raking',
    baleType: null,
    baleMoisturePct: null
  };
}

function patchEvent(body: unknown) {
  return {
    params: { id: 'cut-1' },
    request: new Request('http://localhost/api/hay/cuttings/cut-1', {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
  } as never;
}

beforeEach(() => {
  getCutting.mockReset();
  advanceCutting.mockClear();
  currentUser.mockReset();
  currentUser.mockReturnValue(null);
  getRegistry.mockReset();
  primeRegistry();
});

describe('#323 bale-gate danger is non-overridable', () => {
  it('blocks a >22% (danger) bale even WITH overrideBaleGate:true', async () => {
    getCutting.mockReturnValue(rakingCutting());
    const res = await PATCH(
      patchEvent({
        action: 'advance',
        step: 'bale',
        baleType: 'small-square',
        baleMoisturePct: 25,
        overrideBaleGate: true
      })
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.overridable).toBe(false);
    expect(body.violations.some((v: { severity: string }) => v.severity === 'danger')).toBe(true);
    expect(advanceCutting).not.toHaveBeenCalled();
  });

  it('still blocks a danger bale WITHOUT the override (unchanged behaviour)', async () => {
    getCutting.mockReturnValue(rakingCutting());
    const res = await PATCH(
      patchEvent({
        action: 'advance',
        step: 'bale',
        baleType: 'small-square',
        baleMoisturePct: 25
      })
    );
    expect(res.status).toBe(422);
    expect(advanceCutting).not.toHaveBeenCalled();
  });

  it('MOISTURE_MISSING is danger and cannot be overridden', async () => {
    getCutting.mockReturnValue(rakingCutting());
    const res = await PATCH(
      patchEvent({
        action: 'advance',
        step: 'bale',
        baleType: 'small-square',
        overrideBaleGate: true
      })
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.overridable).toBe(false);
    expect(advanceCutting).not.toHaveBeenCalled();
  });

  it('allows baling at a safe moisture (no violation)', async () => {
    getCutting.mockReturnValue(rakingCutting());
    const res = await PATCH(
      patchEvent({
        action: 'advance',
        step: 'bale',
        baleType: 'small-square',
        baleMoisturePct: 16
      })
    );
    expect(res.status).toBe(200);
    expect(advanceCutting).toHaveBeenCalledOnce();
  });
});
