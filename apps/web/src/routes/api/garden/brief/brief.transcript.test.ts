// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// #870 (FU870-3): the brief keeps the conversation's counted turns for the
// owner: the text as sent and Claude's reply only as the page showed it.
// Helpers and inspectors never read it; DELETE clears it; the no-key path
// stores nothing; it is in the owner's GDPR export and not in the snapshot.

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
  requireUser: () => ({ id: 'garden-brief-tx-user', role: m.role }),
  requireOwner: () => {
    if (m.role !== 'owner') throw error(403, 'owner role required');
    return { id: 'garden-brief-tx-user', role: 'owner' };
  }
}));

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { MAX_BRIEF_CHAT_TURNS, type GardenBrief } from '$lib/garden/brief/schema';
import {
  gardenBriefExportSection,
  gardenBriefSnapshotPart,
  loadGardenBrief
} from '$lib/server/garden/briefStore';
import { loadBriefPage } from '$lib/server/garden/briefPage';
import { DELETE, GET } from './+server';
import { POST as CHAT } from './chat/+server';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const SPRAY_SENTENCE = 'Spray it with neem oil every week.';

function seedOwner(): string {
  const id = `garden-brief-tx-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'garden-brief-tx-user', email: 'garden-brief-tx@test.local' })
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

function aiReply(reply: string) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          reply,
          followUp: 'cuisines',
          shortlist: [{ cropPluginId: 'chervil', because: 'Soft and fresh.' }]
        })
      }
    ],
    usage: { input_tokens: 900, output_tokens: 200 }
  };
}

interface ChatBody {
  reply: string;
  provenance: 'ai' | 'fallback';
  brief: GardenBrief;
}

const chat = async (message: string): Promise<ChatBody> =>
  (await (await CHAT(req('POST', { message }, '/api/garden/brief/chat'))).json()) as ChatBody;

beforeEach(() => {
  vi.clearAllMocks();
  m.role = 'owner';
  m.getApiKey.mockReturnValue('sk-test');
  m.checkGuard.mockReturnValue(OK);
  m.create.mockResolvedValue(aiReply(`Basil loves a sunny step. ${SPRAY_SENTENCE}`));
});

describe('the brief transcript', () => {
  it('stores the text as sent and the reply exactly as shown, never the unfiltered one', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const body = await chat('  I cook a lot of pasta.  ');
      expect(body.provenance).toBe('ai');
      expect(body.reply).toBe('Basil loves a sunny step.');
      const turn = body.brief.transcript?.[0];
      expect(turn).toMatchObject({
        question: 'I cook a lot of pasta.',
        reply: body.reply,
        provenance: 'ai'
      });
      expect(JSON.stringify(loadGardenBrief())).not.toContain(SPRAY_SENTENCE);
      expect(loadGardenBrief()?.transcript).toEqual(body.brief.transcript);
    });
  });

  it('shows it to the owner only, on the API and the page', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      await chat('I cook a lot of pasta.');
      const read = async () =>
        ((await (await GET(req('GET'))).json()) as { brief: Record<string, unknown> }).brief;
      expect((await read()).transcript).toHaveLength(1);
      const ownerPage = await loadBriefPage({ id: 'garden-brief-tx-user', role: 'owner' });
      expect(ownerPage.brief && 'transcript' in ownerPage.brief).toBe(true);
      for (const role of ['helper', 'inspector']) {
        m.role = role;
        const brief = await read();
        expect(brief.shortlist).toBeDefined();
        expect('transcript' in brief).toBe(false);
        const page = await loadBriefPage({ id: 'garden-brief-tx-user', role });
        expect(page.brief).not.toBeNull();
        expect(page.brief && 'transcript' in page.brief).toBe(false);
        expect(JSON.stringify(page)).not.toContain('I cook a lot of pasta.');
      }
    });
  });

  it('stores nothing on the no-key path or for a spray question, and keeps what was there', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      m.getApiKey.mockReturnValue('');
      const noKey = await chat('I cook a lot of pasta.');
      expect(noKey.provenance).toBe('fallback');
      expect(noKey.brief.transcript).toBeUndefined();
      m.getApiKey.mockReturnValue('sk-test');
      await chat('What herbs for tea?');
      const spray = await chat('What should I spray on aphids?');
      expect(spray.brief.transcript?.map((t) => t.question)).toEqual(['What herbs for tea?']);
    });
  });

  it('stores a turn Claude answered badly with the form reply, not its text', async () => {
    m.create.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ reply: 'hm', shortlist: [] }) }],
      usage: { input_tokens: 10, output_tokens: 10 }
    });
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const body = await chat('Hi');
      expect(body.provenance).toBe('fallback');
      expect(body.brief.transcript).toEqual([
        { question: 'Hi', reply: null, provenance: 'fallback', at: expect.any(Number) }
      ]);
    });
  });

  it('holds at most 8 turns and stops at the turn limit', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      for (let i = 0; i < MAX_BRIEF_CHAT_TURNS + 1; i++) await chat(`Question ${i}`);
      const brief = loadGardenBrief();
      expect(brief?.transcript).toHaveLength(MAX_BRIEF_CHAT_TURNS);
      expect(brief?.transcript?.at(-1)?.question).toBe(`Question ${MAX_BRIEF_CHAT_TURNS - 1}`);
    });
  });

  it('is cleared by DELETE, in the owner export only, and never in the snapshot', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      await chat('I cook a lot of pasta.');
      expect(gardenBriefExportSection({ role: 'owner' })?.transcript).toHaveLength(1);
      expect(gardenBriefExportSection({ role: 'helper' })).toBeUndefined();
      expect(JSON.stringify(gardenBriefSnapshotPart())).not.toContain('pasta');
      expect((await DELETE(req('DELETE'))).status).toBe(200);
      expect(loadGardenBrief()).toBeNull();
      expect(gardenBriefExportSection({ role: 'owner' })).toBeNull();
    });
  });
});
