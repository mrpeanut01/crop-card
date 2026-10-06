import { beforeEach, describe, expect, it, vi } from 'vitest';

const pins = new Map<string, number>();
let answerPersist: ((kept: boolean) => void) | null = null;

async function answer(kept: boolean): Promise<void> {
  await vi.waitFor(() => expect(answerPersist).not.toBeNull());
  answerPersist!(kept);
  answerPersist = null;
}

vi.mock('$lib/client/cardStore', () => ({
  pinCard: async (key: string, now = Date.now()) => {
    pins.set(key, now);
    return true;
  },
  unpinCard: async (key: string) => pins.delete(key),
  listPinned: async () =>
    [...pins.entries()].sort((a, b) => b[1] - a[1]).map(([key, pinnedAt]) => ({ key, pinnedAt }))
}));

vi.mock('$lib/client/offlineStorage', () => ({
  requestPersistentStorage: () =>
    new Promise<boolean>((resolve) => {
      answerPersist = resolve;
    })
}));

const { OfflineCards } = await import('./offlineCards.svelte');

describe('OfflineCards pinning (#572)', () => {
  beforeEach(() => {
    pins.clear();
    answerPersist = null;
  });

  it('shows a pin while the browser is still asking to keep storage', async () => {
    const cards = new OfflineCards();
    await cards.togglePin('ar_1');
    expect(cards.isPinned('ar_1')).toBe(true);
    expect(cards.storageKept).toBeNull();
    await answer(false);
    await vi.waitFor(() => expect(cards.storageKept).toBe(false));
  });

  it('pins a whole barn without waiting for the prompt', async () => {
    const cards = new OfflineCards();
    await cards.pinAll(['fl_1', 'an_1', 'an_2']);
    expect(cards.allPinned(['fl_1', 'an_1', 'an_2'])).toBe(true);
    expect(cards.pinned[0]).toBe('fl_1');
  });

  it('unpins without asking for storage', async () => {
    const cards = new OfflineCards();
    await cards.togglePin('ar_1');
    await answer(true);
    await vi.waitFor(() => expect(cards.storageKept).toBe(true));
    await cards.togglePin('ar_1');
    expect(cards.isPinned('ar_1')).toBe(false);
  });
});
