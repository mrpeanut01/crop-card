// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { equipment, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { deleteSprayEvent } from '$lib/db/admin';
import { listDispositionsForHarvests } from '$lib/db/harvestDispositions';
import { createField } from '$lib/db/fields';
import { createBlock, listBlocks } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { insertCropHarvestEvent, listHarvestEvents } from '$lib/db/harvestEvents';
import { insertHarvestDisposition, setDispositionLedgerEntry } from '$lib/db/harvestDispositions';
import { insertLedgerEntry, softDeleteLedgerEntry } from '$lib/db/ledger';
import { insertOrganicStatusEntry } from '$lib/db/organicStatus';
import { insertAnimal } from '$lib/db/animals';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { deleteHealthEvent, insertHealthEvent } from '$lib/db/animalHealth';
import { insertProductionLog } from '$lib/db/animalProduction';
import { insertStatusEvent } from '$lib/db/animalStatus';
import { buildYearSummary } from '$lib/records/yearSummary.server';
import { PACK_PREAMBLE } from '$lib/records/packCsv';
import { TREATMENT_LOG_HEADER } from '$lib/records/animalTreatmentLog';
import { tryStartPack } from './organicPack';
import { GET as PACK } from '../../routes/api/organic/pack.zip/+server';
import { GET as LOG_CSV } from '../../routes/api/animals/treatments.csv/+server';
import { GET as LOG_PDF } from '../../routes/api/animals/treatments.pdf/+server';

type Handler = (event: never) => Response | Promise<Response>;
type Role = 'owner' | 'helper' | 'inspector';

const DAY = 86_400_000;
const YEAR = new Date().getFullYear();
const WINDOW = `from=${YEAR - 1}-01-01&to=${YEAR}-12-31`;

for (const role of ['owner', 'helper', 'inspector']) {
  db.insert(users)
    .values({ id: `pack-${role}`, email: `pack-${role}@test.local` })
    .onConflictDoNothing()
    .run();
}

async function call(
  handler: unknown,
  ownerId: string,
  role: Role,
  path: string
): Promise<{ status: number; res: Response | null; error?: unknown }> {
  const url = new URL(`http://localhost${path}`);
  return runWithTenantAsync(ownerId, async () => {
    try {
      const res = await (handler as Handler)({
        params: {},
        url,
        request: new Request(url.href),
        locals: {
          authVia: 'cookie',
          user: {
            id: `pack-${role}`,
            email: `pack-${role}@test.local`,
            phone: null,
            role,
            activeOwnerId: ownerId,
            isSuperadmin: false,
            impersonating: false
          }
        },
        cookies: { get: () => undefined }
      } as never);
      return { status: res.status, res };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (!status) throw e;
      return { status, res: null, error: e };
    }
  });
}

/** Reads a store-only ZIP (no ZIP64, no data descriptors) into name → bytes. */
function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Map<string, Uint8Array>();
  let at = 0;
  while (at + 4 <= buf.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(buf.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extraLen;
    out.set(name, buf.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b ?? new Uint8Array());

interface Farm {
  ownerId: string;
  label: string;
  henName: string;
}

function seedFarm(label: string, opts: { animals?: boolean; organic?: boolean } = {}): Farm {
  const ownerId = `pack-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: `${label} farm`, slug: ownerId, billingStatus: 'active' })
    .run();
  const henName = `${label}-Henrietta`;
  runWithTenant(ownerId, () => {
    const field = createField({ name: `${label} garden`, kind: 'garden' });
    const block = createBlock({ name: `${label} bed`, fieldId: field.id, acres: 0.01 });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: `${label} Amish Paste`
    });
    const harvestAt = Date.now() - 3 * DAY;
    const harvest = insertCropHarvestEvent({
      blockId: block.id,
      cropId: crop.id,
      cropPluginId: 'tomato-amish-paste',
      occurredAt: harvestAt,
      quantity: '40 lb'
    });
    const disposition = insertHarvestDisposition(
      {
        harvestEventId: harvest.id,
        kind: 'sold',
        quantity: 30,
        unit: 'lb',
        occurredAt: harvestAt + DAY,
        recipient: `${label} market`,
        soldAsOrganic: opts.organic ? true : null
      },
      { createdBy: 'pack-owner' }
    );
    const sale = insertLedgerEntry(
      {
        kind: 'income',
        occurredAt: harvestAt + DAY,
        amountCents: 4321,
        category: 'produce-sale',
        harvestEventId: harvest.id
      },
      'pack-owner'
    );
    setDispositionLedgerEntry(disposition.id, sale.id);
    if (opts.organic) {
      insertOrganicStatusEntry({
        subjectType: 'field',
        subjectId: field.id,
        status: 'transitioning',
        effectiveAt: Date.now() - 400 * DAY,
        certifier: `${label} Certifier`,
        note: null,
        createdBy: 'pack-owner'
      });
    }
    if (opts.animals) {
      const flock = insertAnimalGroup({
        name: `${label} flock`,
        speciesId: 'chicken',
        purpose: 'production',
        headCount: 6,
        foodProducing: true
      });
      const hen = insertAnimal({
        speciesId: 'chicken',
        name: henName,
        sex: 'female',
        purpose: 'production',
        foodProducing: true
      });
      insertHealthEvent({
        subjectType: 'animal',
        subjectId: hen.id,
        kind: 'deworm',
        productName: `${label} Wormer`,
        dose: 1,
        doseUnit: 'mL',
        route: 'oral',
        labelUse: 'label',
        administeredAt: Date.now() - 10 * DAY,
        withdrawalClear: null,
        rulesVersion: 'test',
        foodProducingAtRecord: true,
        performedById: 'pack-owner'
      });
      insertHealthEvent({
        subjectType: 'group',
        subjectId: flock.id,
        kind: 'vaccination',
        productName: `${label} Vaccine`,
        administeredAt: Date.now() - 5 * DAY,
        withdrawalClear: null,
        rulesVersion: 'test',
        foodProducingAtRecord: true,
        performedById: 'pack-owner'
      });
      insertHealthEvent({
        subjectType: 'animal',
        subjectId: hen.id,
        kind: 'note',
        notes: 'looked fine',
        administeredAt: Date.now() - 4 * DAY,
        withdrawalClear: null,
        rulesVersion: 'test',
        foodProducingAtRecord: true,
        performedById: 'pack-owner'
      });
      const voided = insertHealthEvent({
        subjectType: 'animal',
        subjectId: hen.id,
        kind: 'treatment',
        productName: `${label} Never Given`,
        administeredAt: Date.now() - 3 * DAY,
        withdrawalClear: null,
        rulesVersion: 'test',
        foodProducingAtRecord: true,
        performedById: 'pack-owner'
      });
      deleteHealthEvent(voided, { deletedBy: 'pack-owner', reason: 'mistake', dosed: false });
      insertProductionLog({
        subjectType: 'group',
        subjectId: flock.id,
        kind: 'eggs',
        quantity: 12,
        unit: 'eggs',
        occurredAt: Date.now() - 2 * DAY,
        use: 'sale',
        rulesVersion: 'test',
        performedById: 'pack-owner'
      });
      insertStatusEvent({
        subjectType: 'group',
        subjectId: flock.id,
        status: 'died',
        occurredAt: Date.now() - DAY,
        headCountDelta: -1,
        recordedById: 'pack-owner'
      });
    }
  });
  return { ownerId, label, henName };
}

describe('GET /api/animals/treatments.csv (B-48, B-50)', () => {
  it('gives the owner and an inspector one header row and one row per dose', async () => {
    const farm = seedFarm('logcsv', { animals: true });
    for (const role of ['owner', 'inspector'] as const) {
      const r = await call(LOG_CSV, farm.ownerId, role, `/api/animals/treatments.csv?${WINDOW}`);
      expect(r.status, role).toBe(200);
      expect(r.res!.headers.get('content-type')).toContain('text/csv');
      const lines = (await r.res!.text()).trimEnd().split('\r\n');
      expect(lines[0].split(',')).toEqual([...TREATMENT_LOG_HEADER]);
      expect(lines).toHaveLength(4);
      const body = lines.join('\n');
      expect(body).toContain('logcsv Wormer');
      expect(body).toContain('logcsv Vaccine');
      expect(body).toContain('Voided, never given');
      expect(body).not.toContain('looked fine');
      expect(body).not.toContain('not a certification');
    }
  });

  it('refuses a helper and names a bad date', async () => {
    const farm = seedFarm('loghelper', { animals: true });
    const helper = await call(
      LOG_CSV,
      farm.ownerId,
      'helper',
      `/api/animals/treatments.csv?${WINDOW}`
    );
    expect(helper.status).toBe(403);
    const bad = await call(
      LOG_CSV,
      farm.ownerId,
      'owner',
      `/api/animals/treatments.csv?from=${YEAR}-01-01`
    );
    expect(bad.status).toBe(400);
    expect((await bad.res!.json()).issues[0].path).toBe('to');
  });

  it('never shows another farm’s doses', async () => {
    const a = seedFarm('logA', { animals: true });
    const b = seedFarm('logB', { animals: true });
    const r = await call(LOG_CSV, b.ownerId, 'owner', `/api/animals/treatments.csv?${WINDOW}`);
    const body = await r.res!.text();
    expect(body).toContain('logB Wormer');
    expect(body).not.toContain('logA');
    expect(body).not.toContain(a.henName);
  });

  it('renders the PDF for an inspector', async () => {
    const farm = seedFarm('logpdf', { animals: true });
    const r = await call(
      LOG_PDF,
      farm.ownerId,
      'inspector',
      `/api/animals/treatments.pdf?${WINDOW}`
    );
    expect(r.status).toBe(200);
    expect(r.res!.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await r.res!.arrayBuffer());
    expect(text(bytes.subarray(0, 5))).toBe('%PDF-');
  });
});

function harvestIdsOf(ownerId: string): string[] {
  return runWithTenant(ownerId, () => listHarvestEvents({}).map((h) => h.id));
}

describe('GET /api/organic/pack.zip (B-43 to B-49)', () => {
  it('streams every file, each CSV opening with the preamble', async () => {
    const farm = seedFarm('pack', { animals: true, organic: true });
    const r = await call(PACK, farm.ownerId, 'owner', `/api/organic/pack.zip?${WINDOW}`);
    expect(r.status).toBe(200);
    expect(r.res!.headers.get('content-type')).toBe('application/zip');
    const files = unzip(new Uint8Array(await r.res!.arrayBuffer()));
    expect([...files.keys()]).toEqual([
      'README.txt',
      'summary.pdf',
      '01-statuses.csv',
      '02-activity.csv',
      '03-inputs.csv',
      '04-seed-sourcing.csv',
      '05-animal-treatments.csv',
      '06-harvests.csv',
      '07-documents.csv'
    ]);
    for (const [name, bytes] of files) {
      if (!name.endsWith('.csv')) continue;
      expect(text(bytes).split('\r\n')[0], name).toBe(PACK_PREAMBLE);
    }
    expect(text(files.get('README.txt'))).toContain('This is not a certification.');
    expect(text(files.get('summary.pdf')).startsWith('%PDF-')).toBe(true);
    const statuses = text(files.get('01-statuses.csv'));
    expect(statuses).toContain('Transitioning');
    expect(statuses).toContain('pack Certifier');
    expect(statuses).toContain('owner-entered');
    expect(text(files.get('05-animal-treatments.csv'))).toContain('pack Wormer');
    const harvests = text(files.get('06-harvests.csv'));
    expect(harvests).toContain('Sale amount');
    expect(harvests).toContain('$43.21');
    expect(text(files.get('02-activity.csv'))).toContain('Harvest');
  });

  it('B-47: an inspector gets no money and a helper gets nothing', async () => {
    const farm = seedFarm('packinsp', { animals: true });
    const r = await call(PACK, farm.ownerId, 'inspector', `/api/organic/pack.zip?${WINDOW}`);
    expect(r.status).toBe(200);
    const harvests = text(unzip(new Uint8Array(await r.res!.arrayBuffer())).get('06-harvests.csv'));
    expect(harvests).toContain('Sale recorded');
    expect(harvests).not.toContain('43.21');
    expect(harvests).toMatch(/,yes\r\n/);
    const helper = await call(PACK, farm.ownerId, 'helper', `/api/organic/pack.zip?${WINDOW}`);
    expect(helper.status).toBe(403);
  });

  it('a deleted sale never reads as recorded, and kinds use the app words', async () => {
    const farm = seedFarm('packdel');
    runWithTenant(farm.ownerId, () => {
      const [list] = [...listDispositionsForHarvests(harvestIdsOf(farm.ownerId)).values()];
      softDeleteLedgerEntry(list[0].ledgerEntryId!, 'pack-owner');
      const harvestEventId = list[0].harvestEventId;
      insertHarvestDisposition(
        {
          harvestEventId,
          kind: 'donated',
          quantity: 5,
          unit: 'lb',
          occurredAt: Date.now() - DAY,
          recipient: 'Food bank',
          soldAsOrganic: null
        },
        { createdBy: 'pack-owner' }
      );
    });
    for (const role of ['owner', 'inspector'] as const) {
      const r = await call(PACK, farm.ownerId, role, `/api/organic/pack.zip?${WINDOW}`);
      const harvests = text(
        unzip(new Uint8Array(await r.res!.arrayBuffer())).get('06-harvests.csv')
      );
      expect(harvests, role).toContain('Linked sale deleted');
      expect(harvests, role).not.toMatch(/,yes\r\n/);
      expect(harvests, role).toContain('Given away');
      expect(harvests, role).not.toContain('Donated');
    }
  });

  it('a deleted spray that still counts stays in the activity and inputs', async () => {
    const farm = seedFarm('packspray', { organic: true });
    runWithTenant(farm.ownerId, () => {
      const sprayerId = `${farm.ownerId}-sprayer`;
      db.insert(equipment)
        .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Sprayer' }))
        .run();
      const [block] = listBlocks({ plantings: 'none' });
      const spray = insertSprayEvent({
        blockId: block.id,
        sprayerId,
        performedById: 'pack-owner',
        occurredAt: Date.now() - 20 * DAY,
        products: [{ pluginId: 'glyphosate-generic', chemistryClasses: ['glyphosate'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
      deleteSprayEvent(spray.id, { force: true, tombstone: true, reason: 'planting removed' });
    });
    const r = await call(PACK, farm.ownerId, 'inspector', `/api/organic/pack.zip?${WINDOW}`);
    const files = unzip(new Uint8Array(await r.res!.arrayBuffer()));
    const activity = text(files.get('02-activity.csv'));
    expect(activity).toContain('Herbicide spray (record deleted, still counted as applied)');
    expect(activity).toContain('Glyphosate 41%');
    expect(text(files.get('03-inputs.csv'))).toContain('glyphosate-generic');
  });

  it('a pack built for B never holds A’s rows', async () => {
    const a = seedFarm('crossA', { animals: true, organic: true });
    const b = seedFarm('crossB', { animals: true, organic: true });
    const r = await call(PACK, b.ownerId, 'owner', `/api/organic/pack.zip?${WINDOW}`);
    const files = unzip(new Uint8Array(await r.res!.arrayBuffer()));
    const all = [...files.entries()]
      .filter(([n]) => !n.endsWith('.pdf'))
      .map(([, v]) => text(v))
      .join('\n');
    expect(all).toContain('crossB');
    expect(all).not.toContain('crossA');
    expect(all).not.toContain(a.henName);
  });

  it('B-49: a second build for the same farm answers 429 PACK_BUSY', async () => {
    const farm = seedFarm('busy');
    const release = tryStartPack(farm.ownerId)!;
    try {
      const r = await call(PACK, farm.ownerId, 'owner', `/api/organic/pack.zip?${WINDOW}`);
      expect(r.status).toBe(429);
      expect(r.res!.headers.get('retry-after')).toBe('10');
      expect((await r.res!.json()).error).toBe('PACK_BUSY');
    } finally {
      release();
    }
    const after = await call(PACK, farm.ownerId, 'owner', `/api/organic/pack.zip?${WINDOW}`);
    expect(after.status).toBe(200);
    await after.res!.arrayBuffer();
    expect(tryStartPack(farm.ownerId)).not.toBeNull();
  });

  it('names a bad window', async () => {
    const farm = seedFarm('badwin');
    const r = await call(
      PACK,
      farm.ownerId,
      'owner',
      `/api/organic/pack.zip?from=${YEAR}-02-01&to=${YEAR}-01-01`
    );
    expect(r.status).toBe(400);
    expect((await r.res!.json()).issues[0].path).toBe('to');
  });
});

describe('year summary animal section (plan item 8)', () => {
  it('appears only for a farm with animals and never counts another farm', async () => {
    const a = seedFarm('ysA', { animals: true });
    const b = seedFarm('ysB');
    const withAnimals = await runWithTenantAsync(a.ownerId, () =>
      buildYearSummary(YEAR, a.ownerId, undefined, { includeCosts: false })
    );
    const section = withAnimals.animals!;
    expect(section).not.toBeNull();
    expect(section.treatments.map((t) => t.product).sort()).toEqual(['ysA Vaccine', 'ysA Wormer']);
    expect(section.production).toEqual([
      expect.objectContaining({ food: 'eggs', use: 'sale', quantity: 12, logs: 1 })
    ]);
    expect(section.movements).toContainEqual(
      expect.objectContaining({ speciesId: 'chicken', kind: 'died', head: 1 })
    );
    const none = await runWithTenantAsync(b.ownerId, () =>
      buildYearSummary(YEAR, b.ownerId, undefined, { includeCosts: false })
    );
    expect(none.animals).toBeNull();
  });
});

describe('never gated (B-48)', () => {
  it('a suspended farm keeps the pack and the treatment log', async () => {
    const { suspendedTenantGate } = await import('../../hooks.server');
    for (const path of [
      '/api/organic/pack.zip',
      '/api/animals/treatments.csv',
      '/api/animals/treatments.pdf'
    ]) {
      expect(suspendedTenantGate(path, 'suspended', 'GET'), path).toBe('allow');
    }
  });

  it('no export route reads the season-closed gate', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(process.cwd(), 'src/routes/api');
    for (const rel of [
      'organic/pack.zip/+server.ts',
      'animals/treatments.csv/+server.ts',
      'animals/treatments.pdf/+server.ts'
    ]) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      expect(src, rel).not.toContain('checkSeasonClosed(');
      expect(src, rel).not.toContain("from '$lib/server/seasonClose'");
    }
  });
});
