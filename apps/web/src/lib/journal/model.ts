/** Client-safe planting journal types shared by the repo, the endpoints and
 *  the photo-help panel. */

export const JOURNAL_KINDS = ['note', 'photo_help', 'observation'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const JOURNAL_PROVENANCE = ['manual', 'ai', 'fallback'] as const;
export type JournalProvenance = (typeof JOURNAL_PROVENANCE)[number];

export const PHOTO_QUESTIONS = ['ready', 'prune', 'leaves', 'other'] as const;
export type PhotoQuestion = (typeof PHOTO_QUESTIONS)[number];

export const PHOTO_QUESTION_LABEL: Record<Exclude<PhotoQuestion, 'other'>, string> = {
  ready: 'Is it ready to pick?',
  prune: 'Where do I prune?',
  leaves: "What's wrong with these leaves?"
};

export interface JournalAnswerSection {
  title: string;
  items: string[];
  /** Where the section's text came from: the crop plugin, or general tips. */
  provenance?: 'plugin' | 'fallback';
}

/** Kinds of mark drawn over a photo (Phase 37F, R-13). */
export const PHOTO_MARK_KINDS = ['cut', 'pinch', 'harvest', 'leave'] as const;
export type PhotoMarkKind = (typeof PHOTO_MARK_KINDS)[number];

/** One mark on a photo. `x`, `y`, `w` and `h` are 0 to 1 of the stored
 *  photo's width and height. */
export interface PhotoMark {
  kind: PhotoMarkKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
}

export interface JournalAnswer {
  question: PhotoQuestion;
  /** Claude's short answer; empty when the Care Guide answered. */
  text: string;
  source: 'ai' | 'fallback';
  sections: JournalAnswerSection[];
  /** True when the answer points to the Spray flow and the label. */
  sprayRedirect: boolean;
  /** Marks drawn over the photo, stored with the answer (R-14). */
  marks?: PhotoMark[];
}

export interface JournalEntry {
  id: string;
  cropId: string;
  blockId: string;
  createdAt: number;
  createdBy: string | null;
  kind: JournalKind;
  text: string;
  hasPhoto: boolean;
  /** Set once the photo lives in the document vault (Phase 33A). */
  photoDocumentId?: string | null;
  answer: JournalAnswer | null;
  provenance: JournalProvenance;
}

export const MAX_JOURNAL_TEXT = 2000;
export const MAX_PHOTO_QUESTION = 500;

export function questionText(question: PhotoQuestion, text: string): string {
  const typed = text.trim();
  if (question === 'other') return typed;
  return typed ? `${PHOTO_QUESTION_LABEL[question]} ${typed}` : PHOTO_QUESTION_LABEL[question];
}

export function journalPhotoUrl(cropId: string, entryId: string): string {
  return `/api/plantings/${encodeURIComponent(cropId)}/journal/${encodeURIComponent(entryId)}/photo`;
}
