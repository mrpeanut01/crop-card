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
  requireUser: () => ({ id: 'garden-brief-user', role: m.role }),
  requireOwner: () => {
    if (m.role !== 'owner') throw error(403, 'owner role required');
    return { id: 'garden-brief-user', role: 'owner' };
  }
}));

import { db } from '$lib/db/client';
import { getSetting } from '$lib/db/settings';
import { aiCallLog, owners, users } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { HERB_PLUGIN_IDS } from '$lib/garden/herbs';
import { GARDEN_BRIEF_KEY, MAX_BRIEF_CHAT_TURNS, type GardenBrief } from '$lib/garden/brief/schema';
import { loadGardenBrief, saveGardenBrief } from '$lib/server/garden/briefStore';
import { DELETE, GET, PUT } from './+server';
import { POST as CHAT } from './chat/+server';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const a = <T>(value: T) => ({ value, notSure: false, provenance: 'manual' as const });

function seedOwner(): string {
  const id = `garden-brief-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'garden-brief-user', email: 'garden-brief@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

function req(method: string, body?: unknown, path = '/api/garden/brief') {
  return {
    locals: {},
    request: new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  } as never;
}

function aiReply(obj: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj) }],
    usage: { input_tokens: 900, output_tokens: 200 }
  };
}

function logRows(ownerId: string) {
  return runWithTenant(ownerId, () =>
    db
      .select()
      .from(aiCallLog)
      .where(withTenant(aiCallLog, and(eq(aiCallLog.endpoint, 'garden-brief'))))
      .all()
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.role = 'owner';
  m.getApiKey.mockReturnValue('');
  m.checkGuard.mockReturnValue(OK);
});

describe('/api/garden/brief', () => {
  it('saves the answers with the deterministic shortlist and reads it back for every role', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const res = await PUT(req('PUT', { answers: { cuisines: a(['italian']) } }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { brief: GardenBrief };
      expect(body.brief.shortlist.length).toBeGreaterThan(0);
      expect(body.brief.shortlist.every((r) => r.provenance === 'fallback')).toBe(true);
      expect(getSetting(GARDEN_BRIEF_KEY)).toBeTruthy();
      for (const role of ['owner', 'helper', 'inspector']) {
        m.role = role;
        const got = (await (await GET(req('GET'))).json()) as {
          brief: GardenBrief;
          canEdit: boolean;
        };
        expect(got.brief.shortlist).toEqual(body.brief.shortlist);
        expect(got.canEdit).toBe(role === 'owner');
      }
    });
  });

  it('refuses helpers and inspectors on PUT and DELETE', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      for (const role of ['helper', 'inspector']) {
        m.role = role;
        await expect(PUT(req('PUT', { answers: {} }))).rejects.toMatchObject({ status: 403 });
        await expect(DELETE(req('DELETE'))).rejects.toMatchObject({ status: 403 });
      }
      expect(loadGardenBrief()).toBeNull();
    });
  });

  it('refuses unknown plugin ids and non-herbs', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const res = await PUT(
        req('PUT', { answers: { wanted: a(['not-a-plugin', 'tomato-brandywine', 'chervil']) } })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string; plugins: string[] };
      expect(body.code).toBe('UNKNOWN_PLUGIN');
      expect(body.plugins.sort()).toEqual(['not-a-plugin', 'tomato-brandywine']);
      const short = await PUT(
        req('PUT', {
          answers: {},
          shortlist: [{ cropPluginId: 'not-a-plugin', because: 'x.', provenance: 'ai' }]
        })
      );
      expect(short.status).toBe(400);
    });
  });

  it('keeps an edited shortlist but replaces a spray sentence in it', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const res = await PUT(
        req('PUT', {
          answers: {},
          shortlist: [
            { cropPluginId: 'chives-common', because: 'Spray it with neem oil.', provenance: 'ai' },
            { cropPluginId: 'chervil', because: 'Soft and fresh.', provenance: 'ai' }
          ]
        })
      );
      const body = (await res.json()) as { brief: GardenBrief };
      expect(body.brief.shortlist.map((r) => r.because)).toEqual([
        'Suggested for your garden.',
        'Soft and fresh.'
      ]);
    });
  });

  it('deletes the brief', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      await PUT(req('PUT', { answers: {} }));
      expect((await DELETE(req('DELETE'))).status).toBe(200);
      expect(loadGardenBrief()).toBeNull();
    });
  });
});

describe('POST /api/garden/brief/chat', () => {
  const chat = (body: unknown) => CHAT(req('POST', body, '/api/garden/brief/chat'));

  it('answers with the deterministic shortlist tagged fallback when there is no key', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const res = await chat({ message: 'I cook pasta', answers: { cuisines: a(['italian']) } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        provenance: string;
        fallbackReason: string;
        shortlist: GardenBrief['shortlist'];
        brief: GardenBrief;
        message: string;
      };
      expect(body.provenance).toBe('fallback');
      expect(body.fallbackReason).toBe('no-key');
      expect(body.message).toMatch(/^Claude is not turned on for this farm\./);
      expect(body.shortlist.length).toBeGreaterThan(0);
      expect(body.brief.chatTurns).toBe(0);
      expect(body.brief.answers.cuisines?.value).toEqual(['italian']);
    });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('drops unknown ids, caps an over-long shortlist and counts the turn', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply({
        reply: 'Lovely. What do you cook most?',
        followUp: 'cuisines',
        shortlist: [
          { cropPluginId: 'moon-melon', because: 'x' },
          ...HERB_PLUGIN_IDS.map((id) => ({ cropPluginId: id, because: 'A good kitchen herb.' }))
        ]
      })
    );
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const res = await chat({ message: 'Hi', history: [{ role: 'user', text: 'earlier' }] });
      const body = (await res.json()) as {
        provenance: string;
        shortlist: GardenBrief['shortlist'];
        followUp: string;
        turnsLeft: number;
        brief: GardenBrief;
      };
      expect(body.provenance).toBe('ai');
      expect(body.shortlist).toHaveLength(12);
      expect(body.shortlist.map((r) => r.cropPluginId)).not.toContain('moon-melon');
      expect(body.shortlist.every((r) => r.provenance === 'ai')).toBe(true);
      expect(body.followUp).toBe('cuisines');
      expect(body.turnsLeft).toBe(MAX_BRIEF_CHAT_TURNS - 1);
      expect(body.brief.chatTurns).toBe(1);
      const prompt = m.create.mock.calls[0][0].messages[0].content as string;
      expect(prompt.split('\n')[0]).toBe('CROPCARD_FIXTURE:garden-brief');
      expect(prompt).toContain('Owner: earlier');
    });
    expect(logRows(owner).some((r) => r.success && r.provenance === 'ai')).toBe(true);
  });

  it('falls back when Claude answers nothing usable', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply({ reply: 'hm', shortlist: [{ cropPluginId: 'nope' }] }));
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const body = (await (await chat({ message: 'Hi' })).json()) as {
        provenance: string;
        fallbackReason: string;
        brief: GardenBrief;
      };
      expect(body.provenance).toBe('fallback');
      expect(body.fallbackReason).toBe('invalid');
      expect(body.brief.chatTurns).toBe(1);
    });
  });

  it('stops calling Claude after 8 turns', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      saveGardenBrief({
        version: 1,
        answers: {},
        shortlist: [],
        chatTurns: MAX_BRIEF_CHAT_TURNS,
        updatedAt: 1
      });
      const body = (await (await chat({ message: 'Hi' })).json()) as {
        fallbackReason: string;
        turnsLeft: number;
      };
      expect(body.fallbackReason).toBe('turn-limit');
      expect(body.turnsLeft).toBe(0);
    });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('answers a spray question without calling Claude', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const body = (await (await chat({ message: 'What should I spray on aphids?' })).json()) as {
        sprayRedirect: boolean;
        fallbackReason: string;
      };
      expect(body.sprayRedirect).toBe(true);
      expect(body.fallbackReason).toBe('spray');
    });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('refuses helpers', async () => {
    m.role = 'helper';
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      await expect(chat({ message: 'Hi' })).rejects.toMatchObject({ status: 403 });
    });
  });

  it('keeps each Owner on its own brief', async () => {
    const first = seedOwner();
    const second = seedOwner();
    await runWithTenant(first, () => PUT(req('PUT', { answers: { cuisines: a(['french']) } })));
    await runWithTenant(second, async () => {
      expect(loadGardenBrief()).toBeNull();
      const got = (await (await GET(req('GET'))).json()) as { brief: GardenBrief | null };
      expect(got.brief).toBeNull();
    });
  });
});
