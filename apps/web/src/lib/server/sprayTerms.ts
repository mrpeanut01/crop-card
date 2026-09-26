import { sprayProductTerms, type SprayTermSource } from '$lib/journal/photoHelp';
import type { PluginRegistry } from '$lib/plugins';
import type { Plugin } from '$lib/plugins/schemas';
import { getRegistry } from './registry';

const cache = new WeakMap<PluginRegistry, string[]>();

function source(p: Plugin): SprayTermSource | null {
  if (p.type !== 'herbicide' && p.type !== 'insecticide' && p.type !== 'fungicide') return null;
  return {
    displayName: p.displayName,
    activeIngredients: p.activeIngredients.map((ai) => ai.name)
  };
}

/** Brand and active-ingredient terms for every pesticide in a registry view,
 *  for the photo-help spray guard and the offline Care Guide. */
export function sprayTermsFor(registry: PluginRegistry): string[] {
  const hit = cache.get(registry);
  if (hit) return hit;
  const terms = sprayProductTerms(
    registry
      .all()
      .map((r) => source(r.plugin))
      .filter((s): s is SprayTermSource => s !== null)
  );
  cache.set(registry, terms);
  return terms;
}

export async function currentSprayTerms(): Promise<string[]> {
  return sprayTermsFor(await getRegistry());
}
