/**
 * @vitest-environment jsdom
 *
 * Sprint 9 / Phase 27E — verify SmallGrainZadoks reads plugin
 * zadoksStages + moistureGates and highlights the current stage
 * relative to days-from-planting.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SmallGrainZadoks from './SmallGrainZadoks.svelte';

const DAY_MS = 24 * 60 * 60 * 1000;

const baseProps = {
  plantingId: 'p1',
  blockId: 'b1',
  blockName: 'North 10',
  cropPluginId: 'wheat-redeemer',
  varietyDisplayName: 'Redeemer winter wheat',
  cropFamily: 'cereal-grain',
  plantingDate: 0,
  harvestIndicators: [],
  onCommit: async () => null,
  onCancel: () => {}
};

describe('SmallGrainZadoks — Sprint 9 enrichment', () => {
  it('renders without rendererData (back-compat)', () => {
    const { container } = render(SmallGrainZadoks, baseProps);
    expect(container.textContent).toMatch(/Small-grain|Zadoks|Z89/);
  });

  it('renders Zadoks stage list when zadoksStages is provided', () => {
    const { container } = render(SmallGrainZadoks, {
      ...baseProps,
      plantingDate: Date.now() - 100 * DAY_MS,
      rendererData: {
        zadoksStages: [
          { stage: 'Z10', name: 'Emergence', daysFromPlanting: { min: 5, max: 15 } },
          { stage: 'Z30', name: 'Stem elongation', daysFromPlanting: { min: 60, max: 120 } },
          { stage: 'Z89', name: 'Full ripeness', daysFromPlanting: { min: 200, max: 260 } }
        ],
        priorPickCount: 0
      } as never
    });
    expect(container.textContent).toMatch(/Z10/);
    expect(container.textContent).toMatch(/Z89/);
    expect(container.textContent).toMatch(/Full ripeness/);
    // currentStage at day 100 → Z30
    const current = container.querySelector('.stage-list li.current');
    expect(current?.textContent).toMatch(/Z30/);
  });

  it('does not flag stem-elongation range stage as harvest window (#268)', () => {
    const { container } = render(SmallGrainZadoks, {
      ...baseProps,
      plantingDate: Date.now() - 80 * DAY_MS,
      rendererData: {
        zadoksStages: [
          { stage: 'Z10', name: 'Emergence', daysFromPlanting: { min: 5, max: 15 } },
          {
            stage: 'Z30-Z89',
            name: 'Stem elongation through ripening',
            daysFromPlanting: { min: 60, max: 200 }
          },
          { stage: 'Z92', name: 'Hard ripe', daysFromPlanting: { min: 210, max: 240 } }
        ],
        priorPickCount: 0
      } as never
    });
    const items = Array.from(container.querySelectorAll('.stage-list li'));
    const rangeRow = items.find((li) => li.textContent?.includes('Z30-Z89'));
    const ripeRow = items.find((li) => li.textContent?.includes('Z92'));
    expect(rangeRow?.classList.contains('harvest')).toBe(false);
    expect(ripeRow?.classList.contains('harvest')).toBe(true);
  });

  it('flags Z80+ leading-prefix stages as harvest window', () => {
    const { container } = render(SmallGrainZadoks, {
      ...baseProps,
      rendererData: {
        zadoksStages: [
          { stage: 'Z85', name: 'Soft dough', daysFromPlanting: { min: 180, max: 200 } }
        ],
        priorPickCount: 0
      } as never
    });
    const row = container.querySelector('.stage-list li');
    expect(row?.classList.contains('harvest')).toBe(true);
  });

  it('renders moisture gates with danger threshold', () => {
    const { container } = render(SmallGrainZadoks, {
      ...baseProps,
      rendererData: {
        moistureGates: [
          {
            operation: 'harvest',
            thresholds: {
              dangerAbovePct: 14,
              optimumPercent: { min: 12, max: 13.5 }
            }
          }
        ],
        priorPickCount: 0
      } as never
    });
    expect(container.textContent).toMatch(/STOP/);
    expect(container.textContent).toMatch(/>14%/);
    expect(container.textContent).toMatch(/12–13.5%/);
  });
});
