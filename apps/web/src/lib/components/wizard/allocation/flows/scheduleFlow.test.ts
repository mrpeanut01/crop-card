import { describe, expect, it } from 'vitest';
import { ScheduleFlow, parseScheduleDay, scheduleDayIso } from './scheduleFlow';
import type { AllocationWizardState } from '../wizardState.svelte';
import type { ScheduleResponse } from '../types';

function fakeWizard() {
  const scheduleResponse: ScheduleResponse = {
    scheduled: [
      {
        stockItemId: 'wheat',
        blockId: 'b1',
        cropPluginId: 'wheat-soft-red-winter',
        varietyDisplayName: 'Wheat',
        plantingDateMs: Date.UTC(2027, 3, 2),
        plants: 100,
        rationale: ''
      },
      {
        stockItemId: 'corn',
        blockId: 'b2',
        cropPluginId: 'corn',
        varietyDisplayName: 'Corn',
        plantingDateMs: Date.UTC(2027, 3, 23),
        plants: 100,
        rationale: ''
      }
    ],
    rationale: '',
    advisories: [],
    meta: { model: 'engine', usdEstimate: 0, fallback: 'no-api-key', aiOff: true }
  };
  const w = { scheduleResponse };
  return { flow: new ScheduleFlow(w as unknown as AllocationWizardState), w };
}

describe('parseScheduleDay', () => {
  it('reads a calendar day as UTC midnight and refuses non-days', () => {
    expect(parseScheduleDay('2026-10-12')).toBe(Date.UTC(2026, 9, 12));
    expect(parseScheduleDay('2026-02-30')).toBeNull();
    expect(parseScheduleDay('')).toBeNull();
    expect(parseScheduleDay('Oct 12')).toBeNull();
    expect(scheduleDayIso(Date.UTC(2026, 9, 12))).toBe('2026-10-12');
  });
});

describe('ScheduleFlow.setPlantingDate (#723)', () => {
  it('stores a typed date as manual and keeps the proposal', () => {
    const { flow, w } = fakeWizard();
    expect(flow.setPlantingDate(0, '2026-10-12')).toBeNull();
    const row = w.scheduleResponse.scheduled[0];
    expect(row.plantingDateMs).toBe(Date.UTC(2026, 9, 12));
    expect(row.dateProvenance).toBe('manual');
    expect(row.proposedDateMs).toBe(Date.UTC(2027, 3, 2));
    expect(w.scheduleResponse.scheduled[1].dateProvenance).toBeUndefined();
    expect(flow.provisionalPlantings()[0].plantingDate).toBe(Date.UTC(2026, 9, 12));
  });

  it('refuses blank, impossible and far-off dates without changing the row', () => {
    const { flow, w } = fakeWizard();
    expect(flow.setPlantingDate(1, '')).toBe('invalid');
    expect(flow.setPlantingDate(1, '2027-13-01')).toBe('invalid');
    expect(flow.setPlantingDate(1, '2030-04-23')).toBe('range');
    expect(w.scheduleResponse.scheduled[1].plantingDateMs).toBe(Date.UTC(2027, 3, 23));
    expect(w.scheduleResponse.scheduled[1].dateProvenance).toBeUndefined();
  });

  it('measures the range from the original proposal after an edit', () => {
    const { flow } = fakeWizard();
    expect(flow.setPlantingDate(1, '2028-04-01')).toBeNull();
    expect(flow.setPlantingDate(1, '2029-03-01')).toBe('range');
  });
});
