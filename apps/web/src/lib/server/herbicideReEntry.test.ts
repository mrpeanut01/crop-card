// @vitest-environment node
/**
 * #640: a herbicide spray shows in the active re-entry banner, on its record
 * card and in the USDA CSV's rei_hours once its plugin has an REI on file,
 * and drops out of the banner when the window ends. A herbicide with no REI
 * on file never shows. The REI here comes from a test-only copy of a shipped
 * herbicide; no shipped plugin carries one.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import papa from 'papaparse';
import type { PluginRegistry } from '$lib/plugins';

const m = vi.hoisted(() => ({ ownerId: '', registry: null as unknown }));

vi.mock('$lib/server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry')>();
  return {
    ...actual,
    getRegistry: async () => (m.registry as PluginRegistry | null) ?? actual.getRegistry()
  };
});

vi.mock('$lib/server/auth', () => {
  const user = () => ({
    id: 'herb-rei-user',
    email: 'herb-rei@example.test',
    phone: null,
    role: 'owner',
    activeOwnerId: m.ownerId,
    isSuperadmin: false
  });
  return { currentUser: user, requireUser: user };
});

import { db } from '$lib/db/client';
import { equipment, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { getSprayEvent, insertSprayEvent } from '$lib/db/sprayEvents';
import { DEFAULT_PREFS } from '$lib/prefs';
import { getBaseRegistry } from './registry';
import {
  activeHerbicideReEntryRestrictions,
  herbicideReEntryClearAtFor,
  longestHerbicideReiHours
} from './herbicideReEntry';
import { buildRecordCards } from './recordCards';
import { GET as usdaCsv } from '../../routes/api/spray/records/export.usda.csv/+server';

const HOUR = 3_600_000;
const FIXTURE_ID = 'test-herbicide-rei-fixture';
const NO_REI_ID = '24d';

let registry: PluginRegistry;

beforeAll(async () => {
  const base = await getBaseRegistry();
  const source = base.get(NO_REI_ID)?.plugin;
  if (!source || source.type !== 'herbicide') throw new Error('24d herbicide missing');
  expect(source.reEntryIntervalHours).toBeUndefined();
  const { registry: view, failures } = base.withOverlay(
    [],
    [
      {
        ...structuredClone(source),
        pluginId: FIXTURE_ID,
        displayName: 'REI fixture herbicide',
        reEntryIntervalHours: 12
      }
    ]
  );
  expect(failures).toEqual([]);
  registry = view;
  m.registry = view;
});

db.insert(users)
  .values({ id: 'herb-rei-user', email: 'herb-rei@example.test' })
  .onConflictDoNothing()
  .run();

function seedFarm(label: string) {
  const ownerId = `herb-rei-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `Field ${label}`, kind: 'field', acres: 5 });
    const block = createBlock({ name: `Block ${label}`, fieldId: field.id, acres: 5 });
    const sprayerId = `sprayer-${ownerId}`;
    db.insert(equipment)
      .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Boom' }))
      .run();
    return { ownerId, blockId: block.id, sprayerId };
  });
}

function spray(
  farm: ReturnType<typeof seedFarm>,
  pluginIds: string[],
  occurredAt: number,
  reEntryClearAt?: number
) {
  return runWithTenant(farm.ownerId, () =>
    insertSprayEvent({
      blockId: farm.blockId,
      sprayerId: farm.sprayerId,
      performedById: 'herb-rei-user',
      occurredAt,
      products: pluginIds.map((pluginId) => ({
        pluginId,
        chemistryClasses: ['synthetic-auxin'],
        rate: { amount: 1, unit: 'pt' }
      })),
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'rv-test',
      pluginHashes: {},
      ...(reEntryClearAt !== undefined ? { reEntryClearAt } : {})
    })
  );
}

const NOW = Date.now();

describe('herbicide re-entry banner (#640)', () => {
  it('reads the longest herbicide REI from the library for the lookback', () => {
    expect(longestHerbicideReiHours(registry)).toBeGreaterThanOrEqual(12);
  });

  it('shows a sourced herbicide spray inside its REI and drops it after', () => {
    const farm = seedFarm('window');
    const ev = spray(farm, [FIXTURE_ID], NOW - 2 * HOUR);
    const inside = runWithTenant(farm.ownerId, () =>
      activeHerbicideReEntryRestrictions(registry, NOW)
    );
    expect(inside).toEqual([
      { id: ev.id, blockId: farm.blockId, reEntryClearAt: NOW + 10 * HOUR, complete: true }
    ]);
    const after = runWithTenant(farm.ownerId, () =>
      activeHerbicideReEntryRestrictions(registry, NOW + 11 * HOUR)
    );
    expect(after).toEqual([]);
  });

  it('never lists a herbicide with no REI on file', () => {
    const farm = seedFarm('none');
    spray(farm, [NO_REI_ID], NOW - HOUR);
    spray(farm, [NO_REI_ID], NOW);
    expect(
      runWithTenant(farm.ownerId, () => activeHerbicideReEntryRestrictions(registry, NOW))
    ).toEqual([]);
  });

  it('keeps a stored clear time longer than the library value', () => {
    const farm = seedFarm('stored');
    const ev = spray(farm, [FIXTURE_ID], NOW - 20 * HOUR, NOW - 20 * HOUR + 48 * HOUR);
    expect(
      runWithTenant(farm.ownerId, () => activeHerbicideReEntryRestrictions(registry, NOW))
    ).toEqual([
      { id: ev.id, blockId: farm.blockId, reEntryClearAt: NOW + 28 * HOUR, complete: true }
    ]);
  });

  it('flags a tank where another herbicide has no REI on file', () => {
    const farm = seedFarm('partial');
    const ev = spray(farm, [FIXTURE_ID, NO_REI_ID], NOW - HOUR);
    const [row] = runWithTenant(farm.ownerId, () =>
      activeHerbicideReEntryRestrictions(registry, NOW)
    );
    expect(row).toMatchObject({ id: ev.id, complete: false, reEntryClearAt: NOW + 11 * HOUR });
    const stored = runWithTenant(farm.ownerId, () => getSprayEvent(ev.id))!;
    expect(herbicideReEntryClearAtFor(registry, stored)).toBeNull();
  });

  it("never shows another farm's spray", () => {
    const a = seedFarm('tenant-a');
    const b = seedFarm('tenant-b');
    spray(b, [FIXTURE_ID], NOW - HOUR);
    expect(
      runWithTenant(a.ownerId, () => activeHerbicideReEntryRestrictions(registry, NOW))
    ).toEqual([]);
  });
});

describe('herbicide REI on records (#640)', () => {
  it('stores and reads back the clear time on the spray record', () => {
    const farm = seedFarm('roundtrip');
    const ev = spray(farm, [FIXTURE_ID], NOW, NOW + 12 * HOUR);
    expect(runWithTenant(farm.ownerId, () => getSprayEvent(ev.id))?.reEntryClearAt).toBe(
      NOW + 12 * HOUR
    );
  });

  it('puts "Re-entry clear" on the record card only when the REI is on file', async () => {
    const farm = seedFarm('card');
    const withRei = spray(farm, [FIXTURE_ID], NOW - HOUR);
    const withoutRei = spray(farm, [NO_REI_ID], NOW - HOUR);
    const cardFacts = async (id: string) =>
      (
        await runWithTenantAsync(farm.ownerId, () =>
          buildRecordCards('spray', id, { prefs: DEFAULT_PREFS, now: NOW })
        )
      )?.cards[0].facts.map((f) => f.label) ?? [];
    expect(await cardFacts(withRei.id)).toContain('Re-entry clear');
    expect(await cardFacts(withoutRei.id)).not.toContain('Re-entry clear');
  });

  it('fills rei_hours on herbicide rows of the USDA CSV only when on file', async () => {
    const farm = seedFarm('csv');
    spray(farm, [FIXTURE_ID], NOW - 3 * HOUR);
    spray(farm, [NO_REI_ID], NOW - 2 * HOUR);
    m.ownerId = farm.ownerId;
    const res = await runWithTenantAsync(farm.ownerId, async () =>
      usdaCsv({ locals: {}, url: new URL('http://localhost/x') } as never)
    );
    const body = (await res.text())
      .split(/\r?\n/)
      .filter((l) => !l.startsWith('#'))
      .join('\n');
    const rows = papa.parse<Record<string, string>>(body, {
      header: true,
      skipEmptyLines: true
    }).data;
    expect(rows.find((r) => r.product_name === 'REI fixture herbicide')?.rei_hours).toBe('12');
    const plain = rows.find((r) => r.product_name !== 'REI fixture herbicide');
    expect(plain?.rei_hours).toBe('');
  });
});
