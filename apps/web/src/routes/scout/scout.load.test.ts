import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createBlock } from '$lib/db/blocks';
import { insertScoutObservation } from '$lib/db/scoutObservations';
import { ensureSystemUser } from '$lib/db/users';
import { runWithTenant } from '$lib/db/tenant';
import { saveSeasonSetup } from '$lib/season/setup.server';
import { getRegistry } from '$lib/server/registry';

vi.mock('$lib/server/degreeDays.server', () => ({
  loadDegreeDays: () => Promise.resolve(null),
  SCOUT_FETCH_TIMEOUT_MS: 1
}));

const { load } = await import('./+page.server');

const OWNER = 'owner_home_farm';

type Out = {
  observationsByBlock: Record<string, Array<{ pest: string; note: string | null }>>;
  pestThresholds: Array<{ pest: string; metric: string; threshold: number }>;
  noHerbicides: boolean;
};

const run = () =>
  load({
    url: new URL('http://x/scout'),
    locals: { user: { role: 'owner' }, locale: 'en' }
  } as never) as Promise<Out>;

beforeAll(async () => {
  await getRegistry();
}, 60_000);

describe('/scout loader', () => {
  it('passes the typed note of a counted observation (#731)', () =>
    runWithTenant(OWNER, async () => {
      const user = await ensureSystemUser();
      const block = createBlock({ name: 'Scout bed #731', acres: 0.01 } as never);
      insertScoutObservation({
        blockId: block.id,
        performedById: user.id,
        pest: 'broadleaf-weed',
        metric: 'avg-per-10sqft',
        value: 1.5,
        notes: 'spots=[1,2,1,2] decision=SKIP note: Aphids on a few lettuce heads',
        occurredAt: Date.now()
      });
      const out = await run();
      expect(out.observationsByBlock[block.id][0].note).toBe('Aphids on a few lettuce heads');
    }));

  it('lists label thresholds and reads the no-herbicide weed strategy (#713)', () =>
    runWithTenant(OWNER, async () => {
      const out = await run();
      expect(out.pestThresholds.length).toBeGreaterThan(0);
      saveSeasonSetup(new Date().getFullYear(), { weedStrategy: 'cultivate-first' });
      expect((await run()).noHerbicides).toBe(true);
    }));
});
