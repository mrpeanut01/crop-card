/**
 * @vitest-environment jsdom
 *
 * Sprint 7 / Phase 27C — CropPluginDetail formatField fix for #237.
 *
 * The pre-Phase-27 /plugins/[id] route rendered `postHarvestCuring.durationWeeks`
 * (a {min, max} range object) as the literal string "[object Object]". The
 * `formatField()` helper now expands range-shaped objects into readable
 * text before render. This test locks the formatter behaviour.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import CropPluginDetail from './CropPluginDetail.svelte';

const basePlugin = {
  pluginId: 'tomato-cherokee-purple',
  displayName: 'Tomato — Cherokee Purple',
  cropFamily: 'solanaceae',
  archetype: 'continuous-harvest-fruit',
  daysToMaturity: { min: 80, max: 85 },
  varieties: [],
  growthStages: [],
  pests: [],
  diseases: []
};

describe('CropPluginDetail — Phase 27C', () => {
  it('renders the plugin id + display name + resolved archetype', () => {
    const { getByText, getAllByText } = render(CropPluginDetail, {
      plugin: basePlugin,
      resolvedArchetype: 'continuous-harvest-fruit',
      hash: 'abc123'
    });
    expect(getByText('Tomato — Cherokee Purple')).toBeInTheDocument();
    // pluginId is shown in the header subline AND in the InvKVP body.
    expect(getAllByText('tomato-cherokee-purple').length).toBeGreaterThanOrEqual(1);
    // Both declared + resolved archetype rows render with the value.
    expect(getAllByText('continuous-harvest-fruit').length).toBeGreaterThanOrEqual(1);
  });

  it('formats {min, max} ranges instead of "[object Object]" (#237 fix)', () => {
    const { container } = render(CropPluginDetail, {
      plugin: {
        ...basePlugin,
        postHarvestCuring: {
          method: 'field-cure',
          durationWeeks: { min: 2, max: 3 },
          targetMoisturePercent: { min: 12, max: 14, unit: '%' },
          storageLocation: 'cold-cellar'
        }
      } as never,
      resolvedArchetype: 'continuous-harvest-fruit',
      hash: 'abc123'
    });
    const text = container.textContent ?? '';
    expect(text).not.toContain('[object Object]');
    expect(text).toContain('2–3');
    expect(text).toContain('12–14 %');
    expect(text).toContain('field-cure');
  });

  it('renders the kernel-locked archetype + PHI rows with the lock badge', () => {
    const { container } = render(CropPluginDetail, {
      plugin: { ...basePlugin, preHarvestIntervalDays: 7 } as never,
      resolvedArchetype: 'continuous-harvest-fruit',
      hash: 'abc'
    });
    // .locked class is the visual signal applied to InvKVP tone="locked".
    expect(container.querySelectorAll('.inv-kvp.locked').length).toBeGreaterThanOrEqual(2);
  });

  it('truncates varieties beyond 12 with a "more" tail', () => {
    const varieties = Array.from({ length: 20 }, (_, i) => `variety-${i}`);
    const { getByText } = render(CropPluginDetail, {
      plugin: { ...basePlugin, varieties } as never,
      resolvedArchetype: 'continuous-harvest-fruit',
      hash: 'abc'
    });
    expect(getByText(/and 8 more/)).toBeInTheDocument();
  });
});
