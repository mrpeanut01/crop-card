import { describe, expect, it } from 'vitest';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { careGuideCardsFor, photoHelpTargets } from './targets';

describe('photoHelpTargets', () => {
  const snap = sampleSnapshot();

  it('targets the planting itself on a Planting Card, with its care guide', () => {
    const [t, ...rest] = photoHelpTargets(snap, 'pl_p_tom');
    expect(rest).toEqual([]);
    expect(t.cropId).toBe('p_tom');
    expect(t.label).toBe('Cherokee Purple tomato · Bed 3');
    expect(t.careGuide?.key).toBe('cg_tomato-cherokee-purple');
  });

  it('keeps a planting whose plugin is missing, without a care guide', () => {
    const [t] = photoHelpTargets(snap, 'pl_p_alf');
    expect(t.careGuide).toBeNull();
  });

  it('lists the growing and planned plantings of a garden Area only', () => {
    expect(
      photoHelpTargets(snap, 'ar_f_garden')
        .map((t) => t.cropId)
        .sort()
    ).toEqual(['p_bean', 'p_tom']);
    const harvested = sampleSnapshot({
      plantings: snap.plantings.map((p) => ({ ...p, status: 'harvested' as const }))
    });
    expect(photoHelpTargets(harvested, 'ar_f_garden')).toEqual([]);
    expect(photoHelpTargets(snap, 'ar_f_hay')).toEqual([]);
    expect(photoHelpTargets(snap, 'ar_missing')).toEqual([]);
    expect(photoHelpTargets(snap, 'eq_x')).toEqual([]);
    expect(photoHelpTargets(snap, 'garbage')).toEqual([]);
  });

  it('builds care guide cards offline from the snapshot', () => {
    expect(careGuideCardsFor(snap, 'pl_p_tom').map((c) => c.key)).toEqual([
      'cg_tomato-cherokee-purple'
    ]);
    expect(careGuideCardsFor(snap, 'ar_f_garden')).toHaveLength(2);
    expect(careGuideCardsFor(snap, 'ar_f_barn')).toEqual([]);
  });
});
