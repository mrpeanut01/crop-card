import { describe, expect, it } from 'vitest';
import type { PlacedPlanting } from '$lib/garden/types';
import { DesignerState, bedAwareIntervals, type DesignerInit } from './designerState.svelte';
import { CATALOG, TOMATO, fakeFetch, kitchenGarden } from './fixtures';

const DAY = 86_400_000;
const covered = {
  bed1: {
    lastSpringFrostMs: Date.UTC(2026, 3, 15) - 21 * DAY,
    firstFallFrostMs: Date.UTC(2026, 9, 24) + 14 * DAY,
    frostFree: false,
    summary: 'Covered: frost ends Mar 25, first frost Nov 7'
  }
};

function make(over: Partial<DesignerInit> = {}) {
  const f = fakeFetch(() => ({ body: {} }));
  let state!: DesignerState;
  const cleanup = $effect.root(() => {
    state = new DesignerState({
      design: kitchenGarden({ frostByBed: covered }),
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
  return { d: state, cleanup };
}

const early = (blockId: string) =>
  ({
    cropPluginId: TOMATO.pluginId,
    plantingDateMs: Date.UTC(2026, 3, 5),
    blockId
  }) as Pick<PlacedPlanting, 'cropPluginId' | 'plantingDateMs' | 'blockId'>;

describe('designer per-bed frost (Phase 32E)', () => {
  it('a covered bed opens its window earlier than an uncovered one', () => {
    const { d, cleanup } = make();
    const bedWindow = d.plantingWindowFor(TOMATO.pluginId, 'bed1');
    const farmWindow = d.plantingWindowFor(TOMATO.pluginId, 'bed2');
    expect(farmWindow.startMs - bedWindow.startMs).toBe(21 * DAY);
    expect(d.windowWarning(early('bed1'))).toBeNull();
    expect(d.windowWarning(early('bed2'))).toMatch(/^Early for/);
    expect(d.bedFrostSummary('bed1')).toMatch(/^Covered/);
    expect(d.bedFrostSummary('bed2')).toBeNull();
    cleanup();
  });

  it('with no covers the windows and intervals match the farm exactly', () => {
    const { d, cleanup } = make({ design: kitchenGarden() });
    expect(d.plantingWindowFor(TOMATO.pluginId, 'bed1')).toEqual(
      d.plantingWindowFor(TOMATO.pluginId)
    );
    cleanup();
  });

  it('applyBedFrost updates the bed after a cover is added, and clears it when removed', () => {
    const { d, cleanup } = make({ design: kitchenGarden() });
    d.applyBedFrost('bed2', {
      lastSpring: '2026-03-25',
      firstFall: '2026-10-24',
      frostFree: false,
      farmLastSpring: '2026-04-15',
      farmFirstFall: '2026-10-24',
      summary: 'Covered: frost ends Mar 25'
    });
    expect(d.windowWarning(early('bed2'))).toBeNull();
    d.applyBedFrost('bed2', {
      lastSpring: '2026-04-15',
      firstFall: '2026-10-24',
      frostFree: false,
      farmLastSpring: '2026-04-15',
      farmFirstFall: '2026-10-24',
      summary: null
    });
    expect(d.windowWarning(early('bed2'))).toMatch(/^Early for/);
    expect(d.design.frostByBed?.bed2).toBeUndefined();
    cleanup();
  });

  it('occupancy for a covered bed ends on its own fall frost', () => {
    const base = kitchenGarden({
      plantings: [
        {
          id: 'p1',
          blockId: 'bed1',
          cropPluginId: TOMATO.pluginId,
          varietyDisplayName: 'Tomato',
          status: 'planned',
          plantingDateMs: Date.UTC(2026, 4, 1),
          harvestedAtMs: null,
          footprint: null,
          spacingIn: null,
          rowSpacingIn: null,
          spacingPattern: null,
          plantCount: null,
          plantCountProvenance: null,
          groupId: null,
          groupSystemKind: null
        }
      ]
    });
    const plain = bedAwareIntervals(base);
    const withCover = bedAwareIntervals({ ...base, frostByBed: covered });
    expect(plain).toHaveLength(1);
    expect(withCover[0].endMs).toBeGreaterThanOrEqual(plain[0].endMs);
  });
});
