// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';

const m = vi.hoisted(() => ({
  role: 'owner',
  getApiKey: vi.fn(() => ''),
  checkGuard: vi.fn(),
  create: vi.fn()
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: m.create };
  }
}));
vi.mock('$lib/server/scanResult', () => ({ getApiKey: m.getApiKey }));
vi.mock('$lib/server/aiGuard', async (orig) => ({
  ...(await orig<typeof import('$lib/server/aiGuard')>()),
  checkGuard: m.checkGuard,
  reserveGuard: m.checkGuard
}));
vi.mock('$lib/server/auth', () => ({
  requireOwner: () => {
    if (m.role !== 'owner') throw error(403, 'owner role required');
    return { id: 'garden-fill-user', role: 'owner' };
  }
}));

import { db } from '$lib/db/client';
import { aiCallLog, owners, users } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import type { FillResponse } from '$lib/garden/api';
import { POST } from './+server';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const APR_1 = Date.UTC(2027, 3, 1);

function seedOwner(): string {
  const id = `garden-fill-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'garden-fill-user', email: 'garden-fill@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

function seedBed(areaKind: 'garden' | 'field' = 'garden') {
  const area = createField({ name: 'Kitchen Garden', kind: areaKind, widthFt: 20, lengthFt: 30 });
  return createBlock({
    name: 'Bed 2',
    fieldId: area.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    xFt: 8,
    yFt: 3,
    bedStyle: 'raised'
  });
}

function call(blockId: string, body: unknown = { dateMs: APR_1, seasonYear: 2027 }) {
  return POST({
    params: { blockId },
    request: new Request(`http://localhost/api/garden/beds/${blockId}/fill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never);
}

function aiReply(text: string) {
  return { content: [{ type: 'text', text }], usage: { input_tokens: 900, output_tokens: 200 } };
}

function logRows(ownerId: string) {
  return runWithTenant(ownerId, () =>
    db
      .select()
      .from(aiCallLog)
      .where(withTenant(aiCallLog, and(eq(aiCallLog.endpoint, 'garden-fill'))))
      .all()
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.role = 'owner';
  m.getApiKey.mockReturnValue('');
  m.checkGuard.mockReturnValue(OK);
});

describe('POST /api/garden/beds/[blockId]/fill', () => {
  it('answers from a bed recipe with no Anthropic key', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const bed = seedBed();
      const res = await call(bed.id);
      expect(res.status).toBe(200);
      const body = (await res.json()) as FillResponse;
      expect(body.provenance).toBe('fallback');
      expect(body.fallbackReason).toBe('no-key');
      expect(body.message).toMatch(
        /^Claude is off, so this is a plain plan from the .+ recipe\. Everything here works the same\.$/
      );
      expect(body.proposals.length).toBeGreaterThan(0);
      for (const p of body.proposals) {
        expect(p.provenance).toBe('fallback');
        expect(p.blockId).toBe(bed.id);
        expect(p.plantingDateMs).toBeGreaterThanOrEqual(APR_1);
        expect(p.footprint.x_in + p.footprint.w_in).toBeLessThanOrEqual(48);
        expect(p.footprint.y_in + p.footprint.l_in).toBeLessThanOrEqual(96);
      }
    });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('returns validated Claude proposals tagged ai and drops the rest', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply(
        JSON.stringify({
          proposals: [
            {
              cropPluginId: 'lettuce-black-seeded-simpson',
              plantingDate: '2027-04-02',
              footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
              pattern: 'square',
              note: 'Cool-season greens fit the spring gap.'
            },
            {
              cropPluginId: 'moon-melon',
              plantingDate: '2027-04-02',
              footprint: { x_in: 0, y_in: 48, w_in: 48, l_in: 48 }
            },
            {
              cropPluginId: 'radish-cherry-belle',
              plantingDate: '2027-04-02',
              footprint: { x_in: 24, y_in: 60, w_in: 48, l_in: 48 }
            },
            {
              cropPluginId: 'tomato-celebrity-f1',
              plantingDate: '2027-04-02',
              footprint: { x_in: 0, y_in: 48, w_in: 48, l_in: 48 }
            },
            {
              cropPluginId: 'spinach-space-f1',
              plantingDate: '2027-04-10',
              footprint: { x_in: 0, y_in: 24, w_in: 48, l_in: 24 }
            }
          ]
        })
      )
    );
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const bed = seedBed();
      const body = (await (await call(bed.id)).json()) as FillResponse;
      expect(body.provenance).toBe('ai');
      expect(body.message).toBeNull();
      expect(body.proposals).toHaveLength(1);
      expect(body.proposals[0]).toMatchObject({
        cropPluginId: 'lettuce-black-seeded-simpson',
        provenance: 'ai',
        plantingDateMs: Date.UTC(2027, 3, 2),
        note: 'Cool-season greens fit the spring gap.'
      });
    });
    const prompt = m.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('48 in wide (x) by 96 in long (y)');
    expect(prompt).toContain('Spring greens, bush beans, fall brassicas.');
    expect(prompt).not.toContain('spring-greens-beans-fall-brassicas');
    expect(prompt).toMatch(
      /- kale-red-russian: .*plant between 2027-\d{2}-\d{2} and 2027-\d{2}-\d{2}/
    );
    expect(prompt).toMatch(/kale-red-russian around 2027-\d{2}-\d{2}/);
    expect(logRows(owner)).toMatchObject([{ provenance: 'ai', success: true, inputTokens: 900 }]);
  });

  it('falls back to the recipe when Claude returns something that is not JSON', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply('Plant lettuce, it will be lovely.'));
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const body = (await (await call(seedBed().id)).json()) as FillResponse;
      expect(body.provenance).toBe('fallback');
      expect(body.fallbackReason).toBeNull();
      expect(body.message).toMatch(/^Claude's ideas didn't fit this bed, so this is a plain plan/);
      expect(body.proposals.every((p) => p.provenance === 'fallback')).toBe(true);
    });
    expect(logRows(owner)).toMatchObject([
      { provenance: 'fallback', success: false, errorClass: 'invalid-json' }
    ]);
  });

  it('skips Claude when the monthly cap is spent', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.checkGuard.mockReturnValue({
      ok: false,
      reason: 'cap-exceeded',
      status: 402,
      message: 'Monthly cap reached.',
      detail: 'monthly-budget',
      plan: 'free',
      upgrade: 'grower'
    });
    await runWithTenant(seedOwner(), async () => {
      const body = (await (await call(seedBed().id)).json()) as FillResponse;
      expect(body.provenance).toBe('fallback');
      expect(body.fallbackReason).toBe('over-cap');
      expect(body.message).toMatch(/^This month's AI help for your farm is used up, so /);
      expect(body.aiLimit).toEqual({ detail: 'monthly-budget', plan: 'free', upgrade: 'grower' });
    });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("skips Claude when today's quota is used up", async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.checkGuard.mockReturnValue({
      ok: false,
      reason: 'quota-exceeded',
      status: 429,
      message: 'Daily quota reached.'
    });
    await runWithTenant(seedOwner(), async () => {
      const body = (await (await call(seedBed().id)).json()) as FillResponse;
      expect(body.fallbackReason).toBe('rate-limit');
      expect(body.message).toMatch(/^Today's AI help for this is used up, so /);
    });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('falls back when Claude throws', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockRejectedValue(new Error('overloaded'));
    await runWithTenant(seedOwner(), async () => {
      const body = (await (await call(seedBed().id)).json()) as FillResponse;
      expect(body.provenance).toBe('fallback');
      expect(body.proposals.length).toBeGreaterThan(0);
    });
  });

  it('refuses beds outside a garden or greenhouse, and other Owners beds', async () => {
    const theirs = runWithTenant(seedOwner(), () => seedBed().id);
    await runWithTenant(seedOwner(), async () => {
      const res = await call(seedBed('field').id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'NOT_DESIGNABLE' });
      const foreign = await call(theirs);
      expect(foreign.status).toBe(400);
      expect(await foreign.json()).toMatchObject({ code: 'FOREIGN_REF' });
    });
  });

  it('400s a bad body and 403s a helper', async () => {
    await runWithTenant(seedOwner(), async () => {
      const bed = seedBed();
      expect((await call(bed.id, { dateMs: 'soon' })).status).toBe(400);
      m.role = 'helper';
      await expect(call(bed.id)).rejects.toMatchObject({ status: 403 });
    });
  });
});
