import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface Acc {
  stations: Map<string, unknown>;
}
interface BuildScript {
  GHCN_SHA256: Record<string, string>;
  GHCN_FIRST_YEAR: number;
  GHCN_LAST_YEAR: number;
  MIN_DAYS_PER_COLD_MONTH: number;
  MIN_YEARS_FOR_EXTREME: number;
  newExtremeAccumulator(ids: Iterable<string>, southern?: Set<string>): Acc;
  accumulateGhcnLine(acc: Acc, line: string): void;
  extremeMinF(acc: Acc, id: string): number | null;
}

const SCRIPT = path.resolve(__dirname, '../../scripts/build-frost-normals.mjs');
const load = () => import(/* @vite-ignore */ pathToFileURL(SCRIPT).href) as Promise<BuildScript>;

const pad = (n: number) => String(n).padStart(2, '0');

function coldMonths(
  mod: BuildScript,
  acc: Acc,
  id: string,
  year: number,
  tenthsC: number,
  months = [1, 2, 12],
  days = 28
) {
  for (const m of months) {
    for (let d = 1; d <= days; d++) {
      mod.accumulateGhcnLine(acc, `${id},${year}${pad(m)}${pad(d)},TMIN,${tenthsC},,,7,0700`);
    }
  }
}

describe('build-frost-normals extreme minimum', () => {
  it('pins one SHA-256 per year, 1991-2020', async () => {
    const mod = await load();
    expect(mod.GHCN_FIRST_YEAR).toBe(1991);
    expect(mod.GHCN_LAST_YEAR).toBe(2020);
    const years = Object.keys(mod.GHCN_SHA256).map(Number);
    expect(years).toHaveLength(30);
    for (const h of Object.values(mod.GHCN_SHA256)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('averages each complete year’s lowest TMIN and converts to °F', async () => {
    const mod = await load();
    const acc = mod.newExtremeAccumulator(['USW00093738']);
    for (let y = 1991; y < 1991 + mod.MIN_YEARS_FOR_EXTREME; y++) {
      coldMonths(mod, acc, 'USW00093738', y, 0);
      mod.accumulateGhcnLine(acc, `USW00093738,${y}0115,TMIN,${y % 2 ? -200 : -100},,,7,0700`);
    }
    const f = mod.extremeMinF(acc, 'USW00093738')!;
    const meanC =
      [...Array(mod.MIN_YEARS_FOR_EXTREME).keys()]
        .map((i) => ((1991 + i) % 2 ? -20 : -10))
        .reduce((a, b) => a + b, 0) / mod.MIN_YEARS_FOR_EXTREME;
    expect(f).toBeCloseTo((meanC * 9) / 5 + 32, 1);
  });

  it('skips QC-flagged values, other elements, other stations and years outside 1991-2020', async () => {
    const mod = await load();
    const acc = mod.newExtremeAccumulator(['USC00012172']);
    for (let y = 1991; y < 1991 + mod.MIN_YEARS_FOR_EXTREME; y++) {
      coldMonths(mod, acc, 'USC00012172', y, 50);
      mod.accumulateGhcnLine(acc, `USC00012172,${y}0110,TMIN,-300,,I,7,0700`);
      mod.accumulateGhcnLine(acc, `USC00012172,${y}0110,TMAX,-300,,,7,0700`);
      mod.accumulateGhcnLine(acc, `USC00099999,${y}0110,TMIN,-300,,,7,0700`);
    }
    mod.accumulateGhcnLine(acc, 'USC00012172,19900110,TMIN,-300,,,7,0700');
    mod.accumulateGhcnLine(acc, 'USC00012172,20210110,TMIN,-300,,,7,0700');
    expect(mod.extremeMinF(acc, 'USC00012172')).toBe(41);
  });

  it('needs enough days in every cold month and enough years', async () => {
    const mod = await load();
    const acc = mod.newExtremeAccumulator(['A', 'B']);
    for (let y = 1991; y < 1991 + mod.MIN_YEARS_FOR_EXTREME; y++) {
      coldMonths(mod, acc, 'A', y, 0, [1, 2, 12], mod.MIN_DAYS_PER_COLD_MONTH - 1);
    }
    for (let y = 1991; y < 1991 + mod.MIN_YEARS_FOR_EXTREME - 1; y++) {
      coldMonths(mod, acc, 'B', y, 0);
    }
    expect(mod.extremeMinF(acc, 'A')).toBeNull();
    expect(mod.extremeMinF(acc, 'B')).toBeNull();
    expect(mod.extremeMinF(acc, 'nope')).toBeNull();
  });

  it('uses June to August as the cold months south of the equator', async () => {
    const mod = await load();
    const acc = mod.newExtremeAccumulator(['AQW00061705'], new Set(['AQW00061705']));
    for (let y = 1991; y < 1991 + mod.MIN_YEARS_FOR_EXTREME; y++) {
      coldMonths(mod, acc, 'AQW00061705', y, 200, [6, 7, 8]);
    }
    expect(mod.extremeMinF(acc, 'AQW00061705')).toBe(68);
  });
});
