import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { runWithTenantAsync } from '$lib/db/tenant';
import { createBlock, getBlock } from '$lib/db/blocks';
import { createStockItem, getStockItemWithBalance, receiveLot } from '$lib/db/stock';
import { listSplitGroup } from '$lib/db/crops';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';

vi.mock('$lib/server/auth', () => ({
  requireOwner: vi.fn(() => ({ id: 'split-replay-user', role: 'owner' }))
}));
vi.mock('$lib/server/registry', () => ({
  getRegistry: vi.fn(async () => ({
    get: () => ({ plugin: { type: 'crop', displayName: 'Bush Bean' } })
  }))
}));

import { POST } from './+server';

const OWNER = 'owner_home_farm';

db.insert(users)
  .values({ id: 'split-replay-user', email: 'split-replay@test.local' })
  .onConflictDoNothing()
  .run();

function ev(blockId: string, body: unknown, key?: string): RequestEvent {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key) headers.set(CLIENT_RECORD_HEADER, key);
  return {
    params: { id: blockId },
    request: new Request(`http://localhost/api/blocks/${blockId}/plantings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    url: new URL(`http://localhost/api/blocks/${blockId}/plantings`),
    locals: {}
  } as unknown as RequestEvent;
}

describe('POST /api/blocks/[id]/plantings replay and split groups (R-13, R-19)', () => {
  it('a retried row with the same client record id saves once and draws seed once', async () => {
    await runWithTenantAsync(OWNER, async () => {
      const block = createBlock({ name: `replay-${randomUUID()}` });
      const item = createStockItem({
        category: 'seed',
        displayName: 'Replay bean',
        defaultUnit: 'seeds',
        pluginId: 'bush-bean-provider'
      });
      receiveLot({ stockItemId: item.id, receivedQuantity: 100, unit: 'seeds' });
      const key = randomUUID();
      const groupId = `sg_${randomUUID()}`;
      const body = {
        cropPluginId: 'bush-bean-provider',
        varietyDisplayName: 'Replay bean',
        quantityPlanted: 40,
        quantityUnit: 'seeds',
        stockItemId: item.id,
        sourceProvenance: 'fallback',
        splitGroupId: groupId
      };
      const first = await POST(ev(block.id, body, key));
      expect(first.status).toBe(201);
      const again = await POST(ev(block.id, body, key));
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ ok: true, duplicate: true });

      expect(getBlock(block.id)!.plantings).toHaveLength(1);
      expect(getBlock(block.id)!.plantings[0].splitGroupId).toBe(groupId);
      expect(getStockItemWithBalance(item.id)!.onHand).toBe(60);
      expect(listSplitGroup(groupId)).toHaveLength(1);
    });
  });

  it('a new client record id saves a second part of the same group', async () => {
    await runWithTenantAsync(OWNER, async () => {
      const groupId = `sg_${randomUUID()}`;
      const blocks = [1, 2].map((i) => createBlock({ name: `split-${i}-${randomUUID()}` }));
      for (const b of blocks) {
        const res = await POST(
          ev(
            b.id,
            { cropPluginId: 'bush-bean-provider', plannedPlants: 10, splitGroupId: groupId },
            randomUUID()
          )
        );
        expect(res.status).toBe(201);
      }
      expect(
        listSplitGroup(groupId)
          .map((c) => c.blockId)
          .sort()
      ).toEqual(blocks.map((b) => b.id).sort());
    });
  });

  it('refuses a malformed split group id', async () => {
    await runWithTenantAsync(OWNER, async () => {
      const block = createBlock({ name: `bad-${randomUUID()}` });
      const res = await POST(
        ev(block.id, { cropPluginId: 'bush-bean-provider', splitGroupId: 'group 1' })
      );
      expect(res.status).toBe(400);
    });
  });

  it('keeps undated parts of different groups on one block apart', async () => {
    await runWithTenantAsync(OWNER, async () => {
      const block = createBlock({ name: `merge-${randomUUID()}` });
      const base = {
        cropPluginId: 'bush-bean-provider',
        quantityPlanted: 5,
        quantityUnit: 'seeds'
      };
      await POST(ev(block.id, { ...base, splitGroupId: `sg_${randomUUID()}` }));
      await POST(ev(block.id, base));
      await POST(ev(block.id, base));
      const rows = getBlock(block.id)!.plantings;
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => !r.splitGroupId)?.quantityPlanted).toBe(10);
    });
  });
});
