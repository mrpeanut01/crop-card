// @vitest-environment node
/**
 * F2-17 (OPS-2): money is owner only, with a test on every surface. A farm
 * holds ledger entries, priced stock lots and a labour rate; every surface
 * a helper or inspector can reach is built as them and must carry no
 * ledger id, no lot cost and no dollar amount.
 *
 * F3 and F4 append their week, month and digest builders to `SURFACES`.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/pdf', () => ({
  renderPdf: async (doc: unknown) => Buffer.from(JSON.stringify(doc))
}));

import { db } from '$lib/db/client';
import { owners, taskTimeEntries, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { createStockItem, receiveLot, recordMovement } from '$lib/db/stock';
import { insertCropHarvestEvent } from '$lib/db/harvestEvents';
import { insertLedgerEntry } from '$lib/db/ledger';
import { setSetting } from '$lib/db/settings';
import { buildDeck } from '$lib/cards/build';
import { buildFarmSnapshot } from '$lib/server/cardSnapshot';
import { buildRecordCards } from '$lib/server/recordCards';
import { buildYearSummary } from '$lib/records/yearSummary.server';
import { DEFAULT_PREFS } from '$lib/prefs';
import { LABOUR_RATE_SETTING } from './profit.server';
import { GET as SNAPSHOT } from '../../routes/api/cards/snapshot/+server';
import { GET as SPRAY_CSV } from '../../routes/api/spray/records/export.csv/+server';
import { GET as USDA_CSV } from '../../routes/api/spray/records/export.usda.csv/+server';
import { GET as SPRAY_PDF } from '../../routes/api/spray/records/export.pdf/+server';
import { GET as VDACS_PDF } from '../../routes/api/records/export.vdacs.pdf/+server';
import { GET as YEAR_PDF } from '../../routes/api/records/year-summary.pdf/+server';
import { GET as GDPR } from '../../routes/api/account/export.json/+server';
import { GET as STOCK_ITEM } from '../../routes/api/stock/[id]/+server';
import { load as RECORDS_PAGE } from '../../routes/records/+page.server';
import { load as TODAY_PAGE } from '../../routes/today/+page.server';
import { load as INVENTORY_DETAIL } from '../../routes/inventory/[type]/[id]/+page.server';

const LOT_COST = 98_765;
const ENTRY_CENTS = 43_210;
const RATE = 3_917;
const SECRET = 'LEDGER-SECRET-NOTE';

type Role = 'owner' | 'helper' | 'inspector';

interface Farm {
  ownerId: string;
  entryId: string;
  harvestId: string;
  itemId: string;
}

function seed(): Farm {
  const ownerId = `leak-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  for (const role of ['owner', 'helper', 'inspector']) {
    db.insert(users)
      .values({ id: `leak-${role}`, email: `leak-${role}@test.local` })
      .onConflictDoNothing()
      .run();
  }
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Leak garden', kind: 'garden' });
    const block = createBlock({ name: 'Leak bed', fieldId: field.id, acres: 0.01 });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: 'Amish Paste'
    });
    const item = createStockItem({
      category: 'seed',
      displayName: 'Leak seed',
      defaultUnit: 'seeds'
    });
    const lot = receiveLot({
      stockItemId: item.id,
      receivedQuantity: 100,
      unit: 'seeds',
      receivedCostCents: LOT_COST
    });
    recordMovement({
      stockLotId: lot.id,
      delta: -10,
      unit: 'seeds',
      reason: 'planting',
      cropId: crop.id
    });
    const harvest = insertCropHarvestEvent({
      blockId: block.id,
      cropId: crop.id,
      cropPluginId: 'tomato-amish-paste',
      occurredAt: Date.now() - 3_600_000,
      quantity: '40 lb'
    });
    const entry = insertLedgerEntry(
      {
        kind: 'income',
        occurredAt: Date.now() - 3_600_000,
        amountCents: ENTRY_CENTS,
        category: 'produce-sale',
        description: SECRET,
        cropId: crop.id,
        harvestEventId: harvest.id
      },
      'leak-owner'
    );
    insertLedgerEntry(
      {
        kind: 'expense',
        occurredAt: Date.now() - 3_600_000,
        amountCents: LOT_COST,
        category: 'seed-and-plants',
        stockLotId: lot.id
      },
      'leak-owner'
    );
    setSetting(LABOUR_RATE_SETTING, String(RATE));
    db.insert(taskTimeEntries)
      .values(
        tenantValues({ id: randomUUID(), userId: 'leak-helper', cropId: crop.id, minutes: 60 })
      )
      .run();
    return { ownerId, entryId: entry.id, harvestId: harvest.id, itemId: item.id };
  });
}

function event(farm: Farm, role: Role, path: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost${path}`);
  return {
    url,
    params,
    request: new Request(url.href),
    locals: {
      authVia: 'cookie',
      user: {
        id: `leak-${role}`,
        email: `leak-${role}@test.local`,
        phone: null,
        role,
        activeOwnerId: farm.ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    cookies: { get: () => undefined, set: () => undefined, delete: () => undefined },
    setHeaders: () => undefined,
    getClientAddress: () => '127.0.0.1'
  } as never;
}

async function body(res: Response): Promise<string> {
  return Buffer.from(await res.arrayBuffer()).toString('utf8');
}

type Surface = [name: string, build: (farm: Farm, role: Role) => Promise<unknown>];

const SURFACES: Surface[] = [
  ['card snapshot', async () => buildFarmSnapshot({ now: Date.now(), origin: null })],
  [
    'every snapshot card',
    async () => buildDeck(await buildFarmSnapshot({ now: Date.now(), origin: null }))
  ],
  ['snapshot endpoint', async (f, r) => body(await SNAPSHOT(event(f, r, '/api/cards/snapshot')))],
  [
    'harvest record card',
    async (f) => buildRecordCards('harvest', f.harvestId, { prefs: DEFAULT_PREFS })
  ],
  [
    'spray CSV',
    async (f, r) => body(await SPRAY_CSV(event(f, r, '/api/spray/records/export.csv')))
  ],
  [
    'USDA CSV',
    async (f, r) => body(await USDA_CSV(event(f, r, '/api/spray/records/export.usda.csv')))
  ],
  [
    'spray PDF',
    async (f, r) => body(await SPRAY_PDF(event(f, r, '/api/spray/records/export.pdf')))
  ],
  [
    'VDACS PDF',
    async (f, r) => body(await VDACS_PDF(event(f, r, '/api/records/export.vdacs.pdf')))
  ],
  [
    'year summary PDF',
    async (f, r) => body(await YEAR_PDF(event(f, r, '/api/records/year-summary.pdf')))
  ],
  [
    'year summary',
    async (f, r) =>
      buildYearSummary(new Date().getFullYear(), f.ownerId, DEFAULT_PREFS, {
        includeCosts: r === 'owner'
      })
  ],
  ['GDPR export', async (f, r) => body(await GDPR(event(f, r, '/api/account/export.json')))],
  [
    'stock item API',
    async (f, r) => body(await STOCK_ITEM(event(f, r, `/api/stock/${f.itemId}`, { id: f.itemId })))
  ],
  [
    'inventory detail page',
    async (f, r) =>
      INVENTORY_DETAIL(event(f, r, `/inventory/seed/${f.itemId}`, { type: 'seed', id: f.itemId }))
  ],
  ['/records page data', async (f, r) => RECORDS_PAGE(event(f, r, '/records'))],
  ['/today page data', async (f, r) => TODAY_PAGE(event(f, r, '/today'))]
];

function moneyIn(text: string, farm: Farm): string[] {
  const hits: string[] = [];
  const needles = [
    farm.entryId,
    SECRET,
    'receivedCostCents',
    String(LOT_COST),
    String(ENTRY_CENTS),
    '987.65',
    '432.10',
    '39.17',
    LABOUR_RATE_SETTING
  ];
  for (const n of needles) if (text.includes(n)) hits.push(n);
  const dollars = /\$\s?\d/.exec(text);
  if (dollars) hits.push(text.slice(Math.max(0, dollars.index - 40), dollars.index + 20));
  return hits;
}

const serialize = (v: unknown) =>
  typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x));

describe('no money for helpers or inspectors (F2-17)', () => {
  const farm = seed();

  for (const [name, build] of SURFACES) {
    it.each(['helper', 'inspector'] as const)(`${name} as a %s`, async (role) => {
      const out = await runWithTenantAsync(farm.ownerId, () => build(farm, role));
      expect(moneyIn(serialize(out), farm)).toEqual([]);
    });
  }

  it('the owner does see the money the test looks for', async () => {
    const summary = await runWithTenantAsync(farm.ownerId, () =>
      buildYearSummary(new Date().getFullYear(), farm.ownerId, DEFAULT_PREFS, {
        includeCosts: true
      })
    );
    expect(summary.inputCosts?.totalCents).toBeGreaterThan(0);
    const gdpr = await runWithTenantAsync(farm.ownerId, async () =>
      body(await GDPR(event(farm, 'owner', '/api/account/export.json')))
    );
    expect(gdpr).toContain(farm.entryId);
    const item = await runWithTenantAsync(farm.ownerId, async () =>
      body(await STOCK_ITEM(event(farm, 'owner', `/api/stock/${farm.itemId}`, { id: farm.itemId })))
    );
    expect(item).toContain('receivedCostCents');
  });
});
