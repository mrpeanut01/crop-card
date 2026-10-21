import { sprayProductTerms, type SprayTermSource } from '$lib/journal/photoHelp';
import { markDiagnosisTerms } from '$lib/journal/markGuard';
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

const diagnosisCache = new WeakMap<PluginRegistry, string[]>();

function targetNames(p: Plugin): string[] {
  if (p.type === 'insecticide') {
    return [...(p.targetPests ?? []), ...(p.scoutingThresholds ?? []).map((t) => t.pest)];
  }
  if (p.type === 'fungicide') return [...(p.targetDiseases ?? [])];
  return [];
}

/** Pest and disease names from every pesticide label in a registry view,
 *  for the photo mark diagnosis check (#869, FU869-1). */
export function markDiagnosisTermsFor(registry: PluginRegistry): string[] {
  const hit = diagnosisCache.get(registry);
  if (hit) return hit;
  const terms = markDiagnosisTerms(registry.all().flatMap((r) => targetNames(r.plugin)));
  diagnosisCache.set(registry, terms);
  return terms;
}
