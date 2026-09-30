// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import fc from 'fast-check';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'covers-user', role: m.role });
  return {
    currentUser: user,
    requireUser: user,
    requireOwner: () => {
      if (m.role !== 'owner') throw error(403, 'owner role required');
      return user();
    }
  };
});

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { listBlockProtections, insertBlockProtection } from '$lib/db/blockProtections';
import {
  activeCoverByBlock,
  loadEffectiveFrostByBlock,
  plannerFrostByBlock
} from '$lib/server/blockFrost.server';
import { GET, POST } from './+server';
import { DELETE } from './[pid]/+server';

const YEAR = 2027;
const DAY = 86_400_000;

function seedOwner(): string {
  const id = `covers-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'covers-user', email: 'covers@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

async function call(
  handler: unknown,
  blockId: string,
  method: string,
  opts: { pid?: string; body?: unknown } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(`http://localhost/api/blocks/${blockId}/protections?year=${YEAR}`);
  try {
    const res = await (handler as (e: never) => Response | Promise<Response>)({
      params: { id: blockId, pid: opts.pid ?? '' },
      url,
      request: new Request(url.href, {
        method,
        headers: { 'content-type': 'application/json' },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }),
      locals: {}
    } as never);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) throw e;
    return { status, body: {} };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function bed(kind: 'garden' | 'greenhouse' = 'garden', details?: object) {
  const area = createField({ name: `Kitchen ${randomUUID().slice(0, 4)}`, kind, details } as never);
  return createBlock({ name: 'Bed 3', fieldId: area.id, kind: 'bed', widthFt: 4, lengthFt: 8 });
}

function setFrost() {
  setSetting(SETTINGS_KEYS.lastFrost, '04-20');
  setSetting(SETTINGS_KEYS.firstFrost, '10-15');
}

describe('/api/blocks/:id/protections', () => {
  it('owner adds a low tunnel and the bed frost moves earlier', async () => {
    m.role = 'owner';
    await runWithTenantAsync(seedOwner(), async () => {
      setFrost();
      const b = bed();
      const before = (await call(GET, b.id, 'GET')).body as Json;
      expect(before.protections).toEqual([]);
      expect(before.frost.lastSpring).toBe(`${YEAR}-04-20`);

      const added = await call(POST, b.id, 'POST', {
        body: { kind: 'low-tunnel', springShiftDays: 21, fallShiftDays: 14, seasonYear: YEAR }
      });
      expect(added.status).toBe(201);
      const body = added.body as Json;
      expect(body.protection.provenance).toBe('manual');
      expect(body.frost.lastSpring).toBe(`${YEAR}-03-30`);
      expect(body.frost.firstFall).toBe(`${YEAR}-10-29`);
      expect(body.frost.summary).toMatch(/^Covered:/);
    });
  });

  it('keeps an unsourced default unknown and says so', async () => {
    m.role = 'owner';
    await runWithTenantAsync(seedOwner(), async () => {
      setFrost();
      const b = bed();
      const added = (await call(POST, b.id, 'POST', { body: { kind: 'row-cover' } })).body as Json;
      expect(added.protection.springShiftDays).toBeNull();
      expect(added.effectiveFrost.unknownShift).toEqual(['row-cover']);
      expect(added.frost.summary).toBe('Covered, shift not known');
      expect(added.frost.lastSpring).toBe(`${YEAR}-04-20`);
    });
  });

  it('a heated greenhouse Area is frost-free', async () => {
    m.role = 'owner';
    await runWithTenantAsync(seedOwner(), async () => {
      setFrost();
      const b = bed('greenhouse', { heated: true });
      const got = (await call(GET, b.id, 'GET')).body as Json;
      expect(got.frost).toMatchObject({
        frostFree: true,
        lastSpring: `${YEAR}-01-01`,
        firstFall: `${YEAR}-12-31`
      });
    });
  });

  it('helpers and inspectors read covers but cannot add or remove them', async () => {
    const owner = seedOwner();
    m.role = 'owner';
    const { blockId, pid } = await runWithTenantAsync(owner, async () => {
      const b = bed();
      const r = (
        await call(POST, b.id, 'POST', { body: { kind: 'cold-frame', springShiftDays: 7 } })
      ).body as Json;
      return { blockId: b.id, pid: r.protection.id as string };
    });
    for (const role of ['helper', 'inspector']) {
      m.role = role;
      await runWithTenantAsync(owner, async () => {
        expect((await call(GET, blockId, 'GET')).status).toBe(200);
        const add = await call(POST, blockId, 'POST', { body: { kind: 'row-cover' } });
        expect(add.status).toBe(403);
        if (role === 'helper') expect(add.body.error).toMatch(/Ask the owner/);
        expect((await call(DELETE, blockId, 'DELETE', { pid })).status).toBe(403);
      });
    }
    m.role = 'owner';
  });

  it('rejects out-of-range shifts and a removal before install', async () => {
    m.role = 'owner';
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      expect(
        (await call(POST, b.id, 'POST', { body: { kind: 'row-cover', springShiftDays: 121 } }))
          .status
      ).toBe(400);
      expect(
        (await call(POST, b.id, 'POST', { body: { kind: 'row-cover', springShiftDays: -1 } }))
          .status
      ).toBe(400);
      expect(
        (
          await call(POST, b.id, 'POST', {
            body: { kind: 'row-cover', installedOn: 2000, removedOn: 1000 }
          })
        ).status
      ).toBe(400);
      expect((await call(POST, b.id, 'POST', { body: { kind: 'plastic' } })).status).toBe(400);
    });
  });

  it('deletes a cover, and 404s for another bed or an unknown id', async () => {
    m.role = 'owner';
    await runWithTenantAsync(seedOwner(), async () => {
      const b = bed();
      const other = bed();
      const r = (
        await call(POST, b.id, 'POST', { body: { kind: 'high-tunnel', springShiftDays: 30 } })
      ).body as Json;
      expect((await call(DELETE, other.id, 'DELETE', { pid: r.protection.id })).status).toBe(404);
      expect((await call(DELETE, b.id, 'DELETE', { pid: 'nope' })).status).toBe(404);
      expect((await call(DELETE, b.id, 'DELETE', { pid: r.protection.id })).status).toBe(200);
      expect(listBlockProtections([b.id])).toEqual([]);
    });
  });

  it('SEASON_CLOSED never gates covers (E0-6)', async () => {
    m.role = 'owner';
    await runWithTenantAsync(seedOwner(), async () => {
      createCloseout({ year: YEAR, snapshotJson: '{}' });
      createCloseout({ year: new Date().getFullYear(), snapshotJson: '{}' });
      const b = bed();
      const r = await call(POST, b.id, 'POST', { body: { kind: 'row-cover', springShiftDays: 5 } });
      expect(r.status).toBe(201);
      const pid = (r.body as Json).protection.id;
      expect((await call(DELETE, b.id, 'DELETE', { pid })).status).toBe(200);
    });
  });

  it("never reads, lists or deletes another Owner's covers", async () => {
    m.role = 'owner';
    const a = seedOwner();
    const bOwner = seedOwner();
    const aBed = await runWithTenantAsync(a, async () => {
      const b = bed();
      await call(POST, b.id, 'POST', { body: { kind: 'low-tunnel', springShiftDays: 14 } });
      return b.id;
    });
    const bBed = await runWithTenantAsync(bOwner, async () => {
      const b = bed();
      await call(POST, b.id, 'POST', { body: { kind: 'row-cover', springShiftDays: 7 } });
      return b.id;
    });
    fc.assert(
      fc.property(fc.boolean(), (aReads) => {
        const [me, mine, theirs] = aReads ? [a, aBed, bBed] : [bOwner, bBed, aBed];
        runWithTenant(me, () => {
          expect(listBlockProtections([mine, theirs]).every((p) => p.blockId === mine)).toBe(true);
          expect(listBlockProtections([theirs])).toEqual([]);
          expect(Object.keys(plannerFrostByBlock([theirs], YEAR))).toEqual([]);
          expect(activeCoverByBlock([theirs], Date.now()).size).toBe(0);
        });
      }),
      { numRuns: 10 }
    );
    await runWithTenantAsync(a, async () => {
      const theirPid = runWithTenant(bOwner, () => listBlockProtections([bBed])[0].id);
      expect((await call(GET, bBed, 'GET')).status).toBe(404);
      expect((await call(DELETE, bBed, 'DELETE', { pid: theirPid })).status).toBe(404);
      expect((await call(POST, bBed, 'POST', { body: { kind: 'row-cover' } })).status).toBe(404);
    });
    expect(runWithTenant(bOwner, () => listBlockProtections([bBed])).length).toBe(1);
  });
});

describe('blockFrost.server', () => {
  it('stacked covers take the largest shift and planner frost lists only moved beds', () => {
    runWithTenant(seedOwner(), () => {
      setFrost();
      const b = bed();
      const plain = bed();
      insertBlockProtection({
        blockId: b.id,
        kind: 'row-cover',
        springShiftDays: 10,
        fallShiftDays: 20,
        provenance: 'manual',
        installedOn: null,
        removedOn: null,
        seasonYear: null,
        notes: null
      });
      insertBlockProtection({
        blockId: b.id,
        kind: 'low-tunnel',
        springShiftDays: 21,
        fallShiftDays: 5,
        provenance: 'manual',
        installedOn: null,
        removedOn: null,
        seasonYear: null,
        notes: null
      });
      const eff = loadEffectiveFrostByBlock([b.id, plain.id], YEAR);
      expect(eff[b.id].springShiftDays).toBe(21);
      expect(eff[b.id].fallShiftDays).toBe(20);
      expect(eff[plain.id].springShiftDays).toBe(0);
      const planner = plannerFrostByBlock([b.id, plain.id], YEAR);
      expect(Object.keys(planner)).toEqual([b.id]);
      expect(planner[b.id].lastSpringFrostMs).toBe(new Date(YEAR, 3, 20).getTime() - 21 * DAY);
    });
  });

  it('reports active cover state for frost alerts', () => {
    runWithTenant(seedOwner(), () => {
      const now = Date.now();
      const heated = bed('greenhouse', { heated: true });
      const unheated = bed('greenhouse');
      const covered = bed();
      const later = bed();
      const plain = bed();
      const base = {
        springShiftDays: 7,
        fallShiftDays: 7,
        provenance: 'manual' as const,
        removedOn: null,
        seasonYear: null,
        notes: null
      };
      insertBlockProtection({
        ...base,
        blockId: covered.id,
        kind: 'row-cover',
        installedOn: now - DAY
      });
      insertBlockProtection({
        ...base,
        blockId: later.id,
        kind: 'row-cover',
        installedOn: now + DAY
      });
      const state = activeCoverByBlock(
        [heated.id, unheated.id, covered.id, later.id, plain.id],
        now
      );
      expect(state.get(heated.id)).toBe('heated');
      expect(state.get(unheated.id)).toBe('covered');
      expect(state.get(covered.id)).toBe('covered');
      expect(state.has(later.id)).toBe(false);
      expect(state.has(plain.id)).toBe(false);
    });
  });
});
