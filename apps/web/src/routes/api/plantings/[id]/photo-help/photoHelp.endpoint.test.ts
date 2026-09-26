// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';

const m = vi.hoisted(() => ({
  role: 'owner' as string,
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
vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'photo-help-user', role: m.role });
  return {
    currentUser: user,
    requireUser: user,
    requireOwner: () => {
      if (m.role !== 'owner') throw error(403, 'owner role required');
      return user();
    }
  };
});

import { db } from '$lib/db/client';
import { aiCallLog, ownerUsageCounters, owners, plantingJournal, users } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { EXIF_SECRET, fakeJpeg, toDataUrl } from '$lib/journal/jpegFixture';
import type { PhotoHelpResponse } from '$lib/server/photoHelp';
import { PHOTO_HELP_TIMEOUT_MS } from '$lib/server/photoHelp';
import { POST } from './+server';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const PHOTO = toDataUrl(fakeJpeg({ exif: true }));

function seedOwner(): string {
  const id = `photo-help-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'photo-help-user', email: 'photo-help@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

function seedPlanting(cropPluginId = 'tomato-amish-paste') {
  const area = createField({ name: 'Kitchen Garden', kind: 'garden', widthFt: 20, lengthFt: 30 });
  const bed = createBlock({
    name: 'Bed 1',
    fieldId: area.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8
  });
  return createPlanned({
    blockId: bed.id,
    cropPluginId,
    varietyDisplayName: 'Amish Paste tomato',
    plantingDate: Date.UTC(2026, 4, 10)
  });
}

function call(id: string, body: unknown) {
  return POST({
    params: { id },
    request: new Request(`http://localhost/api/plantings/${id}/photo-help`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never) as Promise<Response>;
}

function aiReply(text: string) {
  return { content: [{ type: 'text', text }], usage: { input_tokens: 1200, output_tokens: 80 } };
}

function journal(ownerId: string) {
  return runWithTenant(ownerId, () =>
    db.select().from(plantingJournal).where(withTenant(plantingJournal)).all()
  );
}

function logRows(ownerId: string) {
  return runWithTenant(ownerId, () =>
    db
      .select()
      .from(aiCallLog)
      .where(withTenant(aiCallLog, and(eq(aiCallLog.endpoint, 'photo-help'))))
      .all()
  );
}

function aiCalls(ownerId: string): number {
  const row = db
    .select()
    .from(ownerUsageCounters)
    .where(eq(ownerUsageCounters.ownerId, ownerId))
    .get();
  return row?.aiCalls ?? 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.role = 'owner';
  m.getApiKey.mockReturnValue('');
  m.checkGuard.mockReturnValue(OK);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/plantings/[id]/photo-help', () => {
  it('answers from the Care Guide with no key and saves the photo tagged fallback', async () => {
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      const res = await call(crop.id, { question: 'ready', text: '', photo: PHOTO });
      expect(res.status).toBe(200);
      return (await res.json()) as PhotoHelpResponse;
    });
    expect(m.create).not.toHaveBeenCalled();
    expect(body.provenance).toBe('fallback');
    expect(body.fallbackReason).toBe('no-key');
    expect(body.message).toMatch(/^Claude is off, so here is what the Care Guide says\./);
    expect(body.answer.sections).toEqual([
      { title: 'Harvest cues', items: ['Deep red, dry-feeling flesh'], provenance: 'plugin' }
    ]);
    expect(body.entry).toMatchObject({
      kind: 'photo_help',
      provenance: 'fallback',
      hasPhoto: true
    });
    const [row] = journal(owner);
    expect(row.text).toBe('Is it ready to pick?');
    expect(row.photoRef!.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(Buffer.from(row.photoRef!.split(',')[1], 'base64').toString('latin1')).not.toContain(
      EXIF_SECRET
    );
    expect(logRows(owner)).toMatchObject([
      { provenance: 'fallback', fallbackReason: 'no-key', inputTokens: 0 }
    ]);
    expect(aiCalls(owner)).toBe(1);
  });

  it('gives the pruning and common-problem sections for those chips', async () => {
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      const prune = (await (
        await call(crop.id, { question: 'prune', text: '' })
      ).json()) as PhotoHelpResponse;
      expect(prune.answer.sections[0].title).toBe('Stake and prune');
      const leaves = (await (
        await call(crop.id, { question: 'leaves', text: '' })
      ).json()) as PhotoHelpResponse;
      expect(leaves.answer.sections[0].title).toBe('Common problems');
    });
  });

  it('returns a short Claude answer tagged ai, grounded in the plugin, and saves it', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply('The fruit is still orange at the shoulders. Give it three or four more days.')
    );
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'ready', text: 'the big one', photo: PHOTO })
      ).json()) as PhotoHelpResponse;
    });
    expect(body.provenance).toBe('ai');
    expect(body.message).toBeNull();
    expect(body.answer).toMatchObject({
      source: 'ai',
      sprayRedirect: false,
      text: 'The fruit is still orange at the shoulders. Give it three or four more days.'
    });
    expect(body.entry.provenance).toBe('ai');
    const content = m.create.mock.calls[0][0].messages[0].content as Array<{
      type: string;
      text?: string;
      source?: { data: string };
    }>;
    const prompt = content.find((c) => c.type === 'text')!.text!;
    expect(prompt).toContain('Deep red, dry-feeling flesh');
    expect(prompt).toContain('Is it ready to pick? the big one');
    expect(prompt).toMatch(/Never name a pesticide/);
    const image = content.find((c) => c.type === 'image')!.source!.data;
    expect(Buffer.from(image, 'base64').toString('latin1')).not.toContain(EXIF_SECRET);
    expect(logRows(owner)).toMatchObject([{ provenance: 'ai', success: true, inputTokens: 1200 }]);
    expect(aiCalls(owner)).toBe(1);
    expect(journal(owner)[0].answerJson).toContain('three or four more days');
  });

  it('strips spray advice from a Claude answer and points to the Spray flow', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply(
        'Those spots look like early blight. Spray chlorothalonil at 2 tsp per gallon every 7 days. Remove the lower leaves and mulch.'
      )
    );
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'leaves', text: '' })
      ).json()) as PhotoHelpResponse;
    });
    expect(body.provenance).toBe('ai');
    expect(body.answer.text).toBe(
      'Those spots look like early blight. Remove the lower leaves and mulch.'
    );
    expect(body.answer.text).not.toMatch(/chlorothalonil|per gallon|spray/i);
    expect(body.answer.sprayRedirect).toBe(true);
    expect(body.message).toMatch(/Spray flow/);
    expect(journal(owner)[0].answerJson).not.toMatch(/chlorothalonil/i);
    expect(logRows(owner)[0].errorClass).toBe('spray-advice-removed');
  });

  it('strips brand names from the plugin library out of a Claude answer', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply(
        'Those are hornworms. Entrust will clean them up fast. Actara or Admire Pro would knock them back. Pick them off by hand in the evening.'
      )
    );
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'leaves', text: '' })
      ).json()) as PhotoHelpResponse;
    });
    expect(body.provenance).toBe('ai');
    expect(body.answer.text).toBe('Those are hornworms. Pick them off by hand in the evening.');
    expect(body.answer.sprayRedirect).toBe(true);
  });

  it('sends a brand-name question to the Spray flow without asking Claude', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'other', text: 'Would Coragen fix the worms?' })
      ).json()) as PhotoHelpResponse;
    });
    expect(m.create).not.toHaveBeenCalled();
    expect(body.answer.sprayRedirect).toBe(true);
    expect(body.message).toMatch(/Your question is saved in the journal\.$/);
  });

  it('falls back to the Care Guide when the whole answer is spray advice', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply('Use neem oil. Spray every 5 days.'));
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'leaves', text: '' })
      ).json()) as PhotoHelpResponse;
    });
    expect(body.provenance).toBe('fallback');
    expect(body.message).toMatch(/^Claude's answer could not be used/);
    expect(body.answer).toMatchObject({ source: 'fallback', text: '', sprayRedirect: true });
    expect(body.entry.provenance).toBe('fallback');
    expect(JSON.stringify(body)).not.toMatch(/neem/i);
    expect(logRows(owner)).toMatchObject([
      { provenance: 'fallback', success: false, errorClass: 'unusable' }
    ]);
  });

  it('falls back to the Care Guide when most of the answer was spray advice', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply(
        'I can see white powder on the leaves. Mix baking soda into water. Apply it every 7 days.'
      )
    );
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'leaves', text: '', photo: PHOTO })
      ).json()) as PhotoHelpResponse;
    });
    expect(body.provenance).toBe('fallback');
    expect(body.answer).toMatchObject({ source: 'fallback', text: '', sprayRedirect: true });
    expect(JSON.stringify(body)).not.toMatch(/baking soda|every 7 days/i);
  });

  it('shows a Claude answer as plain sentences, without markdown headings or bullets', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply(
        '# Cherokee Purple Tomato Care\n\nI can see dark spots on the lower leaves.\n- Remove the spotted leaves.\n- **Water** at the base.'
      )
    );
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'leaves', text: '', photo: PHOTO })
      ).json()) as PhotoHelpResponse;
    });
    expect(body.answer.text).toBe(
      'I can see dark spots on the lower leaves. Remove the spotted leaves. Water at the base.'
    );
  });

  it('tells Claude there is no photo when the grower sent none', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply('Pick them when the shoulders darken.'));
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      await call(crop.id, { question: 'ready', text: '' });
    });
    const content = m.create.mock.calls[0][0].messages[0].content;
    expect(typeof content).toBe('string');
    expect(content).toContain('They did not send a photo.');
    expect(content).toContain('never say what you can see');
    expect(content).not.toContain('Say what you can see in the photo');
    expect(content).toContain('Always answer in English');
  });

  it('never asks Claude for spray advice: a spray question goes to the Spray flow', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'other', text: 'What should I spray on these aphids?' })
      ).json()) as PhotoHelpResponse;
    });
    expect(m.create).not.toHaveBeenCalled();
    expect(body.provenance).toBe('fallback');
    expect(body.fallbackReason).toBeNull();
    expect(body.answer.sprayRedirect).toBe(true);
    expect(body.message).toMatch(/^For anything you would spray, use the Spray flow/);
    expect(logRows(owner)).toEqual([]);
  });

  it.each([
    [
      'over-cap',
      {
        ok: false,
        reason: 'cap-exceeded',
        status: 402,
        message: 'cap',
        detail: 'monthly-budget',
        plan: 'free',
        upgrade: 'grower'
      },
      /^This month's AI help for your farm is used up/
    ],
    [
      'rate-limit',
      { ok: false, reason: 'quota-exceeded', status: 429, message: 'quota' },
      /Today's AI help for photos is used up/
    ]
  ])('skips Claude when the guard says %s', async (reason, guard, copy) => {
    m.getApiKey.mockReturnValue('sk-test');
    m.checkGuard.mockReturnValue(guard);
    const owner = seedOwner();
    const body = await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      return (await (
        await call(crop.id, { question: 'ready', text: '' })
      ).json()) as PhotoHelpResponse;
    });
    expect(m.create).not.toHaveBeenCalled();
    expect(body.fallbackReason).toBe(reason);
    expect(body.message).toMatch(copy);
    expect(body.answer.sections[0].title).toBe('Harvest cues');
    expect(logRows(owner)).toMatchObject([{ provenance: 'fallback', inputTokens: 0 }]);
  });

  it('falls back when Claude throws', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockRejectedValue(new Error('overloaded'));
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      const body = (await (
        await call(crop.id, { question: 'prune', text: '' })
      ).json()) as PhotoHelpResponse;
      expect(body.provenance).toBe('fallback');
      expect(body.fallbackReason).toBe('rate-limit');
      expect(body.message).toMatch(/isn't answering right now/);
    });
  });

  it('falls back when Claude takes too long', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockReturnValue(new Promise(() => {}));
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      const pending = call(crop.id, { question: 'ready', text: '' });
      await vi.advanceTimersByTimeAsync(PHOTO_HELP_TIMEOUT_MS + 1);
      const body = (await (await pending).json()) as PhotoHelpResponse;
      expect(body.fallbackReason).toBe('timeout');
      expect(body.message).toMatch(/^Claude took too long/);
    });
  });

  it('lets a helper ask, refuses an inspector, and 404s another Owner planting', async () => {
    const theirs = runWithTenant(seedOwner(), () => seedPlanting().id);
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      m.role = 'helper';
      expect((await call(crop.id, { question: 'ready', text: '' })).status).toBe(200);
      expect((await call(theirs, { question: 'ready', text: '' })).status).toBe(404);
      m.role = 'inspector';
      expect((await call(crop.id, { question: 'ready', text: '' })).status).toBe(403);
    });
  });

  it('400s a bad body, an empty free-text question and a non-JPEG photo', async () => {
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      expect((await call(crop.id, { question: 'maybe' })).status).toBe(400);
      expect((await call(crop.id, { question: 'other', text: '  ' })).status).toBe(400);
      const png = await call(crop.id, {
        question: 'ready',
        text: '',
        photo: 'data:image/png;base64,iVBORw0KGgo='
      });
      expect(png.status).toBe(400);
      expect(await png.json()).toMatchObject({ code: 'not-jpeg' });
    });
  });
});
