import { describe, expect, it } from 'vitest';
import * as schema from '$lib/db/schema';
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_SUBJECT_LABEL,
  DOCUMENT_SUBJECT_TYPES,
  PHOTO_DOCUMENT_KINDS,
  formatBytes,
  isPhotoKind
} from './kinds';

describe('document kinds', () => {
  it('match the schema enums exactly', () => {
    expect([...DOCUMENT_KINDS]).toEqual([...schema.DOCUMENT_KINDS]);
    expect([...PHOTO_DOCUMENT_KINDS]).toEqual([...schema.PHOTO_DOCUMENT_KINDS]);
    expect([...DOCUMENT_SUBJECT_TYPES]).toEqual([...schema.DOCUMENT_SUBJECT_TYPES]);
  });

  it('label every kind and subject', () => {
    for (const k of DOCUMENT_KINDS) expect(DOCUMENT_KIND_LABEL[k]).toBeTruthy();
    for (const s of DOCUMENT_SUBJECT_TYPES) expect(DOCUMENT_SUBJECT_LABEL[s]).toBeTruthy();
  });

  it('knows the photo kinds', () => {
    expect(isPhotoKind('journal-photo')).toBe(true);
    expect(isPhotoKind('animal-photo')).toBe(true);
    expect(isPhotoKind('photo')).toBe(false);
    expect(isPhotoKind('lab-report')).toBe(false);
  });
});

describe('formatBytes', () => {
  it('uses decimal units, as the cap does', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(1)).toBe('1 KB');
    expect(formatBytes(250_000)).toBe('250 KB');
    expect(formatBytes(12_400_000)).toBe('12.4 MB');
    expect(formatBytes(100_000_000)).toBe('100 MB');
    expect(formatBytes(1_000_000_000)).toBe('1 GB');
    expect(formatBytes(5_000_000_000)).toBe('5 GB');
    expect(formatBytes(-5)).toBe('0 KB');
  });
});
