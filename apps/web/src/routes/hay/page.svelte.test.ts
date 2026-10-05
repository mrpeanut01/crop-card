/**
 * @vitest-environment jsdom
 *
 * The next hay step follows the cutting's own crop steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

import Page from './+page.svelte';

const hayCrop = (pluginId: string, steps: string[]) => ({
  pluginId,
  displayName: pluginId,
  cropFamily: 'grass',
  hayOperations: { steps, weatherWindowDays: 3 }
});

function data(steps: string[]) {
  return {
    blocks: [{ id: 'b1', name: 'Hayfield', acres: 2, hasGeometry: false, hayPlanting: null }],
    hayCrops: [hayCrop('grass-hay', steps)],
    selectedBlockId: 'b1',
    selectedCropId: null,
    taskContext: null,
    year: 2026,
    cuttings: [
      {
        id: 'c1',
        blockId: 'b1',
        cropPluginId: 'grass-hay',
        year: 2026,
        cuttingNumber: 1,
        status: 'mowing',
        mowAt: Date.now() - 86_400_000,
        createdAt: Date.now() - 86_400_000,
        voidableUntilMs: Date.now() + 86_400_000,
        offFarm: []
      }
    ],
    canVoidHolds: false,
    canStockBales: false,
    forage: { canRecord: false, canAttach: false }
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 }))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('/hay next step', () => {
  it('skips tedding when the crop has no ted step', () => {
    render(Page, { props: { data: data(['mow', 'rake', 'bale', 'store']) } as never });
    expect(screen.getByRole('button', { name: /Advance — rake/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Advance — ted/ })).toBeNull();
  });

  it('teds first when the crop declares it', () => {
    render(Page, { props: { data: data(['mow', 'ted', 'rake', 'bale', 'store']) } as never });
    expect(screen.getByRole('button', { name: /Advance — ted/ })).toBeTruthy();
  });
});
