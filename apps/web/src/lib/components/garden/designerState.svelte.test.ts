import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { pointFt } from '$lib/garden/geometry';
import type { PlacedPlanting } from '$lib/garden/types';
import { DesignerState, nextBedName, type DesignerInit } from './designerState.svelte';
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
      lookbackByFamily: { solanaceae: 3 },
      canEdit: true,
      nowMs: Date.UTC(2026, 4, 1),
      fetch: f.fetch,
      ...over
    });
  });
  return { d: state, calls: f.calls, cleanup };
}

function placed(over: Partial<PlacedPlanting>): PlacedPlanting {
  return {
    cropId: 'x',
    blockId: 'bed1',
    cropPluginId: TOMATO.pluginId,
    varietyDisplayName: 'Tomato',
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
    ...over
  };
}

describe('nextBedName', () => {
  it('takes the lowest unused number and names containers Pot N', () => {
    expect(nextBedName([{ name: 'Bed 1' }, { name: 'Bed 3' }], 'bed')).toBe('Bed 2');
    expect(nextBedName([{ name: 'Bed 1' }], 'container')).toBe('Pot 1');
    expect(nextBedName([], 'bed')).toBe('Bed 1');
  });
});

describe('DesignerState beds', () => {
  it('drops a preset at the tapped top-left, snapped, and saves it through /api/blocks', async () => {
    const { d, calls, cleanup } = make({ design: kitchenGarden({ blocks: [] }) }, (c) =>
      c.method === 'POST' ? { status: 201, body: { block: { id: 'new1' } } } : { body: {} }
    );
    d.choosePreset('raised-4x8');
    expect(d.mode.kind).toBe('place-bed');
    await d.tap(pointFt(2.2, 2.9), null, null);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: '/api/blocks',
      method: 'POST',
      body: {
        fieldId: 'area1',
        name: 'Bed 1',
        kind: 'bed',
        bedStyle: 'raised',
        widthFt: 4,
        lengthFt: 8,
        xFt: 2,
        yFt: 3,
        rotationDeg: 0
      }
    });
    expect(d.beds.map((b) => b.blockId)).toEqual(['new1']);
    expect(d.selectedBedId).toBe('new1');
    await flush();
    expect(d.status).toBe('Bed 1 added at 2 feet from west, 3 feet from north.');
    cleanup();
  });

  it('choosing a preset twice drops it at the first open spot', async () => {
    const { d, calls, cleanup } = make({}, () => ({ status: 201, body: { block: { id: 'b3' } } }));
    d.choosePreset('container-5gal');
    d.choosePreset('container-5gal');
    await flush();
    expect(calls[0].body).toMatchObject({ name: 'Pot 1', kind: 'container', xFt: 0, yFt: 0 });
    cleanup();
  });

  it('refuses a drop onto another bed without saving', async () => {
    const { d, calls, cleanup } = make();
    d.choosePreset('raised-4x8');
    await d.tap(pointFt(3, 4), 'bed1', null);
    await flush();
    expect(calls).toHaveLength(0);
    expect(d.alert).toBe("Beds can't overlap");
    cleanup();
  });

  it('Move then tap onto Bed 1 leaves Bed 2 where it was', async () => {
    const { d, calls, cleanup } = make();
    d.startMove('bed2');
    await d.tap(pointFt(3, 3), 'bed1', null);
    await flush();
    expect(calls).toHaveLength(0);
    expect(d.bed('bed2')!.rect).toMatchObject({ x: 8, y: 3 });
    expect(d.alert).toBe("Beds can't overlap");
    cleanup();
  });

  it('rolls a move back with the server message when the PATCH fails', async () => {
    const { d, cleanup } = make({}, () => ({
      status: 409,
      body: { error: 'nope', code: 'OVERLAP' }
    }));
    const ok = await d.moveBedTo('bed2', 14, 10);
    await flush();
    expect(ok).toBe(false);
    expect(d.bed('bed2')!.rect).toMatchObject({ x: 8, y: 3 });
    expect(d.alert).toBe("Beds can't overlap");
    cleanup();
  });

  it('says so and goes read-only when a write fails for lack of a connection', async () => {
    const { d, cleanup } = make({}, () => 'offline');
    await d.turnBed('bed2');
    await flush();
    expect(d.alert).toBe("That change didn't save because you're offline.");
    expect(d.bed('bed2')!.rotationDeg).toBe(0);
    expect(d.canEdit).toBe(false);
    cleanup();
  });

  it('keyboard pick-up, arrows and Enter save one PATCH at the new spot', async () => {
    const { d, calls, cleanup } = make();
    d.pickUp('bed2');
    d.carry(0.5, 0);
    d.carry(5, 0);
    d.carry(0, 5);
    await d.drop();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/blocks/bed2',
      body: { xFt: 13.5, yFt: 8 }
    });
    cleanup();
  });

  it('Escape puts a carried bed back', () => {
    const { d, calls, cleanup } = make();
    d.pickUp('bed2');
    d.carry(5, 5);
    d.cancelMode();
    expect(d.bed('bed2')!.rect).toMatchObject({ x: 8, y: 3 });
    expect(calls).toHaveLength(0);
    cleanup();
  });

  it('refuses a turn that cannot fit', async () => {
    const { d, cleanup } = make({
      design: kitchenGarden({
        blocks: [
          {
            id: 'long',
            name: 'Bed 1',
            kind: 'bed',
            widthFt: 3,
            lengthFt: 28,
            xFt: 0,
            yFt: 0,
            rotationDeg: 0,
            bedStyle: 'raised'
          }
        ]
      })
    });
    expect(await d.turnBed('long')).toBe(false);
    await flush();
    expect(d.alert).toBe("Bed 1 won't fit turned. Make the garden bigger or the bed shorter.");
    cleanup();
  });

  it('a bed with records stays when deleted', async () => {
    const { d, cleanup } = make({}, () => ({
      status: 409,
      body: { error: 'x', code: 'BED_HAS_RECORDS' }
    }));
    await d.deleteBed('bed1');
    await flush();
    expect(d.bed('bed1')).toBeDefined();
    expect(d.alert).toMatch(/Bed 1 has records, so it stays/);
    cleanup();
  });

  it('duplicates next to the original with the same size and style', async () => {
    const { d, calls, cleanup } = make({}, () => ({ status: 201, body: { block: { id: 'b3' } } }));
    await d.duplicateBed('bed1');
    expect(calls[0].body).toMatchObject({
      name: 'Bed 3',
      widthFt: 4,
      lengthFt: 8,
      bedStyle: 'raised'
    });
    expect(calls[0].body).not.toMatchObject({ xFt: 2, yFt: 3 });
    cleanup();
  });

  it('a helper sees everything and changes nothing', async () => {
    const { d, calls, cleanup } = make({ canEdit: false });
    d.choosePreset('raised-4x8');
    await d.moveBedTo('bed1', 10, 10);
    await flush();
    expect(calls).toHaveLength(0);
    expect(d.mode.kind).toBe('idle');
    expect(d.alert).toBe('View only. The farm owner changes the layout.');
    cleanup();
  });
});

describe('DesignerState crops', () => {
  it('places a searched crop at the tap point with the scrubber date', async () => {
    const { d, calls, cleanup } = make({}, (c) => ({
      status: 201,
      body: {
        placed: placed({
          cropId: 'new',
          footprint: (c.body as { footprint: PlacedPlanting['footprint'] }).footprint
        })
      }
    }));
    d.chooseCrop({ source: 'catalog', pluginId: TOMATO.pluginId, label: TOMATO.displayName });
    expect(d.mode.kind).toBe('place-crop');
    await d.tap(pointFt(3, 4), 'bed1', null);
    expect(calls[0]).toMatchObject({
      url: '/api/blocks/bed1/plantings',
      method: 'POST',
      body: {
        cropPluginId: TOMATO.pluginId,
        plantingDate: Date.UTC(2026, 4, 1),
        spacingPattern: 'square',
        footprint: { x_in: 0, w_in: 48, l_in: 24 }
      }
    });
    expect(calls[0].body).not.toHaveProperty('sourceProvenance');
    expect(d.selectedCropId).toBe('new');
    cleanup();
  });

  it('says when a bed has no room on that date and when it opens', async () => {
    const full = kitchenGarden({
      plantings: [
        plantingRow({
          id: 'lettuce',
          blockId: 'bed2',
          cropPluginId: LETTUCE.pluginId,
          varietyDisplayName: 'Lettuce',
          plantingDateMs: Date.UTC(2026, 3, 1),
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 }
        })
      ]
    });
    const { d, calls, cleanup } = make({ design: full });
    await d.placeCrop({ source: 'catalog', pluginId: TOMATO.pluginId, label: 'Tomatoes' }, 'bed2');
    expect(calls).toHaveLength(0);
    expect(d.conflict).toMatchObject({
      text: 'No room in Bed 2 on May 1. It opens Jul 1.',
      retryDateMs: Date.UTC(2026, 6, 1)
    });
    cleanup();
  });

  it('refuses to move an in-ground planting to another bed', async () => {
    const design = kitchenGarden({
      plantings: [
        plantingRow({
          id: 'tom',
          status: 'active',
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 }
        })
      ]
    });
    const { d, calls, cleanup } = make({ design });
    await d.movePlantingTo('tom', 'bed2', { xIn: 24, yIn: 24 });
    await flush();
    expect(calls).toHaveLength(0);
    expect(d.alert).toMatch(/already in the ground in Bed 1\. Record a new planting instead\./);
    cleanup();
  });

  it('resizing sends the snapped footprint and shows the recomputed count at once', async () => {
    const design = kitchenGarden({
      plantings: [
        plantingRow({
          id: 'let',
          blockId: 'bed2',
          cropPluginId: LETTUCE.pluginId,
          varietyDisplayName: 'Lettuce',
          plantingDateMs: Date.UTC(2026, 3, 1),
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 }
        })
      ]
    });
    let seen: unknown;
    const { d, cleanup } = make({ design }, (c) => {
      seen = c.body;
      return { status: 500, body: { error: 'later' } };
    });
    const p = d.setPlantingSize('let', 4, 4);
    flushSync();
    expect(d.design.plantings[0]).toMatchObject({
      plantCount: 16,
      plantCountProvenance: 'fallback'
    });
    await p;
    expect(seen).toMatchObject({
      action: 'set-placement',
      blockId: 'bed2',
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
      spacingPattern: 'square'
    });
    expect(d.design.plantings[0].footprint).toMatchObject({ l_in: 24 });
    cleanup();
  });

  it('reads the July 15 summary from occupancy', () => {
    const design = kitchenGarden({
      plantings: [
        plantingRow({ id: 'tom', footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 } }),
        plantingRow({
          id: 'let',
          blockId: 'bed2',
          cropPluginId: LETTUCE.pluginId,
          varietyDisplayName: 'Lettuce',
          plantingDateMs: Date.UTC(2026, 3, 1),
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 }
        })
      ]
    });
    const { d, cleanup } = make({ design });
    d.setDate(Date.UTC(2026, 6, 15));
    flushSync();
    expect(d.stageOf('tom')).toBe('Harvesting');
    expect(d.dateSummary()).toBe(
      `July 15. Bed 1: ${TOMATO.displayName}, harvesting. Bed 2: open from July 1.`
    );
    expect(d.bedLabel(d.bed('bed1')!)).toBe(
      `Bed 1, 4 by 8 foot raised bed, 2 feet from west, 3 feet from north. On July 15: ${TOMATO.displayName}, 3 plants.`
    );
    cleanup();
  });

  it('warns about a same-family repeat from bed history without blocking', () => {
    const { d, cleanup } = make({
      history: {
        bed1: [
          {
            cropId: 'old',
            cropPluginId: TOMATO.pluginId,
            varietyDisplayName: 'Tomato',
            cropFamily: 'solanaceae',
            archetype: 'continuous-harvest-fruit',
            status: 'harvested',
            plantingDateMs: Date.UTC(2025, 4, 1),
            harvestedAtMs: Date.UTC(2025, 8, 1),
            seasonYear: 2025
          }
        ]
      }
    });
    const [w] = d.rotationFor('bed1', 'solanaceae');
    expect(w).toMatchObject({ severity: 'warn', lastSeasonYear: 2025 });
    expect(w.message).toMatch(/grew here in 2025/);
    cleanup();
  });

  it('opens on the ?on= date when it is in range', () => {
    const { d, cleanup } = make({ initialDateMs: Date.UTC(2026, 6, 15, 14), initialBedId: 'bed2' });
    expect(d.dateMs).toBe(Date.UTC(2026, 6, 15));
    expect(d.selectedBedId).toBe('bed2');
    cleanup();
  });
});
