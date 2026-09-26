import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { json, type RequestEvent } from '@sveltejs/kit';
import { sqliteHandle } from '$lib/db/client';
import { runWithTenantAsync } from '$lib/db/tenant';
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
});
