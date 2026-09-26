/**
 * The snapshot endpoint decides 304 from a state key read before building.
 * It must never answer 304 when the content would differ: any write, the
 * hour its date windows are cut at, and the plugin registry all move the key.
 */

import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createBlock } from '$lib/db/blocks';
import { createTask } from '$lib/db/tasks';
import { createStockItem, receiveLot } from '$lib/db/stock';
import type { FarmSnapshot } from '$lib/cards/snapshot';
import {
  SNAPSHOT_TASK_FUTURE_DAYS,
  knownSnapshotEtag,
  rememberSnapshotEtag,
  snapshotStateKey,
  snapshotWindowTime
} from './cardSnapshot';
import { resetRegistry } from './registry';
import { GET } from '../../routes/api/cards/snapshot/+server';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-06-15T15:20:00Z');

function newOwner(): string {
  const id = `etag-${randomUUID().slice(0, 8)}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  runWithTenant(id, () => createBlock({ name: `${id} bed` }));
  return id;
}

function get(ownerId: string, etag?: string) {
  const event = {
    locals: {
      user: {
        id: `user-${ownerId}`,
        email: null,
        phone: null,
        role: 'owner',
        activeOwnerId: ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    request: new Request('http://localhost/api/cards/snapshot', {
      headers: etag ? { 'if-none-match': etag } : {}
    }),
    cookies: { get: () => undefined }
  } as unknown as RequestEvent;
  return runWithTenantAsync(ownerId, async () => GET(event as Parameters<typeof GET>[0]));
}

describe('snapshot ETag short-circuit', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers 304 from the remembered ETag without building', async () => {
    const owner = newOwner();
    const first = await get(owner);
    expect(first.status).toBe(200);
    expect((await get(owner, first.headers.get('etag')!)).status).toBe(304);
    // A remembered ETag no build could produce proves the 304 skipped the
    // build. Other vitest workers write to the same database file and move
    // the key at any moment, so retry until one request sees a quiet key.
    const fake = 'W/"remembered-without-building"';
    let shortCircuited = false;
    for (let i = 0; i < 50 && !shortCircuited; i++) {
      const key = await runWithTenantAsync(owner, () =>
        snapshotStateKey({ now: NOW, origin: null })
      );
      runWithTenant(owner, () => rememberSnapshotEtag(key, fake));
      const res = await get(owner, fake);
      shortCircuited = res.status === 304 && res.headers.get('etag') === fake;
      if (!shortCircuited) expect(res.status).toBe(200);
    }
    expect(shortCircuited).toBe(true);
  });

  it('rebuilds after a write to the farm and serves the new content', async () => {
    const owner = newOwner();
    const etag = (await get(owner)).headers.get('etag')!;
    const item = runWithTenant(owner, () => {
      const i = createStockItem({ category: 'fertilizer', displayName: 'new', defaultUnit: 'lb' });
      receiveLot({ stockItemId: i.id, receivedQuantity: 3, unit: 'lb' });
      return i;
    });
    const res = await get(owner, etag);
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).not.toBe(etag);
    const body = (await res.json()) as FarmSnapshot;
    expect(body.stock.find((s) => s.id === item.id)?.onHand).toBe(3);
  });

  it('still answers 304 when only unrelated rows changed', async () => {
    const owner = newOwner();
    const etag = (await get(owner)).headers.get('etag')!;
    newOwner();
    const res = await get(owner, etag);
    expect(res.status).toBe(304);
  });

  it('picks up a task that enters the window when the hour turns', async () => {
    const owner = newOwner();
    const edge = snapshotWindowTime(NOW) + SNAPSHOT_TASK_FUTURE_DAYS * DAY + HOUR / 2;
    const task = runWithTenant(owner, () =>
      createTask({ title: 'edge', kind: 'primary', scheduledFor: edge })
    );
    const first = await get(owner);
    const etag = first.headers.get('etag')!;
    expect(((await first.json()) as FarmSnapshot).tasks.some((t) => t.id === task.id)).toBe(false);
    vi.setSystemTime(NOW + 10 * 60_000);
    expect((await get(owner, etag)).status).toBe(304);
    vi.setSystemTime(snapshotWindowTime(NOW) + HOUR);
    const later = await get(owner, etag);
    expect(later.status).toBe(200);
    expect(((await later.json()) as FarmSnapshot).tasks.some((t) => t.id === task.id)).toBe(true);
  });

  it('keys on the plugin registry instance', async () => {
    const owner = newOwner();
    const before = await runWithTenantAsync(owner, () =>
      snapshotStateKey({ now: NOW, origin: null })
    );
    resetRegistry();
    const after = await runWithTenantAsync(owner, () =>
      snapshotStateKey({ now: NOW, origin: null })
    );
    expect(after).not.toBe(before);
  });

  it('keys on the Owner and the origin', async () => {
    const a = newOwner();
    const b = newOwner();
    const ka = await runWithTenantAsync(a, () => snapshotStateKey({ now: NOW, origin: null }));
    const kb = await runWithTenantAsync(b, () => snapshotStateKey({ now: NOW, origin: null }));
    const ko = await runWithTenantAsync(a, () =>
      snapshotStateKey({ now: NOW, origin: 'https://app.example' })
    );
    expect(new Set([ka, kb, ko]).size).toBe(3);
    const etagA = (await get(a)).headers.get('etag')!;
    expect(runWithTenant(b, () => knownSnapshotEtag(kb))).not.toBe(etagA);
  });
});
