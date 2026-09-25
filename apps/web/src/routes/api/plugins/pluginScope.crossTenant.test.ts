/**
 * Plugin library scope (Invariant 6): an Owner's retire / upload changes
 * only that Owner's view via `plugin_overrides`; shared-library mutations
 * (global retire, uninstall, rollback, rescan, global upload) need a
 * superadmin. Real DB + real registry for the Owner paths; the global
 * filesystem operations are stubbed so the test never rewrites plugins/.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { getBaseRegistry, getRegistry } from '$lib/server/registry';
import type { CropPlugin } from '$lib/plugins/schemas';

const auth = vi.hoisted(() => ({
  user: { id: 'system', email: 'x@test', role: 'owner', isSuperadmin: false }
}));

vi.mock('$lib/server/auth', () => ({
  currentUser: () => auth.user,
  requireUser: () => auth.user,
  requireOwner: () => {
    if (auth.user.role !== 'owner') throw error(403, 'owner role required');
    return auth.user;
  },
  requireSuperadmin: () => {
    if (!auth.user.isSuperadmin) throw error(403, 'superadmin required');
    return auth.user;
  }
}));

const globalOps = vi.hoisted(() => ({
  retirePlugin: vi.fn(async () => {}),
  unretirePlugin: vi.fn(async () => {}),
  uninstallPlugin: vi.fn(async (id: string) => ({
    pluginId: id,
    removedRows: 0,
    tombstoneId: 't'
  })),
  writePluginFile: vi.fn(async () => ({ pluginId: 'x', noChange: false })),
  rollbackTo: vi.fn(async () => ({ version: '9.9.9' })),
  rescanPluginsFromDisk: vi.fn(async () => ({ ok: true }))
}));

vi.mock('$lib/server/pluginLifecycle', async (orig) => ({
  ...(await orig<typeof import('$lib/server/pluginLifecycle')>()),
  retirePlugin: globalOps.retirePlugin,
  unretirePlugin: globalOps.unretirePlugin,
  uninstallPlugin: globalOps.uninstallPlugin
}));
vi.mock('$lib/server/pluginFiles', async (orig) => ({
  ...(await orig<typeof import('$lib/server/pluginFiles')>()),
  writePluginFile: globalOps.writePluginFile,
  rollbackTo: globalOps.rollbackTo
}));
vi.mock('$lib/server/pluginRescan', () => ({
  rescanPluginsFromDisk: globalOps.rescanPluginsFromDisk
}));
vi.mock('$lib/db/pluginVersions', async (orig) => ({
  ...(await orig<typeof import('$lib/db/pluginVersions')>()),
  historyOf: () => [{ version: '1.0.0', payloadJson: '{}' }]
}));

import { POST as retirePost } from './[pluginId]/retire/+server';
import { POST as unretirePost } from './[pluginId]/unretire/+server';
import { POST as uninstallPost } from './[pluginId]/uninstall/+server';
import { POST as rollbackPost } from './[pluginId]/rollback/+server';
import { POST as uploadPost } from './upload/+server';
import { POST as rescanPost } from './rescan/+server';

const OWNER_A = 'plugin-scope-owner-a';
const OWNER_B = 'plugin-scope-owner-b';

let crop: CropPlugin;

beforeAll(async () => {
  for (const id of [OWNER_A, OWNER_B]) {
    db.insert(owners)
      .values({ id, name: id, slug: id, billingStatus: 'active' })
      .onConflictDoNothing()
      .run();
  }
  const base = await getBaseRegistry();
  crop = base.crops()[0];
});

beforeEach(() => {
  auth.user = { id: 'system', email: 'x@test', role: 'owner', isSuperadmin: false };
  for (const f of Object.values(globalOps)) f.mockClear();
});

type Handler = (event: never) => Promise<Response> | Response;

async function call(
  ownerId: string,
  handler: Handler,
  opts: { params?: Record<string, string>; query?: string; body?: unknown } = {}
): Promise<Response> {
  const url = new URL(`http://localhost/api/plugins${opts.query ?? ''}`);
  const event = {
    url,
    params: opts.params ?? {},
    locals: {},
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts.body ?? {})
    })
  };
  return runWithTenantAsync(ownerId, async () => {
    try {
      return await handler(event as never);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status) return new Response(null, { status });
      throw e;
    }
  });
}

const view = (ownerId: string) => runWithTenantAsync(ownerId, () => getRegistry());

describe('owner retire / unretire is per-farm', () => {
  it("Owner A's retire hides the plugin for A only", async () => {
    const res = await call(OWNER_A, retirePost, { params: { pluginId: crop.pluginId } });
    expect(res.status).toBe(200);
    expect((await res.json()).scope).toBe('owner');
    expect(globalOps.retirePlugin).not.toHaveBeenCalled();

    expect((await view(OWNER_A)).get(crop.pluginId)).toBeUndefined();
    expect((await view(OWNER_B)).get(crop.pluginId)).toBeTruthy();
    expect((await getBaseRegistry()).get(crop.pluginId)).toBeTruthy();
  });

  it("Owner A's unretire restores it for A", async () => {
    const res = await call(OWNER_A, unretirePost, { params: { pluginId: crop.pluginId } });
    expect(res.status).toBe(200);
    expect((await view(OWNER_A)).get(crop.pluginId)).toBeTruthy();
  });

  it('unknown plugin → 404', async () => {
    const res = await call(OWNER_A, retirePost, { params: { pluginId: 'no-such-plugin-xyz' } });
    expect(res.status).toBe(404);
  });
});

describe('owner upload is a farm copy', () => {
  it("Owner A's edit replaces the plugin for A only; the shared library is untouched", async () => {
    const edited = { ...crop, displayName: `${crop.displayName} (A's selection)` };
    const res = await call(OWNER_A, uploadPost, { body: edited });
    expect(res.status).toBe(201);
    expect(globalOps.writePluginFile).not.toHaveBeenCalled();

    expect((await view(OWNER_A)).get(crop.pluginId)?.plugin.displayName).toBe(edited.displayName);
    expect((await view(OWNER_B)).get(crop.pluginId)?.plugin.displayName).toBe(crop.displayName);
    expect((await getBaseRegistry()).get(crop.pluginId)?.plugin.displayName).toBe(crop.displayName);
  });

  it('a farm copy still goes through schema validation', async () => {
    const res = await call(OWNER_A, uploadPost, { body: { pluginId: 'bad', type: 'crop' } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('schema');
  });
});

describe('shared-library mutations need a superadmin', () => {
  const pid = () => ({ pluginId: crop.pluginId });

  it.each([
    ['uninstall', uninstallPost, { body: { confirm: 'x' } }],
    ['rollback', rollbackPost, { body: { toVersion: '1.0.0' } }],
    ['rescan', rescanPost, {}],
    ['global retire', retirePost, { query: '?scope=global' }],
    ['global unretire', unretirePost, { query: '?scope=global' }],
    ['global upload', uploadPost, { query: '?scope=global', body: crop }]
  ] as const)('owner → 403 on %s', async (_n, handler, opts) => {
    const res = await call(OWNER_A, handler as Handler, { ...opts, params: pid() });
    expect(res.status).toBe(403);
    for (const f of Object.values(globalOps)) expect(f).not.toHaveBeenCalled();
  });

  it('superadmin can uninstall, roll back and retire globally', async () => {
    auth.user = { ...auth.user, isSuperadmin: true };
    const u = await call(OWNER_A, uninstallPost, {
      params: pid(),
      body: { confirm: crop.pluginId }
    });
    expect(u.status).toBe(200);
    expect(globalOps.uninstallPlugin).toHaveBeenCalledWith(crop.pluginId, expect.anything());

    const r = await call(OWNER_A, rollbackPost, { params: pid(), body: { toVersion: '1.0.0' } });
    expect(r.status).toBe(201);
    expect(globalOps.rollbackTo).toHaveBeenCalled();

    const g = await call(OWNER_A, retirePost, { params: pid(), query: '?scope=global' });
    expect(g.status).toBe(200);
    expect(globalOps.retirePlugin).toHaveBeenCalledWith(crop.pluginId);

    const up = await call(OWNER_A, uploadPost, { query: '?scope=global', body: crop });
    expect(up.status).toBe(201);
    expect(globalOps.writePluginFile).toHaveBeenCalled();
  });
});
