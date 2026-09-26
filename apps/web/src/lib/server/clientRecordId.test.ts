import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { STALE_CLAIM_MS, claimClientRecord } from '$lib/db/clientRecords';
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

  it('answers every sequential repeat after the first save as a duplicate', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 12 }), async (n) => {
        const handler = vi.fn(async () => json({ ok: true }, { status: 201 }));
        const wrapped = withClientRecordId(handler);
        const id = randomUUID();
        const statuses: number[] = [];
        for (let i = 0; i < n; i++) {
          const res = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
          statuses.push(res.status);
          if (i > 0) expect(await res.json()).toEqual({ ok: true, duplicate: true });
        }
        expect(handler).toHaveBeenCalledTimes(1);
        expect(statuses).toEqual([201, ...Array(n - 1).fill(200)]);
      }),
      { numRuns: 25 }
    );
  });

  it('writes exactly once across any run of failures, throws and repeats', async () => {
    type Outcome = 'ok' | 'fail' | 'throw';
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<Outcome>('ok', 'fail', 'throw'), { minLength: 1, maxLength: 12 }),
        async (outcomes) => {
          let next: Outcome = 'fail';
          let writes = 0;
          const handler = vi.fn(async () => {
            if (next === 'throw') throw new Error('db down');
            if (next === 'fail') return json({ error: 'nope' }, { status: 422 });
            writes++;
            return json({ ok: true }, { status: 201 });
          });
          const wrapped = withClientRecordId(handler);
          const id = randomUUID();
          const firstOk = outcomes.indexOf('ok');
          for (const [i, outcome] of outcomes.entries()) {
            next = outcome;
            const call = runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
            if (firstOk !== -1 && i > firstOk) {
              expect((await call).status).toBe(200);
            } else if (outcome === 'throw') {
              await expect(call).rejects.toThrow('db down');
            } else {
              expect((await call).status).toBe(outcome === 'ok' ? 201 : 422);
            }
          }
          expect(writes).toBe(firstOk === -1 ? 0 : 1);
          expect(handler).toHaveBeenCalledTimes(firstOk === -1 ? outcomes.length : firstOk + 1);
        }
      ),
      { numRuns: 40 }
    );
  });

  it('answers the overlapping request 503 and the next repeat as a duplicate', async () => {
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
    expect(b.status).toBe(503);
    expect(await b.json()).toMatchObject({ error: expect.stringMatching(/already being saved/) });
    finish();
    await a;
    const c = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    expect(c.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when the handler throws (including SvelteKit error())', async () => {
    let mode: 'throw' | 'http' | 'ok' = 'throw';
    const handler = vi.fn(async () => {
      if (mode === 'throw') throw new Error('boom');
      if (mode === 'http') error(409, 'conflict');
      return json({ ok: true }, { status: 201 });
    });
    const wrapped = withClientRecordId(handler);
    const id = randomUUID();
    await expect(runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)))).rejects.toThrow(
      'boom'
    );
    mode = 'http';
    await expect(
      runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)))
    ).rejects.toMatchObject({ status: 409 });
    mode = 'ok';
    const retry = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    expect(retry.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('retakes a claim abandoned by a crashed request once it goes stale', async () => {
    const handler = vi.fn(async () => json({ ok: true }, { status: 201 }));
    const wrapped = withClientRecordId(handler);
    const id = randomUUID();
    runWithTenant(OWNER, () =>
      claimClientRecord(id, '/api/scout/record', Date.now() - STALE_CLAIM_MS - 1)
    );
    const res = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    expect(res.status).toBe(201);
    const again = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
    expect(again.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  describe('when a slow original outlives a stale-claim takeover', () => {
    type Outcome = 'ok' | 'fail' | 'throw';

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function race() {
      let clock = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => clock);
      const gates: Array<(o: Outcome) => void> = [];
      let writes = 0;
      const handler = vi.fn(async () => {
        const outcome = await new Promise<Outcome>((r) => gates.push(r));
        if (outcome === 'throw') throw new Error('db down');
        if (outcome === 'fail') return json({ error: 'nope' }, { status: 422 });
        writes++;
        return json({ ok: true }, { status: 201 });
      });
      const wrapped = withClientRecordId(handler);
      const id = randomUUID();
      const send = () => runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
      const started = (n: number) => vi.waitFor(() => expect(gates.length).toBe(n));
      return {
        handler,
        send,
        started,
        settle: (i: number, o: Outcome) => gates[i](o),
        advance: (ms: number) => {
          clock += ms;
        },
        writes: () => writes
      };
    }

    async function takeover(r: ReturnType<typeof race>) {
      const original = r.send();
      await r.started(1);
      r.advance(STALE_CLAIM_MS + 1);
      const holder = r.send();
      await r.started(2);
      return { original, holder };
    }

    it.each<Exclude<Outcome, 'ok'>>(['fail', 'throw'])(
      'an original that ends in %s does not free the new holder claim',
      async (outcome) => {
        const r = race();
        const { original, holder } = await takeover(r);
        r.settle(0, outcome);
        if (outcome === 'throw') await expect(original).rejects.toThrow('db down');
        else expect((await original).status).toBe(422);

        const overlap = await r.send();
        expect(overlap.status).toBe(503);
        expect(r.handler).toHaveBeenCalledTimes(2);

        r.settle(1, 'ok');
        expect((await holder).status).toBe(201);
        const repeat = await r.send();
        expect(repeat.status).toBe(200);
        expect(r.writes()).toBe(1);
        expect(r.handler).toHaveBeenCalledTimes(2);
      }
    );

    it('an original that succeeds does not mark the new holder claim done', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = race();
      const { original, holder } = await takeover(r);
      r.settle(0, 'ok');
      expect((await original).status).toBe(201);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/claim was taken over/));

      const overlap = await r.send();
      expect(overlap.status).toBe(503);

      r.settle(1, 'ok');
      expect((await holder).status).toBe(201);
      expect((await r.send()).status).toBe(200);
      expect(r.handler).toHaveBeenCalledTimes(2);
    });

    it('the new holder can still release its own claim after the original succeeded', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = race();
      const { original, holder } = await takeover(r);
      r.settle(0, 'ok');
      await original;
      r.settle(1, 'fail');
      expect((await holder).status).toBe(422);

      const retry = r.send();
      await r.started(3);
      r.settle(2, 'ok');
      expect((await retry).status).toBe(201);
      expect((await r.send()).status).toBe(200);
    });
  });

  it('keeps the same client id independent per Owner', async () => {
    const seen: string[] = [];
    const handler = vi.fn(async () => json({ ok: true }, { status: 201 }));
    const wrapped = withClientRecordId(handler);
    const id = randomUUID();
    const a = `client-id-owner-a-${randomUUID()}`;
    const b = `client-id-owner-b-${randomUUID()}`;
    for (const owner of [a, b, a, b]) {
      const res = await runWithTenantAsync(owner, async () => wrapped(eventWith(id)));
      seen.push(`${owner === a ? 'a' : 'b'}:${res.status}`);
    }
    expect(seen).toEqual(['a:201', 'b:201', 'a:200', 'b:200']);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['too short', 'abc1234'],
    ['bad characters', 'abcd efgh'],
    ['punctuation', 'abcdefgh;drop'],
    ['too long', 'a'.repeat(81)],
    ['empty', '']
  ])('runs unchanged with an invalid client record id (%s)', async (_label, id) => {
    const handler = vi.fn(async () => json({ ok: true }, { status: 201 }));
    const wrapped = withClientRecordId(handler);
    const headers = new Headers();
    headers.set(CLIENT_RECORD_HEADER, id);
    const event = {
      request: new Request('http://x/api/scout/record', { method: 'POST', headers, body: '{}' }),
      url: new URL('http://x/api/scout/record')
    } as unknown as RequestEvent;
    await runWithTenantAsync(OWNER, async () => wrapped(event));
    await runWithTenantAsync(OWNER, async () => wrapped(event));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('accepts ids at the pattern bounds (8 and 80 chars)', async () => {
    const hex = () => randomUUID().replace(/-/g, '');
    for (const id of [hex().slice(0, 8), `${hex()}${'_-'.repeat(24)}`.slice(0, 80)]) {
      const handler = vi.fn(async () => json({ ok: true }, { status: 201 }));
      const wrapped = withClientRecordId(handler);
      await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
      const again = await runWithTenantAsync(OWNER, async () => wrapped(eventWith(id)));
      expect(again.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it('runs unchanged outside a tenant context', async () => {
    const handler = vi.fn(async () => json({ ok: true }, { status: 201 }));
    const wrapped = withClientRecordId(handler);
    const id = randomUUID();
    await wrapped(eventWith(id));
    await wrapped(eventWith(id));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it.each([
    'spray/record',
    'insecticide/record',
    'fungicide/record',
    'harvest/record',
    'hay/cuttings',
    'scout/record'
  ])('wraps POST /api/%s', (route) => {
    const file = resolve(process.cwd(), `src/routes/api/${route}/+server.ts`);
    expect(readFileSync(file, 'utf8')).toMatch(
      /export const POST: RequestHandler = withClientRecordId\(/
    );
  });
});
