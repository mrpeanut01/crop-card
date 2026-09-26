/** Client-safe Card model shared by the pure builders, the renderer and print. */

export const CARD_KINDS = [
  'planting',
  'area',
  'farmMap',
  'spray',
  'equipment',
  'careGuide',
  'day',
  'stock',
  'task',
  'scout'
] as const;

/** Kinds built only from a saved record, never from the offline snapshot. */
export const RECORD_ONLY_CARD_KINDS: readonly CardKind[] = ['scout'];

export type CardKind = (typeof CARD_KINDS)[number];

export type ProvenanceSource = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

export interface CardFact {
  label: string;
  value: string;
  provenance?: ProvenanceSource;
}

export interface CardAction {
  label: string;
  href: string;
  due?: string;
}

export interface CardSection {
  title: string;
  items: string[];
  /** Safety content (decon, pollinator cautions). Print never clips it. */
  safety?: boolean;
}

export interface CardProvenance {
  source: ProvenanceSource;
  detail?: string;
}

/** One bed on a garden Area's bed map, in the Area's feet grid. `crops`
 *  lists what is in the bed on the card's date. */
export interface CardBedMapBed {
  name: string;
  kind: 'bed' | 'container';
  x: number;
  y: number;
  w: number;
  l: number;
  crops: string[];
}

/** Garden and greenhouse Areas carry a to-scale sketch of their beds. */
export interface CardBedMap {
  widthFt: number;
  lengthFt: number;
  hasNorth: boolean;
  /** Epoch ms of the day `crops` describes. */
  onMs: number;
  beds: CardBedMapBed[];
}

export type CardStatusTone = 'forest' | 'sky' | 'wheat' | 'rust' | 'neutral';

/** A derived status pill beside the title, built with the card and never stored.
 *  `id` is a stable machine value (task cards); others fall back to the label. */
export interface CardStatus {
  id?: string;
  label: string;
  tone: CardStatusTone;
}

export interface CardModel {
  kind: CardKind;
  key: string;
  kicker: string;
  title: string;
  facts: CardFact[];
  next?: CardAction;
  sections: CardSection[];
  /** Epoch ms of the snapshot the card was built from. */
  asOf: number;
  rulesVersion?: string;
  provenance: CardProvenance[];
  href: string;
  /** Lines shown on every variant, printed included (Spray Card cautions). */
  notices?: string[];
  /** After this long past `asOf` the card shows a stale banner. */
  staleAfterMs?: number;
  /** Extra screen links, e.g. "Open designer" on a garden Area. */
  links?: CardAction[];
  bedMap?: CardBedMap;
  status?: CardStatus;
  /** Strip color that matches the item elsewhere on the page (a planting's
   *  swatch on /plan). Defaults to the kind color. */
  accent?: string;
}

export const STALE_NOTICE = 'This card is more than a day old. Refresh it before you rely on it.';

export function isCardStale(card: Pick<CardModel, 'asOf' | 'staleAfterMs'>, now: number): boolean {
  return card.staleAfterMs !== undefined && now - card.asOf > card.staleAfterMs;
}

export type CardVariant = 'screen' | 'compact' | 'print';

export type CardPrintLayout = 'letter-4up' | 'index-3x5' | 'index-4x6';

export const CARD_KIND_LABEL: Record<CardKind, string> = {
  planting: 'Planting',
  area: 'Area',
  farmMap: 'Farm map',
  spray: 'Spray',
  equipment: 'Equipment',
  careGuide: 'Care guide',
  day: 'Day',
  stock: 'Seed & stock',
  task: 'Task',
  scout: 'Scout'
};

export const CARD_KEY_PREFIX: Record<CardKind, string> = {
  planting: 'pl',
  area: 'ar',
  farmMap: 'fm',
  spray: 'sp',
  equipment: 'eq',
  careGuide: 'cg',
  day: 'dy',
  stock: 'st',
  task: 'tk',
  scout: 'sc'
};

const KIND_BY_PREFIX = new Map<string, CardKind>(
  CARD_KINDS.map((k) => [CARD_KEY_PREFIX[k], k] as const)
);

export function isCardKind(value: unknown): value is CardKind {
  return typeof value === 'string' && (CARD_KINDS as readonly string[]).includes(value);
}

export function cardKey(kind: CardKind, id: string): string {
  return `${CARD_KEY_PREFIX[kind]}_${id}`;
}

export function parseCardKey(key: string): { kind: CardKind; id: string } | null {
  const i = key.indexOf('_');
  if (i <= 0 || i === key.length - 1) return null;
  const kind = KIND_BY_PREFIX.get(key.slice(0, i));
  return kind ? { kind, id: key.slice(i + 1) } : null;
}

const RECORD_KEY_PREFIX = 'rc_';
const RECORD_KEY = /^rc_([a-z]+)\.([\s\S]+)$/;

/** Key for a card shown from a saved record. Its printed QR opens the
 *  record itself, which stays the legal source of truth. */
export function recordCardKey(recordKind: string, rowId: string): string {
  return `${RECORD_KEY_PREFIX}${recordKind}.${rowId}`;
}

export function parseRecordCardKey(key: string): { recordKind: string; rowId: string } | null {
  const m = RECORD_KEY.exec(key);
  return m ? { recordKind: m[1], rowId: m[2] } : null;
}

export function recordHref(recordKind: string, rowId: string): string {
  return `/records/${encodeURIComponent(recordKind)}/${encodeURIComponent(rowId)}`;
}

export function cardHref(kind: CardKind, key: string): string {
  return `/cards/${kind}/${encodeURIComponent(key)}`;
}

/** Link printed beside the QR. Null when there is no stable http(s) origin,
 *  in which case the QR is left off. */
export function cardShortUrl(origin: string | null | undefined, key: string): string | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return `${url.origin}/c/${encodeURIComponent(key)}`;
}

export function mergeProvenance(entries: readonly CardProvenance[]): CardProvenance[] {
  const seen = new Set<string>();
  const out: CardProvenance[] = [];
  for (const e of entries) {
    const id = `${e.source}\u0000${e.detail ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}
