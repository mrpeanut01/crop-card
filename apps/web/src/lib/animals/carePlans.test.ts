import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CARE_PLAN_KINDS,
  CARE_TO_HEALTH_KIND,
  addDaysYmd,
  careAlertText,
  careMetaJson,
  careTaskId,
  careTemplateKey,
  defaultLeadDays,
  horizonDays,
  isHoldBearingCare,
  isSurfaced,
  nextDueAfterDone,
  nextDueAfterSkip,
  parseCareMeta,
  rollupCareTasks,
  surfaceOn,
  undatedPrompt
} from './carePlans';
import { HOLD_BEARING_KINDS } from '$lib/safety/animalWithdrawal';

describe('care plan vocabulary (D0-4)', () => {
  it('maps hold-bearing kinds and vet visits to a health event, husbandry to none', () => {
    expect(CARE_TO_HEALTH_KIND.vaccination).toBe('vaccination');
    expect(CARE_TO_HEALTH_KIND.deworm).toBe('deworm');
    expect(CARE_TO_HEALTH_KIND.treatment).toBe('treatment');
    expect(CARE_TO_HEALTH_KIND['vet-visit']).toBe('vet-visit');
    for (const k of ['hoof-trim', 'grooming', 'shearing', 'health-check', 'other'] as const) {
      expect(CARE_TO_HEALTH_KIND[k]).toBeNull();
    }
  });

  it('every care kind whose health event bears a hold needs the health form', () => {
    for (const k of CARE_PLAN_KINDS) {
      const health = CARE_TO_HEALTH_KIND[k];
      expect(isHoldBearingCare(k)).toBe(health !== null && HOLD_BEARING_KINDS.includes(health));
    }
  });

  it('shows vaccines two weeks ahead and everything else three days ahead (D2-10)', () => {
    expect(defaultLeadDays('vaccination')).toBe(14);
    expect(defaultLeadDays('hoof-trim')).toBe(3);
    expect(horizonDays(3)).toBe(30);
    expect(horizonDays(45)).toBe(45);
  });
});

describe('task keys (D0-1)', () => {
  it('derives one id per plan and due day', () => {
    expect(careTaskId('p1', '2026-10-05')).toBe('tk_care_p1_20261005');
    expect(careTemplateKey('p1', '2026-10-05')).toBe('care:p1:2026-10-05');
  });

  it('round-trips the task metadata and rejects anything else', () => {
    const meta = {
      subjectType: 'animal' as const,
      subjectId: 'a1',
      planId: 'p1',
      dueOn: '2026-10-05',
      careKind: 'vaccination' as const,
      leadDays: 14
    };
    expect(parseCareMeta(careMetaJson(meta))).toEqual({ care: 1, ...meta });
    expect(parseCareMeta(null)).toBeNull();
    expect(parseCareMeta('{"freq":"weekly"}')).toBeNull();
    expect(parseCareMeta(careMetaJson({ ...meta, dueOn: 'soon' }))).toBeNull();
    expect(parseCareMeta('not json')).toBeNull();
  });
});

describe('rolling forward (D0-3)', () => {
  it('Done rolls from the day it was done; Skip from the day it was due', () => {
    const plan = { intervalDays: 365, onceOn: null };
    expect(nextDueAfterDone(plan, '2026-10-09')).toBe('2027-10-09');
    expect(nextDueAfterSkip(plan, '2026-10-05')).toBe('2027-10-05');
  });

  it('a one-off plan ends', () => {
    const once = { intervalDays: null, onceOn: '2026-10-05' };
    expect(nextDueAfterDone(once, '2026-10-05')).toBeNull();
    expect(nextDueAfterSkip(once, '2026-10-05')).toBeNull();
  });

  it('the next due day is always after the day it was done', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3650 }),
        fc.integer({ min: 0, max: 20000 }),
        (interval, offset) => {
          const done = addDaysYmd('2000-01-01', offset);
          const next = nextDueAfterDone({ intervalDays: interval, onceOn: null }, done)!;
          expect(next > done).toBe(true);
        }
      )
    );
  });
});

describe('surfacing', () => {
  it('surfaces lead days before the due day', () => {
    const meta = { dueOn: '2026-10-20', leadDays: 14 };
    expect(surfaceOn(meta)).toBe('2026-10-06');
    expect(isSurfaced(meta, '2026-10-05')).toBe(false);
    expect(isSurfaced(meta, '2026-10-06')).toBe(true);
  });
});

describe('wording (D0-16)', () => {
  it('names the animal and the care kind, never the plan title or a product', () => {
    const soon = careAlertText('vaccination', 'Rex', 'soon', 3);
    expect(soon.title).toBe('Vaccine coming up: Rex');
    expect(soon.body).toBe('Vaccine for Rex is due in 3 days.');
    const due = careAlertText('deworm', 'Herd A', 'due', 0);
    expect(due.title).toBe('Wormer due today: Herd A');
    expect(careAlertText('grooming', 'Rex', 'soon', 1).body).toContain('tomorrow');
  });

  it('asks for the last date of an undated plan (D2-09)', () => {
    expect(undatedPrompt('Rabies vaccine', 'Rex')).toBe("When was Rex's last rabies vaccine?");
  });
});

describe('group roll-up (D2-11)', () => {
  const meta = (subjectId: string, careKind: 'deworm' | 'hoof-trim', dueOn = '2026-10-05') => ({
    care: 1 as const,
    subjectType: 'animal' as const,
    subjectId,
    planId: `p-${subjectId}-${careKind}`,
    dueOn,
    careKind,
    leadDays: 3
  });

  it('rolls same-kind, same-day tasks of one group into one card', () => {
    const tasks = [
      { taskId: 't1', meta: meta('g1', 'deworm'), memberOfGroupId: 'herd' },
      { taskId: 't2', meta: meta('g2', 'deworm'), memberOfGroupId: 'herd' },
      { taskId: 't3', meta: meta('g3', 'hoof-trim'), memberOfGroupId: 'herd' },
      { taskId: 't4', meta: meta('g4', 'deworm', '2026-10-06'), memberOfGroupId: 'herd' },
      { taskId: 't5', meta: meta('rex', 'deworm'), memberOfGroupId: null }
    ];
    const cards = rollupCareTasks(tasks);
    expect(cards.map((c) => c.items.map((i) => i.taskId))).toEqual([
      ['t1', 't2'],
      ['t3'],
      ['t5'],
      ['t4']
    ]);
    expect(cards[0].groupId).toBe('herd');
    expect(cards[2].groupId).toBeNull();
  });
});
