import { describe, expect, it } from 'vitest';
import { canReadDocument, readerRole, whoCanSee } from './access';
import { DOCUMENT_SUBJECT_TYPES, type DocumentSubjectType } from './kinds';

const doc = (subjectType: DocumentSubjectType, subjectExists = true) => ({
  kind: 'lab-report' as const,
  links: [{ subjectType, subjectExists }]
});

describe('canReadDocument (A-31)', () => {
  it('lets the owner read everything', () => {
    for (const s of DOCUMENT_SUBJECT_TYPES) expect(canReadDocument('owner', doc(s))).toBe(true);
    expect(canReadDocument('owner', { kind: 'other', links: [] })).toBe(true);
  });

  it('keeps money records owner only', () => {
    expect(canReadDocument('helper', doc('ledger-entry'))).toBe(false);
    expect(canReadDocument('inspector', doc('ledger-entry'))).toBe(false);
  });

  it('lets inspectors but not helpers read farm and organic status files', () => {
    for (const s of ['farm', 'organic-status'] as const) {
      expect(canReadDocument('inspector', doc(s))).toBe(true);
      expect(canReadDocument('helper', doc(s))).toBe(false);
    }
  });

  it('lets helpers and inspectors read files on every other subject', () => {
    const rest = DOCUMENT_SUBJECT_TYPES.filter(
      (s) => !['ledger-entry', 'farm', 'organic-status'].includes(s)
    );
    for (const s of rest) {
      expect(canReadDocument('helper', doc(s))).toBe(true);
      expect(canReadDocument('inspector', doc(s))).toBe(true);
      expect(canReadDocument('custom-operator', doc(s))).toBe(true);
    }
  });

  it('makes unlinked files and files whose subject is gone owner only', () => {
    expect(canReadDocument('helper', { kind: 'lab-report', links: [] })).toBe(false);
    expect(canReadDocument('helper', doc('block', false))).toBe(false);
    expect(canReadDocument('inspector', doc('soil-test', false))).toBe(false);
  });

  it('grants when any one link grants', () => {
    expect(
      canReadDocument('helper', {
        kind: 'receipt',
        links: [
          { subjectType: 'ledger-entry', subjectExists: true },
          { subjectType: 'stock-lot', subjectExists: true }
        ]
      })
    ).toBe(true);
  });

  it('lets any farm member see photo kinds', () => {
    for (const r of ['helper', 'inspector', 'custom-operator']) {
      expect(canReadDocument(r, { kind: 'journal-photo', links: [] })).toBe(true);
      expect(canReadDocument(r, { kind: 'animal-photo', links: [] })).toBe(true);
    }
  });

  it('refuses roles it does not know', () => {
    expect(readerRole('superadmin')).toBeNull();
    expect(canReadDocument('', doc('block'))).toBe(false);
    expect(canReadDocument('anonymous', { kind: 'journal-photo', links: [] })).toBe(false);
  });

  it('says in plain words who will see a file', () => {
    expect(whoCanSee('ledger-entry')).toBe('Only you can see this file.');
    expect(whoCanSee('farm')).toBe('You and inspectors can see this file.');
    expect(whoCanSee('block')).toBe('Helpers and inspectors on this farm can see this file.');
  });
});
