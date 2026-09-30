import { describe, expect, it } from 'vitest';
import { buildPlantingWindowPrompt } from './aiPlantingWindow';

const baseline = {
  earliest: '2027-01-01',
  prime: '2027-01-01',
  latest: '2027-10-01',
  note: 'No frost limit for this bed.'
};

describe('buildPlantingWindowPrompt', () => {
  it('never claims a heated greenhouse for a bed that is frost-free from cover shifts', () => {
    const prompt = buildPlantingWindowPrompt({
      cropPluginId: 'tomato',
      cropName: 'Tomato',
      cropFamily: 'solanaceae',
      dtmMaxDays: 80,
      soilTempMinF: null,
      year: 2027,
      frost: { lastSpring: '2027-01-01', firstFall: '2027-12-31', frostFree: true },
      coverNote: 'Covered: no frost limit with these cover shifts.',
      latLon: null,
      baseline
    });
    expect(prompt).not.toMatch(/in a heated greenhouse/);
    expect(prompt).toMatch(/no frost limit/);
  });
});
