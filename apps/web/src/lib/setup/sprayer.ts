import type { SetupSprayerResult, SprayerTemplateTile } from './types';

interface TemplateLike {
  templateId: string;
  type: string;
  category: string;
  label: string;
  description: string;
  spec?: Record<string, string | number>;
}

/** The starter sprayers as tiles. `defaultGpa` is deliberately left out:
 *  a new sprayer starts uncalibrated and cannot produce a rate until the
 *  owner walks the 1/128-acre calibration. */
export function sprayerTiles(templates: readonly TemplateLike[]): SprayerTemplateTile[] {
  return templates
    .filter((t) => t.type === 'sprayer')
    .map((t) => {
      const spec = { ...(t.spec ?? {}) };
      const tank = spec.tankGal;
      return {
        templateId: t.templateId,
        label: t.label,
        category: t.category,
        description: t.description,
        tankGal: typeof tank === 'number' ? tank : null,
        spec
      };
    });
}

type FetchFn = typeof fetch;

/** Creates the sprayer through the existing `/api/equipment` endpoint. The
 *  template id rides in `spec` so a renamed sprayer still gets its
 *  template's pre/post tasks. */
export async function saveSprayerFromTile(
  tile: SprayerTemplateTile,
  name: string,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true; result: SetupSprayerResult } | { ok: false; error: string }> {
  const label = name.trim() || tile.label;
  if (label.length > 120)
    return { ok: false, error: 'That name is too long (120 characters max).' };
  const res = await fetchFn('/api/equipment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'sprayer',
      label,
      spec: { ...tile.spec, templateId: tile.templateId }
    })
  });
  if (!res.ok) {
    if (res.status === 403) return { ok: false, error: 'Only the farm owner can add a sprayer.' };
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `Something went wrong (HTTP ${res.status}).` };
  }
  const { equipment } = (await res.json()) as { equipment: { id: string; label: string } };
  return {
    ok: true,
    result: { sprayerId: equipment.id, label: equipment.label, calibratedGpa: null }
  };
}
