import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_GUIDE_SENTENCES, BIOASSAY_DAMAGE_TEXT, BIOASSAY_SOURCE_LINKS } from './bioassayGuide';
import { lineText } from '$lib/farm/areaCarryover';
import { HARMS_TEXT } from './spreadPrompt';

const SCRIPTS = path.resolve(__dirname, '../../../scripts');
const sources = JSON.parse(readFileSync(path.join(SCRIPTS, 'bioassay-sources.json'), 'utf8')) as {
  entries: Record<
    string,
    { url: string; publisher: string; date: string; quote: string; note?: string }
  >;
};

describe('bioassay guide gate (M-50)', () => {
  it.each(ALL_GUIDE_SENTENCES.map((s) => [s.id, s] as const))(
    '%s rests on a sourced quote',
    (_id, s) => {
      const entry = sources.entries[s.sourceKey];
      expect(entry, s.sourceKey).toBeDefined();
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.publisher.length).toBeGreaterThan(0);
      expect(entry.date.length).toBeGreaterThan(0);
      const quote = entry.quote.toLowerCase();
      for (const phrase of s.quoteHas) expect(quote, `${s.id}: ${phrase}`).toContain(phrase);
      const numbersInText = s.text.match(/\d+/g) ?? [];
      const paired = new Map(s.numbers ?? []);
      for (const n of numbersInText) {
        expect(paired.has(n), `${s.id}: ${n} has no quote pairing`).toBe(true);
        expect(quote, `${s.id}: ${n}`).toContain((paired.get(n) as string).toLowerCase());
      }
    }
  );

  it('never rests on a page-reader extraction still waiting to be re-read', () => {
    for (const s of ALL_GUIDE_SENTENCES) {
      const note = sources.entries[s.sourceKey]?.note ?? '';
      expect(note, s.id).not.toMatch(/page reader|re-read/i);
    }
  });

  it('never repeats a source saying the material is safe', () => {
    for (const s of ALL_GUIDE_SENTENCES) {
      expect(s.text.toLowerCase()).not.toMatch(/\bsafe|\bclear\b|tested clean/);
      expect(s.text).not.toContain('—');
    }
  });

  it('every linked source is a guide entry url', () => {
    const urls = new Set(Object.values(sources.entries).map((e) => e.url));
    for (const l of BIOASSAY_SOURCE_LINKS) expect(urls.has(l.href)).toBe(true);
  });

  it('the damage line carries the Oregon State citation word for word', () => {
    const { text } = lineText(
      'may-carry',
      'Horse manure',
      Date.UTC(2026, 4, 1, 16),
      {
        id: 't',
        batchId: null,
        blockId: 'b',
        testedAt: Date.UTC(2026, 4, 20, 4),
        createdAt: 0,
        result: 'damage'
      },
      'America/New_York'
    );
    expect(text.endsWith(BIOASSAY_DAMAGE_TEXT)).toBe(true);
    expect(HARMS_TEXT).not.toMatch(/safe/i);
  });
});
