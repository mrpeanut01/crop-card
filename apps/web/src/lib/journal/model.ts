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
}

export interface JournalAnswer {
  question: PhotoQuestion;
  /** Claude's short answer; empty when the Care Guide answered. */
  text: string;
  source: 'ai' | 'fallback';
  sections: JournalAnswerSection[];
  /** True when the answer points to the Spray flow and the label. */
  sprayRedirect: boolean;
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
