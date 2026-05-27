/**
 * @vitest-environment jsdom
 *
 * Sprint 9 / Phase 27E (#230) — verify the forage renderer reads
 * plugin-derived hayOperations and surfaces cut count, regrowth window,
 * and bale moisture danger thresholds.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ForageCuttingCycle from './ForageCuttingCycle.svelte';

const baseProps = {
  plantingId: 'p1',
  blockId: 'b1',
  blockName: 'East 40',
  cropPluginId: 'alfalfa-vernal',
  varietyDisplayName: 'Vernal alfalfa',
  cropFamily: 'forage',
  plantingDate: 0,
  harvestIndicators: [],
  onCommit: async () => null,
  onCancel: () => {}
};

describe('ForageCuttingCycle — Sprint 9 enrichment', () => {
  it('renders without rendererData (back-compat)', () => {
    const { container } = render(ForageCuttingCycle, baseProps);
    expect(container.textContent).toMatch(/forage|hay|cut/i);
  });

  it('surfaces cutting count + interval when hayOperations is provided', () => {
    const { container } = render(ForageCuttingCycle, {
      ...baseProps,
      rendererData: {
        hayOperations: {
          steps: ['mow', 'rake', 'bale', 'store'],
          cuttingsPerSeason: { min: 3, max: 4 },
          cutIntervalDays: { min: 28, max: 35 },
          weatherWindowDays: 3
        },
        priorPickCount: 1
      } as never
    });
    // After 1 prior pick, we're on cut 2 of 3–4 per season (en-dash via fmtRange)
    expect(container.textContent).toMatch(/2 of 3–4/);
    expect(container.textContent).toMatch(/28–35 d/);
  });

  it('flags small-square bale moisture danger threshold', () => {
    const { container } = render(ForageCuttingCycle, {
      ...baseProps,
      rendererData: {
        hayOperations: {
          steps: ['mow', 'rake', 'bale', 'store'],
          weatherWindowDays: 3,
          baleMoistureGate: {
            'small-square': { dangerAbovePct: 22 }
          }
        },
        priorPickCount: 0
      } as never
    });
    expect(container.textContent).toMatch(/small-square/);
    expect(container.textContent).toMatch(/>22%/);
  });
});
