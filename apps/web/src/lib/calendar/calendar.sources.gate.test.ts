import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSEPHONE_NAME_SOURCED, shortDayBandLabel, SHORT_DAY_HOURS } from './persephone';

interface SourceEntry {
  url: string;
  publisher: string;
  date: string;
  quote: string;
  note?: string;
}

const file = path.resolve(__dirname, '../../../scripts/calendar-sources.json');
const sources = JSON.parse(readFileSync(file, 'utf8')) as {
  entries: Record<string, SourceEntry>;
};

const USABLE_HOST = /(^|\.)(edu|usda\.gov|noaa\.gov|weather\.gov)$/;

describe('calendar-sources.json gate (E0-2, E0-3, E3-6)', () => {
  it('every entry is complete and comes from an extension, university or federal page', () => {
    for (const [key, e] of Object.entries(sources.entries)) {
      expect(e.url, key).toMatch(/^https:\/\//);
      expect(USABLE_HOST.test(new URL(e.url).hostname), `${key} host`).toBe(true);
      expect(e.publisher.trim().length, key).toBeGreaterThan(0);
      expect(e.date, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.quote.trim().length, key).toBeGreaterThan(20);
    }
  });

  it('the Persephone name is used only while a quote names it with the 10-hour line', () => {
    const e = sources.entries.persephone;
    const backed =
      !!e && /Persephone/.test(e.quote) && new RegExp(`\\b${SHORT_DAY_HOURS}\\b`).test(e.quote);
    expect(PERSEPHONE_NAME_SOURCED).toBe(backed);
    if (!backed) expect(shortDayBandLabel()).not.toMatch(/Persephone/);
  });

  it('a quote taken from a search excerpt says so', () => {
    for (const [key, e] of Object.entries(sources.entries)) {
      if (e.note && /excerpt/i.test(e.note)) expect(e.note, key).toMatch(/word for word/);
    }
  });

  it('the band label makes no growth claim', () => {
    expect(shortDayBandLabel()).not.toMatch(/grow|growth|stop|dormant/i);
  });
});
