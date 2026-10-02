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
import { addPlanting, createBlock } from '$lib/db/blocks';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { insertStay } from '$lib/db/animalLocations';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { getFertilityApplication } from '$lib/db/fertility';
import { closeSeason } from '$lib/server/seasonClose';
import { actAs, call, seedFarm, type TestFarm } from '$lib/server/documents.testkit';
import { loadCarryoverLines } from '$lib/server/areaCarryover';
import { buildFarmSnapshot } from '$lib/server/cardSnapshot';
import { buildAreaCard } from '$lib/cards/build';
import { CARRYOVER_SECTION, CARRYOVER_TESTS_SECTION } from '$lib/farm/areaCarryover';
import { parseCarryoverAck, type CarryoverConfirmBody } from '$lib/amendments/spreadPrompt';
import { POST as createBatch } from './batches/+server';
import { POST as addInput } from './batches/[id]/inputs/+server';
import { GET as listTests, POST as addTest } from './bioassays/+server';
import { DELETE as deleteTest } from './bioassays/[id]/+server';
import { POST as dismiss } from './dismissals/+server';
import { DELETE as undismiss } from './dismissals/[id]/+server';
import { POST as spread } from '../fertility/applications/+server';

const DAY = 86_400_000;
let farm: TestFarm;

const inFarm = <T>(fn: () => T): T => runWithTenant(farm.ownerId, fn);

function ymd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
}

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function boughtLoad(
  statement: 'unknown' | 'says-none' | 'none-asked',
  name = 'Horse manure'
) {
  const res = await call(createBatch, {
    method: 'POST',
    json: {
      kind: 'manure',
      name,
      origin: 'bought',
      supplier: 'Neighbour',
      supplierStatement: statement,
      startedOn: ymd(Date.now() - 2 * DAY)
    }
  });
  expect(res.status).toBe(201);
  return (await body<{ batch: { id: string; state: string } }>(res)).batch;
}

async function goatPile(): Promise<string> {
  const { pastureId } = inFarm(() => {
    const pasture = createField({ name: 'North pasture', kind: 'pasture' });
    const block = createBlock({ name: 'Paddock', fieldId: pasture.id, acres: 2 });
    const sprayerId = `${farm.ownerId}-sprayer`;
    db.insert(equipment)
      .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Sprayer' }))
      .run();
    insertSprayEvent({
      blockId: block.id,
      sprayerId,
      performedById: farm.ownerUser,
      occurredAt: Date.now() - 20 * DAY,
      products: [{ pluginId: 'grazonnext-hl', chemistryClasses: ['synthetic-auxin'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: {}
    });
    return { pastureId: pasture.id };
  });
  const groupId = inFarm(() => {
    const g = insertAnimalGroup({
      name: 'Goats',
      speciesId: 'goat',
      purpose: 'production',
      headCount: 4,
      foodProducing: true
    });
    insertStay({
      subject: { subjectType: 'group', subjectId: g.id },
      fieldId: pastureId,
      atMs: Date.now() - 10 * DAY,
      movedBy: null
    });
    return g.id;
  });
  actAs(farm, 'helper');
  const b = await call(createBatch, {
    method: 'POST',
    json: {
      kind: 'manure',
      name: 'Goat pile',
      origin: 'on-farm',
      startedOn: ymd(Date.now() - 5 * DAY)
    }
  });
  const batch = (await body<{ batch: { id: string } }>(b)).batch;
  const i = await call(addInput, {
    method: 'POST',
    params: { id: batch.id },
    json: { inputType: 'group', inputId: groupId, from: ymd(Date.now() - 5 * DAY) }
  });
  expect(i.status).toBe(201);
  actAs(farm, 'owner');
  return batch.id;
}

function spreadOn(blockId: string, batchId: string, confirmCarryover?: string) {
  return call(spread, {
    method: 'POST',
    path: '/api/fertility/applications',
    json: {
      blockId,
      source: 'manure',
      ratePerAcre: 10,
      rateUnit: 'ton-per-acre',
      amendmentBatchId: batchId,
      ...(confirmCarryover ? { confirmCarryover } : {})
    }
  });
}

function hayBlock(): string {
  return inFarm(() => {
    const hay = createField({ name: 'Hay field', kind: 'field' });
    const block = createBlock({ name: 'Timothy', fieldId: hay.id, acres: 3 });
    addPlanting({
      blockId: block.id,
      cropPluginId: 'timothy-climax',
      varietyDisplayName: 'Timothy',
      plantingDate: Date.now() - 300 * DAY
    });
    return block.id;
  });
}

function tomatoBlock(): string {
  return inFarm(() => {
    const field = createField({ name: 'Market field', kind: 'field' });
    const block = createBlock({ name: 'Tomatoes', fieldId: field.id, acres: 0.25 });
    addPlanting({
      blockId: block.id,
      cropPluginId: 'tomato-big-beef-f1',
      varietyDisplayName: 'Big Beef',
      plantingDate: null,
      status: 'planned'
    });
    return block.id;
  });
}

beforeEach(() => {
  farm = seedFarm();
  actAs(farm, 'owner');
});

describe('POST /api/fertility/applications with a batch (M-43 to M-46)', () => {
  it('a flagged batch on a tomato block answers 409 with the facts; confirming saves the ack', async () => {
    const batchId = await goatPile();
    const blockId = tomatoBlock();
    const first = await spreadOn(blockId, batchId);
    expect(first.status).toBe(409);
    const facts = await body<CarryoverConfirmBody>(first);
    expect(facts.error).toBe('CARRYOVER_CONFIRM');
    expect(facts.state).toBe('may-carry');
    expect(facts.reasons).toEqual(['sensitive-crop']);
    expect(facts.families).toEqual(['solanaceae']);
    expect(facts.pathSentences[0]).toMatch(/^Goats grazed North pasture/);
    expect(facts.factsHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(facts)).not.toMatch(/\bsafe\b|—/i);

    const stale = await spreadOn(blockId, batchId, 'not-the-hash');
    expect(stale.status).toBe(409);

    const ok = await spreadOn(blockId, batchId, facts.factsHash);
    expect(ok.status).toBe(201);
    const saved = await body<{ application: { id: string } }>(ok);
    const ack = inFarm(() =>
      parseCarryoverAck(getFertilityApplication(saved.application.id)?.carryoverAckJson)
    );
    expect(ack).toMatchObject({
      v: 1,
      batchId,
      batchName: 'Goat pile',
      state: 'may-carry',
      factsHash: facts.factsHash,
      reasons: ['sensitive-crop'],
      families: ['solanaceae'],
      confirmedById: farm.ownerUser
    });
    expect(ack?.paths.length).toBeGreaterThan(0);
  });

  it('a flagged batch on a grass hay block saves with no prompt', async () => {
    const batchId = await goatPile();
    const res = await spreadOn(hayBlock(), batchId);
    expect(res.status).toBe(201);
    const out = await body<{ carryoverAck: unknown }>(res);
    expect(out.carryoverAck).toBeNull();
  });

  it('a garden bed prompts for a not-known bought load; a none-on-file load never prompts', async () => {
    const unknown = await boughtLoad('unknown');
    const res = await spreadOn(farm.blockId, unknown.id);
    expect(res.status).toBe(409);
    const facts = await body<CarryoverConfirmBody>(res);
    expect(facts.state).toBe('not-known');
    expect(facts.reasons).toEqual(['garden-area']);
    expect(facts.stateLabel).toBe('Not known');

    const said = await boughtLoad('says-none', 'Clean load');
    expect(said.state).toBe('none-on-file');
    expect((await spreadOn(farm.blockId, said.id)).status).toBe(201);
  });

  it('stays owner only and refuses another farm batch', async () => {
    const unknown = await boughtLoad('unknown');
    actAs(farm, 'helper');
    expect((await spreadOn(farm.blockId, unknown.id)).status).toBe(403);
    const other = seedFarm();
    actAs(other, 'owner');
    const res = await spreadOn(other.blockId, unknown.id);
    expect(res.status).toBe(400);
    expect((await body<{ error: string }>(res)).error).toBe('unknown amendmentBatchId');
  });
});

describe('after-spread lines, bioassays and dismissals (M-47 to M-49)', () => {
  async function spreadUnknown() {
    const unknown = await boughtLoad('unknown');
    const first = await body<CarryoverConfirmBody>(await spreadOn(farm.blockId, unknown.id));
    const saved = await body<{ application: { id: string } }>(
      await spreadOn(farm.blockId, unknown.id, first.factsHash)
    );
    return { batchId: unknown.id, applicationId: saved.application.id };
  }

  it('shows a warning line, mutes it after a no-damage test and drops it on dismissal', async () => {
    const { applicationId } = await spreadUnknown();
    let lines = await inFarm(() => loadCarryoverLines());
    expect(lines[farm.blockId]).toHaveLength(1);
    expect(lines[farm.blockId][0].tone).toBe('warn');
    expect(lines[farm.blockId][0].text).toMatch(
      /^Got Horse manure on .*\. Whether it carries a weed killer that harms tomatoes, beans, peas and other broadleaf crops is not known\. Consider a pea or bean test before planting\.$/
    );

    actAs(farm, 'helper');
    const t = await call(addTest, {
      method: 'POST',
      json: { blockId: farm.blockId, testedOn: ymd(Date.now()), result: 'no-damage' }
    });
    expect(t.status).toBe(201);
    lines = await inFarm(() => loadCarryoverLines());
    expect(lines[farm.blockId][0].tone).toBe('muted');
    expect(lines[farm.blockId][0].text).toMatch(/Your pea or bean test on .* showed no damage\.$/);

    const d = await call(addTest, {
      method: 'POST',
      json: { blockId: farm.blockId, testedOn: ymd(Date.now()), result: 'damage', note: 'cupped' }
    });
    expect(d.status).toBe(201);
    lines = await inFarm(() => loadCarryoverLines());
    expect(lines[farm.blockId][0].tone).toBe('warn');
    expect(lines[farm.blockId][0].text).toMatch(
      /showed damage\. Oregon State Extension says the material is likely contaminated\.$/
    );

    const helperDismiss = await call(dismiss, {
      method: 'POST',
      json: { fertilityApplicationId: applicationId, blockId: farm.blockId, reason: 'fine' }
    });
    expect(helperDismiss.status).toBe(403);

    actAs(farm, 'owner');
    const ok = await call(dismiss, {
      method: 'POST',
      json: {
        fertilityApplicationId: applicationId,
        blockId: farm.blockId,
        reason: 'Supplier records'
      }
    });
    expect(ok.status).toBe(201);
    const again = await call(dismiss, {
      method: 'POST',
      json: {
        fertilityApplicationId: applicationId,
        blockId: farm.blockId,
        reason: 'Supplier records'
      }
    });
    expect(again.status).toBe(409);
    expect((await body<{ error: string }>(again)).error).toBe('ALREADY_DISMISSED');
    lines = await inFarm(() => loadCarryoverLines());
    expect(lines[farm.blockId]).toBeUndefined();

    const dismissal = (await body<{ dismissal: { id: string } }>(ok)).dismissal;
    const back = await call(undismiss, { method: 'DELETE', params: { id: dismissal.id } });
    expect(back.status).toBe(200);
    lines = await inFarm(() => loadCarryoverLines());
    expect(lines[farm.blockId]).toHaveLength(1);
  });

  it('a test dated before the spread does not count; a batch test counts', async () => {
    const before = await call(addTest, {
      method: 'POST',
      json: { blockId: farm.blockId, testedOn: ymd(Date.now() - 10 * DAY), result: 'no-damage' }
    });
    expect(before.status).toBe(201);
    const { batchId } = await spreadUnknown();
    let lines = await inFarm(() => loadCarryoverLines());
    expect(lines[farm.blockId][0].tone).toBe('warn');
    await call(addTest, {
      method: 'POST',
      json: { batchId, testedOn: ymd(Date.now()), result: 'no-damage' }
    });
    lines = await inFarm(() => loadCarryoverLines());
    expect(lines[farm.blockId][0].tone).toBe('muted');
  });

  it('validates tests and dismissals', async () => {
    const { applicationId } = await spreadUnknown();
    const both = await call(addTest, {
      method: 'POST',
      json: { blockId: farm.blockId, batchId: 'x', testedOn: ymd(Date.now()), result: 'damage' }
    });
    expect(both.status).toBe(400);
    const future = await call(addTest, {
      method: 'POST',
      json: { blockId: farm.blockId, testedOn: ymd(Date.now() + 3 * DAY), result: 'damage' }
    });
    expect((await body<{ error: string }>(future)).error).toBe('IN_THE_FUTURE');
    actAs(farm, 'inspector');
    const insp = await call(addTest, {
      method: 'POST',
      json: { blockId: farm.blockId, testedOn: ymd(Date.now()), result: 'damage' }
    });
    expect(insp.status).toBe(403);
    const read = await call(listTests, {
      path: `/api/amendments/bioassays?blockId=${farm.blockId}`
    });
    expect(read.status).toBe(200);
    actAs(farm, 'owner');
    const mismatch = await call(dismiss, {
      method: 'POST',
      json: { fertilityApplicationId: applicationId, blockId: hayBlock(), reason: 'nope nope' }
    });
    expect((await body<{ error: string }>(mismatch)).error).toBe('BLOCK_MISMATCH');
    const short = await call(dismiss, {
      method: 'POST',
      json: { fertilityApplicationId: applicationId, blockId: farm.blockId, reason: 'no' }
    });
    expect(short.status).toBe(400);

    const t = await body<{ bioassay: { id: string } }>(
      await call(addTest, {
        method: 'POST',
        json: { blockId: farm.blockId, testedOn: ymd(Date.now()), result: 'damage' }
      })
    );
    actAs(farm, 'helper');
    expect(
      (await call(deleteTest, { method: 'DELETE', params: { id: t.bioassay.id } })).status
    ).toBe(403);
    actAs(farm, 'owner');
    expect(
      (await call(deleteTest, { method: 'DELETE', params: { id: t.bioassay.id } })).status
    ).toBe(200);
  });

  it('another farm sees none of the lines, tests or dismissals', async () => {
    const { applicationId } = await spreadUnknown();
    const other = seedFarm();
    actAs(other, 'owner');
    const lines = await runWithTenant(other.ownerId, () => loadCarryoverLines());
    expect(lines).toEqual({});
    const res = await call(dismiss, {
      method: 'POST',
      json: { fertilityApplicationId: applicationId, blockId: farm.blockId, reason: 'cross farm' }
    });
    expect(res.status).toBe(400);
    const t = await call(addTest, {
      method: 'POST',
      json: { blockId: farm.blockId, testedOn: ymd(Date.now()), result: 'no-damage' }
    });
    expect(t.status).toBe(400);
  });

  it('the offline snapshot carries the line and the offline Area Card shows it (M-52)', async () => {
    await spreadUnknown();
    const snapshot = await inFarm(() => buildFarmSnapshot());
    expect(snapshot.carryover).toEqual([
      expect.objectContaining({ blockId: farm.blockId, tone: 'warn' })
    ]);
    const card = buildAreaCard(snapshot, farm.fieldId);
    const section = card?.sections.find((s) => s.title === CARRYOVER_SECTION);
    expect(section?.items[0]).toMatch(/: Got Horse manure on /);
    expect(card?.sections.some((s) => s.title === CARRYOVER_TESTS_SECTION)).toBe(false);
  });

  it('bioassays and dismissals are not gated by the season close-out (M-64)', async () => {
    const { applicationId } = await spreadUnknown();
    inFarm(() =>
      closeSeason({
        year: new Date().getFullYear(),
        closedById: farm.ownerUser,
        plantingResolutions: [],
        harvestRollup: {},
        pendingCount: 0
      })
    );
    const t = await call(addTest, {
      method: 'POST',
      json: { blockId: farm.blockId, testedOn: ymd(Date.now()), result: 'no-damage' }
    });
    expect(t.status).toBe(201);
    const d = await call(dismiss, {
      method: 'POST',
      json: { fertilityApplicationId: applicationId, blockId: farm.blockId, reason: 'Closed year' }
    });
    expect(d.status).toBe(201);
  });
});
