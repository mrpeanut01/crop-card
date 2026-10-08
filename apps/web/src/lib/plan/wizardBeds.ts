import { DESIGNABLE_AREA_KINDS } from '$lib/farm/areaKinds';
import { DEFAULT_BED_WIDTH_FT, DEFAULT_MAX_BED_LENGTH_FT } from './bedLayout';

const SQFT_PER_ACRE = 43_560;

export interface BedArea {
  id: string;
  name: string;
  kind: string;
  /** The Area's own size (typed, sketched or drawn); undefined when unknown. */
  acres?: number;
}

export interface BedBlock {
  id?: string;
  name: string;
  fieldId?: string | null;
  widthFt?: number;
  lengthFt?: number;
  acres?: number;
}

/** #693: "Beds for this seed" only makes beds in garden or greenhouse Areas. */
export function bedAreas<A extends BedArea>(areas: readonly A[]): A[] {
  return areas.filter((a) => (DESIGNABLE_AREA_KINDS as readonly string[]).includes(a.kind));
}

/** The bed Area new beds go in: the one picked, else the wizard's Area when
 *  it takes beds, else the first bed Area. None when the farm has no bed Area. */
export function bedTargetArea<A extends BedArea>(
  areas: readonly A[],
  pickedId: string | null,
  preferred: BedArea | null
): A | null {
  const beds = bedAreas(areas);
  return (
    beds.find((a) => a.id === pickedId) ??
    beds.find((a) => a.id === preferred?.id) ??
    beds[0] ??
    null
  );
}

function blockSqFt(b: BedBlock): number {
  if (b.widthFt && b.lengthFt && b.widthFt > 0 && b.lengthFt > 0) return b.widthFt * b.lengthFt;
  return (b.acres ?? 0) * SQFT_PER_ACRE;
}

/** Starting bed width and longest bed: the owner's own beds in the Area
 *  (widest short side, longest long side), else the editable defaults. */
export function startingBedSize(
  blocks: readonly BedBlock[],
  areaId: string | null
): { widthFt: number; maxLengthFt: number; fromBeds: boolean } {
  const sized = blocks.filter(
    (b) => areaId && b.fieldId === areaId && (b.widthFt ?? 0) > 0 && (b.lengthFt ?? 0) > 0
  );
  if (sized.length === 0) {
    return {
      widthFt: DEFAULT_BED_WIDTH_FT,
      maxLengthFt: DEFAULT_MAX_BED_LENGTH_FT,
      fromBeds: false
    };
  }
  let widthFt = 0;
  let maxLengthFt = 0;
  for (const b of sized) {
    widthFt = Math.max(widthFt, Math.min(b.widthFt!, b.lengthFt!));
    maxLengthFt = Math.max(maxLengthFt, Math.max(b.widthFt!, b.lengthFt!));
  }
  return { widthFt, maxLengthFt, fromBeds: true };
}

/** Square feet the Area has left after its beds and blocks, or null when
 *  the Area's own size is not known. Never below zero. */
export function areaFreeSqFt(area: BedArea, blocks: readonly BedBlock[]): number | null {
  if (area.acres == null || !(area.acres > 0)) return null;
  const used = blocks.filter((b) => b.fieldId === area.id).reduce((s, b) => s + blockSqFt(b), 0);
  return Math.max(0, area.acres * SQFT_PER_ACRE - used);
}

/** Whether suggested beds fit in the Area's free space: `fits` is null
 *  when the Area's size is not known. */
export function bedsFit(
  beds: ReadonlyArray<{ widthFt: number; lengthFt: number }>,
  area: BedArea,
  blocks: readonly BedBlock[]
): { needSqFt: number; freeSqFt: number | null; fits: boolean | null } {
  const needSqFt = beds.reduce((s, b) => s + b.widthFt * b.lengthFt, 0);
  const freeSqFt = areaFreeSqFt(area, blocks);
  return { needSqFt, freeSqFt, fits: freeSqFt == null ? null : needSqFt <= freeSqFt + 1e-6 };
}

const BED_NAME = /^bed\s+(\d+)$/i;

/** #707: names for `count` new beds in an Area, continuing that Area's
 *  "Bed N" numbering and never reusing a name already on the farm. */
export function nextBedNames(
  blocks: readonly BedBlock[],
  areaId: string | null,
  count: number
): string[] {
  const taken = new Set(blocks.map((b) => b.name.trim().toLowerCase()));
  let n = 0;
  for (const b of blocks) {
    if (b.fieldId !== areaId) continue;
    const m = BED_NAME.exec(b.name.trim());
    if (m) n = Math.max(n, Number(m[1]));
  }
  const out: string[] = [];
  while (out.length < count) {
    n += 1;
    const name = `Bed ${n}`;
    if (taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}
