import { describe, expect, it } from 'vitest';
import {
  isSavedRecordCard,
  recordKindLabel,
  savedCopyCards,
  savedCopyNotice,
  savedRecordHref
} from './recordCard';
import type { CardModel } from './model';

const card = {
  kind: 'spray',
  key: 'rc_spray.1',
  kicker: 'Spray record',
  title: 'Roundup',
  facts: [],
  sections: [],
  asOf: 1,
  provenance: [],
  href: '/records/spray/1',
  status: { label: 'Editable', tone: 'wheat' }
} as CardModel;
const good = { v: 1, recordKind: 'spray', rowId: '1', cards: [card], origin: null };

describe('isSavedRecordCard', () => {
  it('accepts a well-formed model', () => {
    expect(isSavedRecordCard(good)).toBe(true);
    expect(isSavedRecordCard({ ...good, origin: 'https://x' })).toBe(true);
  });

  it('rejects older or damaged shapes', () => {
    for (const bad of [
      null,
      'x',
      { ...good, v: 2 },
      { ...good, recordKind: '' },
      { ...good, rowId: 7 },
      { ...good, origin: 3 },
      { ...good, cards: 'no' },
      { ...good, cards: [{ ...card, kind: 'nope' }] },
      { ...good, cards: [{ ...card, facts: undefined }] }
    ]) {
      expect(isSavedRecordCard(bad)).toBe(false);
    }
  });
});

describe('saved copy helpers', () => {
  it('words the notice with the saved time', () => {
    const text = savedCopyNotice(Date.parse('2026-06-02T16:30:00Z'), {
      timeZone: 'America/New_York',
      units: 'us'
    });
    expect(text).toMatch(/^Saved copy from .*Jun.*2026.*\. The record may have changed since\.$/);
    expect(text).not.toContain('—');
  });

  it('drops the live lock status pill', () => {
    expect(savedCopyCards(good as never)[0].status).toBeUndefined();
    expect(savedCopyCards(good as never)[0].title).toBe('Roundup');
  });

  it('labels kinds and builds the saved-copy URL', () => {
    expect(recordKindLabel('spray')).toBe('Spray');
    expect(recordKindLabel('irrigation')).toBe('Watering');
    expect(recordKindLabel('zzz')).toBe('Record');
    expect(savedRecordHref('rc_spray.a/b')).toBe('/cards/record/rc_spray.a%2Fb');
  });
});
