import { describe, expect, it } from 'vitest';
import { sizeLabel } from './format';

describe('sizeLabel', () => {
  it('stays in feet by default', () => {
    expect(sizeLabel(4, 8)).toBe('4×8 ft');
    expect(sizeLabel(2.5, 10, 'us')).toBe('2.5×10 ft');
  });

  it('shows metres for a metric viewer', () => {
    expect(sizeLabel(4, 8, 'metric')).toBe('1.2×2.4 m');
    expect(sizeLabel(10, 10, 'metric')).toBe('3×3 m');
  });
});
