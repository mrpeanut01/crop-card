/**
 * Request memo, prepared-statement tenant binding and the bounded reads used
 * by /today, /plan and the push tick: each must equal the unbounded read it
 * replaced (on the rows it keeps) and stay inside the active Owner.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { lt } from 'drizzle-orm';
import { db } from './client';
import { crops, equipment, equipmentLog, owners, tasks } from './schema';
import {
  TENANT_PLACEHOLDER,
  runWithTenant,
  tenantParams,
  tenantValues,
  withTenant
} from './tenant';
import { dbChangeMarker, requestMemo } from './requestMemo';
import { countPlantings, createBlock, currentPlantingsCutoff, listBlocks } from './blocks';
import { listCrops } from './crops';
import { equipmentIdsActiveBefore } from './equipment';
import { countTasks, listTasks } from './tasks';
import { plantingsInYear } from '$lib/plan/seasonStart';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-15T15:00:00Z');
const STATUSES = ['planned', 'active', 'harvested', 'failed', 'archived'] as const;

function ensureOwner(id: string): void {
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
}

function newOwner(prefix: string): string {
  const id = `${prefix}-${randomUUID().slice(0, 8)}`;
  ensureOwner(id);
  return id;
}

describe('requestMemo', () => {
  // Other vitest workers write to the same database file, which moves the
  // marker (`data_version`) at any moment; each check retries until it sees
  // a quiet stretch instead of assuming one.
  function whileQuiet(check: () => boolean): void {
    for (let i = 0; i < 50; i++) {
      const before = dbChangeMarker();
      const ok = check();
      if (dbChangeMarker() === before) {
        expect(ok).toBe(true);
        return;
      }
    }
    throw new Error('database never quiet');
  }

  it('reuses a value within a tenant run until the database changes', () => {
    const owner = newOwner('memo');
    runWithTenant(owner, () => {
      let calls = 0;
      const read = () => requestMemo('probe', () => ++calls);
      whileQuiet(() => read() === read());
      const seen = read();
      createBlock({ name: 'memo write' });
      expect(read()).toBeGreaterThan(seen);
    });
  });

  it('never shares a value across tenant runs or outside one', () => {
    let calls = 0;
    const read = () => requestMemo('probe', () => ++calls);
    const a = newOwner('memo-a');
    const b = newOwner('memo-b');
    expect(runWithTenant(a, read)).toBe(1);
    expect(runWithTenant(b, read)).toBe(2);
    expect(runWithTenant(a, read)).toBe(3);
    expect(read()).toBe(4);
    expect(read()).toBe(5);
  });

  it('change marker moves on every write', () => {
    const owner = newOwner('marker');
    runWithTenant(owner, () => {
      const before = dbChangeMarker();
      createBlock({ name: 'marker write' });
      expect(dbChangeMarker()).not.toBe(before);
    });
  });
});

describe('prepared tenant params', () => {
  it('fill the Owner from the active tenant and refuse a caller-supplied one', () => {
    const owner = newOwner('params');
    runWithTenant(owner, () => {
      expect(tenantParams({ x: 1 })).toEqual({ x: 1, [TENANT_PLACEHOLDER]: owner });
      expect(() => tenantParams({ [TENANT_PLACEHOLDER]: 'someone-else' })).toThrow();
    });
  });
});

const plantingArb = fc.record({
  status: fc.constantFrom(...STATUSES),
  daysAgo: fc.option(fc.integer({ min: -200, max: 2500 }), { nil: null })
});

function seedPlantings(owner: string, rows: Array<{ status: string; daysAgo: number | null }>) {
  return runWithTenant(owner, () => {
    const blockA = createBlock({ name: `a-${randomUUID().slice(0, 6)}` });
    const blockB = createBlock({ name: `b-${randomUUID().slice(0, 6)}` });
    rows.forEach((r, i) => {
      db.insert(crops)
        .values(
          tenantValues({
            id: `${owner}-p${i}`,
            blockId: i % 2 ? blockA.id : blockB.id,
            cropPluginId: 'tomato-cherokee-purple',
            varietyDisplayName: `p${i}`,
            plantingDate: r.daysAgo === null ? null : new Date(NOW - r.daysAgo * DAY),
            status: r.status as (typeof STATUSES)[number]
          })
        )
        .run();
    });
  });
}

describe('listBlocks planting scopes', () => {
  it('current keeps exactly the planned/active/undated/recent plantings, in the same order', () => {
    fc.assert(
      fc.property(
        fc.array(plantingArb, { maxLength: 25 }),
        fc.array(plantingArb, { maxLength: 10 }),
        (mine, theirs) => {
          const me = newOwner('scope');
          const other = newOwner('scope-other');
          seedPlantings(me, mine);
          seedPlantings(other, theirs);
          runWithTenant(me, () => {
            const cutoff = currentPlantingsCutoff(NOW);
            const statusById = new Map(listCrops().map((c) => [c.id, c.status]));
            const all = listBlocks();
            const current = listBlocks({ plantings: 'current', now: NOW });
            const none = listBlocks({ plantings: 'none' });
            expect(current.map((b) => b.id)).toEqual(all.map((b) => b.id));
            expect(none.map((b) => b.id)).toEqual(all.map((b) => b.id));
            for (const b of none) expect(b.plantings).toEqual([]);
            all.forEach((b, i) => {
              const keep = b.plantings.filter((p) => {
                const s = statusById.get(p.id);
                return (
                  s === 'planned' ||
                  s === 'active' ||
                  p.plantingDate === null ||
                  p.plantingDate >= cutoff
                );
              });
              expect(current[i].plantings).toEqual(keep);
            });
            expect(countPlantings()).toBe(all.reduce((n, b) => n + b.plantings.length, 0));
            const theirs = runWithTenant(other, () =>
              listBlocks({ plantings: 'current', now: NOW }).flatMap((b) => b.plantings)
            );
            const mineIds = new Set(all.flatMap((b) => b.plantings.map((p) => p.id)));
            for (const p of theirs) expect(mineIds.has(p.id)).toBe(false);
            const year = new Date(NOW).getFullYear();
            for (const y of [year - 1, year, year + 1]) {
              expect(plantingsInYear(all, y).length).toBe(listCrops({ year: y }).length);
            }
          });
        }
      ),
      { numRuns: 25 }
    );
  });

  it('cutoff is Jan 1 of the previous year', () => {
    expect(currentPlantingsCutoff(new Date(2026, 5, 15).getTime())).toBe(
      new Date(2025, 0, 1).getTime()
    );
  });
});

describe('equipmentIdsActiveBefore', () => {
  it('equals a scan of the whole log and stays inside the Owner', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 0, max: 900 }), { maxLength: 5 }), { maxLength: 5 }),
        fc.integer({ min: 0, max: 900 }),
        (logs, beforeDaysAgo) => {
          const me = newOwner('equip');
          const other = newOwner('equip-other');
          for (const owner of [me, other]) {
            runWithTenant(owner, () => {
              logs.forEach((days, i) => {
                const id = `${owner}-eq${i}`;
                db.insert(equipment)
                  .values(tenantValues({ id, type: 'sprayer' as const, label: id }))
                  .run();
                for (const d of days)
                  db.insert(equipmentLog)
                    .values(
                      tenantValues({
                        id: randomUUID(),
                        equipmentId: id,
                        occurredAt: new Date(NOW - d * DAY),
                        kind: 'use' as const
                      })
                    )
                    .run();
              });
            });
          }
          const before = NOW - beforeDaysAgo * DAY;
          runWithTenant(me, () => {
            const expected = new Set(
              db
                .selectDistinct({ id: equipmentLog.equipmentId })
                .from(equipmentLog)
                .where(withTenant(equipmentLog, lt(equipmentLog.occurredAt, new Date(before))))
                .all()
                .map((r) => r.id)
            );
            expect(equipmentIdsActiveBefore(before)).toEqual(expected);
          });
        }
      ),
      { numRuns: 20 }
    );
  });
});

describe('countTasks', () => {
  it('equals listTasks(...).length for the same filters', () => {
    const me = newOwner('count');
    runWithTenant(me, () => {
      for (let i = 0; i < 12; i++)
        db.insert(tasks)
          .values(
            tenantValues({
              id: `${me}-t${i}`,
              title: `t${i}`,
              kind: i % 3 ? ('primary' as const) : ('pre-task' as const),
              scheduledFor: new Date(NOW + (i - 6) * DAY),
              completedAt: i % 4 === 0 ? new Date(NOW) : null
            })
          )
          .run();
      for (const f of [
        {},
        { kind: 'primary' as const },
        { status: 'open' as const },
        { fromMs: NOW - 2 * DAY, toMs: NOW + 3 * DAY, kind: 'primary' as const }
      ])
        expect(countTasks(f)).toBe(listTasks(f).length);
    });
  });
});
