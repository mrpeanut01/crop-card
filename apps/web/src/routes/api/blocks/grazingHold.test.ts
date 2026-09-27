// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { equipment, owners, users } from '$lib/db/schema';
import { runWithTenant, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock, getBlock } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';

vi.mock('$lib/server/auth', async () => {
  const { error } = await import('@sveltejs/kit');
  return {
    currentUser: () => ({ id: 'user-1', role: 'owner' }),
    requireOwner: (event: { locals?: { role?: string } }) => {
      if (event.locals?.role === 'helper') throw error(403, 'owner role required');
      return { id: 'user-1', role: 'owner' };
    }
  };
});

import { PATCH } from './[id]/+server';

function seed(sprayed: boolean) {
  const ownerId = `blocks-graze-${randomUUID()}`;
  const userId = `user-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test.local` })
    .run();
  return runWithTenant(ownerId, () => {
    const from = createField({ name: 'North pasture', kind: 'pasture' });
    const to = createField({ name: 'South field', kind: 'field' });
    const block = createBlock({ name: 'Paddock 1', fieldId: from.id, acres: 1 });
    if (sprayed) {
      db.insert(equipment)
        .values(tenantValues({ id: `${ownerId}-s`, type: 'sprayer' as const, label: 'S' }))
        .run();
      insertSprayEvent({
        blockId: block.id,
        sprayerId: `${ownerId}-s`,
        performedById: userId,
        occurredAt: Date.now() - 2 * 86_400_000,
        products: [{ pluginId: 'no-such-plugin', chemistryClasses: ['glyphosate'] }],
        conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
        rulesVersion: 'test',
        pluginHashes: {}
      });
    }
    return { ownerId, toId: to.id, blockId: block.id, fromId: from.id };
  });
}

const patch = (id: string, body: unknown) =>
  PATCH({
    params: { id },
    locals: {},
    request: new Request(`http://localhost/api/blocks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never);

describe('PATCH /api/blocks/:id grazing hold (C-21)', () => {
  it('refuses to move a sprayed block to another Area while its hold is open', async () => {
    const s = seed(true);
    await runWithTenant(s.ownerId, async () => {
      const res = await patch(s.blockId, { fieldId: s.toId });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('BLOCK_HAS_GRAZING_HOLD');
      expect(getBlock(s.blockId)?.fieldId).toBe(s.fromId);
      const rename = await patch(s.blockId, { name: 'Paddock A' });
      expect(rename.status).toBe(200);
    });
  });

  it('moves a block with no applications', async () => {
    const s = seed(false);
    await runWithTenant(s.ownerId, async () => {
      const res = await patch(s.blockId, { fieldId: s.toId });
      expect(res.status).toBe(200);
      expect(getBlock(s.blockId)?.fieldId).toBe(s.toId);
    });
  });
});
