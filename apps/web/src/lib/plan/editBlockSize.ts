import { sketchAcres } from '$lib/farm/sketch';

export interface BlockSizeInput {
  showDimensions: boolean;
  before: { acres?: number | null; widthFt?: number | null; lengthFt?: number | null };
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
}

const positive = (n: number | null | undefined): n is number => n != null && n > 0;

/** #475: when a block has both a width and a length, those set its area, so
 *  a typed area can never disagree with the size the plan shows. */
export function areaFromDimensions(
  input: Pick<BlockSizeInput, 'showDimensions' | 'widthFt' | 'lengthFt'>
): number | null {
  if (!input.showDimensions) return null;
  return sketchAcres(input.widthFt, input.lengthFt) ?? null;
}

/** The size fields of the Edit block PATCH body. */
export function blockSizePatch(input: BlockSizeInput): Record<string, number | null> {
  const typedAcres = positive(input.acres) ? input.acres : null;
  if (!input.showDimensions) return { acres: typedAcres };
  const hadDims = positive(input.before.widthFt) || positive(input.before.lengthFt);
  if (positive(input.widthFt) && positive(input.lengthFt)) {
    const changed =
      input.widthFt !== (input.before.widthFt ?? null) ||
      input.lengthFt !== (input.before.lengthFt ?? null);
    return changed ? { widthFt: input.widthFt, lengthFt: input.lengthFt } : {};
  }
  const out: Record<string, number | null> = { acres: typedAcres };
  if (hadDims) {
    out.widthFt = positive(input.widthFt) ? input.widthFt : null;
    out.lengthFt = positive(input.lengthFt) ? input.lengthFt : null;
  }
  return out;
}
