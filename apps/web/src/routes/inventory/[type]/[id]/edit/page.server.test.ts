import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createStockItem, decrementForUse, receiveLot } from '$lib/db/stock';
import { load } from './+page.server';

type Existing = { onHand: number; onOrder: number; planned: number; lotCount: number };

function farm(): string {
  const id = `edit-${randomUUID().slice(0, 8)}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function loadEdit(ownerId: string, id: string): Promise<Existing> {
  return runWithTenant(ownerId, async () => {
    const data = (await load({
      params: { type: 'seed', id },
      locals: { user: { id: 'u', role: 'owner', activeOwnerId: ownerId } }
    } as never)) as { existing: Existing };
    return data.existing;
  });
}

describe('/inventory/[type]/[id]/edit on hand', () => {
  it('leaves ordered seed set aside for a planting out of on hand', async () => {
    const ownerId = farm();
    const itemId = runWithTenant(ownerId, () => {
      const item = createStockItem({
        category: 'seed',
        displayName: 'Bean',
        defaultUnit: 'seeds',
        pluginId: 'tomato'
      });
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: 50,
        unit: 'seeds',
        quantityStatus: 'ordered'
      });
      decrementForUse({ stockItemId: item.id, amount: 20, unit: 'seeds', drawExpected: true });
      return item.id;
    });
    const existing = await loadEdit(ownerId, itemId);
    expect(existing.onHand).toBe(0);
    expect(existing.onOrder).toBe(30);
    expect(existing.lotCount).toBe(1);
  });

  it('matches the detail page when an on-hand lot sits next to a drawn ordered lot', async () => {
    const ownerId = farm();
    const itemId = runWithTenant(ownerId, () => {
      const item = createStockItem({
        category: 'seed',
        displayName: 'Bean',
        defaultUnit: 'seeds',
        pluginId: 'tomato'
      });
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: 50,
        unit: 'seeds',
        quantityStatus: 'ordered'
      });
      decrementForUse({ stockItemId: item.id, amount: 20, unit: 'seeds', drawExpected: true });
      receiveLot({ stockItemId: item.id, receivedQuantity: 100, unit: 'seeds' });
      return item.id;
    });
    const existing = await loadEdit(ownerId, itemId);
    expect(existing.onHand).toBe(100);
    expect(existing.onOrder).toBe(30);
  });
});
