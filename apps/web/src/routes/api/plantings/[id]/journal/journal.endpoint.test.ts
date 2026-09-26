// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'journal-user', role: m.role });
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
import { owners, users } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { deleteCropCascade } from '$lib/db/admin';
import { listJournalForCrop } from '$lib/db/plantingJournal';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { EXIF_SECRET, fakeJpeg, toDataUrl } from '$lib/journal/jpegFixture';
import type { JournalEntry } from '$lib/journal/model';
import { GET, POST } from './+server';
import { DELETE } from './[entryId]/+server';
import { GET as PHOTO } from './[entryId]/photo/+server';
import { POST as QUEUED } from '../../../journal/record/+server';

function seedOwner(): string {
  const id = `journal-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'journal-user', email: 'journal@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

function seedPlanting() {
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
    cropPluginId: 'tomato-amish-paste',
    varietyDisplayName: 'Amish Paste tomato'
  });
}

function req(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const post = (id: string, body: unknown) =>
  POST({
    params: { id },
    url: new URL(`http://localhost/api/plantings/${id}/journal`),
    request: req(`http://localhost/api/plantings/${id}/journal`, 'POST', body)
  } as never) as Promise<Response>;

const list = async (id: string) => GET({ params: { id } } as never) as Promise<Response>;

const del = async (id: string, entryId: string) =>
  DELETE({ params: { id, entryId } } as never) as Promise<Response>;

const photo = async (id: string, entryId: string) =>
  PHOTO({ params: { id, entryId } } as never) as Promise<Response>;

const queued = (body: unknown, clientId: string) =>
  QUEUED({
    params: {},
    url: new URL('http://localhost/api/journal/record'),
    request: req('http://localhost/api/journal/record', 'POST', body, {
      [CLIENT_RECORD_HEADER]: clientId
    })
  } as never) as Promise<Response>;

beforeEach(() => {
  m.role = 'owner';
});

describe('/api/plantings/[id]/journal', () => {
  it('saves a note as manual and lists newest first', async () => {
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      expect((await post(crop.id, { kind: 'note', text: 'Staked today' })).status).toBe(201);
      const res = await post(crop.id, { kind: 'observation', text: ' First flowers ' });
      const { entry } = (await res.json()) as { entry: JournalEntry };
      expect(entry).toMatchObject({
        kind: 'observation',
        text: 'First flowers',
        provenance: 'manual',
        hasPhoto: false,
        createdBy: 'journal-user'
      });
      const body = (await (await list(crop.id)).json()) as { entries: JournalEntry[] };
      expect(body.entries.map((e) => e.text)).toEqual(['First flowers', 'Staked today']);
    });
  });

  it('keeps only an EXIF-free copy of a photo and serves it as a JPEG', async () => {
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      const res = await post(crop.id, {
        kind: 'photo_help',
        text: '',
        photo: toDataUrl(fakeJpeg({ exif: true }))
      });
      expect(res.status).toBe(201);
      const { entry } = (await res.json()) as { entry: JournalEntry };
      expect(entry.hasPhoto).toBe(true);
      const img = await photo(crop.id, entry.id);
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      const bytes = Buffer.from(await img.arrayBuffer());
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(bytes.toString('latin1')).not.toContain(EXIF_SECRET);
      await expect(photo(crop.id, 'nope')).rejects.toMatchObject({ status: 404 });
    });
  });

  it('400s an empty entry and an oversize photo', async () => {
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      expect((await post(crop.id, { kind: 'note', text: '   ' })).status).toBe(400);
      const big = toDataUrl(fakeJpeg({ padding: 310 * 1024 }));
      expect((await post(crop.id, { kind: 'note', text: 'x', photo: big })).status).toBe(400);
    });
  });

  it('lets helpers add notes, keeps delete owner-only, and inspectors read-only', async () => {
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      m.role = 'helper';
      const res = await post(crop.id, { kind: 'note', text: 'Helper note' });
      expect(res.status).toBe(201);
      const { entry } = (await res.json()) as { entry: JournalEntry };
      await expect(del(crop.id, entry.id)).rejects.toMatchObject({ status: 403 });
      m.role = 'inspector';
      expect((await post(crop.id, { kind: 'note', text: 'no' })).status).toBe(403);
      expect((await list(crop.id)).status).toBe(200);
      m.role = 'owner';
      expect((await del(crop.id, entry.id)).status).toBe(200);
      expect((await del(crop.id, entry.id)).status).toBe(404);
      expect(listJournalForCrop(crop.id)).toEqual([]);
    });
  });

  it("404s another Owner's planting for every verb", async () => {
    const theirs = runWithTenant(seedOwner(), () => {
      const crop = seedPlanting();
      return crop.id;
    });
    await runWithTenant(seedOwner(), async () => {
      expect((await list(theirs)).status).toBe(404);
      expect((await post(theirs, { kind: 'note', text: 'hi' })).status).toBe(404);
      expect((await del(theirs, 'x')).status).toBe(404);
    });
  });

  it('goes with its planting when the planting is deleted', async () => {
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      await post(crop.id, { kind: 'note', text: 'bye' });
      deleteCropCascade(crop.id);
      expect(listJournalForCrop(crop.id)).toEqual([]);
    });
  });
});

describe('POST /api/journal/record (offline replay)', () => {
  it('saves a queued entry once, however many times it replays', async () => {
    await runWithTenant(seedOwner(), async () => {
      const crop = seedPlanting();
      const body = {
        cropId: crop.id,
        kind: 'photo_help',
        text: 'Is it ready to pick?',
        photo: toDataUrl(fakeJpeg()),
        occurredAt: Date.UTC(2026, 6, 1)
      };
      const first = await queued(body, 'queued-journal-0001');
      expect(first.status).toBe(201);
      const again = await queued(body, 'queued-journal-0001');
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ duplicate: true });
      const rows = listJournalForCrop(crop.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ provenance: 'manual', createdAt: Date.UTC(2026, 6, 1) });
      expect((await queued({ ...body, cropId: 'missing' }, 'queued-journal-0002')).status).toBe(
        404
      );
    });
  });
});
