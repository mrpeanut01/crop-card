// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getTableName, type Table } from 'drizzle-orm';
import { db } from '../client';
import * as schema from '../schema';
import { helperAssignments, ownerSubscriptions, owners, users } from '../schema';
import { runWithTenant, runWithTenantAsync, unscopedQueryNote } from '../tenant';
import { listBlocks } from '../blocks';
import { listCrops } from '../crops';
import { listTasks } from '../tasks';
import { listLotsForItem, listStockItems, lowStockItems } from '../stock';
import { listEquipment } from '../equipment';
import { listSprayers } from '../sprayers';
import { listAnimals } from '../animals';
import { listAnimalGroups } from '../animalGroups';
import { listLedgerEntries } from '../ledger';
import { listUnifiedRecords } from '../recordsUnified';
import { listFields } from '../fields';
import { listCuttings } from '../hayCuttings';
import { listSprayEvents } from '../sprayEvents';
import { listFungicideEvents } from '../fungicideEvents';
import { getSetting } from '../settings';
import { seedDemoFarm, DEMO_FARM_NAME } from './seed';
import { needsDecon } from '$lib/equipment/decon';
import { getOnboardingStatus, getGettingStartedDismissedAt } from '$lib/onboarding/state.server';
import { getAiMonthlyUsdCapSetting, hasFarmLatLon } from '$lib/schedule/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { getActivePlanningYear } from '$lib/season/planningYear.server';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { loadSeasonView } from '$lib/today/seasonView.server';
import { getRegistry } from '$lib/server/registry';
import { eventsForPlanting } from '$lib/calendar/engine';
import type { CropPlugin } from '$lib/plugins/schemas';
import { materializeCareTasks } from '$lib/server/carePlans';
import { buildFarmSnapshot } from '$lib/server/cardSnapshot';
import { loadSeasonMoney } from '$lib/finance/profit.server';
import { projectAsGuard } from '$lib/server/holdGuard';
import { addDaysYmd, demoSeason, utcDayMs, zonedMs } from '$lib/demo/time';

const TENANT_TABLE_EXPORTS: string[] = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../../packages/eslint-plugin-cropcard/tenant-scoped-tables.json',
      import.meta.url
    ),
    'utf8'
  )
);
const TENANT_TABLES: string[] = TENANT_TABLE_EXPORTS.flatMap((name) => {
  const t = (schema as Record<string, unknown>)[name];
  return t && typeof t === 'object' ? [getTableName(t as Table)] : [];
});

/** Columns that date a record: none may be after `now`. */
const RECORD_DATE_COLUMNS: Array<[string, string[]]> = [
  ['spray_events', ['occurred_at']],
  ['insecticide_events', ['occurred_at']],
  ['fungicide_events', ['occurred_at']],
  ['harvest_events', ['occurred_at']],
  ['hay_cuttings', ['mow_at', 'ted_at', 'rake_at', 'bale_at', 'stored_at']],
  ['scout_observations', ['occurred_at']],
  ['fertility_applications', ['occurred_at']],
  ['soil_tests', ['sampled_at']],
  ['irrigation_events', ['occurred_at']],
  ['rain_gauge_readings', ['read_at']],
  ['animal_production_logs', ['occurred_at']],
  ['animal_locations', ['from_ms']],
  ['stock_movements', ['occurred_at']],
  ['ledger_entries', ['occurred_at']],
  ['planting_journal', ['created_at']],
  ['seed_starts', ['sown_at', 'germinated_at', 'harden_started_at', 'transplanted_at']],
  ['equipment_log', ['occurred_at']],
  ['crops', ['harvested_at']],
  ['tasks', ['completed_at']]
];

function createDemoOwner(now: number): { ownerId: string; userId: string } {
  unscopedQueryNote('test fixture writes the demo lifecycle rows');
  const ownerId = `owner_demo_${randomUUID().slice(0, 12)}`;
  const userId = randomUUID();
  const at = new Date(now);
  db.transaction(() => {
    db.insert(users)
      .values({
        id: userId,
        email: `${userId}@demo.cropcard.invalid`,
        timeZone: 'America/New_York',
        createdAt: at
      })
      .run();
    db.insert(owners)
      .values({
        id: ownerId,
        name: DEMO_FARM_NAME,
        slug: ownerId,
        billingStatus: 'active',
        createdAt: at
      })
      .run();
    db.insert(helperAssignments)
      .values({
        ownerId,
        userId,
        roleWithinOwner: 'owner',
        acceptedAt: at,
        status: 'active',
        createdAt: at
      })
      .run();
    db.insert(ownerSubscriptions)
      .values({ ownerId, planCode: 'free', status: 'active', createdAt: at, updatedAt: at })
      .run();
  });
  return { ownerId, userId };
}

function countByOwner(ownerId: string): Record<string, number> {
  unscopedQueryNote('test counts every tenant table for one owner');
  const out: Record<string, number> = {};
  for (const table of TENANT_TABLES) {
    const row = db.$client
      .prepare(`SELECT count(*) AS n FROM "${table}" WHERE owner_id = ?`)
      .get(ownerId) as { n: number };
    out[table] = row.n;
  }
  return out;
}

function totalRows(): Record<string, number> {
  unscopedQueryNote('test counts every tenant table');
  const out: Record<string, number> = {};
  for (const table of TENANT_TABLES) {
    const row = db.$client.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number };
    out[table] = row.n;
  }
  return out;
}

function lateRows(ownerId: string, now: number): string[] {
  unscopedQueryNote('test checks record dates for one owner');
  const out: string[] = [];
  for (const [table, cols] of RECORD_DATE_COLUMNS) {
    for (const col of cols) {
      const row = db.$client
        .prepare(`SELECT count(*) AS n FROM "${table}" WHERE owner_id = ? AND "${col}" > ?`)
        .get(ownerId, now) as { n: number };
      if (row.n > 0) out.push(`${table}.${col}: ${row.n}`);
    }
  }
  return out;
}

const NOWS = [
  '2027-01-15',
  '2026-03-20',
  '2026-05-10',
  '2026-07-15',
  '2026-10-02',
  '2026-12-10',
  '2028-02-29'
];

describe.each(NOWS)('seedDemoFarm on %s', (ymd) => {
  const now = zonedMs(ymd, 11, 20);

  it('seeds a believable farm that every main page can read', async () => {
    const { ownerId, userId } = createDemoOwner(now);
    const before = totalRows();
    const started = performance.now();
    const summary = runWithTenant(ownerId, () => seedDemoFarm({ ownerId, userId, now }));
    const elapsed = performance.now() - started;

    expect(summary.farmName).toBe('Willow Run Farm');
    expect(summary.seasonYear).toBe(demoSeason(now).current);
    expect(elapsed).toBeLessThan(3000);

    // Every row the seed wrote is this owner's.
    const after = totalRows();
    const mine = countByOwner(ownerId);
    for (const table of TENANT_TABLES) {
      expect({ table, added: after[table] - before[table] }).toEqual({
        table,
        added: mine[table]
      });
    }
    const total = Object.values(mine).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(250);
    expect(total).toBeLessThan(1500);

    expect(lateRows(ownerId, now)).toEqual([]);

    await runWithTenantAsync(ownerId, async () => {
      const season = demoSeason(now);
      const today = season.today;

      // Settings: no setup nudges, onboarding done, AI off.
      expect(getOnboardingStatus()).toBe('complete');
      expect(getGettingStartedDismissedAt()).not.toBeNull();
      expect(getAiMonthlyUsdCapSetting()).toBe(0);
      expect(hasFarmLatLon()).toBe(true);
      expect(getSetting(SETTINGS_KEYS.lastFrost)).toBe('04-20');
      expect(getSetting(SETTINGS_KEYS.firstFrost)).toBe('10-18');
      const planningYear = getActivePlanningYear(new Date(now));
      expect(planningYear).toBe(season.planningYear);
      expect(loadSeasonSetup(planningYear)).not.toBeNull();
      expect(loadSeasonSetup(season.current)).not.toBeNull();

      // /today: open work across the next two weeks.
      const open = listTasks({
        fromMs: utcDayMs(today),
        toMs: utcDayMs(addDaysYmd(today, 14)),
        status: 'open'
      });
      expect(open.filter((t) => t.kind === 'primary').length).toBeGreaterThanOrEqual(8);
      const later = listTasks({
        fromMs: utcDayMs(addDaysYmd(today, 15)),
        toMs: utcDayMs(addDaysYmd(today, 60)),
        status: 'open'
      });
      expect(later.length).toBeGreaterThanOrEqual(5);
      const care = materializeCareTasks(now, 'America/New_York');
      expect(care.open.length).toBeGreaterThanOrEqual(3);

      const blocks = listBlocks({ plantings: 'current', now });
      expect(blocks.length).toBe(16);
      const registry = await getRegistry();
      for (const b of blocks) {
        for (const p of b.plantings) {
          const rec = registry.get(p.cropPluginId);
          expect(rec?.plugin.type).toBe('crop');
          eventsForPlanting(p, rec!.plugin as CropPlugin, { blockPlantings: b.plantings });
        }
      }
      // Spray records carry the same plugin hashes the record endpoints write.
      for (const e of [...listSprayEvents(), ...listFungicideEvents()]) {
        for (const [id, hash] of Object.entries(e.pluginHashes)) {
          expect(hash).toBe(registry.get(id)?.hash);
        }
      }
      const season_ = loadSeasonView(registry, null, now);
      expect(season_.timeline).toBeDefined();

      // Plantings in the states the season implies.
      const statuses = new Set(listCrops().map((c) => c.status));
      expect(statuses.has('active')).toBe(true);
      expect(statuses.has('harvested')).toBe(true);
      if (season.nextSeasonPlanned || ymd.slice(5) < '06-01')
        expect(statuses.has('planned')).toBe(true);

      // /equipment and the decon alert: only the orchard sprayer is dirty.
      expect(listEquipment().length).toBe(10);
      const sprayers = listSprayers();
      expect(sprayers).toHaveLength(3);
      const dirty = sprayers.filter((s) =>
        needsDecon({
          lastChemistryClass: s.lastChemistryClass,
          lastUsedAt: s.lastSprayedAt,
          lastDeconAt: s.lastDeconAt
        })
      );
      expect(dirty.map((s) => s.label)).toEqual(['25 gal ATV/UTV-mount sprayer']);
      expect(sprayers.every((s) => s.calibratedGpa !== null && s.templateId)).toBe(true);

      // /inventory.
      const stock = listStockItems();
      expect(stock.length).toBeGreaterThan(20);
      expect(stock.every((i) => i.onHand >= 0)).toBe(true);
      expect(lowStockItems().length).toBeGreaterThanOrEqual(2);
      const expiring = stock.flatMap((i) =>
        listLotsForItem(i.id).filter(
          (l) =>
            l.expiresAt !== undefined && l.expiresAt > now && l.expiresAt < now + 30 * 86_400_000
        )
      );
      expect(expiring.length).toBeGreaterThanOrEqual(1);
      expect(stock.some((i) => i.category === 'seed' && i.onOrder > 0)).toBe(true);
      expect(stock.some((i) => i.category === 'seed' && i.planned > 0)).toBe(true);

      // /records.
      const records = listUnifiedRecords({});
      expect(records.length).toBeGreaterThan(30);
      expect(records.some((r) => r.occurredAt > now - 48 * 3_600_000)).toBe(true);
      expect(listCuttings({}).length).toBeGreaterThanOrEqual(2);

      // /animals.
      expect(listAnimalGroups().length).toBe(2);
      expect(listAnimals().length).toBe(4);

      // /finance.
      expect(listLedgerEntries().length).toBeGreaterThan(5);
      await loadSeasonMoney(season.current);

      // Offline Cards and the hold guard's view of the farm.
      const snapshot = await buildFarmSnapshot({ now });
      expect(snapshot).toBeDefined();
      // Sprayed crop blocks carry the usual hay holds; nothing holds the
      // animals, their food, the pasture or the hay meadow.
      const holds = await projectAsGuard('America/New_York', now);
      const hayMeadow = listBlocks().find((b) => b.name === 'Hay Meadow')!.id;
      const pasture = listFields().find((f) => f.name === 'Goat Pasture')!.id;
      const held = [...holds.holds.keys()].filter(
        (k) =>
          k.startsWith('animal:') ||
          k.startsWith('group:') ||
          k.includes(hayMeadow) ||
          k.includes(pasture)
      );
      expect(held).toEqual([]);
      expect(holds.covered.size).toBe(0);

      expect(listFields().length).toBe(9);
    });
  }, 30_000);
});

describe('two demo farms side by side', () => {
  it('never see each other’s rows', async () => {
    const now = zonedMs('2026-08-01', 9);
    const a = createDemoOwner(now);
    const b = createDemoOwner(now);
    runWithTenant(a.ownerId, () => seedDemoFarm({ ...a, now }));
    const aCounts = countByOwner(a.ownerId);
    runWithTenant(b.ownerId, () => seedDemoFarm({ ...b, now }));
    expect(countByOwner(a.ownerId)).toEqual(aCounts);
    expect(countByOwner(b.ownerId)).toEqual(aCounts);

    const ids = (ownerId: string) =>
      runWithTenant(ownerId, () => ({
        blocks: listBlocks().map((x) => x.id),
        crops: listCrops().map((x) => x.id),
        tasks: listTasks({}).map((x) => x.id),
        stock: listStockItems().map((x) => x.id),
        ledger: listLedgerEntries().map((x) => x.id),
        animals: listAnimals().map((x) => x.id)
      }));
    const ia = ids(a.ownerId);
    const ib = ids(b.ownerId);
    for (const key of Object.keys(ia) as Array<keyof typeof ia>) {
      expect(ia[key].length).toBeGreaterThan(0);
      expect(ia[key].filter((id) => ib[key].includes(id))).toEqual([]);
    }
  }, 30_000);

  it('refuses to run outside the owner’s tenant', () => {
    const now = zonedMs('2026-08-01', 9);
    const a = createDemoOwner(now);
    expect(() => runWithTenant('owner_somebody_else', () => seedDemoFarm({ ...a, now }))).toThrow();
  });
});
