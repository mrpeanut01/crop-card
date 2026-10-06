/**
 * #475: suggest beds for the seed being planted. The plain plan packs each
 * crop in rows across a bed at its plugin spacing, keeps a family together
 * and starts a new bed when one reaches the owner's longest bed. Claude may
 * propose a different grouping (server side, through aiTry), and every bed
 * it proposes is checked against the same spacing before it is shown.
 *
 * Bed width and the longest bed are the owner's choice; the defaults below
 * are only a starting point shown in editable fields, not agronomy.
 */

export const DEFAULT_BED_WIDTH_FT = 4;
export const DEFAULT_MAX_BED_LENGTH_FT = 25;
export const MAX_SUGGESTED_BEDS = 20;
export const BED_WIDTH_LIMITS = { min: 1, max: 30 } as const;
export const BED_LENGTH_LIMITS = { min: 1, max: 300 } as const;

export interface BedLayoutCrop {
  /** The seed lot (stock item) this crop comes from. */
  key: string;
  name: string;
  family: string | null;
  /** Plants, or square feet for a crop sown by area (`byArea`). */
  plants: number;
  inRowIn: number;
  rowIn: number;
  /** #555: drilled or broadcast across the bed; no rows, no plant count. */
  byArea?: boolean;
}

export interface SuggestedBedCrop {
  key: string;
  name: string;
  /** Plants, or the same square feet as `areaSqFt` for a crop sown by area. */
  plants: number;
  /** 0 for a crop sown by area. */
  rows: number;
  lengthFt: number;
  /** #555: set for a crop sown by area; it then has no plant count. */
  areaSqFt?: number;
}

export interface SuggestedBed {
  widthFt: number;
  lengthFt: number;
  crops: SuggestedBedCrop[];
}

export interface BedLayoutOptions {
  bedWidthFt: number;
  maxBedLengthFt: number;
}

/** Rows that fit across a bed of this width, at least one. */
export function rowsAcross(widthFt: number, rowIn: number): number {
  if (!(rowIn > 0)) return 1;
  return Math.max(1, Math.floor((widthFt * 12) / rowIn + 1e-9));
}

/** Feet of bed this many plants take in a bed of this width. */
export function lengthNeededFt(
  crop: Pick<BedLayoutCrop, 'inRowIn' | 'rowIn' | 'byArea'>,
  plants: number,
  widthFt: number
): number {
  if (plants <= 0) return 0;
  if (crop.byArea) return Math.ceil(plants / Math.max(widthFt, 0.1) - 1e-9);
  const perFt = (rowsAcross(widthFt, crop.rowIn) * 12) / Math.max(crop.inRowIn, 0.1);
  return Math.ceil(plants / perFt - 1e-9);
}

/** The narrowest bed a crop fits in: the owner's width, or one row wide
 *  when a single row is wider than that. */
export function widthFor(
  crop: Pick<BedLayoutCrop, 'rowIn' | 'byArea'>,
  bedWidthFt: number
): number {
  if (crop.byArea) return bedWidthFt;
  return Math.max(bedWidthFt, Math.ceil(crop.rowIn / 12 - 1e-9));
}

function segment(crop: BedLayoutCrop, plants: number, widthFt: number): SuggestedBedCrop {
  if (crop.byArea) {
    return {
      key: crop.key,
      name: crop.name,
      plants,
      rows: 0,
      lengthFt: lengthNeededFt(crop, plants, widthFt),
      areaSqFt: plants
    };
  }
  return {
    key: crop.key,
    name: crop.name,
    plants,
    rows: rowsAcross(widthFt, crop.rowIn),
    lengthFt: lengthNeededFt(crop, plants, widthFt)
  };
}

/** Feet one plant of this crop takes in a bed of this width. A bed may run
 *  past the owner's longest bed only by this much, and only when a single
 *  plant needs more than the longest bed. */
function onePlantFt(crop: BedLayoutCrop, widthFt: number): number {
  return lengthNeededFt(crop, 1, widthFt);
}

export interface BedPlan {
  beds: SuggestedBed[];
  /** Plants (square feet when `byArea`) that did not fit in the first
   *  MAX_SUGGESTED_BEDS beds. */
  unplaced: Array<{ key: string; name: string; plants: number; byArea?: true }>;
}

export function planBeds(crops: readonly BedLayoutCrop[], opts: BedLayoutOptions): BedPlan {
  const maxLen = Math.max(1, Math.floor(opts.maxBedLengthFt));
  const ordered = [...crops]
    .filter((c) => c.plants > 0)
    .sort(
      (a, b) =>
        (a.family ?? '~').localeCompare(b.family ?? '~') ||
        a.name.localeCompare(b.name) ||
        a.key.localeCompare(b.key)
    );
  const beds: SuggestedBed[] = [];
  const open = new Map<number, SuggestedBed>();
  for (const crop of ordered) {
    const width = widthFor(crop, opts.bedWidthFt);
    const perFt = crop.byArea
      ? width
      : (rowsAcross(width, crop.rowIn) * 12) / Math.max(crop.inRowIn, 0.1);
    let left = crop.plants;
    while (left > 0) {
      let bed = open.get(width);
      let fits = bed ? Math.floor(perFt * (maxLen - bed.lengthFt) + 1e-9) : 0;
      if (!bed || fits < 1) {
        bed = { widthFt: width, lengthFt: 0, crops: [] };
        beds.push(bed);
        open.set(width, bed);
        fits = Math.max(1, Math.floor(perFt * Math.max(maxLen, onePlantFt(crop, width)) + 1e-9));
      }
      const plants = Math.min(left, fits);
      const seg = segment(crop, plants, width);
      bed.crops.push(seg);
      bed.lengthFt += seg.lengthFt;
      left -= plants;
    }
  }
  const kept = beds.slice(0, MAX_SUGGESTED_BEDS);
  const placed = new Map<string, number>();
  for (const b of kept)
    for (const c of b.crops) placed.set(c.key, (placed.get(c.key) ?? 0) + c.plants);
  const unplaced = ordered
    .map((c) => ({
      key: c.key,
      name: c.name,
      plants: c.plants - (placed.get(c.key) ?? 0),
      ...(c.byArea ? { byArea: true as const } : {})
    }))
    .filter((u) => u.plants > 0);
  return { beds: kept, unplaced };
}

export function deterministicBedLayout(
  crops: readonly BedLayoutCrop[],
  opts: BedLayoutOptions
): SuggestedBed[] {
  return planBeds(crops, opts).beds;
}

export type BedCheck = { ok: true; beds: SuggestedBed[] } | { ok: false; reason: string };

/** Checks a proposal against the seed and the spacing, and rewrites each
 *  crop's rows and length from the spacing so nothing Claude says about
 *  rows reaches the owner unchecked. Every crop must be placed in full,
 *  and no bed may be wider or longer than the owner asked for (a bed is as
 *  wide as its widest row needs, and as long as one plant needs, at most). */
export function checkBedProposal(
  proposal: ReadonlyArray<{
    widthFt: number;
    lengthFt: number;
    crops: ReadonlyArray<{ key: string; plants?: number; areaSqFt?: number }>;
  }>,
  crops: readonly BedLayoutCrop[],
  opts: BedLayoutOptions
): BedCheck {
  const maxLen = Math.max(1, Math.ceil(opts.maxBedLengthFt - 1e-9));
  if (proposal.length === 0) return { ok: false, reason: 'no beds' };
  if (proposal.length > MAX_SUGGESTED_BEDS) return { ok: false, reason: 'too many beds' };
  const byKey = new Map(crops.map((c) => [c.key, c]));
  const placed = new Map<string, number>();
  const beds: SuggestedBed[] = [];
  for (const p of proposal) {
    const widthFt = Math.round(p.widthFt * 2) / 2;
    const lengthFt = Math.ceil(p.lengthFt - 1e-9);
    if (
      !(widthFt >= BED_WIDTH_LIMITS.min && widthFt <= BED_WIDTH_LIMITS.max) ||
      !(lengthFt >= BED_LENGTH_LIMITS.min && lengthFt <= BED_LENGTH_LIMITS.max)
    ) {
      return { ok: false, reason: 'bed size out of range' };
    }
    if (p.crops.length === 0) return { ok: false, reason: 'empty bed' };
    const segs: SuggestedBedCrop[] = [];
    for (const c of p.crops) {
      const crop = byKey.get(c.key);
      if (!crop) return { ok: false, reason: `unknown seed ${c.key}` };
      // #555: a crop sown by area takes square feet, never a plant count.
      if (crop.byArea && c.plants !== undefined)
        return { ok: false, reason: 'plant count for a crop sown by area' };
      const units = crop.byArea ? c.areaSqFt : c.plants;
      if (units === undefined || !Number.isInteger(units) || units <= 0)
        return { ok: false, reason: 'bad count' };
      if (!crop.byArea && crop.rowIn > widthFt * 12 + 1e-9)
        return { ok: false, reason: 'row wider than bed' };
      segs.push(segment(crop, units, widthFt));
      placed.set(c.key, (placed.get(c.key) ?? 0) + units);
    }
    const bedCrops = p.crops.map((c) => byKey.get(c.key)!);
    const widest = Math.max(...bedCrops.map((c) => widthFor(c, opts.bedWidthFt)));
    if (widthFt > Math.round(widest * 2) / 2 + 1e-9)
      return { ok: false, reason: 'bed wider than asked' };
    const longest = Math.max(maxLen, ...bedCrops.map((c) => onePlantFt(c, widthFt)));
    if (lengthFt > longest) return { ok: false, reason: 'bed longer than the longest bed' };
    const used = segs.reduce((s, c) => s + c.lengthFt, 0);
    if (used > lengthFt) return { ok: false, reason: 'crops do not fit the bed' };
    beds.push({ widthFt, lengthFt, crops: segs });
  }
  for (const crop of crops) {
    if (crop.plants <= 0) continue;
    if ((placed.get(crop.key) ?? 0) !== crop.plants) {
      return { ok: false, reason: `${crop.name} is not placed in full` };
    }
  }
  return { ok: true, beds };
}
