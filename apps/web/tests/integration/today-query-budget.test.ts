// @vitest-environment node
// /today query budget (Phase 32 rulings E0-11 and F0-8: at most 57 x 1.2 =
// 68 database statements). Measured the way the cap was set: the whole
// request through `handle` (hooks, root layout and page loaders), counted
// by the Server-Timing `db;desc="Nq"` value, on the demo farm's seed, with
// every outside fetch failing so no weather source is reached.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { helperAssignments, owners, ownerSubscriptions, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { seedDemoFarm } from '$lib/db/demo/seed';
import { writeSession } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { handle } from '../../src/hooks.server';
import { load as layoutLoad } from '../../src/routes/+layout.server';
import { load as todayLoad } from '../../src/routes/today/+page.server';

const TODAY_QUERY_CAP = 68;

type Role = 'owner' | 'helper';

const ownerId = `qbudget-${randomUUID().slice(0, 8)}`;
const userIds: Record<Role, string> = {
  owner: `${ownerId}-owner`,
  helper: `${ownerId}-helper`
};

function seedFarm(): void {
  const now = Date.now();
  const at = new Date(now);
  db.insert(owners)
    .values({ id: ownerId, name: 'Budget Farm', slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(ownerSubscriptions)
    .values({ ownerId, planCode: 'free', status: 'active', createdAt: at, updatedAt: at })
    .run();
  for (const role of ['owner', 'helper'] as const) {
    db.insert(users)
      .values({ id: userIds[role], email: `${userIds[role]}@test.local` })
      .run();
    db.insert(helperAssignments)
      .values({
        ownerId,
        userId: userIds[role],
        roleWithinOwner: role,
        status: 'active',
        acceptedAt: at,
        createdAt: at
      })
      .run();
  }
  runWithTenant(ownerId, () => seedDemoFarm({ ownerId, userId: userIds.owner, now }));
}

function cookieJar() {
  const store = new Map<string, string>();
  return {
    get: (name: string) => store.get(name),
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    serialize: () => ''
  } as unknown as RequestEvent['cookies'];
}

/** One GET /today through the hooks, returning the statement count. */
async function todayQueries(role: Role): Promise<number> {
  const cookies = cookieJar();
  writeSession(cookies, {
    id: userIds[role],
    email: `${userIds[role]}@test.local`,
    phone: null,
    activeOwnerId: ownerId,
    activeRole: role
  });
  const url = new URL('http://localhost/today');
  const event = {
    url,
    params: {},
    route: { id: '/today' },
    request: new Request(url.href, { headers: { host: 'localhost' } }),
    locals: {},
    cookies,
    isDataRequest: false,
    isSubRequest: false,
    setHeaders: () => undefined,
    getClientAddress: () => '127.0.0.1',
    fetch
  } as unknown as RequestEvent;
  const response = await handle({
    event,
    resolve: async (ev) => {
      const parent = await layoutLoad(ev as never);
      await todayLoad({ ...ev, parent: async () => parent } as never);
      return new Response('ok');
    }
  });
  expect(response.status).toBe(200);
  const timing = response.headers.get('server-timing') ?? '';
  const match = /db;[^,]*desc="(\d+)q"/.exec(timing);
  if (!match) throw new Error(`no db count in Server-Timing: ${timing}`);
  return Number(match[1]);
}

describe('/today query budget (E0-11, F0-8)', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('no network in the /today query budget test');
    });
    seedFarm();
    await runWithTenant(ownerId, () => getRegistry());
  }, 60_000);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each(['owner', 'helper'] as const)(
    'a warm /today for the %s stays at or under the cap',
    async (role) => {
      await todayQueries(role);
      const warm = await todayQueries(role);
      console.info(`[today-query-budget] ${role}: ${warm} queries`);
      expect(warm).toBeLessThanOrEqual(TODAY_QUERY_CAP);
    }
  );
});
