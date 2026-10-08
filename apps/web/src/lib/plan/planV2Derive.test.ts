import { describe, it, expect } from 'vitest';
import type { CalendarEvent } from '$lib/calendar/engine';
import type { BlockWithPlantings, PlantingRecord } from '$lib/db/blocks';
import { growingFacts, planBlockCard, planPlantingCard } from './planCards';
import {
  blockCompanions,
  blocksOnView,
  defaultStandingPlanting,
  plantingOnView,
  blockHarvestWindowLabel,
  blockStatus,
  blockStatusTone,
  currentStageLabel,
  fmtAcres,
  plantingHarvestLabel,
  plantingRoleLabel,
  plantingStatus,
  scheduledTaskTiming
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
  it("spans each planting's current harvest window", () => {
    const other = (s: number, e: number): CalendarEvent => ({ ...hw(s, e), cropId: 'p2' });
    const label = blockHarvestWindowLabel([hw(90, 100), hw(400, 410), other(110, 120)], PLANT);
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
  const hw = (cropId: string, s: number): CalendarEvent => ({
    ...STAGES[0],
    cropId,
    kind: 'harvest-window',
    startMs: PLANT + s * DAY,
    endMs: PLANT + (s + 10) * DAY
  });
  it('uses the next harvest-window start for the planting', () => {
    expect(
      plantingHarvestLabel([hw('p1', 120), hw('p1', 90), hw('p2', 10)], 'p1', null, PLANT)
    ).toBe('Jul 30');
    expect(plantingHarvestLabel(STAGES, 'p1', null, PLANT)).toBeUndefined();
  });
  it('uses the window open now over an earlier closed one (#680)', () => {
    const events = [hw('p1', 90), hw('p1', 455)];
    expect(plantingHarvestLabel(events, 'p1', null, PLANT + 460 * DAY)).toBe(
      plantingHarvestLabel([hw('p1', 455)], 'p1', null, PLANT)
    );
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

describe('scheduledTaskTiming', () => {
  const NY = { timeZone: 'America/New_York', units: 'us' as const };

  it('labels a timed evening task by its local day, not the UTC day', () => {
    const due = Date.UTC(2026, 9, 6, 3, 30);
    const now = Date.UTC(2026, 9, 5, 14);
    const r = scheduledTaskTiming(due, now, NY);
    expect(r.dateLabel).toMatch(/Oct 5/);
    expect(r.status).toBe('today');
  });

  it('keeps a date-only task on its stored day and does not call tomorrow today', () => {
    const due = Date.UTC(2026, 9, 6);
    const now = Date.UTC(2026, 9, 5, 14);
    const r = scheduledTaskTiming(due, now, NY);
    expect(r.dateLabel).toMatch(/Oct 6/);
    expect(r.status).toBe('scheduled');
  });

  it('marks a task from yesterday overdue even within 24 hours', () => {
    const due = Date.UTC(2026, 9, 4);
    const now = Date.UTC(2026, 9, 5, 14);
    expect(scheduledTaskTiming(due, now, NY).status).toBe('overdue');
  });
});

describe('/plan shows the current plantings of a rotation block (#623)', () => {
  const NOW = Date.UTC(2026, 9, 7, 15);
  const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);
  function p(
    id: string,
    cropPluginId: string,
    plantingDate: number | null,
    status: PlantingRecord['status'],
    extra: Partial<PlantingRecord> = {}
  ): PlantingRecord {
    return {
      id,
      blockId: 'nfa',
      cropPluginId,
      varietyDisplayName: id,
      plantingDate,
      status,
      ...extra
    };
  }
  const soy25 = p('soy25', 'soybean', D(2025, 5, 15), 'harvested', {
    harvestedAt: D(2025, 10, 1)
  });
  const corn26 = p('corn26', 'corn', D(2026, 5, 1), 'harvested', { harvestedAt: D(2026, 9, 20) });
  const rye = p('rye', 'rye-cover', D(2026, 10, 3), 'active');
  const soy27 = p('soy27', 'soybean', D(2027, 5, 15), 'planned');
  const block = {
    id: 'nfa',
    name: 'North Field A',
    plantings: [soy25, corn26, rye, soy27]
  } as unknown as BlockWithPlantings;
  const DTM: Record<string, number> = { soybean: 110, corn: 115, 'rye-cover': 200 };
  const dtm = (id: string) => DTM[id];
  const termination: CalendarEvent = {
    kind: 'cover-termination',
    blockId: 'nfa',
    cropId: 'rye',
    cropPluginId: 'rye-cover',
    varietyDisplayName: 'rye',
    startMs: D(2027, 4, 15),
    endMs: D(2027, 5, 1),
    title: 'Terminate rye'
  };

  it('reads the stored status before the dates', () => {
    expect(plantingStatus(corn26.plantingDate, 115, NOW, 'harvested')).toBe('harvested');
    expect(plantingStatus(D(2026, 5, 1), 115, NOW, 'failed')).toBe('ended');
    expect(plantingStatus(D(2026, 5, 1), 115, NOW, 'archived')).toBe('ended');
    expect(plantingStatus(D(2026, 5, 1), 115, NOW, 'active')).toBe('mature');
  });

  it('leaves out harvested annuals and keeps a harvested perennial standing', () => {
    expect(plantingOnView(corn26)).toBe(false);
    expect(plantingOnView({ status: 'failed' }, true)).toBe(false);
    expect(plantingOnView({ status: 'harvested' }, true)).toBe(true);
    const { blocks, endedCount } = blocksOnView([block]);
    expect(blocks[0].plantings.map((x) => x.id)).toEqual(['rye', 'soy27']);
    expect(endedCount.get('nfa')).toBe(2);
    const orchard = blocksOnView([block], (id) => id === 'corn');
    expect(orchard.blocks[0].plantings.map((x) => x.id)).toEqual(['corn26', 'rye', 'soy27']);
  });

  it('gives a rotation no companions', () => {
    const map = blockCompanions([rye, soy27], [termination], dtm);
    expect(map.get('rye')).toEqual([]);
    expect(map.get('soy27')).toEqual([]);
  });

  it('pairs plantings that share time in the ground, or a planned group', () => {
    const a = p('a', 'corn', D(2026, 5, 1), 'active');
    const b = p('b', 'soybean', D(2026, 5, 20), 'active');
    const c = p('c', 'soybean', D(2026, 10, 1), 'planned');
    const map = blockCompanions([a, b, c], [], dtm);
    expect(map.get('a')!.map((x) => x.id)).toEqual(['b']);
    expect(map.get('c')).toEqual([]);
    const g1 = p('g1', 'corn', D(2026, 5, 1), 'active', { groupRole: 'anchor' });
    const g2 = p('g2', 'squash', D(2026, 10, 1), 'planned', { groupRole: 'companion' });
    expect(
      blockCompanions([g1, g2], [], dtm)
        .get('g1')!
        .map((x) => x.id)
    ).toEqual(['g2']);
  });

  it('labels the block card from what is on view', () => {
    const { blocks } = blocksOnView([block]);
    const card = planBlockCard(
      blocks[0],
      new URLSearchParams(),
      'nf',
      { 'rye-cover': 200 },
      undefined,
      NOW
    );
    expect(card.status?.label).toBe('active');
    const facts = growingFacts([corn26, rye, soy27], NOW);
    expect(facts[0].value).toBe('corn26 · rye');
    expect(facts[1].value).toBe('soy27');
    const failed = growingFacts([p('x', 'corn', D(2026, 5, 1), 'failed')], NOW);
    expect(failed[0].value).not.toContain('x');
  });

  it('shows a harvested planting as harvested on its card', () => {
    const card = planPlantingCard({ planting: corn26, daysToMaturity: 115, now: NOW });
    expect(card.status?.label).toBe('harvested');
  });

  it('opens a one-planting page on the planting in the ground', () => {
    expect(defaultStandingPlanting([soy27, rye], NOW)?.id).toBe('rye');
    expect(defaultStandingPlanting([soy27], NOW)?.id).toBe('soy27');
    expect(defaultStandingPlanting([], NOW)).toBeUndefined();
  });
});
