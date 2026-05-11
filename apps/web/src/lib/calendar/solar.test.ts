import { describe, expect, it } from 'vitest';
import {
  dayOfYear,
  shadowDirectionDeg,
  shadowLengthMeters,
  solarDeclinationDeg,
  solarPosition
} from './solar';

const LAT_LOUDOUN = 39.09;
const LON_LOUDOUN = -77.6;

describe('solarDeclinationDeg', () => {
  it('approaches +23.5° near June solstice', () => {
    // Day 172 ≈ Jun 21
    const d = solarDeclinationDeg(172);
    expect(d).toBeGreaterThan(23.0);
    expect(d).toBeLessThanOrEqual(23.5);
  });

  it('approaches -23.5° near December solstice', () => {
    // Day 355 ≈ Dec 21
    const d = solarDeclinationDeg(355);
    expect(d).toBeLessThan(-23.0);
    expect(d).toBeGreaterThanOrEqual(-23.5);
  });

  it('crosses zero near equinoxes', () => {
    // Day 81 ≈ Mar 22 — formula's choice of equinox-zero
    expect(Math.abs(solarDeclinationDeg(81))).toBeLessThan(0.5);
  });
});

describe('solarPosition', () => {
  it('puts sun above horizon at midday in summer', () => {
    const may1 = new Date(2026, 4, 1).getTime();
    const sun = solarPosition(LAT_LOUDOUN, LON_LOUDOUN, may1, 12);
    expect(sun.elevationDeg).toBeGreaterThan(60);
    expect(sun.elevationDeg).toBeLessThan(85);
  });

  it('keeps sun in southern half of sky at noon for northern-hemisphere lat', () => {
    const may1 = new Date(2026, 4, 1).getTime();
    const sun = solarPosition(LAT_LOUDOUN, LON_LOUDOUN, may1, 12);
    // Azimuth at solar noon should be near 180° (due south).
    expect(sun.azimuthDeg).toBeGreaterThan(155);
    expect(sun.azimuthDeg).toBeLessThan(205);
  });

  it('puts morning sun east of meridian (azimuth < 180)', () => {
    const may1 = new Date(2026, 4, 1).getTime();
    const sun = solarPosition(LAT_LOUDOUN, LON_LOUDOUN, may1, 9);
    expect(sun.azimuthDeg).toBeGreaterThan(60);
    expect(sun.azimuthDeg).toBeLessThan(150);
  });

  it('puts afternoon sun west of meridian (azimuth > 180)', () => {
    const may1 = new Date(2026, 4, 1).getTime();
    const sun = solarPosition(LAT_LOUDOUN, LON_LOUDOUN, may1, 15);
    expect(sun.azimuthDeg).toBeGreaterThan(210);
    expect(sun.azimuthDeg).toBeLessThan(300);
  });

  it('elevation is lower in winter than summer at the same time of day', () => {
    const may1 = new Date(2026, 4, 1).getTime();
    const dec1 = new Date(2026, 11, 1).getTime();
    const sunMay = solarPosition(LAT_LOUDOUN, LON_LOUDOUN, may1, 12);
    const sunDec = solarPosition(LAT_LOUDOUN, LON_LOUDOUN, dec1, 12);
    expect(sunMay.elevationDeg).toBeGreaterThan(sunDec.elevationDeg + 20);
  });
});

describe('shadowDirectionDeg', () => {
  it('returns sun azimuth + 180 mod 360', () => {
    expect(shadowDirectionDeg(0)).toBe(180);
    expect(shadowDirectionDeg(90)).toBe(270);
    expect(shadowDirectionDeg(180)).toBe(0);
    expect(shadowDirectionDeg(270)).toBe(90);
    expect(shadowDirectionDeg(359)).toBe(179);
  });
});

describe('shadowLengthMeters', () => {
  it('returns Infinity when sun is at or below horizon', () => {
    expect(shadowLengthMeters(2.5, 0)).toBe(Infinity);
    expect(shadowLengthMeters(2.5, -10)).toBe(Infinity);
  });

  it('shadow length equals height when sun elevation is 45°', () => {
    expect(shadowLengthMeters(2.5, 45)).toBeCloseTo(2.5, 4);
  });

  it('shadow length grows toward Infinity as sun approaches horizon', () => {
    const at60 = shadowLengthMeters(2.5, 60);
    const at30 = shadowLengthMeters(2.5, 30);
    const at10 = shadowLengthMeters(2.5, 10);
    expect(at30).toBeGreaterThan(at60);
    expect(at10).toBeGreaterThan(at30);
  });

  it('shadow length is short near zenith (> 80°)', () => {
    const len = shadowLengthMeters(2.5, 85);
    expect(len).toBeLessThan(0.3);
  });
});

describe('dayOfYear', () => {
  it('Jan 1 is day 0 or 1 depending on rounding', () => {
    const jan1 = new Date(2026, 0, 1).getTime();
    const d = dayOfYear(jan1);
    expect(d === 0 || d === 1).toBe(true);
  });

  it('Dec 31 is around 365 / 366', () => {
    const dec31 = new Date(2026, 11, 31).getTime();
    const d = dayOfYear(dec31);
    expect(d).toBeGreaterThan(363);
    expect(d).toBeLessThan(367);
  });

  it('mid-summer is ~day 195', () => {
    const jul15 = new Date(2026, 6, 15).getTime();
    const d = dayOfYear(jul15);
    expect(d).toBeGreaterThanOrEqual(194);
    expect(d).toBeLessThanOrEqual(197);
  });
});
