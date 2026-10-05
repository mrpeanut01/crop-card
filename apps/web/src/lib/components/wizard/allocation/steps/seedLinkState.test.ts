import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeedLinkState } from './seedLinkState.svelte';
import type { AllocationWizardState } from '../wizardState.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(pluginId: string) {
  return new Response(
    JSON.stringify({ candidates: [{ source: 'local', candidate: { pluginId } }] }),
    { status: 200 }
  );
}

const ids = (s: SeedLinkState) =>
  s.linkResults.map(
    (r) => (r as unknown as { candidate: { pluginId: string } }).candidate.pluginId
  );

describe('SeedLinkState link search', () => {
  it('keeps the newest answer when an older one arrives late', async () => {
    const releases: Array<() => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        const q = JSON.parse(String(init.body)).query as string;
        await new Promise<void>((r) => releases.push(r));
        return answer(q);
      })
    );
    const s = new SeedLinkState({ props: {} } as unknown as AllocationWizardState);
    s.openLinkPicker('a');
    const first = s.runLinkSearch('tom');
    const second = s.runLinkSearch('tomato');
    releases[1]();
    await second;
    releases[0]();
    await first;
    expect(ids(s)).toEqual(['tomato']);
    expect(s.linkSearching).toBe(false);
  });

  it('drops an answer for a picker that was closed', async () => {
    let release!: () => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await new Promise<void>((r) => (release = r));
        return answer('late');
      })
    );
    const s = new SeedLinkState({ props: {} } as unknown as AllocationWizardState);
    s.openLinkPicker('a');
    const p = s.runLinkSearch('tom');
    s.openLinkPicker('b');
    release();
    await p;
    expect(s.linkResults).toEqual([]);
  });
});
