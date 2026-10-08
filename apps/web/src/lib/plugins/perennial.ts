import { isPerennialFamily } from './familyDefaults';
import { resolveArchetype, type Archetype, type HarvestStyle } from './schemas';

const PERENNIAL_ARCHETYPES: ReadonlySet<string> = new Set([
  'tree-fruit-multi-pick',
  'perennial-vine-quality'
]);

/** The slice of a crop plugin `isPerennialCrop` reads. */
export interface PerennialCropSlice {
  cropFamily?: string;
  archetype?: string;
  harvestStyle?: string;
  agronomy?: { lifecycle?: string };
}

/** A crop that stays in the ground for years: a perennial lifecycle (the
 *  plugin's, else its family's, as `resolveCropAgronomy` reads it) or a
 *  tree or vine fruit archetype. Its days to maturity count years to a
 *  first crop, not one season. */
export function isPerennialCrop(plugin: PerennialCropSlice): boolean {
  const lifecycle =
    plugin.agronomy?.lifecycle ??
    (isPerennialFamily(plugin.cropFamily ?? '') ? 'perennial' : 'annual');
  if (lifecycle === 'perennial') return true;
  return PERENNIAL_ARCHETYPES.has(
    resolveArchetype({
      archetype: plugin.archetype as Archetype | undefined,
      harvestStyle: plugin.harvestStyle as HarvestStyle | undefined,
      cropFamily: plugin.cropFamily
    })
  );
}
