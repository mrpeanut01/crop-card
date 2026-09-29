import { describe, expect, it } from 'vitest';
import type { CardModel } from '$lib/cards/model';
import {
  DAY_MS,
  evaluateGrazing,
  evaluateHayCut,
  type GrazingApplication,
  type GrazingAttestationInput
} from '$lib/safety/grazingInterval';
import { grazingLines, grazingSection, summarizeAreaGrazing, withGrazing } from './areaGrazing';

// Test values only; none of these numbers come from a label.
const TZ = 'America/New_York';
const SPRAYED = Date.UTC(2026, 5, 1, 14);

function app(extra: Partial<GrazingApplication> = {}): GrazingApplication {
  return {
    ref: 'spray:e1',
    source: 'spray',
    blockId: 'b1',
    appliedAtMs: SPRAYED,
    productPluginId: 'herb-a',
    productName: 'Herb A',
    restrictions: { source: 't', grazeDays: 7, lactatingDairyGrazeDays: 14, hayDays: 3 },
    ...extra
  };
}

function summarize(
  apps: GrazingApplication[],
  atMs: number,
  attestations: GrazingAttestationInput[] = []
) {
  const base = { applications: apps, attestations, atMs, timeZone: TZ };
  return summarizeAreaGrazing({
    graze: evaluateGrazing({
      ...base,
      subject: { speciesId: null, foodProducing: true, lactating: false }
    }),
    milking: evaluateGrazing({
      ...base,
      subject: { speciesId: null, foodProducing: true, lactating: true }
    }),
    hay: evaluateHayCut(base)
  });
}

const CARD: CardModel = {
  kind: 'area',
  key: 'ar_x',
  kicker: 'Pasture',
  title: 'North pasture',
  facts: [],
  next: null,
  sections: [{ title: 'Notes', items: ['gate sticks'] }],
  asOf: 0,
  provenance: [],
  href: '/cards/area/ar_x'
} as unknown as CardModel;

describe('area grazing lines', () => {
  it('nothing held gives no summary and leaves the card alone', () => {
    const g = summarize([app()], SPRAYED + 60 * DAY_MS);
    expect(g).toBeNull();
    expect(withGrazing(CARD, g, TZ)).toBe(CARD);
  });

  it('shows the grazing, milking and hay clear dates', () => {
    const g = summarize([app()], SPRAYED + DAY_MS)!;
    expect(grazingLines(g, TZ)).toEqual([
      'Grazing clear on Tue, Jun 9, 2026',
      'Milking animals clear on Tue, Jun 16, 2026',
      'Hay cutting clear on Fri, Jun 5, 2026'
    ]);
  });

  it('leaves out the milking line when it clears with everyone else', () => {
    const same = app({
      restrictions: { source: 't', grazeDays: 7, lactatingDairyGrazeDays: 7, hayDays: 7 }
    });
    const lines = grazingLines(summarize([same], SPRAYED + DAY_MS)!, TZ);
    expect(lines.some((l) => l.startsWith('Milking'))).toBe(false);
  });

  it('names the product when its interval is not on file', () => {
    const g = summarize([app({ restrictions: null, productName: 'Crossbow' })], SPRAYED + DAY_MS)!;
    expect(grazingLines(g, TZ)).toEqual([
      'Grazing on hold for food animals: the label interval for Crossbow is not on file yet. The owner can add it from the label.',
      'Hay cutting on hold: the label interval for Crossbow is not on file yet. The owner can add it from the label.'
    ]);
  });

  it('says so when the label forbids pasture use', () => {
    const g = summarize(
      [app({ restrictions: { source: 't', notForPasture: true }, productName: 'X' })],
      SPRAYED + DAY_MS
    )!;
    expect(grazingLines(g, TZ)[0]).toBe(
      'Grazing not allowed: the label for X forbids it on pasture'
    );
  });

  it('adds the manure advisory and marks an attested hold as manual', () => {
    const g = summarize(
      [app({ restrictions: null, activeIngredients: ['aminopyralid'] })],
      SPRAYED + DAY_MS,
      [
        {
          id: 'a',
          sprayEventRef: 'spray:e1',
          productPluginId: 'herb-a',
          grazeDays: 30,
          hayDays: 30
        }
      ]
    )!;
    const section = grazingSection(g, TZ)!;
    expect(section.safety).toBe(true);
    expect(section.provenance).toBe('manual');
    expect(section.items.at(-1)).toMatch(/^Manure from animals that graze here/);
    const card = withGrazing(CARD, g, TZ);
    expect(card.sections[0].title).toBe('Grazing');
    expect(card.sections[1].title).toBe('Notes');
    expect(card.provenance.map((p) => p.source)).toEqual(
      expect.arrayContaining(['plugin', 'manual'])
    );
  });
});
