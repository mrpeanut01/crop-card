import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  NO3N_TO_NO3,
  NO3_TO_NO3N,
  convertNitrate,
  nitrateAsTyped,
  nitrateConvertedText
} from './interpret';
import { FORAGE_NITRATE_UNITS, NITRATE_UNIT_LABELS, nitrateUnitLabel } from './model';

describe('convertNitrate (M-59)', () => {
  it('converts ppm nitrate to nitrate-nitrogen by 0.23', () => {
    expect(convertNitrate(1000, 'ppm-nitrate')).toEqual({ ppmNitrate: 1000, ppmNitrateN: 230 });
  });

  it('converts nitrate-nitrogen to nitrate by 4.4', () => {
    expect(convertNitrate(1000, 'ppm-nitrate-n')).toEqual({ ppmNitrate: 4400, ppmNitrateN: 1000 });
  });

  it('converts percent nitrate through 10,000 ppm per percent', () => {
    const c = convertNitrate(0.5, 'pct-nitrate')!;
    expect(c.ppmNitrate).toBe(5000);
    expect(c.ppmNitrateN).toBeCloseTo(1150);
  });

  it('never converts potassium nitrate', () => {
    expect(convertNitrate(1, 'pct-kno3')).toBeNull();
    expect(nitrateConvertedText(1, 'pct-kno3')).toMatch(/^Not converted/);
  });

  it('refuses negative and non-finite values', () => {
    expect(convertNitrate(-1, 'ppm-nitrate')).toBeNull();
    expect(convertNitrate(Number.NaN, 'ppm-nitrate')).toBeNull();
  });

  it('keeps the typed form unchanged and is monotonic', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        fc.constantFrom('ppm-nitrate', 'ppm-nitrate-n', 'pct-nitrate'),
        (a, b, units) => {
          const ca = convertNitrate(a, units)!;
          const cb = convertNitrate(b, units)!;
          if (units === 'ppm-nitrate') expect(ca.ppmNitrate).toBe(a);
          if (units === 'ppm-nitrate-n') expect(ca.ppmNitrateN).toBe(a);
          if (a <= b) {
            expect(ca.ppmNitrate).toBeLessThanOrEqual(cb.ppmNitrate);
            expect(ca.ppmNitrateN).toBeLessThanOrEqual(cb.ppmNitrateN);
          }
        }
      )
    );
  });

  it('labels the typed value and the converted value', () => {
    expect(nitrateAsTyped(1500, 'ppm-nitrate')).toBe('1,500 ppm nitrate (NO3)');
    expect(nitrateConvertedText(1500, 'ppm-nitrate')).toBe(
      'About 345 ppm nitrate-nitrogen (converted)'
    );
    expect(nitrateConvertedText(0.5, 'pct-nitrate')).toBe(
      'About 5,000 ppm nitrate or 1,150 ppm nitrate-nitrogen (converted)'
    );
  });

  it('gives the units and the converted line in Spanish, keeping the English byte-identical (#741)', () => {
    expect(nitrateAsTyped(3500, 'ppm-nitrate', 'en')).toBe(nitrateAsTyped(3500, 'ppm-nitrate'));
    expect(nitrateConvertedText(3500, 'ppm-nitrate', 'en')).toBe(
      nitrateConvertedText(3500, 'ppm-nitrate')
    );
    expect(nitrateAsTyped(3500, 'ppm-nitrate', 'es')).toMatch(/ppm de nitrato \(NO3\)$/);
    const es = nitrateConvertedText(3500, 'ppm-nitrate', 'es');
    expect(es).toMatch(/^Aproximadamente 805 ppm de nitrógeno de nitrato \(convertido\)$/);
    expect(es).not.toMatch(/nitrate/);
    for (const u of FORAGE_NITRATE_UNITS) {
      expect(nitrateUnitLabel(u, 'en')).toBe(NITRATE_UNIT_LABELS[u]);
      expect(nitrateUnitLabel(u, 'es')).not.toBe(NITRATE_UNIT_LABELS[u]);
      expect(nitrateUnitLabel(u, 'es')).toContain(NITRATE_UNIT_LABELS[u].match(/\(([^)]+)\)/)![1]);
    }
  });

  it('uses the two sourced factors', () => {
    expect(NO3_TO_NO3N).toBe(0.23);
    expect(NO3N_TO_NO3).toBe(4.4);
  });
});
