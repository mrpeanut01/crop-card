import {
  AREA_KINDS,
  AREA_KIND_LABELS,
  CROP_AREA_KINDS,
  OTHER_AREA_KINDS,
  type AreaKind
} from './areaKinds';
import {
  MAP_FEATURE_HINT,
  MAP_FEATURE_KINDS,
  MAP_FEATURE_LABELS,
  MAP_FEATURE_STYLE,
  geometryTypeFor,
  type MapFeatureKind
} from './mapFeatures';

/**
 * Map colors per Area kind, taken from the Almanac palette in
 * `lib/styles/tokens.css`. Leaflet writes these into SVG attributes, where
 * CSS variables don't resolve, so they are literal hex values here and
 * nowhere else.
 */
export interface KindStyle {
  color: string;
  fillOpacity: number;
  dashArray?: string;
  weight: number;
  /** Plain words for the printed legend, where color can't be relied on. */
  colorName: string;
}

export const AREA_KIND_STYLE: Readonly<Record<AreaKind, KindStyle>> = {
  field: { color: '#2c5237', fillOpacity: 0.22, weight: 2, colorName: 'forest green' },
  garden: { color: '#7a8f5a', fillOpacity: 0.3, weight: 2, colorName: 'sage' },
  greenhouse: { color: '#6f8fa8', fillOpacity: 0.3, weight: 2, colorName: 'sky blue' },
  orchard: { color: '#8a5a2c', fillOpacity: 0.22, weight: 2, colorName: 'bark brown' },
  pasture: { color: '#b8893c', fillOpacity: 0.25, weight: 2, colorName: 'wheat gold' },
  barn: { color: '#a64a2a', fillOpacity: 0.3, weight: 2, colorName: 'rust red' },
  residence: { color: '#4a4f46', fillOpacity: 0.25, weight: 2, colorName: 'slate grey' },
  natural_area: {
    color: '#56613f',
    fillOpacity: 0.2,
    weight: 2,
    dashArray: '2 5',
    colorName: 'olive, dotted edge'
  },
  water: { color: '#3a586e', fillOpacity: 0.35, weight: 2, colorName: 'deep blue' },
  boundary: {
    color: '#1a1f1a',
    fillOpacity: 0,
    weight: 3,
    dashArray: '10 6',
    colorName: 'black dashed line'
  }
};

export function kindStyle(kind: AreaKind | null | undefined): KindStyle {
  return AREA_KIND_STYLE[kind ?? 'field'] ?? AREA_KIND_STYLE.field;
}

/** A noun for sentences ("Add a garden"), with its article. */
export const AREA_KIND_NOUN: Readonly<Record<AreaKind, string>> = {
  field: 'a field',
  garden: 'a garden',
  greenhouse: 'a greenhouse',
  orchard: 'an orchard',
  pasture: 'a pasture or hayfield',
  barn: 'a barn',
  residence: 'a house',
  natural_area: 'a patch of woods',
  water: 'a pond',
  boundary: 'a boundary'
};

export const AREA_KIND_PLURAL: Readonly<Record<AreaKind, string>> = {
  field: 'Fields',
  garden: 'Gardens',
  greenhouse: 'Greenhouses',
  orchard: 'Orchards',
  pasture: 'Pastures',
  barn: 'Barns',
  residence: 'Houses',
  natural_area: 'Woods and natural',
  water: 'Ponds and water',
  boundary: 'Boundaries'
};

export const AREA_KIND_HINT: Readonly<Record<AreaKind, string>> = {
  field: 'Row crops, grain, market blocks',
  garden: 'Beds by the house, vegetables, herbs',
  greenhouse: 'Greenhouse or high tunnel',
  orchard: 'Fruit or nut trees in rows',
  pasture: 'Hay or grazing',
  barn: 'Storage, wash and pack',
  residence: 'Where you live',
  natural_area: 'Trees and wild ground',
  water: 'Pond, stream or tank',
  boundary: 'The edge of the property'
};

export const AREA_NAME_PLACEHOLDER: Readonly<Record<AreaKind, string>> = {
  field: 'e.g. Home Field',
  garden: 'e.g. Kitchen Garden',
  greenhouse: 'e.g. High Tunnel',
  orchard: 'e.g. Apple Orchard',
  pasture: 'e.g. Hayfield',
  barn: 'e.g. Bank Barn',
  residence: 'e.g. House',
  natural_area: 'e.g. Back Woods',
  water: 'e.g. Farm Pond',
  boundary: 'e.g. Property line'
};

export const SHADE_KINDS = [
  'tree-row',
  'hedge',
  'fence',
  'tree-grove',
  'tree-single',
  'building',
  'structure',
  'other'
] as const;

export type ShadeKind = (typeof SHADE_KINDS)[number];

export const SHADE_KIND_LABELS: Readonly<Record<ShadeKind, string>> = {
  'tree-row': 'Tree row',
  hedge: 'Hedge',
  fence: 'Fence',
  'tree-grove': 'Grove',
  'tree-single': 'Single tree',
  building: 'Building',
  structure: 'Structure',
  other: 'Other shade'
};

export const SHADE_STYLE = {
  plant: { color: '#15803d', fill: '#86efac' },
  structure: { color: '#92400e', fill: '#fbbf24' }
} as const;

export function shadeStyle(kind: ShadeKind): { color: string; fill: string } {
  return kind === 'building' || kind === 'structure' || kind === 'fence'
    ? SHADE_STYLE.structure
    : SHADE_STYLE.plant;
}

export type AddPick =
  | { type: 'area'; kind: AreaKind }
  | { type: 'shade'; kind: ShadeKind }
  | { type: 'feature'; kind: MapFeatureKind }
  | { type: 'block' };

export interface AddGroup {
  id: 'crop' | 'other' | 'features' | 'shade';
  title: string;
  items: Array<
    | { type: 'area'; kind: AreaKind; label: string; hint: string; color: string }
    | {
        type: 'feature';
        kind: MapFeatureKind;
        label: string;
        hint: string;
        color: string;
        shape: 'line' | 'point';
      }
    | { type: 'shade'; kind: ShadeKind; label: string; color: string }
  >;
}

/** The Add drawer: LiteFarm's grouping, plus lines and points and our shade kinds. */
export const ADD_GROUPS: readonly AddGroup[] = [
  {
    id: 'crop',
    title: 'Crop areas',
    items: CROP_AREA_KINDS.map((kind) => ({
      type: 'area' as const,
      kind,
      label: AREA_KIND_LABELS[kind],
      hint: AREA_KIND_HINT[kind],
      color: AREA_KIND_STYLE[kind].color
    }))
  },
  {
    id: 'other',
    title: 'Other areas',
    items: OTHER_AREA_KINDS.map((kind) => ({
      type: 'area' as const,
      kind,
      label: AREA_KIND_LABELS[kind],
      hint: AREA_KIND_HINT[kind],
      color: AREA_KIND_STYLE[kind].color
    }))
  },
  {
    id: 'features',
    title: 'Lines & points',
    items: MAP_FEATURE_KINDS.map((kind) => ({
      type: 'feature' as const,
      kind,
      label: MAP_FEATURE_LABELS[kind],
      hint: MAP_FEATURE_HINT[kind],
      color: MAP_FEATURE_STYLE[kind].color,
      shape: geometryTypeFor(kind) === 'Point' ? ('point' as const) : ('line' as const)
    }))
  },
  {
    id: 'shade',
    title: 'Shade & structures',
    items: SHADE_KINDS.map((kind) => ({
      type: 'shade' as const,
      kind,
      label: SHADE_KIND_LABELS[kind],
      color: shadeStyle(kind).color
    }))
  }
];

/** Kinds in display order, with how many of each the farm has. */
export function kindCounts(areas: ReadonlyArray<{ kind: AreaKind }>): Map<AreaKind, number> {
  const counts = new Map<AreaKind, number>();
  for (const k of AREA_KINDS) counts.set(k, 0);
  for (const a of areas) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  return counts;
}
