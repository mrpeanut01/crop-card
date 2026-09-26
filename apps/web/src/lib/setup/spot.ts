import {
  CROP_AREA_KINDS,
  defaultBlockKindFor,
  type BlockKind,
  type CropAreaKind
} from '$lib/farm/areaKinds';
import type { SetupArea, SetupSpotResult } from './types';

export const NEW_AREA = '__new__';

export interface SpotInput {
  name: string;
  /** An existing Area id, or `NEW_AREA`. */
  areaId: string;
  /** Kind for a new Area; ignored when `areaId` names an existing one. */
  kind: CropAreaKind;
}

export type SpotPlan =
  | {
      ok: true;
      area: { id: string } | { create: { name: string; kind: CropAreaKind } };
      block: { name: string; kind: BlockKind };
    }
  | { ok: false; error: string };

export function planSpot(input: SpotInput, areas: readonly SetupArea[]): SpotPlan {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Give it a name first.' };
  if (name.length > 120) return { ok: false, error: 'That name is too long (120 characters max).' };
  if (input.areaId === NEW_AREA) {
    if (!(CROP_AREA_KINDS as readonly string[]).includes(input.kind)) {
      return { ok: false, error: 'Pick what kind of place it is.' };
    }
    return {
      ok: true,
      area: { create: { name, kind: input.kind } },
      block: { name, kind: defaultBlockKindFor(input.kind) }
    };
  }
  const area = areas.find((a) => a.id === input.areaId);
  if (!area) return { ok: false, error: 'That Area is no longer on the farm. Pick another.' };
  return {
    ok: true,
    area: { id: area.id },
    block: { name, kind: defaultBlockKindFor(area.kind) }
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
    body: JSON.stringify({ name: plan.block.name, fieldId: areaId, kind: plan.block.kind })
  });
  if (!res.ok) return { ok: false, error: await errorText(res) };
  const { block } = (await res.json()) as { block: { id: string; name: string } };
  return { ok: true, result: { blockId: block.id, blockName: block.name, areaId } };
}
