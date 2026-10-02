// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth')>()),
  ...(await import('$lib/server/documents.testkit')).authOverrides()
}));

const observed = vi.hoisted(() => ({
  impl: null as null | (() => Promise<unknown>)
}));
vi.mock('$lib/server/weatherObserved', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/server/weatherObserved')>();
  return {
    ...real,
    getObservedHours: vi.fn(async () =>
      observed.impl
        ? observed.impl()
        : {
            hours: [],
            provenance: 'fallback',
            station: null,
            sources: [],
            latestMs: null,
            error: 'offline'
          }
    )
  };
});

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { documentLinks, forageTests } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { insertFertilityApplication } from '$lib/db/fertility';
import { createCutting } from '$lib/db/hayCuttings';
import { createStockItem, receiveLot } from '$lib/db/stock';
import { documentStorageKey, insertDocument, removeDocumentLink } from '$lib/db/documents';
import { setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { RULES_VERSION } from '$lib/safety/version';
import { closeSeason } from '$lib/server/seasonClose';
import { actAs, call, seedFarm, type TestFarm } from '$lib/server/documents.testkit';
import { loadForageAdvisory } from '$lib/server/forageAdvisory';
import { GET as advisoryGet } from './advisory/+server';
import { GET as testsGet, POST as testsPost } from './tests/+server';
import { DELETE as testDelete } from './tests/[id]/+server';

const DAY = 86_400_000;
let farm: TestFarm;
let pasture: { fieldId: string; blockId: string };

const inFarm = <T>(f: TestFarm, fn: () => T): T => runWithTenant(f.ownerId, fn);
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function seedPasture(f: TestFarm) {
  return inFarm(f, () => {
    const field = createField({ name: 'Back pasture', kind: 'pasture' });
    const block = createBlock({ name: 'Sudan strip', fieldId: field.id, kind: 'block' });
    createPlanned({
      blockId: block.id,
      cropPluginId: 'sudangrass-piper',
      varietyDisplayName: 'Piper',
      plantingDate: Date.now() - 50 * DAY
    });
    return { fieldId: field.id, blockId: block.id };
  });
}

function post(json: Record<string, unknown>) {
  return call(testsPost, { method: 'POST', path: '/api/forage/tests', json });
}

beforeEach(() => {
  observed.impl = null;
  farm = seedFarm();
  pasture = seedPasture(farm);
  actAs(farm, 'owner');
});

describe('POST /api/forage/tests (M-58, M-60)', () => {
  it('saves a helper entry as manual with the lab rating as typed', async () => {
    actAs(farm, 'helper');
    const res = await post({
      blockId: pasture.blockId,
      sampledOn: ymd(Date.now() - DAY),
      lab: '  Dairy One ',
      nitrateValue: 1500,
      nitrateUnits: 'ppm-nitrate',
      labRating: { nitrate: ' Caution ', basis: 'dry-matter' }
    });
    expect(res.status).toBe(201);
    const { test } = await res.json();
    expect(test).toMatchObject({
      blockId: pasture.blockId,
      lab: 'Dairy One',
      nitrateValue: 1500,
      nitrateUnits: 'ppm-nitrate',
      labRating: { nitrate: 'Caution', basis: 'dry-matter' },
      provenance: 'manual'
    });
  });

  it('lets a custom operator record and refuses an inspector', async () => {
    actAs(farm, 'custom-operator');
    expect(
      (await post({ blockId: pasture.blockId, sampledOn: ymd(Date.now() - DAY), hcnPpm: 20 }))
        .status
    ).toBe(201);
    actAs(farm, 'inspector');
    expect(
      (await post({ blockId: pasture.blockId, sampledOn: ymd(Date.now() - DAY), hcnPpm: 20 }))
        .status
    ).toBe(403);
  });

  it('needs exactly one target, units with a value and at least one value or rating', async () => {
    const day = ymd(Date.now() - DAY);
    expect((await post({ sampledOn: day, hcnPpm: 1 })).status).toBe(400);
    const cutting = inFarm(farm, () =>
      createCutting({
        blockId: pasture.blockId,
        cropPluginId: 'sudangrass-piper',
        year: 2026,
        rulesVersion: RULES_VERSION
      })
    );
    expect(
      (
        await post({
          blockId: pasture.blockId,
          hayCuttingId: cutting.id,
          sampledOn: day,
          hcnPpm: 1
        })
      ).status
    ).toBe(400);
    expect((await post({ blockId: pasture.blockId, sampledOn: day, nitrateValue: 5 })).status).toBe(
      400
    );
    expect(
      (await post({ blockId: pasture.blockId, sampledOn: day, nitrateUnits: 'pct-kno3' })).status
    ).toBe(400);
    expect(
      (await post({ blockId: pasture.blockId, sampledOn: day, labRating: { basis: 'as-fed' } }))
        .status
    ).toBe(400);
    expect(
      (await post({ hayCuttingId: cutting.id, sampledOn: day, labRating: { hcn: 'Low' } })).status
    ).toBe(201);
  });

  it('refuses a future day and a day that does not exist', async () => {
    const future = await post({
      blockId: pasture.blockId,
      sampledOn: ymd(Date.now() + 3 * DAY),
      hcnPpm: 1
    });
    expect(future.status).toBe(400);
    expect((await future.json()).error).toBe('IN_THE_FUTURE');
    expect(
      (await post({ blockId: pasture.blockId, sampledOn: '2026-02-30', hcnPpm: 1 })).status
    ).toBe(400);
  });

  it("refuses another Owner's block, cutting and lot", async () => {
    const other = seedFarm();
    const theirs = seedPasture(other);
    const theirCut = inFarm(other, () =>
      createCutting({
        blockId: theirs.blockId,
        cropPluginId: 'sudangrass-piper',
        year: 2026,
        rulesVersion: RULES_VERSION
      })
    );
    const theirLot = inFarm(other, () => {
      const item = createStockItem({ category: 'feed', displayName: 'Hay', defaultUnit: 'count' });
      return receiveLot({ stockItemId: item.id, receivedQuantity: 10, unit: 'count' });
    });
    const day = ymd(Date.now() - DAY);
    for (const body of [
      { blockId: theirs.blockId },
      { hayCuttingId: theirCut.id },
      { stockLotId: theirLot.id }
    ]) {
      const res = await post({ ...body, sampledOn: day, hcnPpm: 1 });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/^unknown /);
    }
  });

  it('takes feed lots only', async () => {
    const [feed, seed] = inFarm(farm, () =>
      (['feed', 'seed'] as const).map((category) => {
        const item = createStockItem({ category, displayName: category, defaultUnit: 'count' });
        return receiveLot({ stockItemId: item.id, receivedQuantity: 1, unit: 'count' });
      })
    );
    const day = ymd(Date.now() - DAY);
    expect((await post({ stockLotId: feed.id, sampledOn: day, hcnPpm: 1 })).status).toBe(201);
    const bad = await post({ stockLotId: seed.id, sampledOn: day, hcnPpm: 1 });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('NOT_FEED_LOT');
  });

  it('lets only the owner attach a lab report, linked in the same write', async () => {
    const documentId = inFarm(farm, () => {
      const id = randomUUID();
      insertDocument({
        id,
        kind: 'forage-test',
        title: 'Forage report',
        mime: 'application/pdf',
        byteSize: 10,
        sha256: 'a'.repeat(64),
        crc32: 1,
        storageKey: documentStorageKey(farm.ownerId, id),
        originalName: null,
        uploadedBy: null
      });
      return id;
    });
    actAs(farm, 'helper');
    const refused = await post({
      blockId: pasture.blockId,
      sampledOn: ymd(Date.now() - DAY),
      hcnPpm: 3,
      documentId
    });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe('OWNER_ONLY');
    actAs(farm, 'owner');
    const res = await post({
      blockId: pasture.blockId,
      sampledOn: ymd(Date.now() - DAY),
      hcnPpm: 3,
      documentId
    });
    expect(res.status).toBe(201);
    const { test } = await res.json();
    const link = inFarm(farm, () =>
      db
        .select()
        .from(documentLinks)
        .where(withTenant(documentLinks, eq(documentLinks.subjectId, test.id)))
        .get()
    );
    expect(link?.subjectType).toBe('forage-test');
    inFarm(farm, () => removeDocumentLink(documentId, link!, farm.ownerUser));
    const row = inFarm(farm, () =>
      db
        .select()
        .from(forageTests)
        .where(withTenant(forageTests, eq(forageTests.id, test.id)))
        .get()
    );
    expect(row?.documentId).toBeNull();
  });
  it('is never gated by the season close-out (M-64)', async () => {
    inFarm(farm, () =>
      closeSeason({
        year: new Date(Date.now() - DAY).getFullYear(),
        closedById: farm.ownerUser,
        plantingResolutions: [],
        harvestRollup: {},
        pendingCount: 0
      })
    );
    expect(
      (await post({ blockId: pasture.blockId, sampledOn: ymd(Date.now() - DAY), hcnPpm: 2 })).status
    ).toBe(201);
  });
});

describe('GET and DELETE /api/forage/tests', () => {
  it('lists for every role and deletes for the owner only', async () => {
    const res = await post({
      blockId: pasture.blockId,
      sampledOn: ymd(Date.now() - DAY),
      hcnPpm: 3
    });
    const { test } = await res.json();
    actAs(farm, 'inspector');
    const list = await call(testsGet, {
      path: '/api/forage/tests',
      query: { blockId: pasture.blockId }
    });
    expect((await list.json()).tests.map((t: { id: string }) => t.id)).toEqual([test.id]);
    expect((await call(testsGet, { path: '/api/forage/tests' })).status).toBe(400);
    actAs(farm, 'helper');
    const helperDelete = await call(testDelete, { method: 'DELETE', params: { id: test.id } });
    expect(helperDelete.status).toBe(403);
    expect((await helperDelete.json()).error).toBe('OWNER_ONLY');
    actAs(farm, 'owner');
    expect((await call(testDelete, { method: 'DELETE', params: { id: test.id } })).status).toBe(
      200
    );
    expect((await call(testDelete, { method: 'DELETE', params: { id: test.id } })).status).toBe(
      404
    );
  });

  it("cannot delete another Owner's test", async () => {
    const other = seedFarm();
    const theirs = seedPasture(other);
    actAs(other, 'owner');
    const { test } = await (
      await post({ blockId: theirs.blockId, sampledOn: ymd(Date.now() - DAY), hcnPpm: 1 })
    ).json();
    actAs(farm, 'owner');
    expect((await call(testDelete, { method: 'DELETE', params: { id: test.id } })).status).toBe(
      404
    );
  });
});

describe('GET /api/forage/advisory (M-53 to M-57)', () => {
  it('shows prussic acid for a sorghum-family Area to every role, with no numbers but the quoted advice', async () => {
    actAs(farm, 'inspector');
    const res = await call(advisoryGet, {
      path: '/api/forage/advisory',
      query: { fieldId: pasture.fieldId }
    });
    expect(res.status).toBe(200);
    const { advisory } = await res.json();
    const prussic = advisory.items.find((i: { hazard: string }) => i.hazard === 'prussic-acid');
    expect(prussic.cropName).toMatch(/Sudangrass/);
    expect(prussic.frostUnknown).toBe(true);
    expect(advisory.items.map((i: { hazard: string }) => i.hazard)).toEqual(['prussic-acid']);
    expect(advisory.recordHref).toBe(`/forage?fieldId=${pasture.fieldId}`);
  });

  it('reads frost from observed hours and nitrogen from the records', async () => {
    inFarm(farm, () => {
      setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat: 39.1, lon: -77.6 }));
      insertFertilityApplication({
        blockId: pasture.blockId,
        occurredAt: Date.now() - 5 * DAY,
        source: 'urea',
        ratePerAcre: 100,
        rateUnit: 'lb/acre',
        nLbPerAcre: 46
      });
    });
    observed.impl = async () => ({
      hours: [
        {
          t: Date.now() - 2 * DAY,
          tempF: 30,
          dewpointF: null,
          rhPct: null,
          popPct: null,
          precipMm: null,
          windMph: null
        }
      ],
      provenance: 'data',
      station: {
        ghcnId: 'X',
        icao: 'KIAD',
        name: 'DULLES INTL AP',
        lat: 0,
        lon: 0,
        distanceMiles: 3
      },
      sources: ['ghcnh'],
      latestMs: Date.now(),
      error: null
    });
    const { advisory } = await (
      await call(advisoryGet, { path: '/api/forage/advisory', query: { fieldId: pasture.fieldId } })
    ).json();
    const prussic = advisory.items.find((i: { hazard: string }) => i.hazard === 'prussic-acid');
    expect(prussic.elevated).toBe(true);
    expect(prussic.triggersOnFile.map((t: { trigger: string }) => t.trigger)).toEqual([
      'frost',
      'heavy-nitrogen',
      'young-regrowth'
    ]);
    expect(advisory.items.map((i: { hazard: string }) => i.hazard)).toEqual([
      'prussic-acid',
      'nitrate'
    ]);
  });

  it('gives up on a slow weather read within its budget', async () => {
    inFarm(farm, () =>
      setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat: 39.1, lon: -77.6 }))
    );
    observed.impl = () => new Promise(() => {});
    const started = Date.now();
    const advisory = await runWithTenant(farm.ownerId, () =>
      loadForageAdvisory({ fieldId: pasture.fieldId }, Date.now(), { budgetMs: 50 })
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(advisory.items[0].frostUnknown).toBe(true);
  });

  it('answers for a hay cutting with its own latest test', async () => {
    const block = inFarm(farm, () =>
      createBlock({ name: 'Alfalfa', fieldId: pasture.fieldId, kind: 'block' })
    );
    const cutting = inFarm(farm, () =>
      createCutting({
        blockId: block.id,
        cropPluginId: 'alfalfa-vernema',
        year: 2026,
        mowAt: Date.now() - 3 * DAY,
        rulesVersion: RULES_VERSION
      })
    );
    await post({
      hayCuttingId: cutting.id,
      sampledOn: ymd(Date.now() - DAY),
      labRating: { nitrate: 'Moderate' }
    });
    const { advisory } = await (
      await call(advisoryGet, { path: '/api/forage/advisory', query: { hayCuttingId: cutting.id } })
    ).json();
    expect(advisory.targetTest.ratingText).toBe('Lab rating (owner-entered): nitrate Moderate');
    expect(advisory.items.map((i: { hazard: string }) => i.hazard)).toEqual(['nitrate']);
  });

  it("is 404 for another Owner's Area and 400 without exactly one target", async () => {
    const other = seedPasture(seedFarm());
    expect(
      (await call(advisoryGet, { path: '/api/forage/advisory', query: { fieldId: other.fieldId } }))
        .status
    ).toBe(404);
    expect((await call(advisoryGet, { path: '/api/forage/advisory' })).status).toBe(400);
  });
});
