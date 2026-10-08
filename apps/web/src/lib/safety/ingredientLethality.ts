/**
 * #768: per-active-ingredient additions to the class kill matrix.
 *
 * The kill matrix judges a herbicide by chemistry class. Sulfonylureas as a
 * class are not lethal to grasses, so Chaparral (metsulfuron) keeps its
 * labelled pasture use, but that also let grass-active ingredients such as
 * nicosulfuron (Accent Q) pass on wheat and grass hay. An ingredient listed
 * here adds families to whatever its class kills. It can never remove one,
 * so a verdict can only get stricter.
 *
 * A grass family is added when the label of a plugin carrying the
 * ingredient shows that it controls, injures or must not be followed by a
 * crop of that family, and no plugin label carrying it is registered on a
 * crop of that family. Quotes are in apps/web/scripts/epa-reg-sources.json
 * under `ingredientLethality`.
 *
 * Ruling LF-1: where a label names some crops of a family and rules out or
 * leaves out the rest, the stop is by crop plugin id. `killsCropPlugins`
 * stops the listed plugins whatever family the planting reports, and
 * `labelledOnlyIn` stops every plugin of the named families except the ones
 * the label names, so an unknown or farm-uploaded id in those families is
 * stopped too. Both only add stops, and a trait claim never lifts them.
 */

import type { CropFamily } from './cropFamilyLethality';

export interface IngredientAddition {
  killsFamilies: ReadonlyArray<CropFamily>;
  killsCropPlugins?: Readonly<Record<string, CropFamily>>;
  labelledOnlyIn?: {
    families: ReadonlyArray<CropFamily>;
    cropPluginIds: ReadonlyArray<string>;
  };
  notes: string;
}

export const INGREDIENT_KILL_ADDITIONS: Readonly<Record<string, IngredientAddition>> = {
  nicosulfuron: {
    killsFamilies: ['cereal-grain', 'cover-grass', 'forage-grass'],
    notes:
      'Accent Q is labelled on corn only and lists timothy, ryegrass and volunteer barley, oats, rye, triticale and wheat among the grasses it controls.'
  },
  thiencarbazone: {
    killsFamilies: ['cereal-grain', 'cover-grass', 'forage-grass'],
    notes:
      'Capreno is labelled on field corn; it controls shattercane and volunteer sorghum (Sorghum bicolor, the species of grain sorghum and sudangrass), wild proso millet and wild oat, and wheat may not follow for 4 months or oats and barley for 10.'
  },
  metsulfuron: {
    killsFamilies: ['corn', 'cereal-grain', 'cover-grass'],
    killsCropPlugins: {
      'timothy-climax': 'forage-grass',
      'orchard-grass-potomac': 'forage-grass'
    },
    notes:
      'Chaparral is labelled on pasture, rangeland and grass hay, not on crops: cereals and corn may be planted only one year after treatment, ryegrass may not be overseeded for 4 months, and residue can injure wheat and barley. It may not be used on timothy hay or other cool-season grasses grown for hay.'
  },
  chlorimuron: {
    killsFamilies: ['corn', 'cereal-grain', 'cover-grass', 'forage-grass'],
    notes:
      'Classic is labelled on soybeans; cereal grains and pasture grasses may not follow for 3 months, field corn for 8 to 10 and sorghum for 9 to 15.'
  },
  thifensulfuron: {
    killsFamilies: ['forage-grass'],
    labelledOnlyIn: {
      families: ['cereal-grain', 'cover-grass'],
      cropPluginIds: [
        'wheat-hard-red-spring',
        'wheat-hard-white-winter',
        'wheat-soft-red-winter',
        'barley-grain-thoroughbred',
        'barley-hulless-streaker',
        'oats-grain-jerry',
        'oats-hulless-streaker',
        'oats-cover-spring',
        'triticale-fridge'
      ]
    },
    killsCropPlugins: {
      'broomcorn-mennonite': 'cereal-grain',
      'einkorn-blackbeard': 'cereal-grain',
      'emmer-vernal': 'cereal-grain',
      'foxtail-millet-japanese': 'cereal-grain',
      'pearl-millet-tifleaf': 'cereal-grain',
      'proso-millet-cope': 'cereal-grain',
      'rye-grain-aroostook': 'cereal-grain',
      'sorghum-grain-pioneer': 'cereal-grain',
      'spelt-oberkulmer': 'cereal-grain',
      'teff-grain-tiffany': 'cereal-grain',
      'buckwheat-cover': 'cover-grass',
      'cereal-rye-cover': 'cover-grass',
      'daikon-radish-cover': 'cover-grass',
      'millet-japanese-cover': 'cover-grass',
      'sorghum-sudangrass-cover': 'cover-grass'
    },
    notes:
      'Harmony SG is labelled over the crop on wheat (including durum), barley, oats, triticale, field corn and soybeans; its label says tank residue may damage crops other than those, and it carries no pasture or hay use.'
  }
} as const;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** The ingredient keys an active-ingredient name matches. A name that
 *  contains a key ("Nicosulfuron 75%") matches it. */
export function ingredientKeysOf(name: string): string[] {
  const n = normalize(name);
  return Object.keys(INGREDIENT_KILL_ADDITIONS).filter((k) => n.includes(k));
}

export function ingredientKillsFamily(name: string, family: CropFamily): boolean {
  return ingredientKeysOf(name).some((k) =>
    INGREDIENT_KILL_ADDITIONS[k].killsFamilies.includes(family)
  );
}

function listedFamily(row: IngredientAddition, cropPluginId: string): CropFamily | null {
  const list = row.killsCropPlugins;
  if (!list || !Object.prototype.hasOwnProperty.call(list, cropPluginId)) return null;
  return list[cropPluginId];
}

/** Ruling LF-1: the family to report when an ingredient's label rules out
 *  this crop plugin by id, or null when no per-plugin stop applies. The
 *  planting's own family is reported when it has one. */
export function ingredientStopsCropPlugin(
  name: string,
  cropPluginId: string,
  family?: CropFamily
): CropFamily | null {
  for (const k of ingredientKeysOf(name)) {
    const row = INGREDIENT_KILL_ADDITIONS[k];
    const listed = listedFamily(row, cropPluginId);
    if (listed) return family ?? listed;
    const only = row.labelledOnlyIn;
    if (
      only &&
      family &&
      only.families.includes(family) &&
      !only.cropPluginIds.includes(cropPluginId)
    ) {
      return family;
    }
  }
  return null;
}
