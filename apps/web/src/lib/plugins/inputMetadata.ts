import {
  FORMULATION_PHYSICAL_STATE,
  type FertilizerPlugin,
  type FungicidePlugin,
  type HerbicidePlugin,
  type InsecticidePlugin,
  type PluginDefaultUnit
} from './schemas';

/**
 * #255 — input-plugin metadata (defaultUnit / activeIngredients /
 * formulation). Pure, shared by the catalog-pick loader fallback, the
 * `pnpm audit:plugin-metadata` script, and the CI coverage test.
 */

export type InputPlugin = HerbicidePlugin | InsecticidePlugin | FungicidePlugin | FertilizerPlugin;
export type InputPluginType = InputPlugin['type'];
export const INPUT_PLUGIN_TYPES: ReadonlyArray<InputPluginType> = [
  'herbicide',
  'insecticide',
  'fungicide',
  'fertilizer'
];

export const METADATA_FIELDS = [
  'defaultUnit',
  'activeIngredients',
  'formulation',
  'epaRegistrationNumber'
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

export type PhysicalState = 'liquid' | 'dry';

export interface ResolvedDefaultUnit {
  unit: PluginDefaultUnit;
  /** `plugin` = authored on the plugin; `derived` = computed from the
   *  plugin's own formulation/form/rate unit; `fallback` = per-category
   *  default with no plugin evidence. */
  basis: 'plugin' | 'derived' | 'fallback';
}

const LIQUID_RATE_UNITS = new Set(['fl-oz', 'pt', 'qt']);

export function isInputPlugin(p: { type: string }): p is InputPlugin {
  return (INPUT_PLUGIN_TYPES as ReadonlyArray<string>).includes(p.type);
}

/** Physical state from authored formulation (pesticides) or `form`
 *  (fertilizers). Null when the plugin carries no formulation evidence. */
export function formulationStateOf(plugin: InputPlugin): PhysicalState | null {
  if (plugin.type === 'fertilizer') return plugin.form === 'liquid' ? 'liquid' : 'dry';
  return plugin.formulation ? FORMULATION_PHYSICAL_STATE[plugin.formulation] : null;
}

/** Physical state implied by the label rate unit. `oz` is ambiguous
 *  (dry ounces vs. mislabelled fl-oz) so it returns null. */
export function rateStateOf(plugin: InputPlugin): PhysicalState | null {
  if (plugin.type === 'fertilizer') {
    const u = plugin.applicationRange?.unit;
    if (!u) return null;
    if (u === 'lb-per-acre' || u === 'ton-per-acre') return 'dry';
    return 'liquid';
  }
  const u = plugin.ratePerAcre?.unit;
  if (!u) return null;
  if (LIQUID_RATE_UNITS.has(u)) return 'liquid';
  if (u === 'lb') return 'dry';
  return null;
}

/** Derived default unit, or null when the plugin's own evidence is
 *  missing or self-contradictory (formulation says dry, rate says liquid). */
export function deriveDefaultUnit(plugin: InputPlugin): PluginDefaultUnit | null {
  const fState = formulationStateOf(plugin);
  const rState = rateStateOf(plugin);
  if (fState && rState && fState !== rState) return null;
  const state = fState ?? rState;
  if (!state) return null;
  if (plugin.type === 'fertilizer') return state === 'liquid' ? 'gal' : 'lb';
  if (state === 'liquid') return 'fl-oz';
  return plugin.ratePerAcre?.unit === 'oz' ? 'oz' : 'lb';
}

export function categoryFallbackUnit(type: InputPluginType): PluginDefaultUnit {
  return type === 'fertilizer' ? 'lb' : 'fl-oz';
}

export function resolvePluginDefaultUnit(plugin: InputPlugin): ResolvedDefaultUnit {
  if (plugin.defaultUnit) return { unit: plugin.defaultUnit, basis: 'plugin' };
  const derived = deriveDefaultUnit(plugin);
  if (derived) return { unit: derived, basis: 'derived' };
  return { unit: categoryFallbackUnit(plugin.type), basis: 'fallback' };
}

/** Authored-coverage gaps. Fertilizers satisfy `activeIngredients` via the
 *  guaranteed `analysis` and `formulation` via `form` — both required by
 *  the fertilizer schema — and are not EPA-registered pesticides, so only
 *  `defaultUnit` can be a fertilizer gap. */
export function metadataGaps(plugin: InputPlugin): MetadataField[] {
  const gaps: MetadataField[] = [];
  if (!plugin.defaultUnit) gaps.push('defaultUnit');
  if (plugin.type !== 'fertilizer') {
    if (!plugin.activeIngredients || plugin.activeIngredients.length === 0)
      gaps.push('activeIngredients');
    if (!plugin.formulation) gaps.push('formulation');
    if (!plugin.epaRegistrationNumber) gaps.push('epaRegistrationNumber');
  }
  return gaps;
}

/** Catalog-pick loader fallback: stamps a plugin-evidenced `defaultUnit`
 *  onto input plugins that lack one. Per-category fallbacks are left off
 *  so the add form applies its own type default and the operator picks. */
export function withResolvedDefaultUnit<P extends { type: string }>(plugin: P): P {
  if (!isInputPlugin(plugin) || plugin.defaultUnit) return plugin;
  const derived = deriveDefaultUnit(plugin);
  return derived ? { ...plugin, defaultUnit: derived } : plugin;
}

export interface AllowlistEntry {
  pluginId: string;
  field: MetadataField;
  reason: string;
}

export interface CoverageReport {
  gaps: Array<{ pluginId: string; type: InputPluginType; field: MetadataField }>;
  unallowlisted: Array<{ pluginId: string; field: MetadataField }>;
  stale: AllowlistEntry[];
}

export function checkCoverage(
  plugins: ReadonlyArray<InputPlugin>,
  allowlist: ReadonlyArray<AllowlistEntry>
): CoverageReport {
  const key = (id: string, f: string) => `${id}::${f}`;
  const allowed = new Set(allowlist.map((e) => key(e.pluginId, e.field)));
  const gaps: CoverageReport['gaps'] = [];
  for (const p of plugins) {
    for (const field of metadataGaps(p)) gaps.push({ pluginId: p.pluginId, type: p.type, field });
  }
  const gapKeys = new Set(gaps.map((g) => key(g.pluginId, g.field)));
  return {
    gaps,
    unallowlisted: gaps
      .filter((g) => !allowed.has(key(g.pluginId, g.field)))
      .map(({ pluginId, field }) => ({ pluginId, field })),
    stale: allowlist.filter((e) => !gapKeys.has(key(e.pluginId, e.field)))
  };
}
