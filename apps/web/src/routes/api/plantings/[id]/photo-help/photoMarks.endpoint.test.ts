// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
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
  const user = () => ({ id: 'photo-marks-user', role: 'helper' });
  return { currentUser: user, requireUser: user, requireOwner: user };
});

import { db } from '$lib/db/client';
import { owners, plantingJournal, users } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { fakeJpeg, toDataUrl } from '$lib/journal/jpegFixture';
import type { JournalAnswer } from '$lib/journal/model';
import type { PhotoHelpResponse } from '$lib/server/photoHelp';
import {
  PHOTO_MARKS_DIAGNOSIS_ANSWER,
  PHOTO_MARKS_FIXTURE_ANSWER,
  PHOTO_MARKS_PROBLEM_ANSWER
} from '$lib/server/aiFixture/photoMarks';
import { POST } from './+server';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const PHOTO = toDataUrl(fakeJpeg({ exif: true }));

function seedOwner(): string {
  const id = `photo-marks-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'photo-marks-user', email: 'photo-marks@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

function seedPlanting(cropPluginId = 'basil-genovese') {
  const area = createField({ name: 'Herb garden', kind: 'garden', widthFt: 10, lengthFt: 10 });
  const bed = createBlock({
    name: 'Bed 1',
    fieldId: area.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 4
  });
  return createPlanned({ blockId: bed.id, cropPluginId, varietyDisplayName: 'Basil' });
}

function call(id: string, body: unknown, headers: Record<string, string> = {}) {
  return POST({
    params: { id },
    url: new URL(`http://localhost/api/plantings/${id}/photo-help`),
    request: new Request(`http://localhost/api/plantings/${id}/photo-help`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    })
  } as never) as Promise<Response>;
}

function aiReply(text: string) {
  return { content: [{ type: 'text', text }], usage: { input_tokens: 1500, output_tokens: 200 } };
}

function saved(ownerId: string): JournalAnswer[] {
  return runWithTenant(ownerId, () =>
    db.select().from(plantingJournal).where(withTenant(plantingJournal)).all()
  ).map((r) => JSON.parse(r.answerJson!) as JournalAnswer);
}

async function ask(owner: string, body: unknown, headers?: Record<string, string>) {
  return runWithTenant(owner, async () => {
    const crop = seedPlanting();
    const res = await call(crop.id, body, headers);
    expect(res.status).toBe(200);
    return (await res.json()) as PhotoHelpResponse;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getApiKey.mockReturnValue('');
  m.checkGuard.mockReturnValue(OK);
});

describe('photo help with marks (37F)', () => {
  it('stores Claude marks with the answer and numbers the steps', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply(JSON.stringify(PHOTO_MARKS_FIXTURE_ANSWER)));
    const owner = seedOwner();
    const body = await ask(owner, {
      question: 'prune',
      text: '',
      photo: PHOTO,
      wantMarks: true
    });
    expect(body.provenance).toBe('ai');
    expect(body.marksProvenance).toBe('ai');
    expect(body.message).toBeNull();
    expect(body.answer.marks).toHaveLength(3);
    expect(body.answer.steps).toEqual(PHOTO_MARKS_FIXTURE_ANSWER.steps);
    expect(body.answer.text).toBe(PHOTO_MARKS_FIXTURE_ANSWER.steps.join(' '));
    expect(saved(owner)[0].marks).toEqual(body.answer.marks);
    const params = m.create.mock.calls[0][0];
    expect(params.max_tokens).toBe(1200);
    const prompt = (params.messages[0].content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === 'text'
    )!.text!;
    expect(prompt).toContain('CROPCARD_FIXTURE:photo-marks');
    expect(prompt).toContain('"cut", "pinch", "harvest", "leave" or "problem"');
    expect(prompt).toContain('Never say what caused it or how to fix or treat it.');
    expect(prompt).toContain('Pinch stems as they lengthen to promote bushy, compact growth.');
  });

  it('refuses the whole mark set on one bad mark and keeps the steps', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply(
        JSON.stringify({
          steps: ['Cut the tall stem.', 'Leave the base.'],
          marks: [
            { kind: 'cut', x: 0.5, y: 0.5, label: 'Cut here' },
            { kind: 'leave', x: 0.5, y: 1.4, label: 'Leave this' }
          ]
        })
      )
    );
    const owner = seedOwner();
    const body = await ask(owner, { question: 'prune', text: '', photo: PHOTO, wantMarks: true });
    expect(body.provenance).toBe('ai');
    expect(body.marksProvenance).toBe('fallback');
    expect(body.answer.marks).toBeUndefined();
    expect(body.answer.steps).toEqual(['Cut the tall stem.', 'Leave the base.']);
    expect(body.message).toBe('Claude could not place marks on this photo.');
    expect(saved(owner)[0].marksProvenance).toBe('fallback');
  });

  it('drops every mark when a label or a step is spray advice', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    const owner = seedOwner();
    m.create.mockResolvedValueOnce(
      aiReply(
        JSON.stringify({
          steps: ['Cut the tall stem.'],
          marks: [{ kind: 'cut', x: 0.5, y: 0.5, label: 'Spray neem here' }]
        })
      )
    );
    const byLabel = await ask(owner, {
      question: 'prune',
      text: '',
      photo: PHOTO,
      wantMarks: true
    });
    expect(byLabel.answer.marks).toBeUndefined();
    expect(byLabel.answer.sprayRedirect).toBe(false);
    m.create.mockResolvedValueOnce(
      aiReply(
        JSON.stringify({
          steps: ['Cut the tall stem.', 'Pinch the tip.', 'Then use neem oil weekly.'],
          marks: [{ kind: 'cut', x: 0.5, y: 0.5, label: 'Cut here' }]
        })
      )
    );
    const byStep = await ask(owner, { question: 'prune', text: '', photo: PHOTO, wantMarks: true });
    expect(byStep.answer.marks).toBeUndefined();
    expect(byStep.answer.steps).toEqual(['Cut the tall stem.', 'Pinch the tip.']);
    expect(byStep.answer.sprayRedirect).toBe(true);
    expect(byStep.message).toMatch(/Spray flow.*Claude could not place marks/);
  });

  it('keeps a problem mark that only describes what is visible (#869)', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply(JSON.stringify(PHOTO_MARKS_PROBLEM_ANSWER)));
    const owner = seedOwner();
    const body = await ask(owner, { question: 'leaves', text: '', photo: PHOTO, wantMarks: true });
    expect(body.marksProvenance).toBe('ai');
    expect(body.answer.marks?.map((mk) => mk.kind)).toEqual(['cut', 'problem']);
    expect(saved(owner)[0].marks?.[1]).toMatchObject({
      kind: 'problem',
      label: 'Yellow lower leaves'
    });
  });

  it('drops the whole set when a problem label names a disease, a pest or a fix (#869)', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    const owner = seedOwner();
    const withLabel = (label: string, kind = 'problem') =>
      JSON.stringify({
        steps: ['Placeholder step one.', 'Placeholder step two.'],
        marks: [
          { kind: 'cut', x: 0.3, y: 0.3, label: 'Mark one' },
          { kind, x: 0.6, y: 0.6, label }
        ]
      });
    for (const raw of [
      JSON.stringify(PHOTO_MARKS_DIAGNOSIS_ANSWER),
      withLabel('Early blight spots'),
      withLabel('Aphids under the leaf'),
      withLabel('Remove these leaves'),
      withLabel('Nitrogen deficiency'),
      withLabel('Cut out the canker', 'cut')
    ]) {
      m.create.mockResolvedValueOnce(aiReply(raw));
      const body = await ask(owner, {
        question: 'leaves',
        text: '',
        photo: PHOTO,
        wantMarks: true
      });
      expect(body.provenance, raw).toBe('ai');
      expect(body.marksProvenance, raw).toBe('fallback');
      expect(body.answer.marks, raw).toBeUndefined();
      expect(body.answer.steps, raw).toEqual((JSON.parse(raw) as { steps: string[] }).steps);
      expect(body.message, raw).toBe('Claude could not place marks on this photo.');
    }
  });

  it("refuses a label naming a pest from the library's own labels", async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(
      aiReply(
        JSON.stringify({
          steps: ['Placeholder step one.'],
          marks: [{ kind: 'problem', x: 0.5, y: 0.5, label: 'Leafroller rolled leaf' }]
        })
      )
    );
    const body = await ask(seedOwner(), {
      question: 'leaves',
      text: '',
      photo: PHOTO,
      wantMarks: true
    });
    expect(body.answer.marks).toBeUndefined();
    expect(body.marksProvenance).toBe('fallback');
  });

  it('falls back to the Care Guide when the answer is broken JSON', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply('{"steps": ["Cut here."], "marks": [ '));
    const body = await ask(seedOwner(), {
      question: 'prune',
      text: '',
      photo: PHOTO,
      wantMarks: true
    });
    expect(body.provenance).toBe('fallback');
    expect(body.marksProvenance).toBe('fallback');
    expect(body.answer.text).toBe('');
  });

  it('with no key answers from the Care Guide with the growth-habit drawing and no marks', async () => {
    const body = await ask(seedOwner(), {
      question: 'prune',
      text: '',
      photo: PHOTO,
      wantMarks: true
    });
    expect(m.create).not.toHaveBeenCalled();
    expect(body.provenance).toBe('fallback');
    expect(body.marksProvenance).toBe('fallback');
    expect(body.answer.marks).toBeUndefined();
    expect(body.answer.drawing).toBe('cut-and-come-again-leafy');
    expect(body.answer.sections).toEqual([
      {
        title: 'Stake and prune',
        items: [
          'Pinch off basil flower buds. Pinch stem tips for a bushier plant, and pinch off flower buds as soon as you see them. Left on, buds change the flavor of the leaves.',
          'Pinch stems as they lengthen to promote bushy, compact growth.',
          'Basil flower buds should be removed by pinching as soon as you see them form.'
        ],
        provenance: 'plugin'
      }
    ]);
  });

  it('asks for no marks without a photo, and gives no drawing for a leaf question', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply('Pinch the tips above a leaf pair.'));
    const body = await ask(seedOwner(), { question: 'prune', text: '', wantMarks: true });
    expect(body.marksProvenance).toBeNull();
    expect(body.answer.text).toBe('Pinch the tips above a leaf pair.');
    m.getApiKey.mockReturnValue('');
    const leaves = await ask(seedOwner(), { question: 'leaves', text: '', photo: PHOTO });
    expect(leaves.answer.drawing).toBeUndefined();
  });

  it('saves once per client record id, so a retry never saves twice (R-23)', async () => {
    const owner = seedOwner();
    const headers = { [CLIENT_RECORD_HEADER]: `marks-${randomUUID()}` };
    await runWithTenant(owner, async () => {
      const crop = seedPlanting();
      const body = { question: 'prune', text: '', photo: PHOTO, wantMarks: true };
      const first = await call(crop.id, body, headers);
      expect(first.status).toBe(200);
      const again = await call(crop.id, body, headers);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ ok: true, duplicate: true });
    });
    expect(saved(owner)).toHaveLength(1);
  });
});
