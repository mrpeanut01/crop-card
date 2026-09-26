import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A computed path keeps the untyped build script out of svelte-check.
const SCRIPT: string = resolve(__dirname, '../../scripts/build-frost-normals.mjs');
const { EXTREME_MIN_MIN_YEARS, extremeMinEligible, meanExtremeMinF } = (await import(
  /* @vite-ignore */ SCRIPT
)) as {
  EXTREME_MIN_MIN_YEARS: number;
  extremeMinEligible: (id: string) => boolean;
  meanExtremeMinF: (csv: string) => number | null;
};

const HEADER = '"STATION","DATE","LATITUDE","EMNT","EMNT_ATTRIBUTES"';

/** Synthetic GSOM rows: every month of each year, EMNT in °C. */
function gsom(years: number[], emnt: (year: number, month: number) => string): string {
  const rows = [HEADER];
  for (const y of years) {
    for (let m = 1; m <= 12; m++) {
      rows.push(
        `"SYN0000001","${y}-${String(m).padStart(2, '0')}","40.0","${emnt(y, m)}","0,0101, "`
      );
    }
  }
  return rows.join('\n');
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('meanExtremeMinF (GSOM parser)', () => {
  it('averages each year’s lowest monthly EMNT and converts once to °F', () => {
    const csv = gsom(range(1991, 2020), (y, m) => (m === 1 ? (y % 2 ? '-20.0' : '-10.0') : '5.0'));
    expect(meanExtremeMinF(csv)).toBe(5);
  });

  it('only reads 1991-2020', () => {
    const csv = gsom(range(1980, 2025), (y, m) =>
      m === 1 ? (y < 1991 || y > 2020 ? '-40.0' : '-15.0') : '0.0'
    );
    expect(meanExtremeMinF(csv)).toBe(5);
  });

  it(`needs ${EXTREME_MIN_MIN_YEARS} qualifying years`, () => {
    const cold = (_y: number, m: number) => (m === 2 ? '-15.0' : '1.0');
    expect(meanExtremeMinF(gsom(range(1991, 1991 + EXTREME_MIN_MIN_YEARS - 1), cold))).toBe(5);
    expect(meanExtremeMinF(gsom(range(1991, 1991 + EXTREME_MIN_MIN_YEARS - 2), cold))).toBeNull();
  });

  it('drops a year missing any cold month but keeps one missing summer', () => {
    const noDec = gsom(range(1991, 2020), (y, m) =>
      m === 12 && y > 2000 ? '' : m === 1 ? '-15.0' : '1.0'
    );
    expect(meanExtremeMinF(noDec)).toBeNull();
    const noJuly = gsom(range(1991, 2020), (_y, m) => (m === 7 ? '' : m === 1 ? '-15.0' : '1.0'));
    expect(meanExtremeMinF(noJuly)).toBe(5);
  });

  it('ignores blanks, junk and implausible values', () => {
    const csv = gsom(range(1991, 2020), (y, m) =>
      m === 3 ? (y === 1995 ? '-999.9' : y === 1996 ? 'abc' : '-15.0') : '1.0'
    );
    expect(meanExtremeMinF(csv)).toBe(5);
    expect(meanExtremeMinF('')).toBeNull();
    expect(meanExtremeMinF(HEADER)).toBeNull();
    expect(meanExtremeMinF('"STATION","DATE"\n"X","1991-01"')).toBeNull();
  });
});

describe('extremeMinEligible', () => {
  it('keeps U.S. states and territories and leaves out other countries', () => {
    expect(extremeMinEligible('USW00093738')).toBe(true);
    expect(extremeMinEligible('RQC00660061')).toBe(true);
    expect(extremeMinEligible('GQW00041415')).toBe(true);
    expect(extremeMinEligible('CAW00064757')).toBe(false);
    expect(extremeMinEligible('FMC00914395')).toBe(false);
    expect(extremeMinEligible('')).toBe(false);
  });
});
