import { describe, expect, it, vi } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';

vi.mock('./scanResult', () => ({ getApiKey: () => 'sk-test' }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => {
    throw new Error('Claude must not be constructed on the degrade path');
  })
}));

import { refineSchedule, schedulePlantings } from './aiSchedule';

const PLAN_YEAR = new Date().getFullYear() + 1;
const plugin = {
  pluginId: 'corn',
  type: 'crop',
  schemaVersion: '1.0.0',
  displayName: 'Corn',
  cropFamily: 'corn',
  daysToMaturity: { min: 80, max: 90 },
  plantingGuide: { soilTempMinF: 50 }
} as unknown as CropPlugin;
const input = {
  assignments: [
    { stockItemId: 's1', blockId: 'b1', cropPluginId: 'corn', varietyDisplayName: 'G', plants: 10 }
  ],
  pluginIndex: { corn: plugin },
  existingCrops: [],
  pollinationConstraints: [],
  companionGroups: [],
  frostDates: {
    lastSpringFrostMs: new Date(PLAN_YEAR, 3, 15).getTime(),
    firstFallFrostMs: new Date(PLAN_YEAR, 9, 15).getTime()
  },
  year: PLAN_YEAR
};

describe('aiSchedule degradeMessage', () => {
  it('schedulePlantings returns the deterministic schedule with the degrade copy', async () => {
    const r = await schedulePlantings(input, {} as never, { degradeMessage: 'Daily quota hit.' });
    expect(r.meta.fallback).toBe('ai-unavailable');
    expect(r.rationale).toMatch(/^Daily quota hit\./);
    expect(r.scheduled).toHaveLength(1);
  });

  it('refineSchedule echoes the previous schedule with the degrade copy', async () => {
    const previous = [
      {
        ...input.assignments[0],
        plantingDateMs: new Date(PLAN_YEAR, 4, 1).getTime(),
        rationale: ''
      }
    ];
    const r = await refineSchedule(
      {
        ...input,
        previousScheduled: previous,
        previousRationale: 'prev',
        previousAdvisories: [],
        transcript: [{ role: 'user', content: 'move it' }]
      },
      {} as never,
      { degradeMessage: 'Monthly cap reached.' }
    );
    expect(r.meta.fallback).toBe('ai-unavailable');
    expect(r.scheduled).toEqual(previous);
    expect(r.reply).toMatch(/^Monthly cap reached\. The current dates are unchanged\./);
  });
});
