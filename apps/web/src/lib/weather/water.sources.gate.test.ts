import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceEntrySchema } from '$lib/plugins/sourceCoverage';
import {
  DEFAULT_WEEKLY_TARGET_IN,
  GALLONS_PER_SQFT_INCH,
  WATER_SOURCED_KEYS
} from './waterSources';

const FILE = path.resolve(__dirname, '../../../scripts/water-sources.json');
const entries = (JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Record<string, unknown> })
  .entries;

describe('water-sources.json gate (E0-2)', () => {
  it.each(WATER_SOURCED_KEYS)('%s has a quoted source entry', (key) => {
    const parsed = sourceEntrySchema.safeParse(entries[key]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('has no entry that no constant uses', () => {
    expect(Object.keys(entries).sort()).toEqual([...WATER_SOURCED_KEYS].sort());
  });

  it('marks search-excerpt quotes so they get checked word for word', () => {
    for (const key of ['weeklyTargetIn', 'metarHourlyPrecipGroup', 'metarPrecipSensorOut']) {
      const e = entries[key] as { note?: string };
      expect(e.note ?? '').toMatch(/search/i);
    }
  });

  it('keeps the default target to the quoted one inch a week', () => {
    expect(DEFAULT_WEEKLY_TARGET_IN).toBe(1);
    expect((entries.weeklyTargetIn as { quote: string }).quote).toMatch(
      /one inch of water per week/
    );
  });

  it('keeps the gallon conversion to the unit arithmetic', () => {
    expect(GALLONS_PER_SQFT_INCH).toBeCloseTo(0.623, 3);
  });
});
