import { describe, expect, it } from 'vitest';
import { joinStops } from './animalFoodGate';

describe('joinStops', () => {
  it('says the way out once, at the end', () => {
    const text = joinStops(
      [
        'These eggs are in withdrawal. Save as discarded instead.',
        "We don't have the grazing time on file. Save as discarded instead."
      ],
      'Save as discarded instead.'
    );
    expect(text).toBe(
      "These eggs are in withdrawal. We don't have the grazing time on file. Save as discarded instead."
    );
    expect(text.match(/Save as discarded/g)).toHaveLength(1);
  });

  it('leaves messages without the way out alone', () => {
    expect(joinStops(['A.', 'B.'], 'Save as discarded instead.')).toBe('A. B.');
  });
});
