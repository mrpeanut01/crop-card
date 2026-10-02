/** Phase 33D (D-10): the saved copy of a record card kept on this device. */

import { formatInstant, type Prefs } from '$lib/prefs';
import { KIND_LABEL, type RecordKind } from '$lib/db/recordKinds';
import { createT, type MessageKey, type Translator } from '$lib/i18n';
import { isCardKind, type CardModel } from './model';

export interface SavedRecordCard {
  v: 1;
  recordKind: string;
  rowId: string;
  cards: CardModel[];
  origin: string | null;
}

function isCardModelLike(x: unknown): x is CardModel {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  return (
    isCardKind(c.kind) &&
    typeof c.key === 'string' &&
    typeof c.title === 'string' &&
    typeof c.kicker === 'string' &&
    Array.isArray(c.facts) &&
    Array.isArray(c.sections) &&
    Array.isArray(c.provenance) &&
    typeof c.asOf === 'number' &&
    typeof c.href === 'string'
  );
}

export function isSavedRecordCard(x: unknown): x is SavedRecordCard {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return (
    m.v === 1 &&
    typeof m.recordKind === 'string' &&
    m.recordKind.length > 0 &&
    typeof m.rowId === 'string' &&
    m.rowId.length > 0 &&
    (m.origin === null || typeof m.origin === 'string') &&
    Array.isArray(m.cards) &&
    m.cards.every(isCardModelLike)
  );
}

export function savedCopyNotice(
  savedAt: number,
  prefs: Prefs,
  tr: Translator = createT(null)
): string {
  return tr('cardsui.rec.notice', { time: formatInstant(savedAt, prefs, 'datetime') });
}

export function recordKindLabel(recordKind: string, tr: Translator = createT(null)): string {
  if (recordKind === 'irrigation') return tr('cardsui.kind.irrigation');
  if (recordKind in KIND_LABEL) return tr(`records.kind.${recordKind as RecordKind}` as MessageKey);
  return tr('cardsui.rec.kindFallback');
}

export function savedRecordHref(key: string): string {
  return `/cards/record/${encodeURIComponent(key)}`;
}

/** Cards as shown from a saved copy: the lock status pill ("Editable",
 *  "Locked") is a live fact, so it is left off. */
export function savedCopyCards(model: SavedRecordCard): CardModel[] {
  return model.cards.map((card) => {
    const { status: _status, ...rest } = card;
    return rest;
  });
}
