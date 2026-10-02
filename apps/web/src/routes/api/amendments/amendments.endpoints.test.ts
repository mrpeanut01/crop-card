// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth')>()),
  ...(await import('$lib/server/documents.testkit')).authOverrides()
}));

import { db } from '$lib/db/client';
import { equipment } from '$lib/db/schema';
import { runWithTenant, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { insertStay } from '$lib/db/animalLocations';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { createCutting } from '$lib/db/hayCuttings';
import { createStockItem, receiveLot, recordMovement } from '$lib/db/stock';
import { closeSeason } from '$lib/server/seasonClose';
import { feedUseNote } from '$lib/stock/animalStock';
import { actAs, call, seedFarm, type TestFarm } from '$lib/server/documents.testkit';
import { GET as listBatches, POST as createBatch } from './batches/+server';
import { GET as getBatch, PATCH as patchBatch } from './batches/[id]/+server';
import { POST as addInput } from './batches/[id]/inputs/+server';
import { DELETE as deleteInput } from './batches/[id]/inputs/[inputId]/+server';
import { POST as addLot } from '../stock/[id]/lots/+server';

const DAY = 86_400_000;
let farm: TestFarm;

const inFarm = <T>(fn: () => T): T => runWithTenant(farm.ownerId, fn);

function ymd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
}

interface BatchView {
  id: string;
  state: string;
  stateLabel: string;
  paths: Array<{ state: string; sentence: string }>;
  standingNotes: string[];
  advice: string | null;
  inputs: Array<{ id: string; label: string }>;
}

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function newBatch(json: Record<string, unknown>): Promise<BatchView> {
  const res = await call(createBatch, { method: 'POST', path: '/api/amendments/batches', json });
  expect(res.status).toBe(201);
  return (await body<{ batch: BatchView }>(res)).batch;
}

function input(batchId: string, json: Record<string, unknown>) {
  return call(addInput, {
    method: 'POST',
    path: `/api/amendments/batches/${batchId}/inputs`,
    params: { id: batchId },
    json
  });
}

function sprayedPasture(daysAgo: number, pluginId = 'grazonnext-hl') {
  return inFarm(() => {
    const pasture = createField({ name: 'North pasture', kind: 'pasture' });
    const block = createBlock({ name: 'Paddock', fieldId: pasture.id, acres: 2 });
    const sprayerId = `${farm.ownerId}-sprayer-${block.id}`;
    db.insert(equipment)
      .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Sprayer' }))
      .run();
    insertSprayEvent({
      blockId: block.id,
      sprayerId,
      performedById: farm.ownerUser,
      occurredAt: Date.now() - daysAgo * DAY,
      products: [{ pluginId, chemistryClasses: ['synthetic-auxin'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: {}
    });
    return { pastureId: pasture.id, blockId: block.id };
  });
}

function goats(onFieldId: string, fromDaysAgo: number) {
  return inFarm(() => {
    const g = insertAnimalGroup({
      name: 'Goats',
      speciesId: 'goat',
      purpose: 'production',
      headCount: 4,
      foodProducing: true
    });
    insertStay({
      subject: { subjectType: 'group', subjectId: g.id },
      fieldId: onFieldId,
      atMs: Date.now() - fromDaysAgo * DAY,
      movedBy: null
    });
    return g.id;
  });
}

beforeEach(() => {
  farm = seedFarm();
  actAs(farm, 'owner');
});

describe('POST /api/amendments/batches', () => {
  it('a helper builds a pile from goats that grazed a GrazonNext pasture: may carry', async () => {
    actAs(farm, 'helper');
    const { pastureId } = sprayedPasture(20);
    const groupId = goats(pastureId, 10);
    const batch = await newBatch({
      kind: 'manure',
      name: 'Goat pile',
      origin: 'on-farm',
      startedOn: ymd(Date.now() - 5 * DAY)
    });
    expect(batch.state).toBe('none-on-file');
    expect(batch.standingNotes).toEqual(['No sources added yet.']);
    const res = await input(batch.id, {
      inputType: 'group',
      inputId: groupId,
      from: ymd(Date.now() - 5 * DAY),
      to: ymd(Date.now())
    });
    expect(res.status).toBe(201);
    const after = (await body<{ batch: BatchView }>(res)).batch;
    expect(after.state).toBe('may-carry');
    expect(after.stateLabel).toBe('May carry a weed killer');
    expect(after.paths[0].sentence).toMatch(
      /^Goats grazed North pasture from .* to now, after GrazonNext HL .* was sprayed there on /
    );
    expect(after.standingNotes).toContain(
      'Bought hay and feed are not traced. If your animals ate bought hay, ask where it grew.'
    );
    expect(after.inputs[0].label).toBe('Goats');

    actAs(farm, 'inspector');
    const listed = await body<{ batches: BatchView[] }>(
      await call(listBatches, { path: '/api/amendments/batches' })
    );
    expect(listed.batches.map((b) => b.state)).toEqual(['may-carry']);
    const one = await call(getBatch, { params: { id: batch.id } });
    expect(one.status).toBe(200);
  });

  it('a bought load the supplier knows nothing about is not known, with the supplier advice', async () => {
    const batch = await newBatch({
      kind: 'manure',
      name: 'Horse manure',
      origin: 'bought',
      supplier: 'Neighbour',
      supplierStatement: 'unknown',
      startedOn: ymd(Date.now())
    });
    expect(batch.state).toBe('not-known');
    expect(batch.stateLabel).toBe('Not known');
    expect(batch.advice).toBe(
      'Ask the supplier which weed killers were used on the hay or pasture, or run a pea or bean test.'
    );
    expect(JSON.stringify(batch)).not.toMatch(/\bsafe\b|\bclear\b/i);
    const patched = await call(patchBatch, {
      method: 'PATCH',
      params: { id: batch.id },
      json: { supplierStatement: 'says-none' }
    });
    const pb = (await body<{ batch: BatchView }>(patched)).batch;
    expect(pb.state).toBe('none-on-file');
    expect(pb.standingNotes).toEqual(['The supplier said none was used.']);
  });

  it('refuses inspectors, future days and a supplier on a home pile', async () => {
    actAs(farm, 'inspector');
    const r = await call(createBatch, {
      method: 'POST',
      json: { kind: 'manure', name: 'x', origin: 'on-farm', startedOn: ymd(Date.now()) }
    });
    expect(r.status).toBe(403);
    actAs(farm, 'owner');
    const future = await call(createBatch, {
      method: 'POST',
      json: { kind: 'manure', name: 'x', origin: 'on-farm', startedOn: ymd(Date.now() + 3 * DAY) }
    });
    expect(future.status).toBe(400);
    expect((await body<{ error: string }>(future)).error).toBe('IN_THE_FUTURE');
    const supplier = await call(createBatch, {
      method: 'POST',
      json: {
        kind: 'manure',
        name: 'x',
        origin: 'on-farm',
        supplier: 'Bob',
        startedOn: ymd(Date.now())
      }
    });
    expect(supplier.status).toBe(400);
  });

  it('is not gated by the season close-out (M-64)', async () => {
    inFarm(() =>
      closeSeason({
        year: new Date().getFullYear(),
        closedById: farm.ownerUser,
        plantingResolutions: [],
        harvestRollup: {},
        pendingCount: 0
      })
    );
    const b = await newBatch({
      kind: 'compost',
      name: 'Winter compost',
      origin: 'on-farm',
      startedOn: ymd(Date.now())
    });
    expect(b.id).toBeTruthy();
  });
});

describe('inputs', () => {
  it('compost from a flagged manure pile inherits it, and a cycle is refused', async () => {
    const { pastureId } = sprayedPasture(20);
    const groupId = goats(pastureId, 10);
    const manure = await newBatch({
      kind: 'manure',
      name: 'Goat pile',
      origin: 'on-farm',
      startedOn: ymd(Date.now() - 5 * DAY)
    });
    await input(manure.id, {
      inputType: 'group',
      inputId: groupId,
      from: ymd(Date.now() - 5 * DAY)
    });
    const compost = await newBatch({
      kind: 'compost',
      name: 'Compost',
      origin: 'on-farm',
      startedOn: ymd(Date.now())
    });
    const ok = await input(compost.id, {
      inputType: 'batch',
      inputId: manure.id,
      from: ymd(Date.now())
    });
    expect(ok.status).toBe(201);
    const cb = (await body<{ batch: BatchView }>(ok)).batch;
    expect(cb.state).toBe('may-carry');
    expect(cb.paths[0].sentence).toMatch(/^Through Goat pile: Goats grazed/);

    const cycle = await input(manure.id, {
      inputType: 'batch',
      inputId: compost.id,
      from: ymd(Date.now())
    });
    expect(cycle.status).toBe(409);
    expect((await body<{ error: string }>(cycle)).error).toBe('BATCH_CYCLE');
    const self = await input(manure.id, {
      inputType: 'batch',
      inputId: manure.id,
      from: ymd(Date.now())
    });
    expect((await body<{ error: string }>(self)).error).toBe('BATCH_CYCLE');

    const dup = await input(compost.id, {
      inputType: 'batch',
      inputId: manure.id,
      from: ymd(Date.now())
    });
    expect(dup.status).toBe(409);
    expect((await body<{ error: string }>(dup)).error).toBe('INPUT_EXISTS');
  });

  it('refuses closed and bought batches, bad ranges and non-amendment lots', async () => {
    const pile = await newBatch({
      kind: 'manure',
      name: 'Pile',
      origin: 'on-farm',
      startedOn: ymd(Date.now() - 3 * DAY)
    });
    const groupId = goats(farm.fieldId, 3);
    const backwards = await input(pile.id, {
      inputType: 'group',
      inputId: groupId,
      from: ymd(Date.now()),
      to: ymd(Date.now() - 2 * DAY)
    });
    expect((await body<{ error: string }>(backwards)).error).toBe('BAD_RANGE');

    const sprayLot = inFarm(() => {
      const item = createStockItem({
        category: 'herbicide',
        displayName: 'Jug',
        defaultUnit: 'gal'
      });
      return receiveLot({ stockItemId: item.id, receivedQuantity: 1, unit: 'gal' });
    });
    const jug = await input(pile.id, {
      inputType: 'stock-lot',
      inputId: sprayLot.id,
      from: ymd(Date.now())
    });
    expect((await body<{ error: string }>(jug)).error).toBe('NOT_AMENDMENT_LOT');

    await call(patchBatch, {
      method: 'PATCH',
      params: { id: pile.id },
      json: { closedOn: ymd(Date.now()) }
    });
    const closed = await input(pile.id, {
      inputType: 'group',
      inputId: groupId,
      from: ymd(Date.now())
    });
    expect((await body<{ error: string }>(closed)).error).toBe('BATCH_CLOSED');
    await call(patchBatch, { method: 'PATCH', params: { id: pile.id }, json: { closedOn: null } });
    expect(
      (await input(pile.id, { inputType: 'group', inputId: groupId, from: ymd(Date.now()) })).status
    ).toBe(201);

    const bought = await newBatch({
      kind: 'manure',
      name: 'Load',
      origin: 'bought',
      startedOn: ymd(Date.now())
    });
    const refused = await input(bought.id, {
      inputType: 'group',
      inputId: groupId,
      from: ymd(Date.now())
    });
    expect((await body<{ error: string }>(refused)).error).toBe('BOUGHT_BATCH_NO_INPUTS');

    const foreign = await input(pile.id, {
      inputType: 'animal',
      inputId: groupId,
      from: ymd(Date.now() - DAY)
    });
    expect(foreign.status).toBe(400);
  });

  it('only the owner deletes an input', async () => {
    const pile = await newBatch({
      kind: 'manure',
      name: 'Pile',
      origin: 'on-farm',
      startedOn: ymd(Date.now())
    });
    const groupId = goats(farm.fieldId, 3);
    const added = await body<{ input: { id: string } }>(
      await input(pile.id, { inputType: 'group', inputId: groupId, from: ymd(Date.now()) })
    );
    actAs(farm, 'helper');
    const helper = await call(deleteInput, {
      method: 'DELETE',
      params: { id: pile.id, inputId: added.input.id }
    });
    expect(helper.status).toBe(403);
    actAs(farm, 'owner');
    const owner = await call(deleteInput, {
      method: 'DELETE',
      params: { id: pile.id, inputId: added.input.id }
    });
    expect(owner.status).toBe(200);
    expect((await body<{ batch: BatchView }>(owner)).batch.inputs).toEqual([]);
  });
});

describe('hay to feed (M-28, M-39)', () => {
  it('bales from a treated block, fed to goats, reach their pile', async () => {
    const { blockId } = sprayedPasture(40);
    const cuttingId = inFarm(
      () =>
        createCutting({
          blockId,
          cropPluginId: 'alfalfa-vernema',
          year: new Date().getFullYear(),
          mowAt: Date.now() - 30 * DAY,
          rulesVersion: 'test'
        }).id
    );
    const groupId = goats(farm.fieldId, 20);
    const hay = inFarm(() =>
      createStockItem({ category: 'feed', displayName: 'Round bales', defaultUnit: 'lb' })
    );
    const lotRes = await call(addLot, {
      method: 'POST',
      params: { id: hay.id },
      json: { receivedQuantity: 1000, unit: 'lb', sourceHayCuttingId: cuttingId }
    });
    expect(lotRes.status).toBe(201);
    const lot = (await body<{ lot: { id: string; sourceHayCuttingId: string } }>(lotRes)).lot;
    expect(lot.sourceHayCuttingId).toBe(cuttingId);
    inFarm(() =>
      recordMovement({
        stockLotId: lot.id,
        delta: -50,
        unit: 'lb',
        reason: 'animal-feed',
        notes: feedUseNote({ type: 'group', id: groupId }),
        occurredAt: Date.now() - 4 * DAY
      })
    );
    const pile = await newBatch({
      kind: 'manure',
      name: 'Barn pile',
      origin: 'on-farm',
      startedOn: ymd(Date.now() - 3 * DAY)
    });
    const res = await input(pile.id, {
      inputType: 'group',
      inputId: groupId,
      from: ymd(Date.now() - 3 * DAY)
    });
    const b = (await body<{ batch: BatchView }>(res)).batch;
    expect(b.state).toBe('may-carry');
    expect(
      b.paths.some((p) => /^Goats ate hay from Paddock cutting 1, cut on /.test(p.sentence))
    ).toBe(true);
  });

  it('refuses a cutting link on a non-feed lot and an unknown cutting', async () => {
    const fert = inFarm(() =>
      createStockItem({ category: 'fertilizer', displayName: 'Compost', defaultUnit: 'lb' })
    );
    const res = await call(addLot, {
      method: 'POST',
      params: { id: fert.id },
      json: { receivedQuantity: 10, unit: 'lb', sourceHayCuttingId: 'x' }
    });
    expect((await body<{ error: string }>(res)).error).toBe('NOT_FEED_LOT');
    const feed = inFarm(() =>
      createStockItem({ category: 'feed', displayName: 'Hay', defaultUnit: 'lb' })
    );
    const unknown = await call(addLot, {
      method: 'POST',
      params: { id: feed.id },
      json: { receivedQuantity: 10, unit: 'lb', sourceHayCuttingId: 'nope' }
    });
    expect(unknown.status).toBe(400);
  });
});
