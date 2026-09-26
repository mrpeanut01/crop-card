import { describe, it, expect } from 'vitest';
import type { CalendarEvent } from '$lib/calendar/engine';
import {
  blockHarvestWindowLabel,
  blockStatus,
  blockStatusTone,
  currentStageLabel,
  fmtAcres,
  plantingHarvestLabel,
  plantingRoleLabel,
  plantingStatus
} from './planV2Derive';

const DAY = 24 * 60 * 60 * 1000;
const PLANT = Date.UTC(2026, 4, 1, 12);

function stage(code: string, name: string, startDay: number, endDay: number): CalendarEvent {
  return {
    kind: 'stage-window',
    blockId: 'b1',
    cropId: 'p1',
    cropPluginId: 'corn',
    varietyDisplayName: 'Bloody Butcher',
    startMs: PLANT + startDay * DAY,
    endMs: PLANT + endDay * DAY,
    title: `${code} — ${name}`,
    detail: { stageCode: code, stageName: name }
  };
}

const STAGES = [stage('VE', 'Emergence', 7, 12), stage('V6', 'Six leaf', 13, 40)];
const planting = { id: 'p1', plantingDate: PLANT };

describe('plantingStatus', () => {
  it('undated or future plantings are planned', () => {
    expect(plantingStatus(null, 90, PLANT)).toBe('planned');
    expect(plantingStatus(PLANT + DAY, 90, PLANT)).toBe('planned');
  });
  it('active inside DTM, mature past it', () => {
    expect(plantingStatus(PLANT, 90, PLANT + 30 * DAY)).toBe('active');
    expect(plantingStatus(PLANT, 90, PLANT + 91 * DAY)).toBe('mature');
    expect(plantingStatus(PLANT, undefined, PLANT + 400 * DAY)).toBe('active');
  });
});

describe('plantingRoleLabel', () => {
  it('maps group roles and defaults to Primary', () => {
    expect(plantingRoleLabel({ groupRole: 'anchor' })).toBe('Anchor');
    expect(plantingRoleLabel({ groupRole: 'companion' })).toBe('Companion');
    expect(plantingRoleLabel({})).toBe('Primary');
  });
});

describe('currentStageLabel (#121)', () => {
  it('returns the stage window containing now', () => {
    expect(currentStageLabel(STAGES, planting, PLANT + 20 * DAY)).toBe('V6 · Six leaf');
    expect(currentStageLabel(STAGES, planting, PLANT + 8 * DAY)).toBe('VE · Emergence');
  });
  it('pre-emergence between planting and the first stage', () => {
    expect(currentStageLabel(STAGES, planting, PLANT + 2 * DAY)).toBe('Pre-emergence');
  });
  it('not yet planted before the planting date', () => {
    expect(currentStageLabel(STAGES, planting, PLANT - DAY)).toBe('Not yet planted');
  });
  it('last stage flagged past after the table ends', () => {
    expect(currentStageLabel(STAGES, planting, PLANT + 60 * DAY)).toBe('V6 · Six leaf (past)');
  });
  it('undefined without a stage table, a date, or for another planting', () => {
    expect(currentStageLabel([], planting, PLANT + 20 * DAY)).toBeUndefined();
    expect(currentStageLabel(STAGES, { id: 'p1', plantingDate: null })).toBeUndefined();
    expect(currentStageLabel(STAGES, { id: 'p2', plantingDate: PLANT }, PLANT)).toBeUndefined();
  });
});

describe('blockHarvestWindowLabel', () => {
  const hw = (s: number, e: number): CalendarEvent => ({
    ...STAGES[0],
    kind: 'harvest-window',
    startMs: PLANT + s * DAY,
    endMs: PLANT + e * DAY
  });
  it('spans the open harvest windows', () => {
    const label = blockHarvestWindowLabel([hw(90, 100), hw(110, 120)], PLANT);
    expect(label).toBe('Jul 30 – Aug 29');
  });
  it('drops closed windows and returns undefined when none remain', () => {
    expect(blockHarvestWindowLabel([hw(10, 20)], PLANT + 30 * DAY)).toBeUndefined();
    expect(blockHarvestWindowLabel(STAGES, PLANT)).toBeUndefined();
  });
  it('keeps a UTC-midnight calendar date on its own day', () => {
    const midnight = Date.UTC(2026, 6, 30);
    const ev: CalendarEvent = { ...hw(0, 0), startMs: midnight, endMs: midnight };
    expect(blockHarvestWindowLabel([ev], midnight)).toBe('Jul 30');
  });
});

describe('plantingHarvestLabel', () => {
  it('uses the earliest harvest-window start for the planting', () => {
    const hw = (cropId: string, s: number): CalendarEvent => ({
      ...STAGES[0],
      cropId,
      kind: 'harvest-window',
      startMs: PLANT + s * DAY,
      endMs: PLANT + (s + 10) * DAY
    });
    expect(plantingHarvestLabel([hw('p1', 120), hw('p1', 90), hw('p2', 10)], 'p1')).toBe('Jul 30');
    expect(plantingHarvestLabel(STAGES, 'p1')).toBeUndefined();
  });
});

describe('fmtAcres', () => {
  it('rounds geometry-derived acreage to two decimals', () => {
    expect(fmtAcres(2.3763436061801007)).toBe('2.38 ac');
    expect(fmtAcres(0.5)).toBe('0.5 ac');
    expect(fmtAcres(2)).toBe('2 ac');
  });
  it('renders hectares for metric users', () => {
    expect(fmtAcres(2.471053814671653, { units: 'metric' })).toBe('1 ha');
    expect(fmtAcres(10, { units: 'metric' })).toBe('4.05 ha');
  });
});

describe('blockStatus', () => {
  it('aggregates planting statuses', () => {
    expect(blockStatus([])).toBe('empty');
    expect(blockStatus(['planned', 'active'])).toBe('active');
    expect(blockStatus(['mature', 'mature'])).toBe('mature');
    expect(blockStatus(['planned', 'mature'])).toBe('planned');
    expect(blockStatusTone('active')).toBe('forest');
    expect(blockStatusTone('planned')).toBe('sky');
    expect(blockStatusTone('empty')).toBe('neutral');
  });
});
