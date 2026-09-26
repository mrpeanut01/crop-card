import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './dexie';
import { listQueuedJournal, parseQueuedJournal, queueJournalEntry } from './journalQueue';

const ACTIVE_KEY = 'cropcard.activeOwnerId';

beforeEach(async () => {
  await db().pendingSprayRecords.clear();
  sessionStorage.clear();
});

describe('parseQueuedJournal', () => {
  it('reads a note or a photo question', () => {
    expect(
      parseQueuedJournal({ cropId: 'c1', kind: 'photo_help', text: 'Ripe?', photo: 'data:x' })
    ).toEqual({ cropId: 'c1', kind: 'photo_help', text: 'Ripe?', hasPhoto: true });
    expect(parseQueuedJournal({ cropId: 'c1', kind: 'note', text: 'Hail' })).toEqual({
      cropId: 'c1',
      kind: 'note',
      text: 'Hail',
      hasPhoto: false
    });
  });

  it('rejects anything else', () => {
    for (const bad of [null, 'x', {}, { cropId: '', kind: 'note' }, { cropId: 'c', kind: 'x' }]) {
      expect(parseQueuedJournal(bad)).toBeNull();
    }
  });
});

describe('listQueuedJournal', () => {
  it("lists the active Owner's entries for one planting, newest first", async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    await queueJournalEntry({ cropId: 'c1', kind: 'note', text: 'first', photo: null });
    await queueJournalEntry({ cropId: 'c2', kind: 'note', text: 'other bed', photo: null });
    await queueJournalEntry({ cropId: 'c1', kind: 'photo_help', text: 'second', photo: 'data:x' });
    sessionStorage.setItem(ACTIVE_KEY, 'owner_b');
    await queueJournalEntry({ cropId: 'c1', kind: 'note', text: 'another farm', photo: null });
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');

    const rows = await listQueuedJournal('c1');
    expect(rows.map((r) => [r.text, r.hasPhoto, r.rejected])).toEqual([
      ['second', true, false],
      ['first', false, false]
    ]);
  });
});
