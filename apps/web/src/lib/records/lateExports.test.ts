// @vitest-environment node
/**
 * Phase 32G (G2-07..G2-09): hay cuttings ride in the spray CSV, USDA CSV
 * and VDACS PDF with the "saved after its date" marker, tenant-scoped.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import papa from 'papaparse';

const m = vi.hoisted(() => ({ ownerId: '', docs: [] as unknown[] }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({
    id: 'late-export-user',
    email: 'late@test.local',
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

import { db } from '$lib/db/client';
import { equipment, hayCuttings, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createCutting } from '$lib/db/hayCuttings';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { eq } from 'drizzle-orm';
import { GET as sprayCsv } from '../../routes/api/spray/records/export.csv/+server';
import { GET as usdaCsv } from '../../routes/api/spray/records/export.usda.csv/+server';
import { GET as vdacsPdf } from '../../routes/api/records/export.vdacs.pdf/+server';
import { listHayForExport } from './hayExport.server';

const DAY = 86_400_000;

interface Farm {
  ownerId: string;
  blockId: string;
  lateId: string;
  onTimeId: string;
  sprayId: string;
}

function seed(label: string): Farm {
  const ownerId = `late-${label}-${randomUUID()}`;
  label = `${label}-${ownerId.slice(-6)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({
      name: `${label.split('-')[0]} hay field`,
      kind: 'field',
      acres: 4
    });
    const block = createBlock({
      name: `${label.split('-')[0]} hay block`,
      fieldId: field.id,
      acres: 4
    });
    const late = createCutting({
      blockId: block.id,
      cropPluginId: 'alfalfa-vernema',
      year: 2026,
      mowAt: Date.now() - 5 * DAY - 60_000,
      performedById: 'late-export-user',
      rulesVersion: 'rv-test'
    });
    db.update(hayCuttings)
      .set({ baleMoistureHundredths: 1450 })
      .where(withTenant(hayCuttings, eq(hayCuttings.id, late.id)))
      .run();
    const onTime = createCutting({
      blockId: block.id,
      cropPluginId: 'alfalfa-vernema',
      year: 2026,
      mowAt: Date.now() - 60_000,
      rulesVersion: 'rv-test'
    });
    db.insert(equipment)
      .values(tenantValues({ id: `sprayer-${label}`, type: 'sprayer' as const, label: 'Boom' }))
      .run();
    const spray = insertSprayEvent({
      blockId: block.id,
      sprayerId: `sprayer-${label}`,
      performedById: 'late-export-user',
      occurredAt: Date.now() - 2 * DAY,
      products: [{ pluginId: '24d', chemistryClasses: ['synthetic-auxin'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'rv-test',
      pluginHashes: {}
    });
    return { ownerId, blockId: block.id, lateId: late.id, onTimeId: onTime.id, sprayId: spray.id };
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

db.insert(users)
  .values({ id: 'late-export-user', email: 'late@test.local' })
  .onConflictDoNothing()
  .run();
const a = seed('a');
const b = seed('b');

describe('listHayForExport', () => {
  it('returns only the active Owner cuttings, with the day count', () => {
    const rows = runWithTenant(a.ownerId, () => listHayForExport({}));
    expect(rows.map((r) => r.cutting.id).sort()).toEqual([a.lateId, a.onTimeId].sort());
    const late = rows.find((r) => r.cutting.id === a.lateId)!;
    expect(late.cutting.recordedLate).toBe(true);
    expect(late.daysLate).toBe(5);
    expect(rows.find((r) => r.cutting.id === a.onTimeId)!.daysLate).toBeNull();
  });

  it('filters by the mow date', () => {
    const rows = runWithTenant(a.ownerId, () =>
      listHayForExport({ fromMs: Date.now() - DAY, toMs: Date.now() })
    );
    expect(rows.map((r) => r.cutting.id)).toEqual([a.onTimeId]);
  });
});

describe('spray CSV (G2-07, G2-08)', () => {
  it('appends the new columns after every existing one', async () => {
    const { meta } = parseCsv(await (await run(a, sprayCsv, '/x')).text());
    const f = meta.fields ?? [];
    expect(f.slice(0, 3)).toEqual(['id', 'occurredAtIso', 'occurredAtLocal']);
    expect(f.slice(f.indexOf('locked'))).toEqual([
      'locked',
      'record_kind',
      'crop_commodity',
      'moisture_pct',
      'recorded_late',
      'days_after_date'
    ]);
  });

  it('adds hay rows with the late cells and leaves spray rows blank', async () => {
    const res = await run(a, sprayCsv, '/x');
    const text = await res.text();
    const { data } = parseCsv(text);
    const late = data.find((r) => r.id === a.lateId);
    expect(late).toMatchObject({
      record_kind: 'hay',
      blockId: a.blockId,
      moisture_pct: '14.5',
      recorded_late: 'yes',
      days_after_date: '5'
    });
    expect(late?.crop_commodity).toMatch(/alfalfa/i);
    expect(data.find((r) => r.id === a.onTimeId)).toMatchObject({
      record_kind: 'hay',
      recorded_late: 'no',
      days_after_date: ''
    });
    expect(data.find((r) => r.id === a.sprayId)).toMatchObject({
      record_kind: 'application',
      recorded_late: '',
      days_after_date: ''
    });
    expect(text).not.toContain(b.lateId);
    expect(text).not.toContain(b.sprayId);
  });

  it('leaves hay out when filtered to a sprayer', async () => {
    const { data } = parseCsv(
      await (await run(a, sprayCsv, `/x?sprayerId=sprayer-a-${a.ownerId.slice(-6)}`)).text()
    );
    expect(data.map((r) => r.id)).toEqual([a.sprayId]);
  });
});

describe('USDA CSV (G2-07, G2-08)', () => {
  it('ends with recorded_late and days_after_date', async () => {
    const { meta } = parseCsv(await (await run(a, usdaCsv, '/x')).text());
    expect((meta.fields ?? []).slice(-2)).toEqual(['recorded_late', 'days_after_date']);
    expect((meta.fields ?? []).slice(0, 2)).toEqual(['date_iso', 'block_label']);
  });

  it('adds a hay row per cutting and leaves untracked kinds blank', async () => {
    const text = await (await run(a, usdaCsv, '/x')).text();
    const { data } = parseCsv(text);
    const hay = data.filter((r) => r.record_kind === 'hay');
    expect(hay).toHaveLength(2);
    const late = hay.find((r) => r.recorded_late === 'yes');
    expect(late).toMatchObject({
      block_label: 'a hay block',
      applicator: 'late@test.local',
      product_name: '',
      rate_per_acre: '',
      moisture_pct: '14.5',
      days_after_date: '5'
    });
    expect(hay.find((r) => r.recorded_late === 'no')?.days_after_date).toBe('');
    for (const r of data.filter((x) => x.record_kind !== 'hay')) {
      expect(r.recorded_late).toBe('');
      expect(r.days_after_date).toBe('');
    }
    expect(text).not.toContain('b hay block');
  });
});

describe('VDACS PDF (G2-07..G2-09)', () => {
  it('lists hay rows, notes a late save in the detail cell and explains blanks', async () => {
    m.docs.length = 0;
    const res = await run(a, vdacsPdf, '/x');
    expect(res.status).toBe(200);
    const doc = JSON.stringify(m.docs[0]);
    expect(doc).toContain('Saved 5 days after its date.');
    expect(doc).toContain('cutting 1');
    expect(doc).toContain('Only hay cuttings and animal records track this');
    expect(doc).not.toContain('b hay block');
    const rows = (
      (
        m.docs[0] as { doc: { content: Array<{ table?: { body: unknown[][] } }> } }
      ).doc.content.find((c) => c.table)?.table?.body ?? []
    ).slice(1);
    const hay = rows.filter((r) => (r[1] as { text: string }).text === 'hay');
    expect(hay).toHaveLength(2);
    expect(hay.filter((r) => String(r[4]).includes('Saved'))).toHaveLength(1);
  });

  it('includes hay rows in the integrity hash (G2-09)', async () => {
    const before = (await run(a, vdacsPdf, '/x')).headers.get('X-CropCard-Integrity-Hash');
    runWithTenant(a.ownerId, () =>
      createCutting({
        blockId: a.blockId,
        cropPluginId: 'alfalfa-vernema',
        year: 2026,
        mowAt: Date.now() - 30_000,
        rulesVersion: 'rv-test'
      })
    );
    const after = (await run(a, vdacsPdf, '/x')).headers.get('X-CropCard-Integrity-Hash');
    expect(after).not.toBe(before);
  });
});
