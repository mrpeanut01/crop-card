import { describe, expect, it } from 'vitest';
import { buildEquipmentCard, buildEquipmentCards, needsDecon } from './equipment';
import { sampleGearSnapshot } from './fixturesGear';

const fact = (card: ReturnType<typeof buildEquipmentCard>, label: string) =>
  card?.facts.find((f) => f.label === label)?.value;

describe('buildEquipmentCard', () => {
  const snap = sampleGearSnapshot();

  it('shows calibration, tank, last decon and a decon-due load for a dirty sprayer', () => {
    const card = buildEquipmentCard(snap, 'eq_boom')!;
    expect(card.kind).toBe('equipment');
    expect(card.key).toBe('eq_eq_boom');
    expect(card.kicker).toBe('Equipment · Sprayer');
    expect(card.title).toBe('50-gal boom');
    expect(fact(card, 'Calibration')).toBe('20 GPA');
    expect(fact(card, 'Calibrated')).toBe('Apr 2');
    expect(fact(card, 'Tank')).toBe('50 gal');
    expect(fact(card, 'Last decon')).toBe('None on record');
    expect(fact(card, 'Last load')).toBe('sulfonylurea, decon due');
    expect(card.next).toEqual({ label: 'Run decon', href: '/spray/decon?sprayer=eq_boom' });
  });

  it('asks an uncalibrated sprayer to calibrate', () => {
    const card = buildEquipmentCard(snap, 'eq_pack')!;
    expect(fact(card, 'Calibration')).toBe('Not calibrated');
    expect(fact(card, 'Calibrated')).toBeUndefined();
    expect(card.next?.href).toBe('/calibrate');
  });

  it('lists equipment tasks and uses the first as the next action for other gear', () => {
    const s = sampleGearSnapshot({
      tasks: [
        {
          id: 't_grease',
          title: 'Grease the seeder',
          category: 'other',
          scheduledFor: Date.parse('2026-06-03T12:00:00Z'),
          cropId: null,
          blockId: null,
          equipmentId: 'eq_planter'
        },
        {
          id: 't_belt',
          title: 'Check belts',
          category: 'other',
          scheduledFor: Date.parse('2026-06-09T12:00:00Z'),
          cropId: null,
          blockId: null,
          equipmentId: 'eq_planter'
        }
      ]
    });
    const card = buildEquipmentCard(s, 'eq_planter')!;
    expect(card.kicker).toBe('Equipment · Planter');
    expect(card.facts).toEqual([]);
    expect(card.next?.label).toBe('Grease the seeder');
    expect(card.sections[0]).toEqual({ title: 'Coming up', items: ['Check belts (due Jun 9)'] });
  });

  it('needsDecon is false once a decon follows the last use', () => {
    const e = snap.equipment[0];
    expect(needsDecon(e)).toBe(true);
    expect(needsDecon({ ...e, state: { ...e.state!, lastDeconAt: e.state!.lastUsedAt } })).toBe(
      false
    );
    expect(needsDecon(snap.equipment[2])).toBe(false);
  });

  it('builds one card per piece of equipment and null for unknown ids', () => {
    expect(buildEquipmentCards(snap).map((c) => c.key)).toEqual([
      'eq_eq_boom',
      'eq_eq_pack',
      'eq_eq_planter'
    ]);
    expect(buildEquipmentCard(snap, 'nope')).toBeNull();
  });
});
