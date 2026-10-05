import { describe, expect, it } from 'vitest';
import { pollinatorLabelText } from './labelText';

describe('pollinatorLabelText', () => {
  it('reads the label block first', () => {
    expect(
      pollinatorLabelText({
        pollinator: { beeToxicity: 'highly-toxic', bloomRestriction: 'dusk-to-dawn-only' },
        pollinatorRisk: 'high'
      })
    ).toBe('Bees: highly-toxic · dusk-to-dawn-only');
    expect(
      pollinatorLabelText({ pollinator: { beeToxicity: 'unknown', bloomRestriction: 'none' } })
    ).toBe('Bees: unknown');
  });

  it('falls back to the legacy hint, then unknown', () => {
    expect(pollinatorLabelText({ pollinator: null, pollinatorRisk: 'low' })).toBe(
      'Pollinator risk low'
    );
    expect(pollinatorLabelText({})).toBe('Pollinator risk unknown');
  });
});
