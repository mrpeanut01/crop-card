import type { Translator, MessageKey } from '$lib/i18n';
import { isAreaKind } from '$lib/farm/areaKinds';
import { errorFromResponse, type OUTCOME_CHOICES } from '$lib/animals/display';

const DAY = 86_400_000;

const GROUP_NOUNS = ['flock', 'herd', 'colony', 'group'] as const;

/** The word for a species' group ("flock"), in the reader's language. */
export function groupNoun(tr: Translator, noun: string): string {
  return (GROUP_NOUNS as readonly string[]).includes(noun)
    ? tr(`animals.noun.${noun}` as MessageKey)
    : noun;
}

const STATUSES = [
  'active',
  'sold',
  'died',
  'culled',
  'rehomed',
  'slaughtered',
  'sold-for-meat',
  'archived'
] as const;

export function statusLabel(tr: Translator, status: string): string {
  return (STATUSES as readonly string[]).includes(status)
    ? tr(`animals.status.${status}` as MessageKey)
    : status;
}

export function outcomeLabel(
  tr: Translator,
  value: (typeof OUTCOME_CHOICES)[number]['value']
): string {
  return value === 'slaughtered' ? tr('animals.outcome.slaughtered') : statusLabel(tr, value);
}

export function animalName(tr: Translator, a: { name: string | null; tag: string | null }): string {
  if (a.name?.trim()) return a.name.trim();
  if (a.tag?.trim()) return tr('animals.tagLabel', { tag: a.tag.trim() });
  return tr('animals.unnamed');
}

export function ageLabel(
  tr: Translator,
  birthMs: number | null,
  estimated: boolean,
  now: number = Date.now()
): string | null {
  if (birthMs === null || !Number.isFinite(birthMs)) return null;
  const days = Math.floor((now - birthMs) / DAY);
  if (days < 0) return null;
  let text: string;
  if (days < 14) text = tr('animals.age.days', { count: days });
  else if (days < 60) text = tr('animals.age.weeks', { count: Math.floor(days / 7) });
  else if (days < 730) text = tr('animals.age.months', { count: Math.floor(days / 30.44) });
  else text = tr('animals.age.years', { count: Math.floor(days / 365.25) });
  return estimated ? tr('animals.age.about', { text }) : text;
}

export function countLabel(
  tr: Translator,
  total: number,
  species: { label: string; displayName: string } | undefined
): string {
  if (!species) return tr('animals.count.animal', { count: total });
  const word = total === 1 ? species.displayName : species.label;
  return `${total} ${word.toLowerCase()}`;
}

export function areaKindName(tr: Translator, kind: string): string {
  if (isAreaKind(kind)) return tr(`animals.areaKind.${kind}` as MessageKey);
  return kind;
}

/** The Animals page title for the farm's layout ("Pets & animals" for a
 *  household). */
export function pageTitle(tr: Translator, layout: string): string {
  return layout === 'pets' ? tr('nav.petsAndAnimals') : tr('nav.animals');
}

const USES = ['food', 'sale', 'discard', 'feed-to-animals', 'unknown'] as const;

/** Where eggs or milk went ("For the table"), in the reader's language. */
export function useLabel(tr: Translator, use: string): string {
  return (USES as readonly string[]).includes(use) ? tr(`animals.use.${use}` as MessageKey) : use;
}

export function careKindLabel(tr: Translator, kind: string): string {
  return tr(`animals.careKind.${kind}` as MessageKey);
}

export function unitLabel(tr: Translator, unit: string): string {
  return tr(`animals.unit.${unit}` as MessageKey);
}

const QTY_UNITS = ['eggs', 'dozen', 'gal', 'qt', 'l', 'lb', 'kg'] as const;

/** "18 eggs" / "18 huevos": a logged amount with its unit, in the reader's language. */
export function quantityLabel(tr: Translator, quantity: number, unit: string): string {
  if (!(QTY_UNITS as readonly string[]).includes(unit)) return `${quantity} ${unit}`;
  return tr(`animals.qty.${unit as (typeof QTY_UNITS)[number]}`, { count: quantity });
}

const CODE_KEYS: Record<string, MessageKey> = {
  SPECIES_MISMATCH: 'animals.err.SPECIES_MISMATCH',
  NOT_A_HOUSING_AREA: 'animals.err.NOT_A_HOUSING_AREA',
  ALREADY_THERE: 'animals.err.ALREADY_THERE',
  SAME_TIME: 'animals.err.SAME_TIME',
  OUT_OF_ORDER: 'animals.err.OUT_OF_ORDER',
  COUNT_TOO_HIGH: 'animals.err.COUNT_TOO_HIGH',
  READ_ONLY: 'animals.err.READ_ONLY',
  RECORD_LOCKED: 'animallib.err.RECORD_LOCKED',
  NOT_LATEST: 'animals.err.NOT_LATEST',
  GROUP_HAS_MEMBERS: 'animals.err.GROUP_HAS_MEMBERS',
  ANIMAL_HAS_RECORDS: 'animals.err.ANIMAL_HAS_RECORDS',
  AREA_HAS_ANIMALS: 'animals.err.AREA_HAS_ANIMALS',
  AREA_HAS_GROUP_HISTORY: 'animallib.err.AREA_HAS_GROUP_HISTORY',
  UNKNOWN_SUBJECT: 'animals.err.UNKNOWN_SUBJECT',
  OWNER_ONLY: 'animals.err.OWNER_ONLY',
  IN_THE_FUTURE: 'animals.err.IN_THE_FUTURE'
};

const ENGLISH_CODES = new Set([
  'LOG_UNDER_HOLD',
  'HOLD_NOT_VOIDABLE',
  'HOLD_WOULD_SHORTEN',
  'HOLD_DIFF_STALE',
  'VOID_TOO_LATE',
  'BACKDATE_TOO_FAR',
  'HOLD_ACTIVE'
]);

/** `errorFromResponse` with the plain-word refusals in the reader's
 *  language. Hold, withdrawal and grazing refusals (and anything the server
 *  words itself) stay as the server wrote them. */
export async function errorText(res: Response, tr: Translator): Promise<string> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: string; resubmitAs?: unknown } | null;
  const code = body?.code;
  const key = code ? CODE_KEYS[code] : undefined;
  const serverWorded = code === 'OUT_OF_ORDER' && body?.resubmitAs === 'discard';
  if (key && !serverWorded) return tr(key);
  if (res.status === 403 && !(code && ENGLISH_CODES.has(code))) return tr('animals.err.ownerCanDo');
  const out = await errorFromResponse(res);
  return out === errorFromResponseFallback(res.status)
    ? tr('animallib.err.http', { status: res.status })
    : out;
}

function errorFromResponseFallback(status: number): string {
  return `Something went wrong (HTTP ${status}).`;
}
