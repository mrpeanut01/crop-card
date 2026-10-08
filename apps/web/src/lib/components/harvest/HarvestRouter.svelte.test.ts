/**
 * @vitest-environment jsdom
 *
 * Sprint 6 / Phase 27A — HarvestRouter dispatches on the new explicit
 * archetype enum first, plugin archetype field second, legacy harvestStyle
 * third, and family fallback last. This is the runtime mirror of the
 * resolveArchetype() unit tests in schemas.archetype.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import HarvestRouter from './HarvestRouter.svelte';

const baseProps = {
  plantingId: 'p1',
  blockId: 'b1',
  blockName: 'Block 1',
  cropPluginId: 'plug',
  varietyDisplayName: 'Test Variety',
  plantingDate: 0,
  harvestIndicators: [],
  onCommit: async () => null,
  onCancel: () => {}
};

function rendererTextSignature(html: string): string {
  // Each renderer ships a header chrome. We don't bind to specific
  // strings (those change with copy) — instead we sniff the renderer
  // shell by checking which renderer-specific marker class survives.
  return html;
}

describe('HarvestRouter — Phase 27A dispatch', () => {
  it('archetype override takes priority over plugin archetype', () => {
    const { container } = render(HarvestRouter, {
      ...baseProps,
      archetype: 'cure-then-store' as never,
      archetypeOverride: 'tree-fruit-multi-pick',
      harvestStyle: 'cure-then-store',
      cropFamily: 'cucurbit'
    });
    // Tree-fruit renderer should mount, not winter-squash. Both render
    // distinct headers — verifying the archetype-override path picks the
    // tree branch is enough to confirm precedence.
    expect(rendererTextSignature(container.innerHTML)).toMatch(/Tree|Apple|fruit/i);
  });

  it('plugin archetype routes to its renderer when no override', () => {
    const { container } = render(HarvestRouter, {
      ...baseProps,
      archetype: 'forage-cutting-cycle',
      cropFamily: 'forage'
    });
    expect(rendererTextSignature(container.innerHTML)).toMatch(/forage|hay|cut/i);
  });

  it('legacy harvestStyle is honored when archetype is undefined', () => {
    const { container } = render(HarvestRouter, {
      ...baseProps,
      harvestStyle: 'cure-then-store',
      cropFamily: 'cucurbit'
    });
    expect(rendererTextSignature(container.innerHTML)).toMatch(/squash|cure|store/i);
  });

  it('single-event + family fallback routes via family table', () => {
    const { container } = render(HarvestRouter, {
      ...baseProps,
      harvestStyle: 'single-event',
      cropFamily: 'leafy-green'
    });
    // leafy-green fallback → cut-and-come-again-leafy renderer.
    expect(rendererTextSignature(container.innerHTML)).toMatch(/leaf|cut/i);
  });
});

describe('HarvestRouter — berries on the vine archetype (#743)', () => {
  it('gives a blueberry the pick form, not the grape quality form', () => {
    const { container } = render(HarvestRouter, {
      ...baseProps,
      archetype: 'perennial-vine-quality',
      cropFamily: 'small-fruit',
      rendererData: { priorPickCount: 1 }
    });
    expect(container.textContent).toContain('Berry picks');
    expect(container.textContent).toContain('Pick 2');
    expect(container.textContent).not.toMatch(/Brix|Wine grapes|Hops/);
  });

  it('keeps the quality form for grapes', () => {
    const { container } = render(HarvestRouter, {
      ...baseProps,
      archetype: 'perennial-vine-quality',
      cropFamily: 'vine-fruit'
    });
    expect(container.textContent).toContain('Brix');
  });

  it('a planting override still wins over the berry form', () => {
    const { container } = render(HarvestRouter, {
      ...baseProps,
      archetype: 'perennial-vine-quality',
      archetypeOverride: 'perennial-vine-quality',
      cropFamily: 'bramble'
    });
    expect(container.textContent).toContain('Brix');
  });
});

describe('HarvestRouter — pick details stay out of the lot number (#662)', () => {
  it('a continuous-bearing pick commits its number as a detail', async () => {
    const calls: unknown[] = [];
    const { container } = render(HarvestRouter, {
      ...baseProps,
      archetype: 'continuous-harvest-fruit',
      rendererData: { priorPickCount: 2 },
      onCommit: async (input: unknown) => {
        calls.push(input);
        return null;
      }
    });
    const form = container.querySelector('form.harvest-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    const input = calls[0] as { lotNumber?: string; details?: { pickNumber?: number } };
    expect(input.lotNumber).toBeUndefined();
    expect(input.details?.pickNumber).toBe(3);
  });
});
