import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { json, type RequestEvent } from '@sveltejs/kit';
import { runWithTenantAsync } from '$lib/db/tenant';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { withClientRecordId } from './clientRecordId';

const OWNER = 'owner_home_farm';

function eventWith(id: string | null): RequestEvent {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (id) headers.set(CLIENT_RECORD_HEADER, id);
  return {
    request: new Request('http://x/api/scout/record', { method: 'POST', headers, body: '{}' }),
    url: new URL('http://x/api/scout/record')
  } as unknown as RequestEvent;
}

describe('withClientRecordId', () => {
  it('saves a replayed record once and answers success for the repeat', async () => {
    const handler = vi.fn(async () => json({ ok: true }, { status: 201 }));
    const wrapped = withClientRecordId(handler);
    const id = randomUUID();
    const first = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    const second = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('two overlapping requests for one id run the handler once', async () => {
    let finish: () => void = () => {};
    const gate = new Promise<void>((r) => (finish = r));
    const handler = vi.fn(async () => {
      await gate;
      return json({ ok: true }, { status: 201 });
    });
    const wrapped = withClientRecordId(handler);
    const id = randomUUID();
    const a = runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    const b = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    finish();
    expect((await a).status).toBe(201);
    expect(b.status).toBe(503);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lets a failed save be retried', async () => {
    let status = 500;
    const handler = vi.fn(async () => json({}, { status }));
    const wrapped = withClientRecordId(handler);
    const id = randomUUID();
    await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    status = 201;
    const retry = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    expect(retry.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('runs unchanged without a client record id', async () => {
    const handler = vi.fn(async () => json({ ok: true }, { status: 201 }));
    const wrapped = withClientRecordId(handler);
    await runWithTenantAsync(OWNER, async () => wrapped(eventWith(null)));
    await runWithTenantAsync(OWNER, async () => wrapped(eventWith(null)));
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
