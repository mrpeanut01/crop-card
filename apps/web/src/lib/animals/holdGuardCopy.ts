/**
 * Plain words for the C-35 hold guard: what a refused write would have
 * done to a hold, and what the person can do instead. Client-safe, so the
 * server's answer and the forms say the same thing.
 */

import { formatClearDate } from '$lib/safety/animalWithdrawal';

export type HoldKindWord = 'meat' | 'milk' | 'eggs' | 'preSlaughter' | 'graze' | 'hay';

export interface ShortenedHold {
  subject: string;
  subjectLabel: string;
  kind: HoldKindWord;
  /** When the hold ended before the write; null when it has no end. */
  clearBefore: number | null;
  /** When it would end after the write; null when it would be gone. */
  clearAfter: number | null;
}

export interface HoldShortenBody {
  code: 'HOLD_WOULD_SHORTEN';
  error: string;
  holds: ShortenedHold[];
  coverage: { id: string; label: string }[];
  diffHash: string;
  todayVersionPasses: boolean;
  /** The signed-in owner can void this entry (C-35 §5). */
  canVoid: boolean;
  askOwner: boolean;
}

const KIND_WORD: Record<HoldKindWord, string> = {
  meat: 'meat',
  milk: 'milk',
  eggs: 'eggs',
  preSlaughter: 'pre-slaughter',
  graze: 'grazing',
  hay: 'hay'
};

function possessive(label: string): string {
  return /s$/i.test(label) ? `${label}'` : `${label}'s`;
}

function day(ms: number, timeZone?: string): string {
  return formatClearDate(ms, timeZone)
    .replace(/^\w+, /, '')
    .replace(/, \d{4}$/, '');
}

/** "Saving this with that date would end Bessie's milk hold on Oct 3
 *  instead of Oct 9." */
export function shorteningLine(h: ShortenedHold, timeZone?: string): string {
  const whose = `${possessive(h.subjectLabel)} ${KIND_WORD[h.kind]} hold`;
  if (h.clearBefore === null) {
    return h.clearAfter === null
      ? `Saving this with that date would remove ${whose}, which has no end date.`
      : `Saving this with that date would end ${whose} on ${day(h.clearAfter, timeZone)}. It has no end date now.`;
  }
  if (h.clearAfter === null) {
    return `Saving this with that date would remove ${whose}, which runs to ${day(h.clearBefore, timeZone)}.`;
  }
  if (h.clearAfter < h.clearBefore) {
    return `Saving this with that date would end ${whose} on ${day(h.clearAfter, timeZone)} instead of ${day(h.clearBefore, timeZone)}.`;
  }
  return `Saving this with that date would take days out of ${whose}, which runs to ${day(h.clearBefore, timeZone)}.`;
}

/** The whole refusal: up to three holds, then "+N more", then the way out. */
export function holdShortenMessage(
  input: Pick<
    HoldShortenBody,
    'holds' | 'coverage' | 'todayVersionPasses' | 'canVoid' | 'askOwner'
  >,
  timeZone?: string
): string {
  const lines = input.holds.slice(0, 3).map((h) => shorteningLine(h, timeZone));
  if (input.holds.length > 3) lines.push(`+${input.holds.length - 3} more.`);
  if (input.coverage.length > 0) {
    const n = input.coverage.length;
    lines.push(
      `${n === 1 ? 'A saved record of eggs, milk, meat or hay' : `${n} saved records of eggs, milk, meat or hay`} would no longer fall inside a hold.`
    );
  }
  lines.push('Holds never get shorter.');
  if (input.todayVersionPasses) lines.push("Save it with today's date instead.");
  if (input.askOwner) lines.push('Or ask the owner to enter it.');
  if (input.canVoid) {
    lines.push('If this entry was a mistake, you can void it within 48 hours of entering it.');
  }
  return lines.join(' ');
}

export const DATE_RULE_COPY = {
  IN_THE_FUTURE:
    'That date is in the future. Records are for what already happened. Use a task to plan ahead.',
  BACKDATE_DECLARATION:
    "Eggs, milk, meat and hay can be dated up to 7 days back (24 hours for helpers). For anything older, add a note to a record. It won't change any hold.",
  BACKDATE_OTHER: "Records older than 400 days can't be entered.",
  HOLD_DIFF_STALE: 'The holds changed since you looked. Review again.',
  HOLD_NOT_VOIDABLE: "Holds from a prohibited drug or unknown label can't be shortened.",
  VOID_TOO_LATE:
    'Only an entry made in the last 48 hours can be voided. After that, holds stay as they are.'
} as const;

/** C-35 §4c: a declaration dated before a hold already on file. */
export function crossingHoldMessage(
  product: string,
  subject: string,
  whenMs: number,
  timeZone?: string
): string {
  return `${product} is on record for ${subject} on ${day(whenMs, timeZone)}, after the date entered. Save as discarded, or record it when it happens.`;
}

/** A record card and export label for records saved late (C-35 §1). */
export function enteredLateLabel(occurredAt: number, createdAt: number): string | null {
  const days = Math.floor((createdAt - occurredAt) / 86_400_000);
  if (days < 2) return null;
  return `Entered ${days} days late`;
}

/** The guard's refusal, when a response is one. Reads a clone. */
export async function holdRefusalOf(res: Response): Promise<HoldShortenBody | null> {
  if (res.status !== 409) return null;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as Partial<HoldShortenBody> | null;
  return body?.code === 'HOLD_WOULD_SHORTEN' && Array.isArray(body.holds)
    ? (body as HoldShortenBody)
    : null;
}
