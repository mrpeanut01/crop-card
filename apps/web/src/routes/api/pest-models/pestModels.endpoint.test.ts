// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string, signedIn: true }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'dd-user', role: m.role });
  return {
    currentUser: () => (m.signedIn ? user() : null),
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
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { listBiofixes } from '$lib/db/pestBiofix';
import { createCloseout } from '$lib/db/seasonCloseouts';
import { seasonYearOf } from '$lib/server/seasonClose';
import { registerTestPestModel } from '$lib/server/registry';
import { E2E_TRAP_MODEL } from '$lib/ipm/pestModel.fixtures';
import { PUT } from './[id]/biofix/+server';
import { GET } from '../weather/degree-days/+server';

const MODEL = E2E_TRAP_MODEL.pluginId;
const CALENDAR_MODEL = 'test-calendar-borer';
const YEAR = new Date().getFullYear();

function seedOwner(): string {
  const id = `ddr-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

async function put(id: string, body: unknown) {
  const url = new URL(`http://localhost/api/pest-models/${id}/biofix`);
  try {
    const res = await PUT({
      params: { id },
      url,
      request: new Request(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      locals: {}
    } as never);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    return { status: (e as { status: number }).status, body: {} };
  }
}

async function get(query: string) {
  const url = new URL(`http://localhost/api/weather/degree-days${query}`);
  const res = await GET({ url, params: {}, locals: {} } as never);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  await registerTestPestModel(E2E_TRAP_MODEL);
  await registerTestPestModel({
    ...E2E_TRAP_MODEL,
    pluginId: CALENDAR_MODEL,
    biofix: { kind: 'calendar-date', date: '03-01' }
  });
});

beforeEach(() => {
  m.role = 'owner';
  m.signedIn = true;
});

describe('PUT /api/pest-models/[id]/biofix', () => {
  it('owners and helpers record a catch; inspectors cannot', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      m.role = 'helper';
      const ok = await put(MODEL, { year: YEAR, date: `${YEAR}-01-02` });
      expect(ok.status).toBe(200);
      expect(ok.body.biofix).toMatchObject({ date: `${YEAR}-01-02`, byUserId: 'dd-user' });
      expect(listBiofixes(YEAR).get(MODEL)?.date).toBe(`${YEAR}-01-02`);
      m.role = 'inspector';
      expect((await put(MODEL, { year: YEAR, date: `${YEAR}-01-03` })).status).toBe(403);
      m.role = 'owner';
      expect((await put(MODEL, { year: YEAR, date: null })).body).toEqual({ biofix: null });
      expect(listBiofixes(YEAR).size).toBe(0);
    });
  });

  it('refuses unknown models, fixed-date models, bad dates and future dates', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      expect((await put('no-such-model', { year: YEAR, date: `${YEAR}-01-02` })).status).toBe(404);
      const fixed = await put(CALENDAR_MODEL, { year: YEAR, date: `${YEAR}-01-02` });
      expect(fixed).toMatchObject({ status: 400, body: { code: 'BIOFIX_NOT_TRAP' } });
      expect((await put(MODEL, { year: YEAR, date: `${YEAR}-02-30` })).status).toBe(400);
      expect((await put(MODEL, { year: YEAR, date: `${YEAR - 1}-06-01` })).status).toBe(400);
      const future = await put(MODEL, { year: YEAR + 1, date: `${YEAR + 1}-06-01` });
      expect(future.body.code).toBe('IN_THE_FUTURE');
    });
  });

  it('is not gated by a closed season (E0-6)', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      createCloseout({ year: seasonYearOf(Date.now()), snapshotJson: '{}' });
      expect((await put(MODEL, { year: YEAR, date: `${YEAR}-01-02` })).status).toBe(200);
    });
  });
});

describe('GET /api/weather/degree-days', () => {
  it('needs a signed-in member', async () => {
    m.signedIn = false;
    expect((await get('')).status).toBe(401);
  });

  it('validates the query and 404s an unknown model', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      expect((await get('?year=1999')).status).toBe(400);
      expect((await get(`?year=${YEAR + 1}`)).status).toBe(400);
      expect((await get('?model=Bad_Id')).status).toBe(400);
      expect((await get('?model=no-such-model')).status).toBe(404);
    });
  });

  it('answers without a location with a plain message, any role', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      m.role = 'inspector';
      const r = await get(`?model=${MODEL}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        year: YEAR,
        location: 'no-location',
        message: 'Set your farm location.'
      });
      expect(r.body.models[0]).toMatchObject({
        modelId: MODEL,
        method: 'simple-average',
        baseTempF: 50,
        upperCutoffF: null,
        biofix: { kind: 'first-trap-catch', date: null, acceptsManual: true }
      });
    });
  });
});
