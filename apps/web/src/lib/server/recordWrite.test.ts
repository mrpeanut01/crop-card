import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { json, type RequestEvent } from '@sveltejs/kit';
import { sqliteHandle } from '$lib/db/client';
import { runWithTenantAsync } from '$lib/db/tenant';
import { STALE_CLAIM_MS } from '$lib/db/clientRecords';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { withClientRecordId } from './clientRecordId';
import { bestEffort, writeRecord } from './recordWrite';

const OWNER = 'owner_home_farm';
const probe = (id: string) =>
  sqliteHandle().prepare('INSERT INTO record_write_probe (id) VALUES (?)').run(id);
const probed = (id: string) =>
  !!sqliteHandle().prepare('SELECT 1 FROM record_write_probe WHERE id = ?').get(id);
const receiptStatus = (key: string) =>
  (
    sqliteHandle()
      .prepare(
        'SELECT status FROM client_record_receipts WHERE owner_id = ? AND client_record_id = ?'
      )
      .get(OWNER, key) as { status: string } | undefined
  )?.status;

function eventWith(key: string | null): RequestEvent {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key) headers.set(CLIENT_RECORD_HEADER, key);
  return {
    request: new Request('http://x/api/spray/record', { method: 'POST', headers, body: '{}' }),
    url: new URL('http://x/api/spray/record')
  } as unknown as RequestEvent;
}

beforeAll(() => {
  sqliteHandle().exec('CREATE TABLE IF NOT EXISTS record_write_probe (id TEXT PRIMARY KEY)');
});

describe('writeRecord', () => {
  it('commits every write together', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    writeRecord(eventWith(null), () => {
      probe(a);
      probe(b);
    });
    expect(probed(a) && probed(b)).toBe(true);
  });

  it('a failure part-way rolls back the writes already made', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    expect(() =>
      writeRecord(eventWith(null), () => {
        probe(a);
        probe(b);
        throw new Error('sprayer state write failed');
      })
    ).toThrow(/sprayer state/);
    expect(probed(a)).toBe(false);
    expect(probed(b)).toBe(false);
  });

  it('bestEffort undoes only its own step and reports the error', () => {
    const [kept, undone] = [randomUUID(), randomUUID()];
    let outcome: ReturnType<typeof bestEffort> | undefined;
    writeRecord(eventWith(null), () => {
      probe(kept);
      outcome = bestEffort(() => {
        probe(undone);
        throw new Error('stock lot missing');
      });
    });
    expect(outcome).toMatchObject({ ok: false });
    expect(probed(kept)).toBe(true);
    expect(probed(undone)).toBe(false);
  });
});

describe('writeRecord + offline replay receipts', () => {
  it('marks the receipt done in the same transaction as the record', async () => {
    const key = `rw-${randomUUID()}`;
    const id = randomUUID();
    let statusInside: string | undefined;
    const handler = withClientRecordId(async (event) => {
      writeRecord(event, () => probe(id));
      statusInside = receiptStatus(key);
      return json({ ok: true });
    });
    const res = await runWithTenantAsync(OWNER, async () => handler(eventWith(key)));
    expect(res.status).toBe(200);
    expect(statusInside).toBe('done');
    expect(probed(id)).toBe(true);
  });

  it('a mid-write failure leaves no record and no receipt, so a replay saves it once', async () => {
    const key = `rw-${randomUUID()}`;
    const id = randomUUID();
    let fail = true;
    const handler = withClientRecordId(async (event) => {
      writeRecord(event, () => {
        probe(id);
        if (fail) throw new Error('disk full');
      });
      return json({ ok: true }, { status: 201 });
    });
    await expect(runWithTenantAsync(OWNER, async () => handler(eventWith(key)))).rejects.toThrow(
      /disk full/
    );
    expect(probed(id)).toBe(false);
    expect(receiptStatus(key)).toBeUndefined();

    fail = false;
    const retry = await runWithTenantAsync(OWNER, async () => handler(eventWith(key)));
    expect(retry.status).toBe(201);
    const replay = await runWithTenantAsync(OWNER, async () => handler(eventWith(key)));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(probed(id)).toBe(true);
  });

  describe('when a slow original outlives a stale-claim takeover', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function race() {
      let clock = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => clock);
      const key = `rw-${randomUUID()}`;
      const gates: Array<() => void> = [];
      const attempted: string[] = [];
      const written: string[] = [];
      const handler = withClientRecordId(async (event) => {
        await new Promise<void>((r) => gates.push(r));
        const id = randomUUID();
        attempted.push(id);
        writeRecord(event, () => probe(id));
        written.push(id);
        return json({ ok: true }, { status: 201 });
      });
      const send = () => runWithTenantAsync(OWNER, async () => handler(eventWith(key)));
      const started = (n: number) => vi.waitFor(() => expect(gates.length).toBe(n));
      return {
        key,
        send,
        started,
        attempted,
        written,
        settle: (i: number) => gates[i](),
        advance: (ms: number) => {
          clock += ms;
        }
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

    it('rolls the original write back and answers pending while the new holder saves', async () => {
      const r = race();
      const { original, holder } = await takeover(r);
      r.settle(0);
      const res = await original;
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        error: expect.stringMatching(/already being saved/)
      });
      expect(r.attempted).toHaveLength(1);
      expect(probed(r.attempted[0])).toBe(false);
      expect(r.written).toHaveLength(0);
      expect(receiptStatus(r.key)).toBe('pending');

      r.settle(1);
      expect((await holder).status).toBe(201);
      expect(r.written).toHaveLength(1);
      expect(probed(r.written[0])).toBe(true);
      expect(receiptStatus(r.key)).toBe('done');
      const replay = await r.send();
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ duplicate: true });
    });

    it('rolls the original write back and answers duplicate once the new holder saved', async () => {
      const r = race();
      const { original, holder } = await takeover(r);
      r.settle(1);
      expect((await holder).status).toBe(201);
      r.settle(0);
      const res = await original;
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
      expect(r.attempted).toHaveLength(2);
      expect(probed(r.attempted[1])).toBe(false);
      expect(r.written).toEqual([r.attempted[0]]);
      expect(probed(r.attempted[0])).toBe(true);
      expect(receiptStatus(r.key)).toBe('done');
    });
  });
});
