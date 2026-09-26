import {
  CROP_AREA_KINDS,
  defaultBlockKindFor,
  type BlockKind,
  type CropAreaKind
} from '$lib/farm/areaKinds';
import type { SetupArea, SetupSpotResult } from './types';

export const NEW_AREA = '__new__';

/** Picker value prefix for "use this whole Area as one spot". */
export const WHOLE_AREA_PREFIX = 'area:';

/** Picker value for "name a new spot". */
export const NEW_SPOT = '__new_spot__';

/** Areas with nothing inside yet, which a picker can offer as one spot. */
export function emptyAreas(areas: readonly SetupArea[]): SetupArea[] {
  return areas.filter((a) => a.blockCount === 0);
}

/** Plants the whole Area as one bed or block named after it. */
export function wholeAreaPlan(area: SetupArea): Extract<SpotPlan, { ok: true }> {
  return {
    ok: true,
    area: { id: area.id },
    block: { name: area.name, kind: defaultBlockKindFor(area.kind) }
  };
}

/** The Area a new spot most likely belongs in: the first one of the kind
 *  asked for, else the only one, else none (so "Somewhere new"). */
export function defaultSpotArea(areas: readonly SetupArea[], kind: CropAreaKind): SetupArea | null {
  return areas.find((a) => a.kind === kind) ?? (areas.length === 1 ? areas[0] : null);
}

/** Placeholder for a spot's name inside an Area of this kind. */
export const SPOT_NAME_PLACEHOLDER: Readonly<Record<CropAreaKind, string>> = {
  field: 'e.g. North half',
  garden: 'e.g. Tomato bed',
  greenhouse: 'e.g. Bench 1',
  orchard: 'e.g. Row 1',
  pasture: 'e.g. Upper paddock'
};

export interface SpotInput {
  name: string;
  /** An existing Area id, or `NEW_AREA`. */
  areaId: string;
  /** Kind for a new Area; ignored when `areaId` names an existing one. */
  kind: CropAreaKind;
  /** Optional size in feet, for totals that need an area. */
  widthFt?: number | null;
  lengthFt?: number | null;
}

export const SQFT_PER_ACRE = 43_560;

export interface SpotSize {
  widthFt: number;
  lengthFt: number;
  acres: number;
}

export type SpotPlan =
  | {
      ok: true;
      area: { id: string } | { create: { name: string; kind: CropAreaKind } };
      block: { name: string; kind: BlockKind; size?: SpotSize };
    }
  | { ok: false; error: string };

function sizeOf(input: SpotInput): SpotSize | null | 'bad' {
  const w = input.widthFt;
  const l = input.lengthFt;
  const blank = (v: number | null | undefined) => v === null || v === undefined || Number.isNaN(v);
  if (blank(w) && blank(l)) return null;
  if (blank(w) || blank(l) || !(w! > 0) || !(l! > 0) || w! > 10_000 || l! > 10_000) return 'bad';
  return {
    widthFt: w!,
    lengthFt: l!,
    acres: (w! * l!) / SQFT_PER_ACRE
  };
}

export function planSpot(input: SpotInput, areas: readonly SetupArea[]): SpotPlan {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Give it a name first.' };
  if (name.length > 120) return { ok: false, error: 'That name is too long (120 characters max).' };
  const size = sizeOf(input);
  if (size === 'bad') {
    return { ok: false, error: 'Give both the width and the length in feet, or leave both blank.' };
  }
  const sized = size ? { size } : {};
  if (input.areaId === NEW_AREA) {
    if (!(CROP_AREA_KINDS as readonly string[]).includes(input.kind)) {
      return { ok: false, error: 'Pick what kind of place it is.' };
    }
    return {
      ok: true,
      area: { create: { name, kind: input.kind } },
      block: { name, kind: defaultBlockKindFor(input.kind), ...sized }
    };
  }
  const area = areas.find((a) => a.id === input.areaId);
  if (!area) return { ok: false, error: 'That Area is no longer on the farm. Pick another.' };
  return {
    ok: true,
    area: { id: area.id },
    block: { name, kind: defaultBlockKindFor(area.kind), ...sized }
  };
}

type FetchFn = typeof fetch;

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (res.status === 403) return 'Only the farm owner can add places.';
  return body?.message ?? body?.error ?? `Something went wrong (HTTP ${res.status}).`;
}

/** Runs a spot plan against the existing `/api/fields` + `/api/blocks`
 *  endpoints, so their owner check and tenant scoping apply. */
export async function saveSpot(
  plan: Extract<SpotPlan, { ok: true }>,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true; result: SetupSpotResult } | { ok: false; error: string }> {
  let areaId: string;
  if ('create' in plan.area) {
    const res = await fetchFn('/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan.area.create)
    });
    if (!res.ok) return { ok: false, error: await errorText(res) };
    const { field } = (await res.json()) as { field: { id: string } };
    areaId = field.id;
  } else {
    areaId = plan.area.id;
  }
  const res = await fetchFn('/api/blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: plan.block.name,
      fieldId: areaId,
      kind: plan.block.kind,
      ...(plan.block.size
        ? {
            widthFt: plan.block.size.widthFt,
            lengthFt: plan.block.size.lengthFt,
            acres: plan.block.size.acres
          }
        : {})
    })
  });
  if (!res.ok) return { ok: false, error: await errorText(res) };
  const { block } = (await res.json()) as { block: { id: string; name: string } };
  return { ok: true, result: { blockId: block.id, blockName: block.name, areaId } };
}
