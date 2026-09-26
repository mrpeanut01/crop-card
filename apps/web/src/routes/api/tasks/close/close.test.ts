/**
 * POST /api/tasks/close replays a Done or Skip saved offline on /today.
 * Real DB, per-Owner tenant context: it closes only the active Owner's
 * task, is idempotent on replay, never overwrites an earlier close, and
 * refuses inspectors.
 */

import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { createTask, getTask } from '$lib/db/tasks';
import { POST } from './+server';

const DAY = 86_400_000;

function ensureOwner(ownerId: string): void {
  db.insert(owners)
    .values({ id: ownerId, name: `Farm ${ownerId}`, slug: ownerId, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
}

function seedTask(ownerId: string, title: string, linkedTo?: string): string {
  ensureOwner(ownerId);
  return runWithTenant(
    ownerId,
    () =>
      createTask({
        title,
        kind: linkedTo ? 'post-task' : 'primary',
        linkedToTaskId: linkedTo,
        scheduledFor: Date.now()
      }).id
  );
}

function post(
  ownerId: string,
  body: unknown,
  role: 'owner' | 'helper' | 'inspector' = 'helper'
): Promise<Response> {
  const event = {
    locals: {
      user: {
        id: `user-${ownerId}`,
        email: null,
        phone: null,
        role,
        activeOwnerId: ownerId,
        isSuperadmin: false,
        impersonating: false
      }
    },
    request: new Request('http://localhost/api/tasks/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    cookies: { get: () => undefined }
  } as unknown as RequestEvent;
  return runWithTenantAsync(ownerId, () => Promise.resolve(POST(event)));
}

describe('POST /api/tasks/close', () => {
  const a = `close-a-${randomUUID().slice(0, 6)}`;
  const b = `close-b-${randomUUID().slice(0, 6)}`;

  it('a helper marks the task done at the moment they tapped', async () => {
    const id = seedTask(a, 'Stake tomatoes');
    const tapped = Date.now() - 3_600_000;
    const res = await post(a, { taskId: id, action: 'complete', occurredAt: tapped });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alreadyClosed: false, task: { id } });
    expect(runWithTenant(a, () => getTask(id))?.completedAt).toBe(tapped);
  });

  it('a replay that already landed changes nothing', async () => {
    const id = seedTask(a, 'Scout squash');
    const first = await post(a, { taskId: id, action: 'abort', reason: 'rain' });
    expect(first.status).toBe(200);
    const closed = runWithTenant(a, () => getTask(id))!;
    const again = await post(a, { taskId: id, action: 'complete' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ alreadyClosed: true });
    const after = runWithTenant(a, () => getTask(id))!;
    expect(after.completedAt).toBeUndefined();
    expect(after.abortedAt).toBe(closed.abortedAt);
    expect(after.abortReason).toBe('rain');
  });

  it('skipping a job skips its open follow-ups too', async () => {
    const parent = seedTask(a, 'Spray kale');
    const child = seedTask(a, 'Rinse the sprayer', parent);
    await post(a, { taskId: parent, action: 'abort', reason: 'wind' });
    expect(runWithTenant(a, () => getTask(child))?.abortReason).toBe('wind');
  });

  it('never reaches another Owner’s task', async () => {
    const theirs = seedTask(b, 'Mow the hayfield');
    const res = await post(a, { taskId: theirs, action: 'complete' });
    expect(res.status).toBe(404);
    expect(runWithTenant(b, () => getTask(theirs))?.completedAt).toBeUndefined();
  });

  it('clamps a future or ancient timestamp', async () => {
    const future = seedTask(a, 'Future');
    await post(a, { taskId: future, action: 'complete', occurredAt: Date.now() + 5 * DAY });
    expect(runWithTenant(a, () => getTask(future))!.completedAt!).toBeLessThanOrEqual(Date.now());
    const old = seedTask(a, 'Old');
    await post(a, { taskId: old, action: 'complete', occurredAt: 1 });
    expect(runWithTenant(a, () => getTask(old))!.completedAt!).toBeGreaterThan(
      Date.now() - 31 * DAY
    );
  });

  it('inspectors are read-only and bad bodies are refused', async () => {
    const id = seedTask(a, 'Inspect');
    expect((await post(a, { taskId: id, action: 'complete' }, 'inspector')).status).toBe(403);
    expect((await post(a, { taskId: id, action: 'edit' })).status).toBe(400);
    expect((await post(a, { action: 'complete' })).status).toBe(400);
    expect(runWithTenant(a, () => getTask(id))?.completedAt).toBeUndefined();
  });
});
