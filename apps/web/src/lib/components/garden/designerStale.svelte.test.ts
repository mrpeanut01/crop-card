import { describe, expect, it } from 'vitest';
import type { PlacedPlanting } from '$lib/garden/types';
import { DesignerState } from './designerState.svelte';
import {
  CATALOG,
  LETTUCE,
  fakeFetch,
  kitchenGarden,
  plantingRow,
  type FetchCall
} from './fixtures';

const APR_1 = Date.UTC(2026, 3, 1);
const FP = { x_in: 0, y_in: 0, w_in: 24, l_in: 24 };
const THEIRS = { x_in: 0, y_in: 48, w_in: 24, l_in: 24 };
const MINE = { x_in: 24, y_in: 0, w_in: 24, l_in: 24 };

function make(handler: (c: FetchCall) => { status?: number; body?: unknown }) {
  const f = fakeFetch(handler);
  let state!: DesignerState;
  const cleanup = $effect.root(() => {
    state = new DesignerState({
      design: kitchenGarden({
        plantings: [
          plantingRow({
            id: 'a',
            cropPluginId: LETTUCE.pluginId,
            varietyDisplayName: 'Lettuce',
            plantingDateMs: APR_1,
            footprint: FP
          })
        ]
      }),
      history: {},
      catalog: CATALOG,
      companions: [],
      lookbackByFamily: {},
      canEdit: true,
      nowMs: Date.UTC(2026, 2, 1),
      fetch: f.fetch
    });
  });
  return { d: state, calls: f.calls, cleanup };
}

const conflictBody = {
  error: 'Someone else changed this while you were editing. Nothing was saved.',
  code: 'EDIT_CONFLICT',
  target: 'planting',
  id: 'a',
  action: 'set-placement',
  fields: [{ field: 'footprint', base: FP, mine: MINE, theirs: THEIRS }],
  current: { blockId: 'bed1', footprint: THEIRS, plantingDate: APR_1, status: 'planned' }
};

describe('designer placement against another device', () => {
  it('sends where the planting was as base, and on a conflict shows where it is now', async () => {
    let refused = false;
    const made = make((c) => {
      if (c.method !== 'PATCH') return { body: {} };
      if (!refused) {
        refused = true;
        return { status: 409, body: conflictBody };
      }
      const body = c.body as { footprint: typeof FP; blockId: string };
      const p = made.d.design.plantings.find((q) => q.cropId === 'a')!;
      const planting: PlacedPlanting = { ...p, footprint: body.footprint };
      return { body: { planting, reanchored: null, followers: [], warnings: [] } };
    });
    const d = made.d;
    const p = d.design.plantings.find((q) => q.cropId === 'a')!;
    await d.writeFootprint(p, { blockId: 'bed1', footprint: MINE });
    expect(made.calls[0].body).toMatchObject({
      action: 'set-placement',
      footprint: MINE,
      base: { blockId: 'bed1', footprint: FP, plantingDate: APR_1 }
    });
    expect(d.stalePlacement?.conflict.fields[0].field).toBe('footprint');
    expect(d.design.plantings.find((q) => q.cropId === 'a')?.footprint).toEqual(THEIRS);
    expect(d.alert).toBe('');

    await d.keepStalePlacement();
    expect(made.calls[1].body).toMatchObject({
      footprint: MINE,
      base: { blockId: 'bed1', footprint: THEIRS, plantingDate: APR_1 }
    });
    expect(d.stalePlacement).toBeNull();
    expect(d.design.plantings.find((q) => q.cropId === 'a')?.footprint).toEqual(MINE);
    made.cleanup();
  });
});
