import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ForageHazard } from '$lib/plugins/schemas';
import { FORAGE_ADVICE } from './advice';
import {
  buildForageAdvisory,
  frostFrom,
  frostWindow,
  type AdvisoryInput,
  type AdvisoryTest
} from './advisory';
import { forageLines, withForageAdvisory, FORAGE_FAILED_TEXT } from '$lib/farm/forageAdvisory';
import type { CardModel } from '$lib/cards/model';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 1, 16);
const PRUSSIC: ForageHazard = {
  kind: 'prussic-acid',
  triggers: ['frost', 'drought', 'young-regrowth', 'heavy-nitrogen']
};
const NITRATE: ForageHazard = { kind: 'nitrate', triggers: ['drought', 'heavy-nitrogen'] };
const HAZARDS: Record<string, { name: string; hazards: ForageHazard[] }> = {
  sudan: { name: 'Sudangrass', hazards: [PRUSSIC, NITRATE] },
  oats: { name: 'Oats', hazards: [NITRATE] }
};

function input(over: Partial<AdvisoryInput> = {}): AdvisoryInput {
  return {
    target: { kind: 'area', fieldId: 'f1' },
    blocks: [{ id: 'b1', name: 'North strip' }],
    plantings: [{ blockId: 'b1', cropPluginId: 'sudan', plantingDate: NOW - 60 * DAY }],
    cuts: [],
    nitrogen: [],
    tests: [],
    frost: { seen: [], unknown: false },
    hazardsFor: (id) => HAZARDS[id] ?? null,
    timeZone: 'America/New_York',
    now: NOW,
    ...over
  };
}

function test(over: Partial<AdvisoryTest> = {}): AdvisoryTest {
  return {
    id: 't1',
    blockId: 'b1',
    hayCuttingId: null,
    stockLotId: null,
    sampledAt: NOW - 2 * DAY,
    createdAt: NOW - 2 * DAY,
    nitrateValue: null,
    nitrateUnits: null,
    hcnPpm: null,
    labRating: null,
    ...over
  };
}

const ADVICE_TEXTS = new Set(Object.values(FORAGE_ADVICE).map((a) => a.text));

describe('buildForageAdvisory (M-55, M-56)', () => {
  it('always shows prussic acid for a flagged crop in the ground, with no numbers', () => {
    const a = buildForageAdvisory(input());
    expect(a.items).toHaveLength(1);
    const [item] = a.items;
    expect(item.hazard).toBe('prussic-acid');
    expect(item.elevated).toBe(false);
    expect(item.headline).toBe('Sudangrass on North strip can form prussic acid (cyanide).');
    expect(item.triggersOnFile.map((t) => t.trigger)).toEqual(['young-regrowth']);
    expect(item.raisesRisk).toBe(
      'What raises the risk: frost, drought, young regrowth and heavy nitrogen.'
    );
    expect(item.advice.map((x) => x.id)).toEqual(['frostWait', 'minHeight', 'nitrogen']);
    for (const line of forageLines(a)) {
      if (!ADVICE_TEXTS.has(line)) expect(line).not.toMatch(/\d/);
    }
    expect(a.provenance).toBe('plugin');
  });

  it('hides nitrate until nitrogen or a test is on file', () => {
    const quiet = buildForageAdvisory(
      input({ plantings: [{ blockId: 'b1', cropPluginId: 'oats', plantingDate: NOW - 30 * DAY }] })
    );
    expect(quiet.items).toEqual([]);
    const fed = buildForageAdvisory(
      input({
        plantings: [{ blockId: 'b1', cropPluginId: 'oats', plantingDate: NOW - 30 * DAY }],
        nitrogen: [{ blockId: 'b1', occurredAt: NOW - 10 * DAY }]
      })
    );
    expect(fed.items.map((i) => i.hazard)).toEqual(['nitrate']);
    expect(fed.items[0].advice.map((x) => x.id)).toEqual(['drought', 'nitrogen', 'hayNitrate']);
    const tested = buildForageAdvisory(
      input({
        plantings: [{ blockId: 'b1', cropPluginId: 'oats', plantingDate: NOW - 30 * DAY }],
        tests: [test({ labRating: { nitrate: 'Caution' } })]
      })
    );
    expect(tested.items[0].headline).toBe('Oats on North strip: a nitrate test is on file.');
  });

  it('shows nitrate when nitrogen was applied in an unknown amount', () => {
    const r = buildForageAdvisory(
      input({
        plantings: [{ blockId: 'b1', cropPluginId: 'oats', plantingDate: NOW - 30 * DAY }],
        nitrogen: [{ blockId: 'b1', occurredAt: NOW - 10 * DAY, amountKnown: false }]
      })
    );
    expect(r.items.map((i) => i.hazard)).toEqual(['nitrate']);
    const line = r.items[0].triggersOnFile.find((o) => o.trigger === 'heavy-nitrogen');
    expect(line?.text).toMatch(/How much nitrogen it had is not known\.$/);
  });

  it('counts nitrogen only since the later of planting and the last cut', () => {
    const base = {
      plantings: [{ blockId: 'b1', cropPluginId: 'oats', plantingDate: NOW - 90 * DAY }],
      nitrogen: [{ blockId: 'b1', occurredAt: NOW - 40 * DAY }]
    };
    expect(buildForageAdvisory(input(base)).items).toHaveLength(1);
    expect(
      buildForageAdvisory(
        input({ ...base, cuts: [{ id: 'c1', blockId: 'b1', cutAt: NOW - 20 * DAY }] })
      ).items
    ).toHaveLength(0);
    expect(
      buildForageAdvisory(
        input({
          ...base,
          plantings: [{ blockId: 'b1', cropPluginId: 'oats', plantingDate: NOW - 30 * DAY }]
        })
      ).items
    ).toHaveLength(0);
  });

  it('words prussic acid more strongly with frost or nitrogen on file', () => {
    const frosted = buildForageAdvisory(
      input({
        frost: {
          seen: [{ atMs: NOW - 3 * DAY, source: 'observed', where: 'the Dulles station' }],
          unknown: false
        }
      })
    );
    const item = frosted.items[0];
    expect(item.elevated).toBe(true);
    expect(item.headline).toBe('Sudangrass on North strip: higher prussic acid risk now.');
    expect(item.triggersOnFile[0].text).toMatch(
      /^A reading at or below freezing on .+ at the Dulles station\.$/
    );
    expect(frosted.provenance).toBe('data');

    const alerted = buildForageAdvisory(
      input({ frost: { seen: [{ atMs: NOW - DAY, source: 'alert' }], unknown: false } })
    );
    expect(alerted.items[0].triggersOnFile[0].text).toMatch(/^A frost alert was sent on /);
  });

  it('says frost could not be read instead of saying nothing', () => {
    const a = buildForageAdvisory(input({ frost: { seen: [], unknown: true } }));
    expect(a.items[0].frostUnknown).toBe(true);
    expect(forageLines(a)).toContain('Frost data could not be read. Check whether it froze.');
  });

  it('shows the lab rating the owner typed, the value as typed and the converted value', () => {
    const a = buildForageAdvisory(
      input({
        tests: [
          test({ id: 'old', sampledAt: NOW - 30 * DAY, labRating: { nitrate: 'Low' } }),
          test({
            id: 'new',
            nitrateValue: 1500,
            nitrateUnits: 'ppm-nitrate',
            labRating: { nitrate: 'Moderate, limit feeding', basis: 'dry-matter' }
          })
        ]
      })
    );
    const nitrate = a.items.find((i) => i.hazard === 'nitrate')!;
    expect(nitrate.latestTest?.id).toBe('new');
    expect(nitrate.latestTest?.ratingText).toBe(
      'Lab rating (owner-entered): nitrate Moderate, limit feeding (dry matter basis)'
    );
    expect(nitrate.latestTest?.valueText).toMatch(/Nitrate 1,500 ppm nitrate \(NO3\), as typed\.$/);
    expect(nitrate.latestTest?.convertedText).toBe('About 345 ppm nitrate-nitrogen (converted)');
  });

  it('judges a hay cutting by its own crop and the nitrogen before the cut', () => {
    const a = buildForageAdvisory(
      input({
        target: {
          kind: 'hay',
          cuttingId: 'c2',
          blockId: 'b1',
          cropPluginId: 'oats',
          cutAt: NOW - 5 * DAY
        },
        plantings: [],
        cuts: [
          { id: 'c1', blockId: 'b1', cutAt: NOW - 40 * DAY },
          { id: 'c2', blockId: 'b1', cutAt: NOW - 5 * DAY }
        ],
        nitrogen: [
          { blockId: 'b1', occurredAt: NOW - 20 * DAY },
          { blockId: 'b1', occurredAt: NOW - 2 * DAY }
        ],
        tests: [
          test({ id: 'h', blockId: null, hayCuttingId: 'c2', labRating: { nitrate: 'High' } })
        ]
      })
    );
    expect(a.items).toHaveLength(1);
    expect(a.items[0].triggersOnFile.map((t) => t.atMs)).toEqual([NOW - 20 * DAY]);
    expect(a.targetTest?.ratingText).toBe('Lab rating (owner-entered): nitrate High');
    expect(a.recordHref).toBe('/forage?hayCuttingId=c2');
  });

  it('skips crops with no shipped hazards and repeats nothing per crop and block', () => {
    const a = buildForageAdvisory(
      input({
        plantings: [
          { blockId: 'b1', cropPluginId: 'sudan', plantingDate: NOW - 60 * DAY },
          { blockId: 'b1', cropPluginId: 'sudan', plantingDate: NOW - 20 * DAY },
          { blockId: 'b1', cropPluginId: 'tomato', plantingDate: NOW - 20 * DAY }
        ]
      })
    );
    expect(a.items).toHaveLength(1);
  });

  it('never says safe or clear, whatever is on file', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('sudan', 'oats'),
        (frost, unknown, nitrogen, crop) => {
          const a = buildForageAdvisory(
            input({
              plantings: [{ blockId: 'b1', cropPluginId: crop, plantingDate: NOW - 60 * DAY }],
              frost: { seen: frost ? [{ atMs: NOW - DAY, source: 'alert' }] : [], unknown },
              nitrogen: nitrogen ? [{ blockId: 'b1', occurredAt: NOW - DAY }] : []
            })
          );
          for (const line of forageLines(a)) {
            expect(line).not.toMatch(/\bsafe\b|\bclear\b|no risk|—/i);
          }
        }
      )
    );
  });
});

describe('frostFrom (M-55)', () => {
  const w = frostWindow(NOW);
  it('looks back 14 days for a reading at or below 32°F', () => {
    expect(w.toMs - w.fromMs).toBe(14 * DAY);
    const f = frostFrom(
      w,
      {
        hours: [
          { t: NOW - 20 * DAY, tempF: 20 },
          { t: NOW - 3 * DAY, tempF: 33 },
          { t: NOW - 2 * DAY, tempF: 32 }
        ],
        failed: false
      },
      []
    );
    expect(f.seen).toEqual([{ atMs: NOW - 2 * DAY, source: 'observed', where: null }]);
    expect(f.unknown).toBe(false);
  });

  it('is unknown only when the read failed and no alert is on file', () => {
    expect(frostFrom(w, { hours: [], failed: true }, []).unknown).toBe(true);
    expect(frostFrom(w, { hours: [], failed: true }, [NOW - DAY]).unknown).toBe(false);
    expect(frostFrom(w, { hours: [], failed: false }, []).unknown).toBe(false);
    expect(frostFrom(w, { hours: [], failed: true }, [NOW - 30 * DAY]).unknown).toBe(true);
  });
});

describe('withForageAdvisory (M-53)', () => {
  const card: CardModel = {
    kind: 'area',
    key: 'ar_f1',
    title: 'Back pasture',
    facts: [],
    sections: [
      { title: 'Grazing', items: ['x'], safety: true },
      { title: 'Plantings', items: [] }
    ],
    provenance: [{ source: 'data' }]
  } as unknown as CardModel;

  it('adds the section after grazing with a record link', () => {
    const out = withForageAdvisory(card, buildForageAdvisory(input()));
    expect(out.sections.map((s) => s.title)).toEqual(['Grazing', 'Forage check', 'Plantings']);
    expect(out.links).toEqual([{ label: 'Record a forage test', href: '/forage?fieldId=f1' }]);
    expect(out.provenance.map((p) => p.source)).toContain('plugin');
  });

  it('leaves the card alone when nothing applies', () => {
    const empty = buildForageAdvisory(input({ plantings: [] }));
    expect(withForageAdvisory(card, empty)).toBe(card);
  });

  it('says the check failed rather than staying silent', () => {
    const out = withForageAdvisory(card, null, true);
    expect(out.sections[1]).toEqual({ title: 'Forage check', items: [FORAGE_FAILED_TEXT] });
  });

  it('tags the section manual when a lab rating is shown', () => {
    const out = withForageAdvisory(
      card,
      buildForageAdvisory(input({ tests: [test({ labRating: { nitrate: 'High' } })] }))
    );
    expect(out.sections[1].provenance).toBe('manual');
    expect(out.sections[1].items).toContain('Lab rating (owner-entered): nitrate High');
  });
});
