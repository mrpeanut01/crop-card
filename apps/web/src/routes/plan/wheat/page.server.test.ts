import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addPlanting, createBlock } from '$lib/db/blocks';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { load, type SmallGrainCandidate, type SmallGrainPlanView } from './+page.server';

function freshOwner(): string {
  const id = `owner_wheat_${randomUUID()}`;
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
  return id;
}

interface LoadResult {
  candidates: SmallGrainCandidate[];
  plan: SmallGrainPlanView | null;
  canRecord: boolean;
}

async function run(
  ownerId: string,
  query = '',
  role: 'owner' | 'helper' | 'inspector' = 'owner'
): Promise<LoadResult> {
  return runWithTenantAsync(ownerId, async () => {
    const url = new URL(`http://localhost/plan/wheat${query}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (load as any)({ url, locals: { user: { id: 'u', role } } })) as LoadResult;
  });
}

async function statusOf(p: Promise<unknown>): Promise<number | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

function seed(ownerId: string) {
  return runWithTenantAsync(ownerId, async () => {
    const block = createBlock({ name: 'Block W' });
    const oats = addPlanting({
      blockId: block.id,
      cropPluginId: 'oats-grain-jerry',
      varietyDisplayName: 'Jerry oats',
      plantingDate: Date.UTC(2026, 2, 20)
    });
    const wheat = addPlanting({
      blockId: block.id,
      cropPluginId: 'wheat-soft-red-winter',
      varietyDisplayName: 'Shirley SRW',
      plantingDate: Date.UTC(2025, 9, 8)
    });
    const squash = addPlanting({
      blockId: block.id,
      cropPluginId: 'butternut-squash-waltham',
      varietyDisplayName: 'Waltham',
      plantingDate: Date.UTC(2026, 4, 20)
    });
    return { block, oats, wheat, squash };
  });
}

describe('/plan/wheat loader', () => {
  it('defaults to the wheat planting and projects a Zadoks timeline', async () => {
    const owner = freshOwner();
    const { wheat } = await seed(owner);
    const out = await run(owner);
    expect(out.candidates.map((c) => c.cropPluginId).sort()).toEqual([
      'oats-grain-jerry',
      'wheat-soft-red-winter'
    ]);
    expect(out.plan?.candidate.plantingId).toBe(wheat.id);
    expect(out.plan?.habit).toBe('winter');
    expect(out.plan?.stages.some((s) => s.decision === 'fhb-window')).toBe(true);
    expect(out.plan?.anthesisMs).not.toBeNull();
    expect(out.canRecord).toBe(true);
  }, 30_000);

  it('selects a planting by ?planting= and lets a helper read it', async () => {
    const owner = freshOwner();
    const { oats } = await seed(owner);
    const out = await run(owner, `?planting=${oats.id}`, 'helper');
    expect(out.plan?.candidate.plantingId).toBe(oats.id);
    expect(out.plan?.habit).toBe('spring');
    expect(out.canRecord).toBe(true);
    const inspector = await run(owner, `?planting=${oats.id}`, 'inspector');
    expect(inspector.canRecord).toBe(false);
  }, 30_000);

  it('404s another owner’s planting (tenant isolation)', async () => {
    const a = freshOwner();
    const b = freshOwner();
    const { wheat } = await seed(a);
    expect(await statusOf(run(b, `?planting=${wheat.id}`))).toBe(404);
    const other = await run(b);
    expect(other.candidates).toEqual([]);
    expect(other.plan).toBeNull();
  }, 30_000);

  it('404s a non-small-grain planting and an unknown id', async () => {
    const owner = freshOwner();
    const { squash } = await seed(owner);
    expect(await statusOf(run(owner, `?planting=${squash.id}`))).toBe(404);
    expect(await statusOf(run(owner, '?planting=nope'))).toBe(404);
  }, 30_000);
});
