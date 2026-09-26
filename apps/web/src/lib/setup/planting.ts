import type { SetupPlantingResult } from './types';

export interface CropOption {
  pluginId: string;
  displayName: string;
  cropFamily?: string;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Word-prefix match over crop names; names that start with the query
 *  rank first, then alphabetical. */
export function searchCrops(
  catalog: readonly CropOption[],
  query: string,
  limit = 8
): CropOption[] {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(' ');
  const scored: Array<{ c: CropOption; rank: number }> = [];
  for (const c of catalog) {
    const name = norm(c.displayName);
    const words = name.split(' ');
    const matches = terms.every((t) => words.some((w) => w.startsWith(t)));
    if (!matches) continue;
    scored.push({ c, rank: name.startsWith(q) ? 0 : 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.c.displayName.localeCompare(b.c.displayName));
  return scored.slice(0, limit).map((s) => s.c);
}

type FetchFn = typeof fetch;

/** Creates an in-the-ground planting through the existing
 *  `/api/blocks/[id]/plantings` endpoint. No `sourceProvenance` is sent,
 *  which is how that endpoint records a manual entry. */
export async function savePlanting(
  input: { blockId: string; cropPluginId: string; variety?: string; plantingDateMs: number },
  fetchFn: FetchFn = fetch
): Promise<{ ok: true; result: SetupPlantingResult } | { ok: false; error: string }> {
  const variety = input.variety?.trim();
  const res = await fetchFn(`/api/blocks/${encodeURIComponent(input.blockId)}/plantings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cropPluginId: input.cropPluginId,
      plantingDate: input.plantingDateMs,
      ...(variety ? { varietyDisplayName: variety } : {})
    })
  });
  if (!res.ok) {
    if (res.status === 403) return { ok: false, error: 'Only the farm owner can add plantings.' };
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `Something went wrong (HTTP ${res.status}).` };
  }
  const { planting } = (await res.json()) as { planting: { id: string } };
  return {
    ok: true,
    result: { plantingId: planting.id, blockId: input.blockId, cropPluginId: input.cropPluginId }
  };
}
