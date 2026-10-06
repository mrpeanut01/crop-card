import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitFlow } from './commitFlow';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import type { AllocationWizardState } from '../wizardState.svelte';

const a = (stockItemId: string, blockId: string, plants: number) => ({
  stockItemId,
  blockId,
  cropPluginId: stockItemId === 'bean' ? 'bush-bean-provider' : 'beet-detroit-dark-red',
  varietyDisplayName: stockItemId === 'bean' ? 'Bean' : 'Beet',
  plants
});

function fakeWizard(assignments: ReturnType<typeof a>[]) {
  const onCommitted = vi.fn();
  const w = {
    response: {
      assignments,
      unplaced: [],
      sufficiency: {},
      rationale: '',
      perRowRationale: {},
      advisories: [],
      meta: { model: 'engine', usdEstimate: 0, fallback: 'no-api-key' }
    },
    scheduleResponse: null,
    step: 'inputs',
    error: null,
    acceptedInputs: null,
    inputsCommitError: null,
    commitProgress: { done: 0, total: 0, failed: [] as string[] },
    commitRows: [] as unknown[],
    commitFailedKeys: [] as string[],
    commitRetrying: false,
    establishmentByCrop: {},
    selectedSeeds: new Map([
      ['bean', 101],
      ['beet', 50]
    ]),
    props: {
      seedStock: [
        { stockItemId: 'bean', defaultUnit: 'seeds' },
        { stockItemId: 'beet', defaultUnit: 'seeds' }
      ],
      onCommitted
    },
    isFillToBed: () => false,
    isAreaCrop: (id: string) => id === 'cereal-rye-cover',
    sowMethodFor: (id: string) => (id === 'cereal-rye-cover' ? 'drilled' : null),
    blockNameFor: (id: string) => (id === 'n' ? 'North Bed' : 'South Bed'),
    discardDraft: vi.fn(async () => {})
  };
  return { w: w as unknown as AllocationWizardState, raw: w, onCommitted };
}

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
let calls: Call[];
let fail: (c: Call) => 'ok' | 'error' | 'throw';

beforeEach(() => {
  calls = [];
  fail = () => 'ok';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body))
      };
      calls.push(call);
      const outcome = fail(call);
      if (outcome === 'throw') throw new TypeError('network down');
      return new Response(JSON.stringify(outcome === 'ok' ? { planting: {} } : { error: 'x' }), {
        status: outcome === 'ok' ? 201 : 500
      });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('CommitFlow split lots (R-12, R-18, R-19)', () => {
  it('sends one group id on every part of a split lot and draws the lot exactly once', async () => {
    const { w, onCommitted } = fakeWizard([
      a('bean', 'n', 60),
      a('beet', 's', 40),
      a('bean', 's', 40)
    ]);
    await new CommitFlow(w).commit();
    expect(calls).toHaveLength(3);
    const beans = calls.filter((c) => c.body.cropPluginId === 'bush-bean-provider');
    const group = beans[0].body.splitGroupId as string;
    expect(group).toMatch(/^sg_[A-Za-z0-9-]{8,64}$/);
    expect(beans.every((c) => c.body.splitGroupId === group)).toBe(true);
    expect(beans.reduce((s, c) => s + (c.body.quantityPlanted as number), 0)).toBe(101);
    const beet = calls.find((c) => c.body.cropPluginId !== 'bush-bean-provider')!;
    expect(beet.body.splitGroupId).toBeUndefined();
    expect(beet.body.quantityPlanted).toBe(50);
    const ids = calls.map((c) => c.headers[CLIENT_RECORD_HEADER]);
    expect(new Set(ids).size).toBe(3);
    expect(beans.every((c) => c.body.sourceProvenance === 'fallback')).toBe(true);
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('lists the rows that did not save and retries only those with the same ids', async () => {
    const { w, raw, onCommitted } = fakeWizard([a('bean', 'n', 60), a('bean', 's', 40)]);
    fail = (c) => (c.url.includes('/blocks/s/') ? 'throw' : 'ok');
    const flow = new CommitFlow(w);
    await flow.commit();
    expect(raw.commitProgress.failed).toEqual(['Bean → South Bed']);
    expect(onCommitted).not.toHaveBeenCalled();
    const firstTry = calls.find((c) => c.url.includes('/blocks/s/'))!;

    fail = () => 'ok';
    calls = [];
    await flow.retryFailed();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/blocks/s/');
    expect(calls[0].headers[CLIENT_RECORD_HEADER]).toBe(firstTry.headers[CLIENT_RECORD_HEADER]);
    expect(calls[0].body).toEqual(firstTry.body);
    expect(raw.commitProgress.failed).toEqual([]);
    expect(raw.commitProgress.done).toBe(2);
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('keeps a row on the failed list when the retry fails again', async () => {
    const { w, raw } = fakeWizard([a('bean', 'n', 60), a('bean', 's', 40)]);
    fail = (c) => (c.url.includes('/blocks/n/') ? 'error' : 'ok');
    const flow = new CommitFlow(w);
    await flow.commit();
    await flow.retryFailed();
    expect(raw.commitProgress.failed).toEqual(['Bean → North Bed']);
    expect(calls.filter((c) => c.url.includes('/blocks/s/'))).toHaveLength(1);
  });

  it('apportions the scheduled path from the same helper', async () => {
    const { w } = fakeWizard([]);
    const day = Date.UTC(2026, 4, 1);
    await new CommitFlow(w).commitScheduled([
      { ...a('bean', 'n', 30), plantingDateMs: day, rationale: '' },
      { ...a('bean', 'n', 30), plantingDateMs: day + 14 * 86_400_000, rationale: '' },
      { ...a('bean', 's', 41), plantingDateMs: day, rationale: '' }
    ]);
    expect(calls.reduce((s, c) => s + (c.body.quantityPlanted as number), 0)).toBe(101);
    const groups = new Set(calls.map((c) => c.body.splitGroupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toMatch(/^sg_/);
    expect(calls.every((c) => typeof c.body.plantingDate === 'number')).toBe(true);
  });

  it('sends no plant count for a crop sown by area (#555)', async () => {
    const { w } = fakeWizard([
      { ...a('bean', 'n', 300), cropPluginId: 'cereal-rye-cover', varietyDisplayName: 'Rye' },
      a('beet', 's', 40)
    ]);
    await new CommitFlow(w).commit();
    const rye = calls.find((c) => c.body.cropPluginId === 'cereal-rye-cover')!;
    expect(rye.body.plannedPlants).toBeUndefined();
    expect(rye.body.quantityPlanted).toBe(101);
    expect(rye.body.sowingMethod).toBe('drilled');
    const beet = calls.find((c) => c.body.cropPluginId !== 'cereal-rye-cover')!;
    expect(beet.body.plannedPlants).toBe(40);
    expect(beet.body.sowingMethod).toBeUndefined();
  });
});
