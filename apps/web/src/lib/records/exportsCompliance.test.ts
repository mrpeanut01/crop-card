// @vitest-environment node
/**
 * #744 #759 #760 #761 #764: the compliance exports and the year summary
 * carry every pesticide kind, label ingredient names, the recorded target,
 * REI and crop, hay cuttings, and every year that holds a record. Every
 * read is tenant-scoped, so a second farm's rows never show.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import papa from 'papaparse';

const m = vi.hoisted(() => ({ ownerId: '', docs: [] as unknown[] }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({
    id: 'ct-export-user',
    email: 'a-very-long-applicator-identity-with-no-breaks@example-farm-domain.test',
    phone: null,
    role: 'owner',
    activeOwnerId: m.ownerId,
    isSuperadmin: false
  });
  return { currentUser: user, requireUser: user };
});

vi.mock('$lib/server/pdf', () => ({
  renderPdf: async (doc: unknown) => {
    m.docs.push(doc);
    return Buffer.from('%PDF');
  }
}));

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { equipment, hayCuttings, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { createCutting } from '$lib/db/hayCuttings';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { insertInsecticideEvent } from '$lib/db/insecticideEvents';
import { insertFungicideEvent } from '$lib/db/fungicideEvents';
import { VDACS_CONTENT_WIDTH, VDACS_TABLE_WIDTHS } from '$lib/server/render/docs/vdacs';
import { GET as sprayCsv } from '../../routes/api/spray/records/export.csv/+server';
import { GET as sprayPdf } from '../../routes/api/spray/records/export.pdf/+server';
import { GET as usdaCsv } from '../../routes/api/spray/records/export.usda.csv/+server';
import { GET as vdacsPdf } from '../../routes/api/records/export.vdacs.pdf/+server';
import { buildYearSummary } from './yearSummary.server';
import { defaultSummaryYear, listYearsWithRecords, yearsInZone } from './recordYears.server';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const TZ = 'America/New_York';
const OLD_YEAR = 2019;

interface Farm {
  ownerId: string;
  blockId: string;
  sprayId: string;
  insId: string;
  funId: string;
  hayId: string;
  tag: string;
}

function seed(label: string): Farm {
  const ownerId = `ct-exp-${label}-${randomUUID()}`;
  const tag = `${label}${ownerId.slice(-6)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `field ${tag}`, kind: 'field', acres: 10 });
    const block = createBlock({ name: `block ${tag}`, fieldId: field.id, acres: 10 });
    const wheat = createPlanned({
      blockId: block.id,
      cropPluginId: 'wheat-hard-white-winter',
      varietyDisplayName: 'Wheat'
    });
    db.insert(equipment)
      .values(tenantValues({ id: `sprayer-${tag}`, type: 'sprayer' as const, label: 'Boom' }))
      .run();
    const now = Date.now();
    const spray = insertSprayEvent({
      blockId: block.id,
      cropId: wheat.id,
      sprayerId: `sprayer-${tag}`,
      performedById: 'ct-export-user',
      occurredAt: now - 3 * DAY,
      products: [
        {
          pluginId: '24d',
          chemistryClasses: ['synthetic-auxin'],
          rate: { amount: 1, unit: 'pt' }
        }
      ],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'rv-test',
      pluginHashes: {}
    });
    const ins = insertInsecticideEvent({
      blockId: block.id,
      cropId: wheat.id,
      sprayerId: `sprayer-${tag}`,
      performedById: 'ct-export-user',
      occurredAt: now - 2 * DAY,
      products: [
        {
          pluginId: 'warrior-ii-with-zeon',
          displayName: 'Warrior II',
          iracGroups: ['3A'],
          rate: { amount: 2, unit: 'fl-oz/A' }
        }
      ],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      reEntryClearAt: now - 2 * DAY + 24 * HOUR,
      rulesVersion: 'rv-test',
      pluginHashes: {}
    });
    const fun = insertFungicideEvent({
      blockId: block.id,
      cropId: wheat.id,
      performedById: 'ct-export-user',
      occurredAt: now - DAY,
      products: [
        {
          pluginId: 'folicur-36f-tebuconazole',
          displayName: 'Folicur 3.6 F',
          fracCodes: ['3'],
          rate: { amount: 4, unit: 'fl-oz/A' }
        }
      ],
      diseaseObservation: { disease: 'Fusarium head blight', metric: 'risk', value: 1 },
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      reEntryClearAt: now - DAY + 12 * HOUR,
      rulesVersion: 'rv-test',
      pluginHashes: {}
    });
    const hay = createCutting({
      blockId: block.id,
      cropPluginId: 'alfalfa-vernema',
      year: new Date(now).getFullYear(),
      mowAt: now - 4 * DAY,
      performedById: 'ct-export-user',
      rulesVersion: 'rv-test'
    });
    db.update(hayCuttings)
      .set({ baleType: 'small-square', balesQuantity: 400, baleMoistureHundredths: 1450 })
      .where(withTenant(hayCuttings, eq(hayCuttings.id, hay.id)))
      .run();
    return {
      ownerId,
      blockId: block.id,
      sprayId: spray.id,
      insId: ins.id,
      funId: fun.id,
      hayId: hay.id,
      tag
    };
  });
}

async function run(
  farm: Farm,
  handler: (event: never) => Response | Promise<Response>,
  path: string
): Promise<Response> {
  m.ownerId = farm.ownerId;
  return runWithTenantAsync(farm.ownerId, async () =>
    handler({ locals: {}, url: new URL(`http://localhost${path}`) } as never)
  );
}

function parseCsv(text: string) {
  const body = text
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#'))
    .join('\n');
  return papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
}

function tableRows(doc: unknown): unknown[][] {
  const content = (doc as { doc: { content: Array<{ table?: { body: unknown[][] } }> } }).doc
    .content;
  return content.find((c) => c.table)?.table?.body ?? [];
}

db.insert(users)
  .values({
    id: 'ct-export-user',
    email: 'a-very-long-applicator-identity-with-no-breaks@example-farm-domain.test'
  })
  .onConflictDoNothing()
  .run();
const a = seed('a');
const b = seed('b');

describe('USDA CSV (#760)', () => {
  it('names label active ingredients and moves MoA groups to mode_of_action', async () => {
    const text = await (await run(a, usdaCsv, '/x')).text();
    const { data, meta } = parseCsv(text);
    expect((meta.fields ?? []).slice(-4)).toEqual([
      'mode_of_action',
      'total_amount_unit',
      'harvest_quantity',
      'rei_hours'
    ]);
    const warrior = data.find((r) => r.product_name === 'Warrior II')!;
    expect(warrior.active_ingredients).toBe('lambda-cyhalothrin');
    expect(warrior.mode_of_action).toBe('IRAC 3A');
    expect(warrior.rei_hours).toBe('24');
    expect(warrior.total_amount_applied).toBe('20');
    expect(warrior.total_amount_unit).toBe('fl-oz');
    const folicur = data.find((r) => r.product_name === 'Folicur 3.6 F')!;
    expect(folicur.active_ingredients).toBe('tebuconazole');
    expect(folicur.mode_of_action).toBe('FRAC 3');
    expect(folicur.target_pest).toBe('Fusarium head blight');
    expect(folicur.crop_commodity).toMatch(/wheat/i);
    const herb = data.find((r) => r.mode_of_action === 'synthetic-auxin')!;
    expect(herb.active_ingredients).not.toBe('synthetic-auxin');
    expect(herb.active_ingredients.length).toBeGreaterThan(0);
    expect(herb.rei_hours).toBe('');
    expect(text).not.toContain(b.tag);
  });

  it('leaves target_pest blank when nothing was recorded, never the label list', async () => {
    const { data } = parseCsv(await (await run(a, usdaCsv, '/x')).text());
    expect(data.find((r) => r.product_name === 'Warrior II')!.target_pest).toBe('');
  });
});

describe('records CSV and PDF (#761)', () => {
  it('lists insecticide and fungicide applications with product names', async () => {
    const text = await (await run(a, sprayCsv, '/x')).text();
    const { data, meta } = parseCsv(text);
    expect((meta.fields ?? []).slice(-2)).toEqual(['pesticide_type', 'product_names']);
    expect(data.find((r) => r.id === a.sprayId)?.pesticide_type).toBe('herbicide');
    expect(data.find((r) => r.id === a.insId)).toMatchObject({
      record_kind: 'application',
      pesticide_type: 'insecticide',
      products: 'warrior-ii-with-zeon',
      product_names: 'Warrior II',
      chemistryClasses: 'IRAC 3A'
    });
    expect(data.find((r) => r.id === a.funId)).toMatchObject({
      pesticide_type: 'fungicide',
      product_names: 'Folicur 3.6 F',
      chemistryClasses: 'FRAC 3',
      sprayerName: ''
    });
    expect(data.find((r) => r.id === a.hayId)?.record_kind).toBe('hay');
    expect(text).not.toContain(b.insId);
  });

  it('keeps a sprayer filter to that sprayer', async () => {
    const { data } = parseCsv(
      await (await run(a, sprayCsv, `/x?sprayerId=sprayer-${a.tag}`)).text()
    );
    expect(data.map((r) => r.id).sort()).toEqual([a.insId, a.sprayId].sort());
  });

  it('puts every kind in the PDF with names and no undrawable symbols', async () => {
    m.docs.length = 0;
    const res = await run(a, sprayPdf, '/x');
    expect(res.status).toBe(200);
    const rows = tableRows(m.docs[0]).slice(1);
    expect(rows).toHaveLength(3);
    const json = JSON.stringify(rows);
    expect(json).toContain('Warrior II');
    expect(json).toContain('Folicur 3.6 F');
    expect(json).toContain('insecticide');
    expect(json).not.toMatch(/[\u{1F512}⚠]/u);
    expect(json).not.toContain(b.tag);
  });
});

describe('VDACS audit PDF (#759)', () => {
  it('fits landscape Letter with fixed widths', () => {
    const fixed = VDACS_TABLE_WIDTHS.filter((w): w is number => typeof w === 'number');
    expect(VDACS_TABLE_WIDTHS.filter((w) => w === '*')).toHaveLength(1);
    expect(VDACS_TABLE_WIDTHS).not.toContain('auto');
    const n = VDACS_TABLE_WIDTHS.length;
    const padding = 8 * (n - 1) + (n + 1);
    const productWidth = VDACS_CONTENT_WIDTH - padding - fixed.reduce((s, w) => s + w, 0);
    expect(productWidth).toBeGreaterThanOrEqual(90);
  });

  it('has crop, target and REI cells and wraps the applicator', async () => {
    m.docs.length = 0;
    await run(a, vdacsPdf, '/x');
    const body = tableRows(m.docs[0]);
    const header = (body[0] as Array<{ text: string }>).map((c) => c.text);
    expect(header).toHaveLength(VDACS_TABLE_WIDTHS.length);
    expect(header).toEqual(expect.arrayContaining(['Block / crop', 'Target', 'REI']));
    const col = (name: string) => header.indexOf(name);
    const rowOf = (kind: string) =>
      body.slice(1).find((r) => (r[1] as { text: string }).text === kind)!;
    const ins = rowOf('insecticide');
    expect(String(ins[col('Block / crop')])).toMatch(/wheat/i);
    expect(ins[col('Target')]).toBe('Not recorded');
    expect(ins[col('REI')]).toBe('24 h');
    expect(ins[col('Applicator')]).toMatchObject({ wordBreak: 'break-all' });
    const fun = rowOf('fungicide');
    expect(fun[col('Target')]).toBe('Fusarium head blight');
    expect(fun[col('REI')]).toBe('12 h');
    expect(rowOf('spray')[col('REI')]).toBe('Not on file');
    expect(JSON.stringify(body)).not.toContain(b.tag);
  });
});

describe('year summary (#760 #764)', () => {
  it('counts hay cuttings and labels MoA groups', async () => {
    const year = new Date().getFullYear();
    const summary = await runWithTenantAsync(a.ownerId, () =>
      buildYearSummary(year, a.ownerId, { timeZone: TZ }, { includeCosts: false })
    );
    expect(summary.hay).toMatchObject({
      cuttingCount: 1,
      blockCount: 1,
      bales: [{ baleType: 'small-square', count: 400 }],
      moisture: { sampleCount: 1, mean: 14.5 }
    });
    const classes = summary.chemistryClassAcreage.map((c) => c.className);
    expect(classes).toEqual(expect.arrayContaining(['IRAC 3A', 'FRAC 3']));
    expect(classes).not.toContain('3');
    expect(classes).not.toContain('3A');
  });
});

describe('years with records (#744)', () => {
  it('offers a year that holds only records, for this farm only', () => {
    const c = seed('c');
    runWithTenant(c.ownerId, () =>
      createCutting({
        blockId: c.blockId,
        cropPluginId: 'alfalfa-vernema',
        year: OLD_YEAR,
        mowAt: Date.UTC(OLD_YEAR, 5, 1),
        rulesVersion: 'rv-test'
      })
    );
    expect(runWithTenant(c.ownerId, () => listYearsWithRecords(TZ))).toContain(OLD_YEAR);
    expect(runWithTenant(a.ownerId, () => listYearsWithRecords(TZ))).not.toContain(OLD_YEAR);
  });

  it('reads the year in the farm zone', () => {
    const lateNewYearsEve = Date.UTC(2026, 0, 1, 3);
    expect([...yearsInZone([lateNewYearsEve], TZ)]).toEqual([2025]);
    expect([...yearsInZone([lateNewYearsEve], 'UTC')]).toEqual([2026]);
  });

  it('opens on the latest earlier year when the current year has none', () => {
    expect(defaultSummaryYear(2027, [2027, 2026])).toBe(2027);
    expect(defaultSummaryYear(2027, [2028, 2026, 2024])).toBe(2026);
    expect(defaultSummaryYear(2027, [2028])).toBe(2027);
    expect(defaultSummaryYear(2027, [])).toBe(2027);
  });
});
