/**
 * Cross-pollination data + resolution (Phase 19).
 *
 * Cross-pollination is *species*-level, not family-level: sweet corn crosses
 * with popcorn and dent (all Zea mays), but corn doesn't cross with sorghum.
 * Plugins can declare their own `crossesWith` (other pluginIds or `family:*`
 * tags) and override the default `isolationFeet`; this module fills in
 * sensible defaults for the common offenders and provides the resolver the
 * allocator consumes.
 *
 * Home-scale defaults — meaningfully different from seed-saving production
 * (which wants 660ft+ for corn, 1/2 mile for brassicas). At home scale
 * 250ft is the inflection point where casual gardener can taste/visually
 * detect crossing; beyond that, cross-pollination doesn't change the eating
 * crop.
 */
import type { CropPlugin } from '$lib/plugins/schemas';

/** Family-keyed defaults applied when a plugin omits the optional fields.
 *  Anything not listed here is considered "doesn't cross at a level the
 *  farmer cares about" and produces no advisory. */
export const POLLINATION_DEFAULTS: Record<
  string,
  { isolationFeet: number; staggerDays: number; familyCrossesWithin: boolean }
> = {
  // All Zea mays — sweet, dent, flint, flour, popcorn, ornamental all cross.
  corn: { isolationFeet: 250, staggerDays: 14, familyCrossesWithin: true },
  // Open-pollinated brassicas (kale, collards, cabbage, broccoli, cauliflower,
  // Brussels sprouts) all cross within the species (B. oleracea). F1 hybrid
  // seed used at this farm means cross-pollination only matters for seed
  // saving — but the advisory is still useful flavor info.
  brassica: { isolationFeet: 250, staggerDays: 14, familyCrossesWithin: true },
  // Cucurbits are split across THREE species; same-species cross, cross-species
  // does NOT. C. pepo (zucchini, summer squash, acorn, delicata, most jack-o-
  // lanterns), C. moschata (butternut, Long Island Cheese, Seminole), C. maxima
  // (Hubbard, Cinderella/Rouge Vif, Marina di Chioggia, kabocha, buttercup).
  // We model this via per-plugin `crossesWith` tags rather than a blanket
  // family rule — see pollinatorMetaFor().
  cucurbit: { isolationFeet: 0, staggerDays: 0, familyCrossesWithin: false }
};

/** Cucurbit species — drives `crossesWith` resolution for squash/pumpkin/
 *  zucchini plugins. The plugin file can override with explicit `crossesWith`
 *  but listing species here keeps the data layer narrow. Plugin IDs follow
 *  the existing kebab-case convention in `plugins/crops/`. */
export const CUCURBIT_SPECIES: Record<'pepo' | 'moschata' | 'maxima' | 'argyrosperma' | 'lagenaria', string[]> = {
  pepo: [
    'zucchini-black-beauty',
    'summer-squash-yellow-crookneck',
    'acorn-squash-table-queen',
    'pumpkin-ez-gro-monster',
    'pumpkin-flat-white-boer-ford-standard-treated-harris-seeds',
    'pumpkin-silver-moon-film-coated-treated',
    'pumpkin-grizzly-bear-film-coated-farmore-harris-seeds',
    'pumpkin',
    'fairytale-pumpkin-film-coated-treated-seed',
    'squash-sunshine-standard-treated'
  ],
  moschata: [
    'butternut-squash-waltham',
    'squash-butterkin-film-coated-farmore'
  ],
  maxima: [
    'pumpkin-cinderella-film-coated-treated',
    'pumpkin-jarrahdale-film-coat-treated',
    'pumpkin-rouge-vif-d-etampes-film-coated-treated',
    'squash-marina-de-chioggia-film-coated-treated',
    'squash-queensland-blue-raw-untreated-non-gmo'
  ],
  argyrosperma: [],
  lagenaria: []
};

/** Reverse lookup — pluginId → species. */
export function cucurbitSpeciesOf(pluginId: string): keyof typeof CUCURBIT_SPECIES | null {
  for (const [species, ids] of Object.entries(CUCURBIT_SPECIES) as Array<[
    keyof typeof CUCURBIT_SPECIES,
    string[]
  ]>) {
    if (ids.includes(pluginId)) return species;
  }
  return null;
}

export interface PollinatorMeta {
  /** Explicit `crossesWith` from the plugin merged with species-derived
   *  defaults. Members are pluginIds. */
  crossesWith: string[];
  /** Effective isolation distance in feet (plugin override > family default
   *  > 0). 0 means "doesn't cross at home scale; no advisory." */
  isolationFeet: number;
  /** Effective minimum days between flowering windows when spatial
   *  isolation can't be achieved. */
  staggerDays: number;
  /** Phase 19a default attribution — surfaces in dev logs to explain why
   *  a given pair was flagged. */
  source: 'plugin' | 'family-default' | 'species-default' | 'none';
}

/**
 * Resolve the effective pollination metadata for a single crop plugin. The
 * lookup precedence:
 *   1. Plugin's own `crossesWith` + `isolationFeet` + `isolationStaggerDays`
 *   2. Cucurbit species peer list (when cropFamily='cucurbit')
 *   3. Family default (corn, brassica) — uses `family:<name>` tag expansion
 *      that the candidacy matrix resolves against the seed list at runtime
 *   4. None — empty meta means no advisory
 */
export function pollinatorMetaFor(plugin: CropPlugin): PollinatorMeta {
  if (plugin.crossesWith && plugin.crossesWith.length > 0) {
    const fam = POLLINATION_DEFAULTS[plugin.cropFamily];
    return {
      crossesWith: plugin.crossesWith,
      isolationFeet: plugin.isolationFeet ?? fam?.isolationFeet ?? 250,
      staggerDays: plugin.isolationStaggerDays ?? fam?.staggerDays ?? 14,
      source: 'plugin'
    };
  }
  if (plugin.cropFamily === 'cucurbit') {
    const species = cucurbitSpeciesOf(plugin.pluginId);
    if (species) {
      const peers = CUCURBIT_SPECIES[species].filter((id) => id !== plugin.pluginId);
      return {
        crossesWith: peers,
        isolationFeet: plugin.isolationFeet ?? 250,
        staggerDays: plugin.isolationStaggerDays ?? 14,
        source: 'species-default'
      };
    }
    return { crossesWith: [], isolationFeet: 0, staggerDays: 0, source: 'none' };
  }
  const fam = POLLINATION_DEFAULTS[plugin.cropFamily];
  if (fam?.familyCrossesWithin) {
    return {
      crossesWith: [`family:${plugin.cropFamily}`],
      isolationFeet: plugin.isolationFeet ?? fam.isolationFeet,
      staggerDays: plugin.isolationStaggerDays ?? fam.staggerDays,
      source: 'family-default'
    };
  }
  return { crossesWith: [], isolationFeet: 0, staggerDays: 0, source: 'none' };
}

/** Expand `family:<name>` tags in a plugin's `crossesWith` to the matching
 *  pluginIds drawn from the seed selection. The allocator runs this once
 *  per allocation so the matrix has concrete pluginId pairs. */
export function expandCrossesWith(
  crossesWith: ReadonlyArray<string>,
  pluginById: Record<string, CropPlugin>
): string[] {
  const out = new Set<string>();
  for (const tag of crossesWith) {
    if (tag.startsWith('family:')) {
      const fam = tag.slice('family:'.length);
      for (const [id, plug] of Object.entries(pluginById)) {
        if (plug.cropFamily === fam) out.add(id);
      }
    } else {
      out.add(tag);
    }
  }
  return [...out];
}

/** True when two plugins cross-pollinate per the resolved metadata. The
 *  relation is intentionally NOT symmetric in the data (plugin A can list
 *  plugin B without B listing A); we OR both directions to be safe. */
export function pluginsCross(
  a: CropPlugin,
  b: CropPlugin,
  pluginById: Record<string, CropPlugin>
): boolean {
  if (a.pluginId === b.pluginId) return false;
  const metaA = pollinatorMetaFor(a);
  const metaB = pollinatorMetaFor(b);
  const aPeers = expandCrossesWith(metaA.crossesWith, pluginById);
  const bPeers = expandCrossesWith(metaB.crossesWith, pluginById);
  return aPeers.includes(b.pluginId) || bPeers.includes(a.pluginId);
}

/** Pick the more conservative (larger) isolation requirement when two
 *  plugins disagree. Same for the temporal stagger. */
export function pairRequirement(
  a: CropPlugin,
  b: CropPlugin
): { isolationFeet: number; staggerDays: number } {
  const metaA = pollinatorMetaFor(a);
  const metaB = pollinatorMetaFor(b);
  return {
    isolationFeet: Math.max(metaA.isolationFeet, metaB.isolationFeet),
    staggerDays: Math.max(metaA.staggerDays, metaB.staggerDays)
  };
}
