/** Client-safe Card model shared by the pure builders, the renderer and print. */

export const CARD_KINDS = [
  'planting',
  'area',
  'farmMap',
  'spray',
  'equipment',
  'careGuide',
  'day',
  'stock'
] as const;

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
}

export interface CardProvenance {
  source: ProvenanceSource;
  detail?: string;
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
  stock: 'Seed & stock'
};

export const CARD_KEY_PREFIX: Record<CardKind, string> = {
  planting: 'pl',
  area: 'ar',
  farmMap: 'fm',
  spray: 'sp',
  equipment: 'eq',
  careGuide: 'cg',
  day: 'dy',
  stock: 'st'
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
