// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from './client';
import { owners, NITRATE_UNITS } from './schema';
import { runWithTenant } from './tenant';
import { createField } from './fields';
import { createBlock } from './blocks';
import { createPlanned } from './crops';
import { insertFertilityApplication } from './fertility';
import { createCutting } from './hayCuttings';
import {
  deleteForageTest,
  forageFactsForArea,
  getForageTest,
  insertForageTest,
  listForageTests
} from './forageTests';
import { FORAGE_NITRATE_UNITS } from '$lib/forage/model';

const DAY = 86_400_000;

function farm() {
  const ownerId = `forage-${randomUUID()}`;
  db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId }).run();
  return ownerId;
}

describe('forageTests repo', () => {
  it('keeps the client unit list in step with the schema', () => {
    expect([...FORAGE_NITRATE_UNITS]).toEqual([...NITRATE_UNITS]);
  });

  it('round-trips values through hundredths and the rating JSON', () => {
    runWithTenant(farm(), () => {
      const field = createField({ name: 'Pasture', kind: 'pasture' });
      const block = createBlock({ name: 'Strip', fieldId: field.id });
      const t = insertForageTest({
        blockId: block.id,
        sampledAt: Date.UTC(2026, 8, 1),
        nitrateValue: 0.37,
        nitrateUnits: 'pct-nitrate',
        hcnPpm: 12.5,
        labRating: { nitrate: 'Caution', basis: 'as-fed' },
        createdBy: null
      });
      expect(getForageTest(t.id)).toMatchObject({
        nitrateValue: 0.37,
        nitrateUnits: 'pct-nitrate',
        hcnPpm: 12.5,
        labRating: { nitrate: 'Caution', basis: 'as-fed' },
        provenance: 'manual'
      });
      expect(() => insertForageTest({ sampledAt: 0, createdBy: null, hcnPpm: 1 })).toThrow(
        /exactly one target/
      );
      expect(deleteForageTest(t.id)).toBe(true);
      expect(getForageTest(t.id)).toBeUndefined();
    });
  });

  it('lists newest first and nothing for an empty named filter', () => {
    runWithTenant(farm(), () => {
      const block = createBlock({ name: 'Strip' });
      const a = insertForageTest({
        blockId: block.id,
        sampledAt: 1000,
        hcnPpm: 1,
        createdBy: null
      });
      const b = insertForageTest({
        blockId: block.id,
        sampledAt: 2000,
        hcnPpm: 1,
        createdBy: null
      });
      expect(listForageTests({ blockId: block.id }).map((t) => t.id)).toEqual([b.id, a.id]);
      expect(listForageTests({ blockIds: [] })).toEqual([]);
    });
  });

  it('collects in-ground plantings, cuts and nitrogen for an Area', () => {
    runWithTenant(farm(), () => {
      const now = Date.now();
      const field = createField({ name: 'Pasture', kind: 'pasture' });
      const block = createBlock({ name: 'Strip', fieldId: field.id });
      createPlanned({
        blockId: block.id,
        cropPluginId: 'sudangrass-piper',
        varietyDisplayName: 'Piper',
        plantingDate: now - 10 * DAY
      });
      createPlanned({
        blockId: block.id,
        cropPluginId: 'oats-grain-jerry',
        varietyDisplayName: 'Jerry',
        plantingDate: now + 10 * DAY
      });
      insertFertilityApplication({
        blockId: block.id,
        occurredAt: now - DAY,
        source: 'urea',
        ratePerAcre: 1,
        rateUnit: 'lb/acre',
        nLbPerAcre: 30
      });
      insertFertilityApplication({
        blockId: block.id,
        occurredAt: now - DAY,
        source: 'lime',
        ratePerAcre: 1,
        rateUnit: 'lb/acre',
        nLbPerAcre: 0
      });
      const cut = createCutting({
        blockId: block.id,
        cropPluginId: 'sudangrass-piper',
        year: 2026,
        rulesVersion: 'test'
      });
      const facts = forageFactsForArea(field.id, now);
      expect(facts.area?.name).toBe('Pasture');
      expect(facts.plantings.map((p) => p.cropPluginId)).toEqual(['sudangrass-piper']);
      expect(facts.nitrogen).toHaveLength(1);
      expect(facts.cuts.map((c) => c.id)).toEqual([cut.id]);
    });
  });

  it('counts an application with N left blank as nitrogen of unknown amount', () => {
    runWithTenant(farm(), () => {
      const now = Date.now();
      const field = createField({ name: 'Back pasture', kind: 'pasture' });
      const block = createBlock({ name: 'Strip 2', fieldId: field.id });
      insertFertilityApplication({
        blockId: block.id,
        occurredAt: now - DAY,
        source: 'compost',
        ratePerAcre: 1,
        rateUnit: 'lb/acre'
      });
      insertFertilityApplication({
        blockId: block.id,
        occurredAt: now - DAY,
        source: 'potash',
        ratePerAcre: 1,
        rateUnit: 'lb/acre',
        nLbPerAcre: 0
      });
      const facts = forageFactsForArea(field.id, now);
      expect(facts.nitrogen).toHaveLength(1);
      expect(facts.nitrogen[0].amountKnown).toBe(false);
    });
  });
});
