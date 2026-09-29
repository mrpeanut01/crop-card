/**
 * Phase 32D (D4): feed, bedding and animal-health stock. Client-safe and
 * pure. Feed rulings D0-13 and D0-14; medicine rulings D0-15 and D0-17.
 *
 * Per-item extras live in `stock_items.metadata_json` next to any existing
 * keys, under `feed` and `animalHealth`, so no migration is needed.
 */

import type { StockCategory } from '$lib/db/stock';
import type { InventoryType } from '$lib/inventory/types';
import type { StockEntryDraft } from './normalizeStockEntry';
import type { StockUnit } from './units';

export const FEED_CATEGORIES = ['feed', 'bedding'] as const satisfies readonly StockCategory[];
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

export function isFeedCategory(c: string | null | undefined): c is FeedCategory {
  return c === 'feed' || c === 'bedding';
}

/** Units the feed form offers. A bag needs the owner's pounds per bag. */
export const FEED_UNITS: readonly StockUnit[] = ['bag', 'lb', 'kg'];

/** Units the medicine form offers: bottles are read in mL or fl oz, tubs
 *  and boluses by weight or count. */
export const ANIMAL_HEALTH_UNITS: readonly StockUnit[] = [
  'ml',
  'fl-oz',
  'gal',
  'g',
  'oz',
  'lb',
  'count'
];

export const MEDICATED_FEED_MESSAGE =
  'Medicated feed carries a withdrawal; add it as animal-health stock.';

export const MAX_FEED_USE_LB = 5000;

export interface FeedMeta {
  lbPerBag?: number;
  scoopLb?: number;
  /** Always `manual`: the owner typed it. */
  scoopProvenance?: 'manual';
  /** Set only to be refused (D0-14). Never saved. */
  medicated?: boolean;
}

export type ApprovalKind = 'NADA' | 'ANADA';

export interface NadaNumber {
  kind: ApprovalKind;
  number: string;
}

export interface AnimalHealthMeta {
  nada?: NadaNumber & { provenance: 'ai' | 'manual' };
  /** The owner confirmed the library link by hand (D0-15). */
  pluginLink?: 'manual';
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function readStockMeta(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return asObject(JSON.parse(json));
  } catch {
    return {};
  }
}

function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

export function feedMeta(json: string | null | undefined): FeedMeta {
  const raw = asObject(readStockMeta(json).feed);
  const out: FeedMeta = {};
  const lbPerBag = positive(raw.lbPerBag);
  if (lbPerBag !== undefined) out.lbPerBag = lbPerBag;
  const scoopLb = positive(raw.scoopLb);
  if (scoopLb !== undefined) {
    out.scoopLb = scoopLb;
    out.scoopProvenance = 'manual';
  }
  if (raw.medicated === true) out.medicated = true;
  return out;
}

export function animalHealthMeta(json: string | null | undefined): AnimalHealthMeta {
  const raw = asObject(readStockMeta(json).animalHealth);
  const out: AnimalHealthMeta = {};
  const nadaRaw = asObject(raw.nada);
  const nada = normalizeNada(
    typeof nadaRaw.kind === 'string' && typeof nadaRaw.number === 'string'
      ? `${nadaRaw.kind} ${nadaRaw.number}`
      : null
  );
  if (nada) {
    out.nada = { ...nada, provenance: nadaRaw.provenance === 'ai' ? 'ai' : 'manual' };
  }
  if (raw.pluginLink === 'manual') out.pluginLink = 'manual';
  return out;
}

/** Merges one section into the stored metadata, keeping every other key
 *  (seed metadata, planter plates). An empty section is removed. */
export function withMetaSection(
  json: string | null | undefined,
  key: 'feed' | 'animalHealth',
  section: FeedMeta | AnimalHealthMeta
): string | undefined {
  const meta = readStockMeta(json);
  const clean = Object.fromEntries(Object.entries(section).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length > 0) meta[key] = clean;
  else delete meta[key];
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined;
}

// ─── Feed use (D0-12, D0-13) ─────────────────────────────────────────────

const LB_PER_KG = 1 / 0.45359237;

/** Pounds in one of the item's own units, when that unit is a bag. The two
 *  fixed-size bag units are unit definitions, not agronomy numbers. */
export function lbPerBagUnit(unit: string, meta: FeedMeta): number | null {
  if (unit === 'bag') return meta.lbPerBag ?? null;
  if (unit === 'bag-50lb') return 50;
  if (unit === 'bag-25kg') return 25 * LB_PER_KG;
  return null;
}

export type FeedUseAmount =
  | { ok: true; amount: number; unit: StockUnit }
  | { ok: false; code: 'NEEDS_LB_PER_BAG' | 'UNIT_NOT_WEIGHT'; message: string };

/** Converts a use typed in pounds into the item's unit. A bag becomes
 *  hundredths of a bag through the stock ledger's hundredths storage. */
export function feedUseAmount(
  item: { defaultUnit: string; metadataJson?: string | null },
  lb: number
): FeedUseAmount {
  const unit = item.defaultUnit;
  if (unit === 'lb' || unit === 'oz' || unit === 'kg' || unit === 'g') {
    return { ok: true, amount: lb, unit: 'lb' };
  }
  const perBag = lbPerBagUnit(unit, feedMeta(item.metadataJson));
  if (unit === 'bag' && perBag === null) {
    return {
      ok: false,
      code: 'NEEDS_LB_PER_BAG',
      message: 'Set how many pounds are in one bag on the edit page first.'
    };
  }
  if (perBag === null) {
    return {
      ok: false,
      code: 'UNIT_NOT_WEIGHT',
      message: `This item is counted in ${unit}, so pounds cannot be taken off it. Change the count on the edit page.`
    };
  }
  return { ok: true, amount: lb / perBag, unit: unit as StockUnit };
}

/** On-hand pounds for an item counted in bags or a weight, or null. */
export function onHandLb(
  item: { defaultUnit: string; metadataJson?: string | null },
  onHand: number
): number | null {
  const u = item.defaultUnit;
  if (u === 'lb') return onHand;
  if (u === 'oz') return onHand / 16;
  if (u === 'kg') return onHand * LB_PER_KG;
  if (u === 'g') return (onHand / 1000) * LB_PER_KG;
  const perBag = lbPerBagUnit(u, feedMeta(item.metadataJson));
  return perBag === null ? null : onHand * perBag;
}

/** The 1, 2 and 3 scoop chips, in pounds, when the owner set a scoop. */
export function scoopChoices(scoopLb: number | undefined): Array<{ scoops: number; lb: number }> {
  if (!scoopLb || !(scoopLb > 0)) return [];
  return [1, 2, 3].map((scoops) => ({ scoops, lb: Math.round(scoops * scoopLb * 100) / 100 }));
}

export function feedUseNote(subject?: { type: 'animal' | 'group'; id: string } | null): string {
  return subject ? `animal-feed:${subject.type}:${subject.id}` : 'animal-feed';
}

export function parseFeedUseNote(
  note: string | null | undefined
): { type: 'animal' | 'group'; id: string } | null {
  const m = /^animal-feed:(animal|group):(.+)$/.exec(note ?? '');
  return m ? { type: m[1] as 'animal' | 'group', id: m[2] } : null;
}

// ─── NADA numbers and the medicine label scan (D0-15) ───────────────────

const NADA_RE = /^\s*(A?NADA)\s*(?:NO\.?|NUMBER|#)?\s*:?\s*#?\s*(\d{3})\s*[-\s]?\s*(\d{3})\s*$/i;

/** "NADA 141-061", "ANADA #200-420", "nada141061" → { kind, number }. */
export function normalizeNada(raw: string | null | undefined): NadaNumber | null {
  const m = NADA_RE.exec(raw ?? '');
  if (!m) return null;
  return { kind: m[1].toUpperCase() as ApprovalKind, number: `${m[2]}-${m[3]}` };
}

export function formatNada(n: NadaNumber): string {
  return `${n.kind} ${n.number}`;
}

export interface MedLabelScan {
  found: boolean;
  displayName?: string;
  nada?: NadaNumber;
}

/** Reads Claude's reply to the medicine label prompt. Only the product name
 *  and the NADA or ANADA number survive; anything else Claude sent
 *  (withdrawal times, doses, species) is dropped, because withdrawal data
 *  never comes from a scan. */
export function parseMedLabelJson(raw: string): MedLabelScan {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return { found: false };
  let data: Record<string, unknown>;
  try {
    data = asObject(JSON.parse(match[0]));
  } catch {
    return { found: false };
  }
  const name =
    typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 120) : undefined;
  const nada = normalizeNada(typeof data.nada === 'string' ? data.nada : null);
  if (!name) return { found: false, ...(nada ? { nada } : {}) };
  return { found: true, displayName: name, ...(nada ? { nada } : {}) };
}

export interface HealthPluginRef {
  pluginId: string;
  displayName: string;
  approval?: { kind: string; number: string };
}

/** A library product whose approval number is exactly the scanned one, when
 *  exactly one matches. Only a suggestion: the owner confirms the link. */
export function matchHealthPluginByNada(
  nada: NadaNumber | null | undefined,
  plugins: readonly HealthPluginRef[]
): HealthPluginRef | null {
  if (!nada) return null;
  const hits = plugins.filter(
    (p) => p.approval?.kind === nada.kind && p.approval.number === nada.number
  );
  return hits.length === 1 ? hits[0] : null;
}

/** Keeps only what an entry method may prefill for an animal type. A med
 *  draft never carries a library link (the owner confirms any suggestion),
 *  a category, notes or ingredients, only the name, barcode and NADA. */
export function sanitizeAnimalDraft(type: InventoryType, draft: StockEntryDraft): StockEntryDraft {
  if (type !== 'feed' && type !== 'animal-health') return draft;
  const out: StockEntryDraft = { source: draft.source };
  if (draft.displayName) out.displayName = draft.displayName;
  if (draft.shortName) out.shortName = draft.shortName;
  if (draft.barcode) out.barcode = draft.barcode;
  if (type === 'animal-health') {
    if (draft.nada) out.nada = draft.nada;
    if (draft.suggestedHealthPlugin) out.suggestedHealthPlugin = draft.suggestedHealthPlugin;
  }
  return out;
}

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: 'Received',
  adjustment: 'Count changed',
  spill: 'Spilled',
  expiry: 'Expired',
  'animal-feed': 'Fed',
  'animal-treatment': 'Treatment'
};

/** Plain words for a stock history line on the animal detail pages. */
export function movementLabel(reason: string): string {
  return MOVEMENT_LABELS[reason] ?? reason;
}
