import { describe, expect, it } from 'vitest';
import { calibrationDistance, computeCalibratedGpa } from './calibration';

describe('calibrationDistance', () => {
  it('returns ~204 ft for a 20" effective width (canonical row-crop case)', () => {
    const r = calibrationDistance(20);
    expect(r.distanceFeet).toBeCloseTo(204.2, 1);
  });

  it('returns ~272 ft for a 15" nozzle spacing', () => {
    expect(calibrationDistance(15).distanceFeet).toBeCloseTo(272.3, 1);
  });

  it('halves the distance when width doubles', () => {
    const a = calibrationDistance(20).distanceFeet;
    const b = calibrationDistance(40).distanceFeet;
    expect(b).toBeCloseTo(a / 2, 1);
  });

  it('rounds steps using the supplied stride', () => {
    const r = calibrationDistance(20, 2.5);
    expect(r.steps).toBe(Math.round(204.2 / 2.5));
    expect(r.strideFeet).toBe(2.5);
  });

  it('rejects non-positive width or stride', () => {
    expect(() => calibrationDistance(0)).toThrow();
    expect(() => calibrationDistance(-1)).toThrow();
    expect(() => calibrationDistance(20, 0)).toThrow();
  });
});

describe('computeCalibratedGpa', () => {
  it('returns ounces collected as the GPA (1/128-acre invariant)', () => {
    const r = computeCalibratedGpa(20, 18);
    expect(r.gpa).toBeCloseTo(18, 1);
  });

  it('flags outside-sanity-band for absurd values', () => {
    expect(computeCalibratedGpa(20, 2).outsideSanityBand).toBe(true);
    expect(computeCalibratedGpa(20, 80).outsideSanityBand).toBe(true);
    expect(computeCalibratedGpa(20, 15).outsideSanityBand).toBe(false);
  });

  it('rejects negative ounces', () => {
    expect(() => computeCalibratedGpa(20, -5)).toThrow();
  });
});
