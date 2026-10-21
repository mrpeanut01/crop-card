/** The shape of a marked journal entry kept on the phone (#869, FU869-3).
 *  Pure and client-safe. Only what the journal shows is kept: the date, the
 *  question, where it came from, the steps and the marks. No author, block,
 *  vault id or delete right. */

import { JOURNAL_PROVENANCE, PHOTO_QUESTIONS, type JournalEntry, type PhotoMark } from './model';
import type { JournalProvenance, PhotoQuestion } from './model';
import { parseMarks } from './marks';

export interface SavedJournalEntry {
  v: 1;
  id: string;
  cropId: string;
  createdAt: number;
  text: string;
  provenance: JournalProvenance;
  answer: {
    question: PhotoQuestion;
    source: 'ai' | 'fallback';
    text: string;
    steps: string[];
    marks: PhotoMark[];
  };
}

const MAX_ID = 128;
const MAX_TEXT = 2000;

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
}

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_TEXT;
}

/** True when an entry has marks drawn on a photo, so a copy is worth it. */
export function isMarkedEntry(e: JournalEntry): boolean {
  return e.hasPhoto && (e.answer?.marks?.length ?? 0) > 0;
}

/** The part of a marked entry the phone keeps, or null for any other entry. */
export function savedEntryOf(e: JournalEntry): SavedJournalEntry | null {
  if (!isMarkedEntry(e) || !e.answer?.marks) return null;
  const saved: SavedJournalEntry = {
    v: 1,
    id: e.id,
    cropId: e.cropId,
    createdAt: e.createdAt,
    text: e.text,
    provenance: e.provenance,
    answer: {
      question: e.answer.question,
      source: e.answer.source,
      text: e.answer.text,
      steps: [...(e.answer.steps ?? [])],
      marks: e.answer.marks.map((m) => ({ ...m }))
    }
  };
  return isSavedJournalEntry(saved) ? saved : null;
}

/** A stored copy read back: the right shape, and marks that still pass
 *  `parseMarks`, so a damaged or edited row never draws. */
export function isSavedJournalEntry(v: unknown): v is SavedJournalEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<SavedJournalEntry>;
  if (e.v !== 1 || !isId(e.id) || !isId(e.cropId)) return false;
  if (typeof e.createdAt !== 'number' || !Number.isFinite(e.createdAt)) return false;
  if (!isText(e.text) || !(JOURNAL_PROVENANCE as readonly unknown[]).includes(e.provenance))
    return false;
  const a = e.answer;
  if (!a || typeof a !== 'object') return false;
  if (!(PHOTO_QUESTIONS as readonly unknown[]).includes(a.question)) return false;
  if (a.source !== 'ai' && a.source !== 'fallback') return false;
  if (!isText(a.text)) return false;
  if (!Array.isArray(a.steps) || a.steps.length > 12 || !a.steps.every(isText)) return false;
  if (!Array.isArray(a.marks) || a.marks.length === 0) return false;
  const parsed = parseMarks(a.marks);
  return parsed.ok && parsed.marks.length === a.marks.length;
}
