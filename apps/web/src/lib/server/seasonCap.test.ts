// @vitest-environment node
/**
 * #820: the season cap loader reads the block's other Banvel applications
 * for the farm only, keeps deleted ones that were applied, drops "never
 * applied" ones, and reads a custom-rate record as not known. The spray
 * endpoints refuse a pass over the cap (SC-1) and answer the verdicts.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { HerbicidePlugin } from '$lib/plugins/schemas';

const m = vi.hoisted(() => ({ ownerId: '', role: 'owner' }));

vi.mock('$lib/server/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth')>();
  const user = () => ({
    id: 'season-cap-user',
    email: 'season-cap@example.test',
    phone: null,
    role: m.role,
    activeOwnerId: m.ownerId,
    isSuperadmin: false
  });
  return { ...actual, currentUser: user, requireUser: user };
});

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { createEquipment } from '$lib/db/equipment';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { deleteSprayEvent } from '$lib/db/admin';
import { insertSprayEvent, listSprayEvents } from '$lib/db/sprayEvents';
import { withCropRate } from '$lib/plugins/cropRate';
import { evaluateSeasonCaps } from '$lib/safety/seasonCap';
import { getBaseRegistry } from './registry';
import { loadSeasonCapContext } from './seasonCap';
import { POST as RECORD } from '../../routes/api/spray/record/+server';
import { POST as EVALUATE } from '../../routes/api/spray/evaluate/+server';

const CORN = 'corn-feed-dent-pioneer';
const DAY = 86_400_000;
let banvel: HerbicidePlugin;

beforeAll(async () => {
  const plugin = (await getBaseRegistry()).get('banvel')?.plugin;
  if (!plugin || plugin.type !== 'herbicide') throw new Error('banvel missing');
  banvel = withCropRate(plugin, [CORN]);
  expect(banvel.ratePerAcre).toEqual({ amount: 0.5, unit: 'pt' });
});

db.insert(users)
  .values({ id: 'season-cap-user', email: 'season-cap@example.test' })
  .onConflictDoNothing()
  .run();

function seedFarm(label: string) {
  const ownerId = `season-cap-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: `Field ${label}`, kind: 'field', acres: 5 });
    const block = createBlock({ name: `Block ${label}`, fieldId: field.id, acres: 5 });
    const sprayerId = createEquipment({ type: 'sprayer', label: 'Boom' }).id;
    return { ownerId, blockId: block.id, sprayerId };
  });
}

type Farm = ReturnType<typeof seedFarm>;

function spray(
  farm: Farm,
  occurredAt: number,
  opts: { blockId?: string; ownerId?: string; amount?: number; custom?: boolean } = {}
) {
  return runWithTenant(opts.ownerId ?? farm.ownerId, () =>
    insertSprayEvent({
      blockId: opts.blockId ?? farm.blockId,
      sprayerId: farm.sprayerId,
      performedById: 'season-cap-user',
      occurredAt,
      products: [
        {
          pluginId: 'banvel',
          chemistryClasses: ['synthetic-auxin'],
          rate: { amount: opts.amount ?? 0.5, unit: 'pt' }
        }
      ],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'rv-test',
      pluginHashes: {},
      ...(opts.custom ? { customRateOverride: true } : {})
    })
  );
}

function verdict(farm: Farm, occurredAt: number) {
  return runWithTenant(farm.ownerId, () => {
    const ctx = loadSeasonCapContext({
      blockId: farm.blockId,
      occurredAt,
      cropPluginIds: [CORN],
      products: [banvel]
    });
    if (!ctx) throw new Error('no season cap context');
    const [v] = evaluateSeasonCaps(ctx);
    return v;
  });
}

const NOW = Date.now();

describe('loadSeasonCapContext (#820)', () => {
  it('has nothing to read for a crop the label cap does not name', () => {
    const farm = seedFarm('none');
    expect(
      runWithTenant(farm.ownerId, () =>
        loadSeasonCapContext({
          blockId: farm.blockId,
          occurredAt: NOW,
          cropPluginIds: ['corn-sweet-bodacious'],
          products: [banvel]
        })
      )
    ).toBeNull();
  });

  it("never reads another farm's sprays, even one written against this block id", () => {
    const a = seedFarm('a');
    const b = seedFarm('b');
    spray(a, NOW - 2 * DAY);
    spray(b, NOW - 2 * DAY, { blockId: a.blockId, amount: 9 });
    const v = verdict(a, NOW);
    expect(v).toMatchObject({ status: 'within', othersKnown: 0.5, knownTotal: 1 });
  });

  it('counts a deleted application that was applied and drops a "never applied" one', () => {
    const farm = seedFarm('tomb');
    const kept = spray(farm, NOW - 3 * DAY, { amount: 1 });
    const voided = spray(farm, NOW - 2 * DAY, { amount: 1 });
    runWithTenant(farm.ownerId, () => {
      deleteSprayEvent(kept.id, { force: true, tombstone: true, reason: 'typo' });
      deleteSprayEvent(voided.id, { force: true, tombstone: true, neverApplied: true });
    });
    expect(runWithTenant(farm.ownerId, () => listSprayEvents({ blockId: farm.blockId }))).toEqual(
      []
    );
    const v = verdict(farm, NOW);
    expect(v).toMatchObject({ status: 'within', othersKnown: 1, knownTotal: 1.5 });
    spray(farm, NOW - DAY);
    expect(verdict(farm, NOW).status).toBe('over');
  });

  it('reads a custom-rate record as not known, never as under the cap', () => {
    const farm = seedFarm('custom');
    spray(farm, NOW - DAY, { custom: true });
    const v = verdict(farm, NOW);
    expect(v.status).toBe('unknown');
    expect(v.unknown).toEqual(['earlier-rate']);
    expect(v.unknownIds).toHaveLength(1);
  });
});

function post(handler: typeof RECORD, farm: Farm, extra: Record<string, unknown> = {}) {
  return runWithTenantAsync(
    farm.ownerId,
    async () =>
      handler({
        request: new Request('http://localhost/api/spray/x', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            blockId: farm.blockId,
            blockCrops: { primary: { cropPluginId: CORN, heightInches: 4 } },
            productPluginIds: ['banvel'],
            sprayer: { id: farm.sprayerId },
            conditions: { windMph: 3, tempF: 65, rainForecastMmNext24h: 0 },
            ...extra
          })
        }),
        url: new URL('http://localhost/api/spray/x'),
        locals: {}
      } as never) as Promise<Response>
  );
}

describe('spray endpoints and the season cap (#820)', () => {
  it('a third ½ pt pass records with a "within" verdict and a fourth is refused', async () => {
    m.role = 'owner';
    const farm = seedFarm('endpoint');
    m.ownerId = farm.ownerId;
    spray(farm, NOW - 20 * DAY);
    spray(farm, NOW - 10 * DAY);

    const preview = await post(EVALUATE, farm);
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.ok).toBe(true);
    expect(previewBody.seasonCaps).toMatchObject([
      { pluginId: 'banvel', status: 'within', knownTotal: 1.5 }
    ]);

    const third = await post(RECORD, farm);
    expect(third.status).toBe(200);
    expect((await third.json()).seasonCaps[0].status).toBe('within');

    const fourth = await post(RECORD, farm);
    expect(fourth.status).toBe(422);
    const refused = await fourth.json();
    expect(refused.violations.map((v: { code: string }) => v.code)).toContain(
      'SEASON_CAP_EXCEEDED'
    );
    expect(refused.seasonCaps[0]).toMatchObject({ status: 'over', knownTotal: 2 });
    expect(
      runWithTenant(farm.ownerId, () => listSprayEvents({ blockId: farm.blockId }))
    ).toHaveLength(3);
  });

  it('refuses the helper the same as the owner, with no override (SC-1)', async () => {
    m.role = 'helper';
    const farm = seedFarm('helper');
    m.ownerId = farm.ownerId;
    spray(farm, NOW - 5 * DAY, { amount: 1.5 });
    const res = await post(RECORD, farm);
    expect(res.status).toBe(422);
    m.role = 'owner';
    const owner = await post(RECORD, farm, { notes: 'I know' });
    expect(owner.status).toBe(422);
  });

  it("an owner's custom rate on this pass is a warning, not a pass under the cap", async () => {
    m.role = 'owner';
    const farm = seedFarm('custom-pass');
    m.ownerId = farm.ownerId;
    const res = await post(RECORD, farm, { customRateOverride: true });
    expect(res.status).toBe(200);
    expect((await res.json()).seasonCaps[0]).toMatchObject({
      status: 'unknown',
      unknown: ['this-pass-rate']
    });
  });
});
