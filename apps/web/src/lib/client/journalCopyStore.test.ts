import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { db } from './dexie';
import { clearCardCaches } from './cardStore';
import { resetTenantCaches, wipeTenantCaches } from './tenantSwitch';
import {
  JOURNAL_COPY_MAX_BYTES,
  JOURNAL_COPY_PER_OWNER,
  JOURNAL_COPY_PER_PLANTING,
  fetchJournalPhoto,
  forgetJournalCopiesFor,
  forgetJournalCopy,
  listJournalCopies,
  reconcileJournalCopies,
  refreshJournalCopy,
  saveJournalCopy,
  saveShownJournalCopies
} from './journalCopyStore';
import { JPEG_DATA_URL_PREFIX, encodeBase64 } from '$lib/journal/photo';
import type { JournalEntry } from '$lib/journal/model';

const ACTIVE_KEY = 'cropcard.activeOwnerId';

function setActive(id: string | null) {
  if (id) sessionStorage.setItem(ACTIVE_KEY, id);
  else sessionStorage.removeItem(ACTIVE_KEY);
}

function jpeg(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

const PHOTO = JPEG_DATA_URL_PREFIX + encodeBase64(jpeg());

function entry(
  id: string,
  cropId = 'crop_1',
  createdAt = 1_000,
  extra: Partial<JournalEntry> = {}
) {
  return {
    id,
    cropId,
    blockId: 'blk_secret',
    createdAt,
    createdBy: 'user_secret',
    kind: 'photo_help',
    text: 'Where do I prune?',
    hasPhoto: true,
    photoDocumentId: 'doc_secret',
    provenance: 'ai',
    answer: {
      question: 'prune',
      text: 'Step one. Step two.',
      source: 'ai',
      sections: [],
      sprayRedirect: false,
      steps: ['Step one.', 'Step two.'],
      marks: [
        { kind: 'cut', x: 0.2, y: 0.3, label: 'Cut here' },
        { kind: 'problem', x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: 'Yellow lower leaves' }
      ],
      marksProvenance: 'ai'
    },
    ...extra
  } as JournalEntry;
}

async function fresh() {
  await clearCardCaches();
  sessionStorage.clear();
  setActive('owner_a');
}

beforeEach(fresh);
afterEach(fresh);

describe('journalCopyStore (#869, FU869-3)', () => {
  it('saves a marked entry with its photo and reads it back, keeping only what the page shows', async () => {
    expect(await saveJournalCopy(entry('e1'), PHOTO, 100)).toBe(true);
    const [copy] = await listJournalCopies('crop_1');
    expect(copy.savedAt).toBe(100);
    expect(copy.photo).toBe(PHOTO);
    expect(copy.entry.answer.marks).toHaveLength(2);
    expect(copy.entry.answer.steps).toEqual(['Step one.', 'Step two.']);
    expect(copy.entry.answer.text).toBe('Step one. Step two.');
    const stored = JSON.stringify(await db().journalCopies.toArray());
    for (const secret of ['blk_secret', 'user_secret', 'doc_secret', 'sprayRedirect']) {
      expect(stored).not.toContain(secret);
    }
  });

  it('saves nothing for an unmarked entry, a bad photo or no active Owner', async () => {
    expect(await saveJournalCopy(entry('e1', 'crop_1', 1, { hasPhoto: false }), PHOTO)).toBe(false);
    const plain = entry('e2');
    plain.answer = { ...plain.answer!, marks: [] };
    expect(await saveJournalCopy(plain, PHOTO)).toBe(false);
    expect(await saveJournalCopy(entry('e3'), 'data:image/png;base64,AAAA')).toBe(false);
    expect(await saveJournalCopy(entry('e3'), `${JPEG_DATA_URL_PREFIX}not base64!`)).toBe(false);
    setActive(null);
    expect(await saveJournalCopy(entry('e4'), PHOTO)).toBe(false);
    setActive('owner_a');
    expect(await saveJournalCopy(entry('e5'), PHOTO, 1, 'owner_b')).toBe(false);
    expect(await db().journalCopies.count()).toBe(0);
  });

  it('keeps the 20 newest entries per planting', async () => {
    for (let i = 0; i < JOURNAL_COPY_PER_PLANTING + 5; i++) {
      await saveJournalCopy(entry(`e${i}`, 'crop_1', 1_000 + i), PHOTO, 5_000 - i);
    }
    await saveJournalCopy(entry('other', 'crop_2', 1), PHOTO, 1);
    const kept = await listJournalCopies('crop_1');
    expect(kept).toHaveLength(JOURNAL_COPY_PER_PLANTING);
    expect(kept[0].entry.id).toBe(`e${JOURNAL_COPY_PER_PLANTING + 4}`);
    expect(kept.at(-1)!.entry.id).toBe('e5');
    expect(await listJournalCopies('crop_2')).toHaveLength(1);
  });

  it('keeps at most 100 per Owner, dropping the copies saved longest ago', async () => {
    for (let i = 0; i < JOURNAL_COPY_PER_OWNER + 3; i++) {
      await saveJournalCopy(entry(`e${i}`, `crop_${i}`, 1_000), PHOTO, 10_000 + i);
    }
    expect(await db().journalCopies.count()).toBe(JOURNAL_COPY_PER_OWNER);
    for (const gone of ['e0', 'e1', 'e2']) {
      expect(await db().journalCopies.get(['owner_a', gone])).toBeUndefined();
    }
    expect(await db().journalCopies.get(['owner_a', 'e3'])).toBeDefined();
  });

  it('keeps the Owner under 15 MB, dropping the oldest saved first', async () => {
    const big = JPEG_DATA_URL_PREFIX + encodeBase64(jpeg(300 * 1024));
    const each = big.length;
    const fit = Math.floor(JOURNAL_COPY_MAX_BYTES / (each + 2_000));
    for (let i = 0; i < fit + 4; i++) {
      await saveJournalCopy(entry(`e${i}`, `crop_${i}`, 1), big, 10_000 + i);
    }
    const rows = await db().journalCopies.toArray();
    const total = rows.reduce((n, r) => n + r.bytes, 0);
    expect(total).toBeLessThanOrEqual(JOURNAL_COPY_MAX_BYTES);
    expect(rows.length).toBeLessThan(fit + 4);
    expect(await db().journalCopies.get(['owner_a', 'e0'])).toBeUndefined();
    expect(await db().journalCopies.get(['owner_a', `e${fit + 3}`])).toBeDefined();
  });

  it('never shows one Owner the copies of another', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            owner: fc.constantFrom('owner_a', 'owner_b'),
            id: fc.constantFrom('e1', 'e2', 'e3'),
            crop: fc.constantFrom('crop_1', 'crop_2')
          }),
          { maxLength: 10 }
        ),
        fc.constantFrom('owner_a', 'owner_b'),
        async (writes, reader) => {
          await db().journalCopies.clear();
          const mine = new Map<string, string>();
          for (const w of writes) {
            setActive(w.owner);
            await saveJournalCopy(entry(w.id, w.crop), PHOTO, 1);
            if (w.owner === reader) mine.set(w.id, w.crop);
          }
          setActive(reader);
          const seen = [
            ...(await listJournalCopies('crop_1')),
            ...(await listJournalCopies('crop_2'))
          ];
          expect(new Map(seen.map((c) => [c.entry.id, c.entry.cropId]))).toEqual(mine);
        }
      ),
      { numRuns: 40 }
    );
  });

  it('refreshes a saved copy from the server without fetching the photo again', async () => {
    await saveJournalCopy(entry('e1'), PHOTO, 100);
    const changed = entry('e1');
    changed.answer = { ...changed.answer!, steps: ['New step.'] };
    expect(await refreshJournalCopy(changed, 900)).toBe(true);
    const [copy] = await listJournalCopies('crop_1');
    expect(copy.savedAt).toBe(900);
    expect(copy.entry.answer.steps).toEqual(['New step.']);
    expect(copy.photo).toBe(PHOTO);
    expect(await refreshJournalCopy(entry('missing'), 900)).toBe(false);
  });

  it('drops copies of deleted entries when the server lists the journal', async () => {
    await saveJournalCopy(entry('old', 'crop_1', 10), PHOTO);
    await saveJournalCopy(entry('kept', 'crop_1', 50), PHOTO);
    await saveJournalCopy(entry('gone', 'crop_1', 60), PHOTO);
    await reconcileJournalCopies('crop_1', [entry('kept', 'crop_1', 50)], false);
    expect((await listJournalCopies('crop_1')).map((c) => c.entry.id)).toEqual(['kept', 'old']);
    await reconcileJournalCopies('crop_1', [entry('kept', 'crop_1', 50)], true);
    expect((await listJournalCopies('crop_1')).map((c) => c.entry.id)).toEqual(['kept']);
    await forgetJournalCopiesFor('crop_1');
    expect(await listJournalCopies('crop_1')).toEqual([]);
  });

  it('drops a damaged row instead of drawing it', async () => {
    await saveJournalCopy(entry('e1'), PHOTO);
    await db().journalCopies.update(['owner_a', 'e1'], {
      entry: { ...((await db().journalCopies.get(['owner_a', 'e1']))!.entry as object), v: 2 }
    });
    expect(await listJournalCopies('crop_1')).toEqual([]);
    expect(await db().journalCopies.count()).toBe(0);
  });

  it('is cleared with the Card caches, on an Owner switch and on logout', async () => {
    for (const reset of [
      () => clearCardCaches(),
      () => resetTenantCaches('owner_b'),
      () => wipeTenantCaches()
    ]) {
      setActive('owner_a');
      await saveJournalCopy(entry('e1'), PHOTO);
      setActive('owner_b');
      await saveJournalCopy(entry('e2'), PHOTO);
      await reset();
      expect(await db().journalCopies.count()).toBe(0);
    }
  });

  it('forgets one copy for the active Owner only', async () => {
    await saveJournalCopy(entry('e1'), PHOTO);
    setActive('owner_b');
    await saveJournalCopy(entry('e1'), PHOTO);
    await forgetJournalCopy('e1');
    expect(await db().journalCopies.get(['owner_b', 'e1'])).toBeUndefined();
    expect(await db().journalCopies.get(['owner_a', 'e1'])).toBeDefined();
  });
});

describe('fetchJournalPhoto and saveShownJournalCopies', () => {
  const ok = (bytes: Uint8Array) => new Response(bytes, { status: 200 });

  it('reads a JPEG into a data URL and refuses anything else', async () => {
    expect(await fetchJournalPhoto('c', 'e', async () => ok(jpeg()))).toBe(PHOTO);
    expect(await fetchJournalPhoto('c', 'e', async () => new Response('x', { status: 404 }))).toBe(
      'gone'
    );
    expect(await fetchJournalPhoto('c', 'e', async () => new Response('x', { status: 500 }))).toBe(
      null
    );
    expect(await fetchJournalPhoto('c', 'e', async () => ok(new Uint8Array([1, 2, 3, 4])))).toBe(
      null
    );
    expect(await fetchJournalPhoto('c', 'e', async () => ok(jpeg(400 * 1024)))).toBe(null);
    expect(
      await fetchJournalPhoto('c', 'e', async () => {
        throw new TypeError('offline');
      })
    ).toBe(null);
  });

  it('saves every marked entry shown, drops a copy whose photo is gone and fetches each photo once', async () => {
    await saveJournalCopy(entry('gone'), PHOTO);
    const fetcher = vi.fn(async (url: string) =>
      url.includes('/gone/') ? new Response('', { status: 404 }) : ok(jpeg())
    );
    const shown = [entry('a', 'crop_1', 3), entry('b', 'crop_1', 2, { hasPhoto: false })];
    await saveShownJournalCopies(shown, 'owner_a', fetcher, 50);
    expect((await listJournalCopies('crop_1')).map((c) => c.entry.id).sort()).toEqual([
      'a',
      'gone'
    ]);
    await db().journalCopies.delete(['owner_a', 'gone']);
    fetcher.mockClear();
    await saveShownJournalCopies([...shown, entry('gone')], 'owner_a', fetcher, 60);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/gone/');
    expect((await listJournalCopies('crop_1')).map((c) => c.entry.id)).toEqual(['a']);
  });

  it('saves nothing when the page was read for another Owner', async () => {
    const fetcher = vi.fn(async () => ok(jpeg()));
    await saveShownJournalCopies([entry('a')], 'owner_b', fetcher);
    await saveShownJournalCopies([entry('a')], null, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await db().journalCopies.count()).toBe(0);
  });
});
