import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', () => ({ requireOwner: () => ({ id: 'o', role: 'owner' }) }));
vi.mock('$lib/db/stock', () => ({
  getStockItem: () => ({ id: 'sku', category: 'seed' }),
  updateStockItem: vi.fn()
}));

import { POST } from './+server';

describe('POST /api/stock/:id/planter-plate', () => {
  it('answers 400, not 500, to a body that is not JSON', async () => {
    const call = POST({
      params: { id: 'sku' },
      request: new Request('http://localhost/api/stock/sku/planter-plate', {
        method: 'POST',
        body: 'not json'
      })
    } as never);
    await expect(call).rejects.toMatchObject({ status: 400 });
  });
});
