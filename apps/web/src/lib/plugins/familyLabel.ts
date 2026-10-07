import { t, type MessageKey } from '$lib/i18n';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';
import type { Archetype, HarvestStyle } from './schemas';

const FAMILY_KEYS: Record<CropFamily, MessageKey> = {
  corn: 'family.corn',
  cucurbit: 'family.cucurbit',
  legume: 'family.legume',
  'broadleaf-companion': 'family.broadleaf-companion',
  orchard: 'family.orchard',
  'cover-grass': 'family.cover-grass',
  'cover-legume': 'family.cover-legume',
  solanaceae: 'family.solanaceae',
  brassica: 'family.brassica',
  allium: 'family.allium',
  'leafy-green': 'family.leafy-green',
  root: 'family.root',
  apiaceae: 'family.apiaceae',
  'small-fruit': 'family.small-fruit',
  bramble: 'family.bramble',
  'vine-fruit': 'family.vine-fruit',
  'stone-fruit': 'family.stone-fruit',
  'cereal-grain': 'family.cereal-grain',
  forage: 'family.forage',
  'forage-grass': 'family.forage-grass',
  'perennial-vegetable': 'family.perennial-vegetable',
  'herb-culinary': 'family.herb-culinary'
};

const ARCHETYPE_KEYS: Record<Archetype, MessageKey> = {
  'small-grain.zadoks': 'archetype.small-grain.zadoks',
  'row-grain.pollination': 'archetype.row-grain.pollination',
  'dry-seed-legume': 'archetype.dry-seed-legume',
  'winter-squash-cure': 'archetype.winter-squash-cure',
  'continuous-harvest-fruit': 'archetype.continuous-harvest-fruit',
  'cut-and-come-again-leafy': 'archetype.cut-and-come-again-leafy',
  'cover-crop.termination': 'archetype.cover-crop.termination',
  'forage-cutting-cycle': 'archetype.forage-cutting-cycle',
  'perennial-vine-quality': 'archetype.perennial-vine-quality',
  'tree-fruit-multi-pick': 'archetype.tree-fruit-multi-pick'
};

const HARVEST_STYLE_KEYS: Record<HarvestStyle, MessageKey> = {
  'single-cut-grain': 'pluginui.harvestStyle.single-cut-grain',
  'row-grain-pollinated': 'pluginui.harvestStyle.row-grain-pollinated',
  'dry-seed-legume': 'pluginui.harvestStyle.dry-seed-legume',
  'cure-then-store': 'pluginui.harvestStyle.cure-then-store',
  'continuous-fruit': 'pluginui.harvestStyle.continuous-fruit',
  'cut-and-come-again': 'pluginui.harvestStyle.cut-and-come-again',
  'cover-crop-termination': 'pluginui.harvestStyle.cover-crop-termination',
  'forage-cutting-cycle': 'pluginui.harvestStyle.forage-cutting-cycle',
  'perennial-vine': 'pluginui.harvestStyle.perennial-vine',
  'tree-fruit-multi-pick': 'pluginui.harvestStyle.tree-fruit-multi-pick',
  'single-event': 'pluginui.harvestStyle.single-event'
};

const KIND_KEYS = {
  crop: 'plugins.type.crop',
  herbicide: 'plugins.type.herbicide',
  insecticide: 'plugins.type.insecticide',
  fungicide: 'plugins.type.fungicide',
  fertilizer: 'plugins.type.fertilizer',
  companion: 'plugins.type.companion'
} as const satisfies Record<string, MessageKey>;

function humanize(code: string): string {
  const words = code.replace(/[-_.]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

function keyFor(table: Record<string, MessageKey>, code: string): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
}

/** Plain name for a crop family code, e.g. "Tomato family" for
 *  `solanaceae`. An unknown code reads as its words; none reads as
 *  "Unclassified". */
export function cropFamilyLabel(family: string | null | undefined, locale?: string | null): string {
  if (!family) return t(locale, 'family.unclassified');
  const key = keyFor(FAMILY_KEYS, family);
  return key ? t(locale, key) : humanize(family);
}

/** Plain name for a crop archetype (Invariant 8), e.g. "Cut and come again". */
export function archetypeLabel(
  archetype: string | null | undefined,
  locale?: string | null
): string {
  if (!archetype) return t(locale, 'archetype.unknown');
  const key = keyFor(ARCHETYPE_KEYS, archetype);
  return key ? t(locale, key) : humanize(archetype);
}

/** Plain name for a legacy `harvestStyle` value. */
export function harvestStyleLabel(
  style: string | null | undefined,
  locale?: string | null
): string {
  if (!style) return t(locale, 'archetype.unknown');
  const key = keyFor(HARVEST_STYLE_KEYS, style);
  return key ? t(locale, key) : humanize(style);
}

/** Lower-case plugin kind name ("crop", "herbicide", ...). */
export function pluginKindLabel(kind: string, locale?: string | null): string {
  const key = keyFor(KIND_KEYS, kind);
  return key ? t(locale, key) : kind;
}
