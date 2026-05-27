/**
 * @vitest-environment jsdom
 *
 * Sprint 9 / Phase 27E (#181) — verify TreeFruitMultiPick surfaces
 * the prior-pick count + family pass guidance.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import TreeFruitMultiPick from './TreeFruitMultiPick.svelte';

const baseProps = {
  plantingId: 'p1',
  blockId: 'b1',
  blockName: 'Orchard A',
  cropPluginId: 'apple-honeycrisp',
  varietyDisplayName: 'Honeycrisp',
  cropFamily: 'pome',
  plantingDate: 0,
  harvestIndicators: [],
  onCommit: async () => null,
  onCancel: () => {}
};

describe('TreeFruitMultiPick — Sprint 9 enrichment', () => {
  it('shows "Pick 1 of ~3" for first pass of an apple', () => {
    const { container } = render(TreeFruitMultiPick, {
      ...baseProps,
      rendererData: { priorPickCount: 0 } as never
    });
    expect(container.textContent).toMatch(/Pick 1 of ~3/);
    expect(container.textContent).toMatch(/this pass/);
  });

  it('marks prior passes as logged on second pick', () => {
    const { container } = render(TreeFruitMultiPick, {
      ...baseProps,
      rendererData: { priorPickCount: 1 } as never
    });
    expect(container.textContent).toMatch(/Pick 2 of ~3/);
    const done = container.querySelectorAll('.pass-list li.done');
    expect(done.length).toBe(1);
  });

  it('renders without family-specific guidance when family is unknown', () => {
    const { container } = render(TreeFruitMultiPick, {
      ...baseProps,
      cropFamily: undefined,
      rendererData: { priorPickCount: 0 } as never
    });
    // Should still show "Pick 1" but no "of ~N" suffix and no pass list
    expect(container.textContent).toMatch(/Pick 1/);
    expect(container.textContent).not.toMatch(/of ~/);
  });
});
