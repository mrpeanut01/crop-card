import { describe, expect, it } from 'vitest';
import { pointFt } from '$lib/garden/geometry';
import type { FootprintWriteRequest } from '$lib/garden/api';
import type { PlacedPlanting } from '$lib/garden/types';
import { DesignerState, type DesignerInit } from './designerState.svelte';
import {
  CATALOG,
  LETTUCE,
  TOMATO,
  fakeFetch,
  kitchenGarden,
  plantingRow,
  type FetchCall
} from './fixtures';

const flush = () => new Promise((r) => setTimeout(r, 0));
const APR_1 = Date.UTC(2026, 3, 1);
const APR_15 = Date.UTC(2026, 3, 15);
const FP = { x_in: 0, y_in: 0, w_in: 24, l_in: 24 };

function make(
  over: Partial<DesignerInit> = {},
  handler?: (c: FetchCall) => { status?: number; body?: unknown } | 'offline'
) {
  const f = fakeFetch(handler ?? (() => ({ body: {} })));
  let state!: DesignerState;
  const cleanup = $effect.root(() => {
    state = new DesignerState({
      design: kitchenGarden(),
      history: {},
      catalog: CATALOG,
      companions: [],
      lookbackByFamily: {},
      canEdit: true,
      nowMs: Date.UTC(2026, 2, 1),
      fetch: f.fetch,
      ...over
    });
  });
  return { d: state, calls: f.calls, cleanup };
}

/** Answers a set-placement write the way the server does: the planting as
 *  saved, in its new bed. */
function echoPlacement(d: () => DesignerState) {
  return (c: FetchCall) => {
    if (c.method !== 'PATCH') return { body: {} };
    const id = decodeURIComponent(c.url.split('/').pop()!);
    const body = c.body as FootprintWriteRequest;
    const p = d().design.plantings.find((q) => q.cropId === id)!;
    const planting: PlacedPlanting = { ...p, blockId: body.blockId, footprint: body.footprint };
    return { body: { planting, reanchored: null, followers: [], warnings: [] } };
  };
}

function series() {
  const strip = (y: number) => ({ x_in: 0, y_in: y, w_in: 48, l_in: 24 });
  return kitchenGarden({
    plantings: [
      plantingRow({
        id: 'a',
        cropPluginId: LETTUCE.pluginId,
        varietyDisplayName: 'Lettuce',
        plantingDateMs: APR_1,
        footprint: strip(0),
        groupId: 'g1',
        groupSystemKind: 'succession'
      }),
      plantingRow({
        id: 'b',
        cropPluginId: LETTUCE.pluginId,
        varietyDisplayName: 'Lettuce',
        plantingDateMs: APR_15,
        footprint: strip(24),
        groupId: 'g1',
        groupSystemKind: 'succession'
      }),
      plantingRow({
        id: 'blocker',
        blockId: 'bed2',
        cropPluginId: LETTUCE.pluginId,
        varietyDisplayName: 'Early lettuce',
        plantingDateMs: APR_1,
        footprint: strip(0)
      })
    ]
  });
}

describe('moving a linked sowing to another bed', () => {
  it('moves it to a free spot, keeps the link and says so', async () => {
    const made = make({ design: series() }, (c) => echoPlacement(() => made.d)(c));
    const d = made.d;
    await d.movePlantingToBed('b', 'bed2');
    await flush();
    const body = made.calls[0].body as FootprintWriteRequest & { action: string };
    expect(made.calls[0]).toMatchObject({ method: 'PATCH', url: '/api/crops/b' });
    expect(body).toMatchObject({ action: 'set-placement', blockId: 'bed2' });
    expect(body.footprint).toMatchObject({ w_in: 48, l_in: 24 });
    expect(body.footprint!.y_in).toBeGreaterThanOrEqual(24);
    const moved = d.design.plantings.find((p) => p.cropId === 'b')!;
    expect(moved).toMatchObject({ blockId: 'bed2', groupId: 'g1' });
    expect(d.seriesOf(moved).map((p) => p.cropId)).toEqual(['a', 'b']);
    expect(d.status).toBe('Lettuce moved to Bed 2. It stays linked with its other sowings.');
    expect(d.selectedBedId).toBe('bed2');
    made.cleanup();
  });

  it('a tap onto a taken spot lands in the nearest free one instead', async () => {
    const made = make({ design: series() }, (c) => echoPlacement(() => made.d)(c));
    const d = made.d;
    await d.movePlantingTo('b', 'bed2', { xIn: 24, yIn: 6 });
    await flush();
    const fp = (made.calls[0].body as FootprintWriteRequest).footprint!;
    expect(fp.y_in).toBeGreaterThanOrEqual(24);
    made.cleanup();
  });

  it('says there is no room when the other bed is full on its date', async () => {
    const full = series();
    full.plantings = full.plantings.map((p) =>
      p.cropId === 'blocker' ? { ...p, footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 } } : p
    );
    const { d, calls, cleanup } = make({ design: full });
    await d.movePlantingToBed('b', 'bed2');
    await flush();
    expect(calls).toHaveLength(0);
    expect(d.alert).toMatch(
      /^No room for Lettuce in Bed 2 on Apr 15\. It opens [A-Z][a-z]{2} \d+\.$/
    );
    cleanup();
  });

  it('refuses a sowing already in the ground and rolls back a server refusal', async () => {
    const inGround = series();
    inGround.plantings = inGround.plantings.map((p) =>
      p.cropId === 'b' ? { ...p, status: 'active' } : p
    );
    const { d, calls, cleanup } = make({ design: inGround, nowMs: Date.UTC(2026, 3, 20) }, () => ({
      status: 409,
      body: { error: 'No room for Lettuce there in Bed 2.', code: 'OVERLAP' }
    }));
    await d.movePlantingToBed('b', 'bed2');
    await flush();
    expect(calls).toHaveLength(0);
    expect(d.alert).toMatch(/already in the ground in Bed 1/);
    cleanup();

    const later = make({ design: series() }, () => ({
      status: 409,
      body: { error: 'No room for Lettuce there in Bed 2.', code: 'OVERLAP' }
    }));
    await later.d.movePlantingToBed('b', 'bed2');
    await flush();
    expect(later.d.design.plantings.find((p) => p.cropId === 'b')?.blockId).toBe('bed1');
    expect(later.d.alert).toBe('No room for Lettuce there in Bed 2.');
    later.cleanup();
  });
});

describe('bed recipes through the server', () => {
  it('commits the kept keys in one request and adds what the server saved', async () => {
    const saved: PlacedPlanting = {
      cropId: 'new1',
      blockId: 'bed1',
      cropPluginId: TOMATO.pluginId,
      varietyDisplayName: TOMATO.displayName,
      cropFamily: 'solanaceae',
      status: 'planned',
      plantingDateMs: Date.UTC(2026, 4, 1),
      harvestedAtMs: null,
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
      spacing: { inRowIn: 30, rowIn: 48, pattern: 'square', source: 'plugin' },
      plantCount: 3,
      plantCountProvenance: 'data',
      groupId: null,
      groupSystemKind: null,
      sourceProvenance: 'plugin'
    };
    const { d, calls, cleanup } = make({}, () => ({
      status: 201,
      body: { application: {}, created: [saved] }
    }));
    const kept = { key: 's1', plantingDateMs: 1_780_000_000_000, footprint: FP };
    expect(await d.commitRecipe('bed1', 'radishes-then-tomatoes', [kept])).toBe(true);
    await flush();
    expect(calls).toEqual([
      {
        url: '/api/garden/beds/bed1/recipe',
        method: 'POST',
        body: {
          recipePluginId: 'radishes-then-tomatoes',
          seasonYear: 2026,
          commit: true,
          acceptKeys: ['s1'],
          expected: [kept]
        }
      }
    ]);
    expect(d.design.plantings.map((p) => p.cropId)).toEqual(['new1']);
    expect(d.status).toBe('1 planting added.');
    cleanup();
  });

  it('keeps the page as it was when the bed changed since the preview', async () => {
    const { d, cleanup } = make({}, () => ({
      status: 409,
      body: { error: 'Bed 1 changed since this preview, so nothing was added.', code: 'STALE' }
    }));
    expect(
      await d.commitRecipe('bed1', 'radishes-then-tomatoes', [
        { key: 's0', plantingDateMs: 1_780_000_000_000, footprint: FP }
      ])
    ).toBe(false);
    await flush();
    expect(d.design.plantings).toHaveLength(0);
    expect(d.alert).toBe('Bed 1 changed since this preview, so nothing was added.');
    cleanup();
  });

  it('sends nothing for an empty keep list or a helper', async () => {
    const owner = make();
    expect(await owner.d.commitRecipe('bed1', 'r', [])).toBe(false);
    expect(owner.calls).toHaveLength(0);
    owner.cleanup();
    const helper = make({ canEdit: false });
    expect(
      await helper.d.commitRecipe('bed1', 'r', [
        { key: 's0', plantingDateMs: 1_780_000_000_000, footprint: FP }
      ])
    ).toBe(false);
    expect(helper.calls).toHaveLength(0);
    helper.cleanup();
  });
});

describe('dragging a crop onto a bed', () => {
  const tomatoes = { source: 'catalog' as const, pluginId: TOMATO.pluginId, label: 'Tomatoes' };

  it('shows where it would land, then places it there on drop', async () => {
    const made = make({ nowMs: Date.UTC(2026, 4, 1), initialDateMs: Date.UTC(2026, 4, 20) }, (c) =>
      c.method === 'POST'
        ? {
            status: 201,
            body: {
              plantings: [
                {
                  ...(c.body as { plantings: Array<Record<string, unknown>> }).plantings[0],
                  cropId: 'n1',
                  cropFamily: 'solanaceae',
                  status: 'planned',
                  harvestedAtMs: null,
                  spacing: { inRowIn: 30, rowIn: 48, pattern: 'square', source: 'plugin' },
                  plantCount: 1,
                  plantCountProvenance: 'data',
                  groupId: null,
                  groupSystemKind: null
                }
              ]
            }
          }
        : { body: {} }
    );
    const d = made.d;
    d.locate = (x, y) => ({ point: pointFt(x / 10, y / 10), bedId: x < 60 ? 'bed1' : null });
    expect(d.startCropDrag(tomatoes, 0, 0)).toBe(true);
    d.moveCropDrag(200, 200);
    expect(d.cropDrag).toMatchObject({ bedId: null, ghost: null });
    d.moveCropDrag(30, 60);
    expect(d.cropDrag?.bedId).toBe('bed1');
    expect(d.cropDrag?.ghost?.fits).toBe(true);
    const landing = d.cropDrag!.ghost!.footprint;
    await d.dropCrop();
    await flush();
    expect(d.cropDrag).toBeNull();
    const posted = made.calls.find((c) => c.method === 'POST')!;
    expect(posted.url).toBe('/api/garden/plantings');
    expect(
      (posted.body as { plantings: Array<{ blockId: string; footprint: unknown }> }).plantings[0]
    ).toMatchObject({ blockId: 'bed1', footprint: landing });
    made.cleanup();
  });

  it('marks a full bed as no room, and a drop off the beds places nothing', async () => {
    const full = kitchenGarden({
      plantings: [
        plantingRow({
          id: 'let',
          cropPluginId: LETTUCE.pluginId,
          varietyDisplayName: 'Lettuce',
          plantingDateMs: Date.UTC(2026, 4, 1),
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 }
        })
      ]
    });
    const { d, calls, cleanup } = make({
      design: full,
      nowMs: Date.UTC(2026, 4, 1),
      initialDateMs: Date.UTC(2026, 4, 5)
    });
    d.locate = (x, y) => ({ point: pointFt(x, y), bedId: 'bed1' });
    d.startCropDrag(tomatoes, 0, 0);
    d.moveCropDrag(3, 5);
    expect(d.cropDrag?.ghost?.fits).toBe(false);
    d.locate = (x, y) => ({ point: pointFt(x, y), bedId: null });
    d.moveCropDrag(19, 29);
    await d.dropCrop();
    await flush();
    expect(calls).toHaveLength(0);
    expect(d.status).toBe('Tomatoes not placed. Drop it on a bed, or tap it and then a bed.');
    cleanup();
  });

  it('does not start for a helper, offline or in the List view, and Escape puts it back', async () => {
    const helper = make({ canEdit: false });
    expect(helper.d.startCropDrag(tomatoes, 0, 0)).toBe(false);
    helper.cleanup();
    const list = make();
    list.d.view = 'list';
    expect(list.d.startCropDrag(tomatoes, 0, 0)).toBe(false);
    list.d.view = 'canvas';
    list.d.offline = true;
    expect(list.d.startCropDrag(tomatoes, 0, 0)).toBe(false);
    list.d.offline = false;
    expect(list.d.startCropDrag(tomatoes, 0, 0)).toBe(true);
    list.d.cancelCropDrag();
    await flush();
    expect(list.d.cropDrag).toBeNull();
    expect(list.d.status).toBe('Put back.');
    list.cleanup();
  });
});
