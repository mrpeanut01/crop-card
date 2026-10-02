/** Client-safe wording and small conversions for the animal pages. */

import { AREA_KIND_LABELS, isAreaKind } from '$lib/farm/areaKinds';
import type { SpeciesTile } from '$lib/plugins/species';
import { isHousingAreaKind, type AnimalStatus, type StatusEventStatus } from './model';
import { t, type MessageKey } from '$lib/i18n';

export const STATUS_LABEL: Record<AnimalStatus | 'sold-for-meat', string> = {
  active: 'Here',
  sold: 'Sold',
  died: 'Died',
  culled: 'Culled',
  rehomed: 'Rehomed',
  slaughtered: 'Slaughtered',
  'sold-for-meat': 'Sold for meat',
  archived: 'Archived'
};

/** Choices on the "Record a change" form, in the order a person looks for
 *  them. `active` is offered separately as "Still here" on a gone animal. */
export const OUTCOME_CHOICES: { value: Exclude<StatusEventStatus, 'active'>; label: string }[] = [
  { value: 'died', label: 'Died' },
  { value: 'sold', label: 'Sold' },
  { value: 'rehomed', label: 'Rehomed' },
  { value: 'culled', label: 'Culled' },
  { value: 'slaughtered', label: 'Slaughtered for meat' },
  { value: 'sold-for-meat', label: 'Sold for meat' }
];

/** The choices that declare meat as food; shown only for food animals. */
export const MEAT_CHOICE_VALUES: readonly string[] = ['slaughtered', 'sold-for-meat'];

export function animalLabel(a: { name: string | null; tag: string | null }): string {
  return animalLabelIn(a);
}

/** `animalLabel` in the viewer's language ("Tag 14", "Unnamed"). */
export function animalLabelIn(
  a: { name: string | null; tag: string | null },
  locale?: string | null
): string {
  if (a.name?.trim()) return a.name.trim();
  if (a.tag?.trim()) return t(locale, 'animals.tagLabel', { tag: a.tag.trim() });
  return t(locale, 'animals.unnamed');
}

const DAY = 86_400_000;

/** "3 years", "about 3 years" when the birth date is a guess, "5 months",
 *  "2 weeks". Null without a birth date. */
export function ageText(
  birthMs: number | null,
  estimated: boolean,
  now: number = Date.now(),
  locale?: string | null
): string | null {
  if (birthMs === null || !Number.isFinite(birthMs)) return null;
  const days = Math.floor((now - birthMs) / DAY);
  if (days < 0) return null;
  if (locale) {
    let local: string;
    if (days < 14) local = t(locale, 'animals.age.days', { count: days });
    else if (days < 60) local = t(locale, 'animals.age.weeks', { count: Math.floor(days / 7) });
    else if (days < 730) {
      local = t(locale, 'animals.age.months', { count: Math.floor(days / 30.44) });
    } else local = t(locale, 'animals.age.years', { count: Math.floor(days / 365.25) });
    return estimated ? t(locale, 'animals.age.about', { text: local }) : local;
  }
  let text: string;
  if (days < 14) text = days === 1 ? '1 day' : `${days} days`;
  else if (days < 60) text = `${Math.floor(days / 7)} weeks`;
  else if (days < 730) {
    const months = Math.floor(days / 30.44);
    text = months === 1 ? '1 month' : `${months} months`;
  } else text = `${Math.floor(days / 365.25)} years`;
  return estimated ? `about ${text}` : text;
}

/** An `<input type="date">` value as epoch ms at that UTC day, the way the
 *  app stores date-only values. */
export function dateInputToMs(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

export function msToDateInput(ms: number | null): string {
  if (ms === null) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/** Birth date from an age in years, for "about 3 years old". */
export function birthFromAgeYears(years: number, now: number = Date.now()): number | null {
  if (!Number.isFinite(years) || years < 0 || years > 60) return null;
  const d = new Date(now);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return utc - Math.ceil(years * 365.25) * DAY;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A `<input type="datetime-local">` value in the phone's own time. */
export function msToLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToMs(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5])
  ).getTime();
  return Number.isFinite(d) ? d : null;
}

export interface AreaOption {
  id: string;
  name: string;
  kind: string;
}

export interface SpeciesOption extends SpeciesTile {
  /** One plain line under the food-producing chip. */
  explanation: string;
}

/** What the add form hands back after a save. */
export interface AddedAnimals {
  kind: 'animal' | 'group';
  id: string;
  label: string;
  warnings: { message: string; animalId: string }[];
}

export function addedHref(r: Pick<AddedAnimals, 'kind' | 'id'>): string {
  return r.kind === 'group' ? `/animals/groups/${r.id}` : `/animals/${r.id}`;
}

/** What the housing picker hands back. */
export interface HousingPick {
  areaId: string;
  areaName: string;
  kind: string;
  created: boolean;
}

export function areaKindLabel(kind: string, locale?: string | null): string {
  if (locale && isAreaKind(kind)) return t(locale, `animals.areaKind.${kind}` as MessageKey);
  if (kind === 'coop_pen') return 'Coop or pen';
  return isAreaKind(kind) ? AREA_KIND_LABELS[kind] : kind;
}

/** Areas animals can live on, barns, coops and pastures first. */
export function housingOptions<T extends AreaOption>(areas: readonly T[]): T[] {
  const rank = (k: string) => (k === 'barn' || k === 'coop_pen' ? 0 : k === 'pasture' ? 1 : 2);
  return areas
    .filter((a) => isHousingAreaKind(a.kind))
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name));
}

/** Kinds offered when making a new place for animals. The coop kind shows
 *  once it is a known Area kind. */
export function newHousingKinds(
  locale?: string | null
): { kind: string; label: string; hint: string }[] {
  const all = (['coop_pen', 'barn', 'pasture', 'residence'] as const).map((kind) => ({
    kind,
    label: t(locale, `animals.areaKind.${kind}`),
    hint: t(locale, `animallib.housing.${kind}.hint`)
  }));
  return all.filter((k) => isAreaKind(k.kind));
}

/** Plain words for the API's stable refusal codes. */
const CODE_MESSAGES: Record<string, string> = {
  SPECIES_MISMATCH: 'A group holds one kind of animal. Keep the two groups in the same place.',
  NOT_A_HOUSING_AREA: 'Animals cannot live on woods, water or a boundary. Pick another place.',
  ALREADY_THERE: 'They are already there.',
  SAME_TIME: 'Another move is recorded at that exact time. Change the time by a minute.',
  OUT_OF_ORDER: 'A later move is already on record. Record this one after it.',
  COUNT_TOO_HIGH: 'That is more than the unnamed animals in this group.',
  READ_ONLY: 'This animal is no longer here, so only notes and the photo can change.',
  RECORD_LOCKED: 'This change is locked because 48 hours have passed. Record a new change instead.',
  NOT_LATEST: 'Only the latest change can be removed.',
  GROUP_HAS_MEMBERS: 'Move or record the named animals in this group first.',
  ANIMAL_HAS_RECORDS: 'This has records, so it cannot be deleted. Archive it instead.',
  AREA_HAS_ANIMALS: 'Animals live there. Move them before deleting the place.',
  AREA_HAS_GROUP_HISTORY:
    'A group was split or changed here, and that record is kept for food safety. Rename the place instead.',
  UNKNOWN_SUBJECT: 'This animal or group is not on this farm any more.',
  OWNER_ONLY: 'Only the owner can change this.',
  LOG_UNDER_HOLD:
    'This was used or sold while a hold was on. Change it to discarded, or ask the owner to remove it.',
  IN_THE_FUTURE:
    'That date is in the future. Records are for what already happened. Use a task to plan ahead.',
  HOLD_NOT_VOIDABLE: "Holds from a prohibited drug or unknown label can't be shortened."
};

/** Catalog keys for the plain-word refusals above that are not about a
 *  hold, so they read in the viewer's language. */
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

function codeMessage(code: string, locale: string | null | undefined): string | undefined {
  const key = CODE_KEYS[code];
  return locale && key ? t(locale, key) : CODE_MESSAGES[code];
}

/** C-35: refusals whose server copy names the holds and dates involved, so
 *  the form shows it as written. */
const SERVER_WORDED = new Set([
  'HOLD_WOULD_SHORTEN',
  'HOLD_DIFF_STALE',
  'VOID_TOO_LATE',
  'BACKDATE_TOO_FAR',
  'HOLD_ACTIVE'
]);

/** The message to show for a refused request. With a locale, the plain-word
 *  refusals read in that language; hold refusals and anything the server
 *  words itself stay as written. */
export async function errorFromResponse(res: Response, locale?: string | null): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    code?: string;
    resubmitAs?: unknown;
  } | null;
  if (body?.error && body.code && SERVER_WORDED.has(body.code)) return body.error;
  if (body?.error && body.code === 'OUT_OF_ORDER' && body.resubmitAs === 'discard') {
    return body.error;
  }
  if (res.status === 403) {
    return body?.code && CODE_MESSAGES[body.code]
      ? (codeMessage(body.code, locale) ?? CODE_MESSAGES[body.code])
      : t(locale, 'animals.err.ownerCanDo');
  }
  if (body?.code && CODE_MESSAGES[body.code]) {
    return codeMessage(body.code, locale) ?? CODE_MESSAGES[body.code];
  }
  return body?.error ?? t(locale, 'animallib.err.http', { status: res.status });
}

export const OFFLINE_MESSAGE = "We couldn't reach CropCard. Check your signal and try again.";

export function offlineMessage(locale?: string | null): string {
  return t(locale, 'animals.offline');
}

/** "24 chickens", "1 chicken". */
export function countText(
  total: number,
  species: { label: string; displayName: string } | undefined,
  locale?: string | null
): string {
  if (!species) return t(locale, 'animals.count.animal', { count: total });
  const word = total === 1 ? species.displayName : species.label;
  return `${total} ${word.toLowerCase()}`;
}
