import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRING_INDOORS_LEAD_DAYS,
  BRING_INDOORS_LEAD_PROVENANCE,
  BRING_INDOORS_SOURCE
} from './herbEvents';
import { sourceEntrySchema } from '$lib/plugins/sourceCoverage';

const file = path.resolve(__dirname, '../../../scripts/calendar-sources.json');
const entries = (JSON.parse(readFileSync(file, 'utf8')) as { entries: Record<string, unknown> })
  .entries;

describe('bring-indoors lead source (R-8)', () => {
  const entry = sourceEntrySchema.safeParse(entries[BRING_INDOORS_SOURCE.key]);

  it('is a complete entry from an .edu or .gov page', () => {
    expect(entry.success).toBe(true);
    if (!entry.success) return;
    expect(entry.data.url).toBe(BRING_INDOORS_SOURCE.url);
    expect(new URL(entry.data.url).hostname).toMatch(/\.(edu|gov)$/);
  });

  it('the quote states the range and the first fall frost, and the constant is its low end', () => {
    if (!entry.success) throw new Error('missing source');
    const { weeksFrom, weeksTo } = BRING_INDOORS_SOURCE;
    expect(entry.data.quote).toContain(`${weeksFrom} to ${weeksTo} weeks before`);
    expect(entry.data.quote).toMatch(/first fall frost/);
    expect(BRING_INDOORS_LEAD_DAYS).toBe(weeksFrom * 7);
    expect(BRING_INDOORS_LEAD_PROVENANCE).toBe('data');
  });
});
