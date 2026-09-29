// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import {
  createEquipment,
  getEquipment,
  listEquipmentLog,
  updateEquipmentState
} from '$lib/db/equipment';

const auth = vi.hoisted(() => ({ role: 'owner' as 'owner' | 'helper', id: 'user-1' }));
vi.mock('$lib/server/auth', async () => {
  const { error } = await import('@sveltejs/kit');
  return {
    currentUser: () => ({ id: auth.id, role: auth.role }),
    requireOwner: () => {
      if (auth.role !== 'owner') throw error(403, 'owner role required');
      return { id: auth.id, role: auth.role };
    }
  };
});

import { PATCH } from './+server';

function seedOwner(): string {
  const id = `eq-spec-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

const patch = (id: string, body: unknown) =>
  PATCH({
    params: { id },
    request: new Request(`http://localhost/api/equipment/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never) as Promise<Response>;

describe('PATCH /api/equipment/:id sprayer tank and nozzle (#474)', () => {
  it('sets and clears tank size and nozzle, keeping the rest of the spec', async () => {
    await runWithTenant(seedOwner(), async () => {
      const sprayer = createEquipment({
        type: 'sprayer',
        label: 'Backpack',
        spec: { templateId: 'backpack-4gal' }
      });
      const res = await patch(sprayer.id, { spec: { tankGal: 4, nozzle: 'TeeJet 8002' } });
      expect(res.status).toBe(200);
      expect(getEquipment(sprayer.id)!.spec).toEqual({
        templateId: 'backpack-4gal',
        tankGal: 4,
        nozzle: 'TeeJet 8002'
      });
      await patch(sprayer.id, { spec: { nozzle: null } });
      expect(getEquipment(sprayer.id)!.spec).toEqual({ templateId: 'backpack-4gal', tankGal: 4 });
    });
  });

  it('refuses bad sizes, other equipment and helpers', async () => {
    await runWithTenant(seedOwner(), async () => {
      const sprayer = createEquipment({ type: 'sprayer', label: 'Boom' });
      expect((await patch(sprayer.id, { spec: { tankGal: -1 } })).status).toBe(400);
      expect((await patch(sprayer.id, { spec: { templateId: 'x' } })).status).toBe(400);
      const tractor = createEquipment({ type: 'tractor', label: 'Tractor' });
      expect((await patch(tractor.id, { spec: { tankGal: 10 } })).status).toBe(400);
      auth.role = 'helper';
      await expect(patch(sprayer.id, { spec: { tankGal: 10 } })).rejects.toMatchObject({
        status: 403
      });
      auth.role = 'owner';
      expect(getEquipment(sprayer.id)!.spec?.tankGal).toBeUndefined();
    });
  });

  it('changing the nozzle clears the old calibration and logs why', async () => {
    const userId = `eq-spec-user-${randomUUID()}`;
    db.insert(users)
      .values({ id: userId, email: `${userId}@test` })
      .run();
    auth.id = userId;
    await runWithTenant(seedOwner(), async () => {
      const sprayer = createEquipment({
        type: 'sprayer',
        label: 'Boom',
        spec: { nozzle: 'TeeJet 8002' }
      });
      updateEquipmentState(sprayer.id, { calibratedGpa: 20, calibrationDate: Date.now() });

      const same = await patch(sprayer.id, { spec: { tankGal: 25, nozzle: 'TeeJet 8002' } });
      expect((await same.json()).calibrationCleared).toBe(false);
      expect(getEquipment(sprayer.id)!.state.calibratedGpa).toBe(20);

      const res = await patch(sprayer.id, { spec: { nozzle: 'TeeJet 8004' } });
      expect(res.status).toBe(200);
      expect((await res.json()).calibrationCleared).toBe(true);
      const after = getEquipment(sprayer.id)!;
      expect(after.state.calibratedGpa).toBeUndefined();
      expect(after.state.calibrationDate).toBeUndefined();
      const log = listEquipmentLog(sprayer.id, { limit: 5 });
      expect(log[0]).toMatchObject({ kind: 'calibration', performedById: userId });
      expect(log[0].notes).toContain('Calibrate before the next spray');
    });
    auth.id = 'user-1';
  });
});
