// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string, userId: 'water-owner' }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: m.userId, role: m.role });
  return {
    currentUser: user,
    requireUser: user,
    requireMutator: () => {
      if (m.role === 'inspector') throw error(403, 'inspector role is read-only');
      return user();
    },
    requireOwner: () => {
      if (m.role !== 'owner') throw error(403, 'owner role required');
      return user();
    }
  };
});

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { getSetting } from '$lib/db/settings';
import { listIrrigationEvents, listRainGaugeReadings } from '$lib/db/irrigation';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { seasonYearOf } from '$lib/server/seasonClose';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { waterTargetKey } from '$lib/weather/waterSources';
import { GET as LIST, POST as LOG } from './+server';
import { DELETE as DELETE_LOG } from './[id]/+server';
import { POST as TARGET } from './target/+server';
import { GET as SUMMARY } from './summary/+server';
import { POST as GAUGE } from '../rain-gauge/+server';
import { DELETE as DELETE_GAUGE } from '../rain-gauge/[id]/+server';
import { GET as RECORD_CARD } from '../records/[kind]/[id]/card/+server';

const H = 3_600_000;
const BASE = 'http://localhost/api';
type Handler = (event: never) => Response | Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

for (const id of ['water-owner', 'water-helper', 'water-helper-2']) {
  db.insert(users)
    .values({ id, email: `${id}@test.local` })
    .onConflictDoNothing()
    .run();
}

function seedOwner(): string {
  const id = `water-ep-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: {
    params?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
    locale?: string;
  } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`${BASE}${path}`);
  try {
    const res = await (handler as Handler)({
      params: opts.params ?? {},
      url,
      request: new Request(url.href, {
        method,
        headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }),
      locals: opts.locale ? { locale: opts.locale } : {}
    } as never);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) throw e;
    return { status, body: {} };
  }
}

const log = (body: unknown, headers?: Record<string, string>) =>
  call(LOG, '/irrigation', 'POST', { body, headers });
const gauge = (body: unknown, headers?: Record<string, string>) =>
  call(GAUGE, '/rain-gauge', 'POST', { body, headers });

function garden() {
  const field = createField({ name: 'Kitchen beds', kind: 'garden' });
  const bed = createBlock({ name: 'Bed 1', fieldId: field.id });
  return { fieldId: field.id, bedId: bed.id };
}

beforeEach(() => {
  m.role = 'owner';
  m.userId = 'water-owner';
});

describe('POST /api/irrigation', () => {
  it('saves a watering for a helper, with the bed and gallons', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      m.role = 'helper';
      m.userId = 'water-helper';
      const res = await log({
        fieldId: g.fieldId,
        blockId: g.bedId,
        gallons: 20,
        method: 'hand',
        occurredAt: Date.now() - H
      });
      expect(res.status).toBe(201);
      expect(res.body.irrigation).toMatchObject({
        fieldId: g.fieldId,
        blockId: g.bedId,
        gallons: 20
      });
      expect(listIrrigationEvents()).toHaveLength(1);
    });
  });

  it('refuses inspectors, an empty amount, a bed from another Area and a future time', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      const other = createField({ name: 'Back field', kind: 'field' });
      expect((await log({ fieldId: g.fieldId })).status).toBe(400);
      expect((await log({ fieldId: other.id, blockId: g.bedId, inches: 1 })).status).toBe(400);
      const future = await log({ fieldId: g.fieldId, inches: 1, occurredAt: Date.now() + 2 * H });
      expect(future.body.code).toBe('IN_THE_FUTURE');
      expect((await log({ fieldId: g.fieldId, inches: 11 })).status).toBe(400);
      m.role = 'inspector';
      expect((await log({ fieldId: g.fieldId, inches: 1 })).status).toBe(403);
      expect(listIrrigationEvents()).toHaveLength(0);
    });
  });

  it('answers its refusals in the request language', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      const other = createField({ name: 'Back field', kind: 'field' });
      const es = (body: unknown) => call(LOG, '/irrigation', 'POST', { body, locale: 'es' });
      expect((await es({ fieldId: other.id, blockId: g.bedId, inches: 1 })).body.error).toBe(
        'Esa cama de cultivo no está en esta Área.'
      );
      const future = await es({ fieldId: g.fieldId, inches: 1, occurredAt: Date.now() + 2 * H });
      expect(future.body.error).toBe('La hora del riego está en el futuro.');
      const english = await log({ fieldId: g.fieldId, inches: 1, occurredAt: Date.now() + 2 * H });
      expect(english.body.error).toBe('The watering time is in the future.');
      const gaugeEs = await call(GAUGE, '/rain-gauge', 'POST', {
        body: { fieldIds: [g.fieldId], inches: 0.5, readAt: Date.now() + 2 * H },
        locale: 'es'
      });
      expect(gaugeEs.body.error).toBe('La hora de la lectura del pluviómetro está en el futuro.');
      m.role = 'helper';
      const target = await call(TARGET, '/irrigation/target', 'POST', {
        body: { fieldId: g.fieldId, inches: 1 },
        locale: 'es'
      });
      expect(target.status).toBe(403);
      expect(target.body.error).toBe(
        'Solo el propietario fija la meta de agua. Pregunta al propietario.'
      );
    });
  });

  it("refuses another Owner's Area", async () => {
    const a = seedOwner();
    const b = seedOwner();
    const ga = await runWithTenantAsync(a, async () => garden());
    await runWithTenantAsync(b, async () => {
      const res = await log({ fieldId: ga.fieldId, inches: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unknown fieldId');
    });
    await runWithTenantAsync(a, async () => expect(listIrrigationEvents()).toHaveLength(0));
  });

  it('saves a replayed client record once', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      const headers = { [CLIENT_RECORD_HEADER]: `irr_${randomUUID()}` };
      const body = { fieldId: g.fieldId, inches: 0.5, occurredAt: Date.now() - H };
      expect((await log(body, headers)).status).toBe(201);
      const again = await log(body, headers);
      expect(again.status).toBe(200);
      expect(again.body.duplicate).toBe(true);
      expect(listIrrigationEvents()).toHaveLength(1);
    });
  });

  it('is never gated by the season close-out (E0-6)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      createCloseout({ year: seasonYearOf(Date.now()), snapshotJson: '{}' });
      const g = garden();
      expect((await log({ fieldId: g.fieldId, inches: 0.5 })).status).toBe(201);
      expect((await gauge({ fieldIds: [g.fieldId], inches: 0.3 })).status).toBe(201);
    });
  });

  it('lists logs by Area and rejects a bad range', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      await log({ fieldId: g.fieldId, inches: 0.5 });
      const res = await call(LIST, `/irrigation?fieldId=${g.fieldId}`, 'GET');
      expect(res.body.irrigation).toHaveLength(1);
      expect((await call(LIST, '/irrigation?from=abc', 'GET')).status).toBe(400);
    });
  });
});

describe('DELETE /api/irrigation/:id', () => {
  it('lets the owner or the person who logged it remove it, no one else', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      m.role = 'helper';
      m.userId = 'water-helper';
      const a = (await log({ fieldId: g.fieldId, inches: 9 })).body.irrigation.id;
      const b = (await log({ fieldId: g.fieldId, inches: 1 })).body.irrigation.id;
      m.userId = 'water-helper-2';
      const refused = await call(DELETE_LOG, `/irrigation/${a}`, 'DELETE', { params: { id: a } });
      expect(refused.status).toBe(403);
      expect(refused.body.askOwner).toBe(true);
      m.userId = 'water-helper';
      expect(
        (await call(DELETE_LOG, `/irrigation/${a}`, 'DELETE', { params: { id: a } })).status
      ).toBe(200);
      m.role = 'owner';
      m.userId = 'water-owner';
      expect(
        (await call(DELETE_LOG, `/irrigation/${b}`, 'DELETE', { params: { id: b } })).status
      ).toBe(200);
      expect(listIrrigationEvents()).toHaveLength(0);
      expect(
        (await call(DELETE_LOG, `/irrigation/${b}`, 'DELETE', { params: { id: b } })).status
      ).toBe(404);
    });
  });
});

describe('POST /api/rain-gauge', () => {
  it('saves one row per Area and says where each counts from', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      const other = createField({ name: 'Back field', kind: 'field' });
      const readAt = Date.now() - H;
      const first = await gauge({ fieldIds: [g.fieldId], inches: 0, readAt: readAt - 48 * H });
      expect(first.status).toBe(201);
      const res = await gauge({ fieldIds: [g.fieldId, other.id], inches: 1.2, readAt });
      expect(res.status).toBe(201);
      const byField = Object.fromEntries(
        res.body.readings.map((r: Json) => [r.fieldId, r.countsFrom])
      );
      expect(byField[g.fieldId]).toBe(readAt - 48 * H);
      expect(byField[other.id]).toBe(readAt - 24 * H);
      expect(listRainGaugeReadings()).toHaveLength(3);
    });
  });

  it('refuses more than 15 inches, inspectors and foreign Areas', async () => {
    const a = seedOwner();
    const ga = await runWithTenantAsync(a, async () => garden());
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      expect((await gauge({ fieldIds: [g.fieldId], inches: 16 })).status).toBe(400);
      expect((await gauge({ fieldIds: [g.fieldId, ga.fieldId], inches: 1 })).status).toBe(400);
      m.role = 'inspector';
      expect((await gauge({ fieldIds: [g.fieldId], inches: 1 })).status).toBe(403);
      expect(listRainGaugeReadings()).toHaveLength(0);
    });
  });

  it('removes a mistyped reading for the person who entered it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      m.role = 'helper';
      m.userId = 'water-helper';
      const id = (await gauge({ fieldIds: [g.fieldId], inches: 10 })).body.readings[0].id;
      expect(
        (await call(DELETE_GAUGE, `/rain-gauge/${id}`, 'DELETE', { params: { id } })).status
      ).toBe(200);
    });
  });
});

describe('POST /api/irrigation/target', () => {
  it('is owner only, stores manual inches, and resets to the default', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      m.role = 'helper';
      const refused = await call(TARGET, '/irrigation/target', 'POST', {
        body: { fieldId: g.fieldId, inches: 2 }
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toContain('Ask the owner.');
      m.role = 'owner';
      const set = await call(TARGET, '/irrigation/target', 'POST', {
        body: { fieldId: g.fieldId, inches: 1.5 }
      });
      expect(set.body.target).toEqual({ inches: 1.5, provenance: 'manual' });
      expect(getSetting(waterTargetKey(g.fieldId))).toBe('1.5');
      const reset = await call(TARGET, '/irrigation/target', 'POST', {
        body: { fieldId: g.fieldId, inches: null }
      });
      expect(reset.body.target).toEqual({ inches: 1, provenance: 'fallback' });
      expect(getSetting(waterTargetKey(g.fieldId))).toBeUndefined();
      expect(
        (
          await call(TARGET, '/irrigation/target', 'POST', {
            body: { fieldId: g.fieldId, inches: 9 }
          })
        ).status
      ).toBe(400);
    });
  });
});

describe('GET /api/irrigation/summary and the record card', () => {
  it('returns beds, target and history, and builds the watering card', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const g = garden();
      const id = (await log({ fieldId: g.fieldId, blockId: g.bedId, inches: 0.4 })).body.irrigation
        .id;
      await gauge({ fieldIds: [g.fieldId], inches: 0.2 });
      const s = await call(SUMMARY, `/irrigation/summary?fieldId=${g.fieldId}`, 'GET');
      expect(s.body.beds).toEqual([{ id: g.bedId, name: 'Bed 1', sized: false }]);
      expect(s.body.area.sized).toBe(false);
      expect(s.body.target).toEqual({ inches: 1, provenance: 'fallback' });
      expect(s.body.logs).toHaveLength(1);
      expect(s.body.gauges).toHaveLength(1);
      expect(s.body.lastGaugeAt).toBeTypeOf('number');
      expect(s.body.canSetTarget).toBe(true);

      const card = await call(RECORD_CARD, `/records/irrigation/${id}/card`, 'GET', {
        params: { kind: 'irrigation', id }
      });
      expect(card.status).toBe(200);
      expect(card.body.cards[0]).toMatchObject({
        kind: 'irrigation',
        key: `rc_irrigation.${id}`,
        title: 'Watered Bed 1'
      });
    });
  });

  it("finds no card or summary for another Owner's log", async () => {
    const a = seedOwner();
    const { id, fieldId } = await runWithTenantAsync(a, async () => {
      const g = garden();
      return {
        id: (await log({ fieldId: g.fieldId, inches: 1 })).body.irrigation.id as string,
        fieldId: g.fieldId
      };
    });
    await runWithTenantAsync(seedOwner(), async () => {
      expect(
        (await call(RECORD_CARD, '/x', 'GET', { params: { kind: 'irrigation', id } })).status
      ).toBe(404);
      expect((await call(SUMMARY, `/irrigation/summary?fieldId=${fieldId}`, 'GET')).status).toBe(
        404
      );
      expect((await call(DELETE_LOG, '/x', 'DELETE', { params: { id } })).status).toBe(404);
    });
  });
});
