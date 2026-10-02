import type { MessageKey, Translator } from '$lib/i18n';
import type { AreaKind, BedStyle, BlockKind } from '$lib/farm/areaKinds';
import type { MapFeatureKind, WaterSourceType } from '$lib/farm/mapFeatures';
import type { ShadeKind } from '$lib/farm/kindStyle';

export const kindLabel = (tr: Translator, k: AreaKind) => tr(`farm.kind.${k}`);
export const kindHint = (tr: Translator, k: AreaKind) => tr(`farm.kindHint.${k}`);
export const kindPlaceholder = (tr: Translator, k: AreaKind) => tr(`farm.kindPh.${k}`);
export const kindPlural = (tr: Translator, k: AreaKind) => tr(`farm.kindPlural.${k}`);
export const blockKindLabel = (tr: Translator, k: BlockKind) => tr(`farm.blockKind.${k}`);
export const bedStyleLabel = (tr: Translator, k: BedStyle) => tr(`farm.bedStyle.${k}`);
export const shadeLabel = (tr: Translator, k: ShadeKind) => tr(`farm.shade.${k}`);
export const featureLabel = (tr: Translator, k: MapFeatureKind) => tr(`farm.feat.${k}`);
export const featurePlural = (tr: Translator, k: MapFeatureKind) => tr(`farm.featPlural.${k}`);
export const featureHint = (tr: Translator, k: MapFeatureKind) => tr(`farm.featHint.${k}`);
export const featurePlaceholder = (tr: Translator, k: MapFeatureKind) => tr(`farm.featPh.${k}`);
export const waterSourceLabel = (tr: Translator, k: WaterSourceType) => tr(`farm.water.${k}`);

const DETAIL_LABEL: Record<string, MessageKey> = {
  organicStatus: 'farm.df.organicStatus',
  transitionDate: 'farm.df.transitionDate',
  irrigation: 'farm.df.irrigation',
  structure: 'farm.df.structure',
  heated: 'farm.df.heated',
  supplementalLight: 'farm.df.supplementalLight',
  rowSpacingFt: 'farm.df.rowSpacingFt',
  treeSpacingFt: 'farm.df.treeSpacingFt',
  use: 'farm.df.use',
  washPack: 'farm.df.washPack',
  coldStorage: 'farm.df.coldStorage',
  chemicalStorage: 'farm.df.chemicalStorage',
  speciesId: 'farm.df.speciesId',
  space: 'farm.df.space',
  shelterSqFt: 'farm.df.shelterSqFt',
  runSqFt: 'farm.df.runSqFt',
  capacity: 'farm.df.capacity',
  capacityProvenance: 'farm.df.capacityProvenance',
  usedForIrrigation: 'farm.df.usedForIrrigation'
};

const DETAIL_OPTION: Record<string, MessageKey> = {
  'organicStatus.non-organic': 'farm.dfo.organicStatus.non-organic',
  'organicStatus.transitional': 'farm.dfo.organicStatus.transitional',
  'organicStatus.organic': 'farm.dfo.organicStatus.organic',
  'irrigation.none': 'farm.dfo.irrigation.none',
  'irrigation.hose': 'farm.dfo.irrigation.hose',
  'irrigation.drip': 'farm.dfo.irrigation.drip',
  'irrigation.sprinkler': 'farm.dfo.irrigation.sprinkler',
  'structure.glass': 'farm.dfo.structure.glass',
  'structure.poly': 'farm.dfo.structure.poly',
  'structure.high-tunnel': 'farm.dfo.structure.high-tunnel',
  'structure.caterpillar': 'farm.dfo.structure.caterpillar',
  'space.indoor': 'farm.dfo.space.indoor',
  'space.outdoor': 'farm.dfo.space.outdoor',
  'space.both': 'farm.dfo.space.both',
  'use.hay': 'farm.dfo.use.hay',
  'use.graze': 'farm.dfo.use.graze',
  'use.both': 'farm.dfo.use.both',
  'capacityProvenance.data': 'farm.dfo.capacityProvenance.data',
  'capacityProvenance.manual': 'farm.dfo.capacityProvenance.manual'
};

export const detailLabel = (tr: Translator, key: string, fallback: string) =>
  DETAIL_LABEL[key] ? tr(DETAIL_LABEL[key]) : fallback;
export const detailOption = (tr: Translator, key: string, value: string, fallback: string) => {
  const id = DETAIL_OPTION[`${key}.${value}`];
  return id ? tr(id) : fallback;
};
