import { formatCount } from './coopCapacity';
import {
  CAPACITY_PROVENANCES,
  COOP_SPACE_KINDS,
  GREENHOUSE_STRUCTURES,
  IRRIGATION_KINDS,
  ORGANIC_STATUSES,
  PASTURE_USES,
  validateAreaDetails,
  type AreaDetails,
  type AreaKind,
  type DetailsResult
} from './areaKinds';

type Option = { value: string; label: string };

type OnlyWhen = { key: string; equals: string };

export type DetailField =
  | { key: string; label: string; type: 'select'; options: readonly Option[] }
  | { key: string; label: string; type: 'boolean' }
  | { key: string; label: string; type: 'date'; onlyWhen?: OnlyWhen }
  | { key: string; label: string; type: 'feet' }
  | { key: string; label: string; type: 'count'; unit: string }
  | { key: string; label: string; type: 'species' }
  | { key: string; label: string; type: 'sqft'; onlyWhen?: OnlyWhen }
  | { key: string; label: string; type: 'provenance'; options: readonly string[] };

const ORGANIC_LABELS: Record<(typeof ORGANIC_STATUSES)[number], string> = {
  'non-organic': 'Not organic',
  transitional: 'Transitioning',
  organic: 'Certified organic'
};
const IRRIGATION_LABELS: Record<(typeof IRRIGATION_KINDS)[number], string> = {
  none: 'None',
  hose: 'Hose',
  drip: 'Drip',
  sprinkler: 'Sprinkler'
};
const STRUCTURE_LABELS: Record<(typeof GREENHOUSE_STRUCTURES)[number], string> = {
  glass: 'Glass',
  poly: 'Poly',
  'high-tunnel': 'High tunnel',
  caterpillar: 'Caterpillar tunnel'
};
export const COOP_SPACE_LABELS: Record<(typeof COOP_SPACE_KINDS)[number], string> = {
  indoor: 'Indoor coop or shelter',
  outdoor: 'Outdoor run',
  both: 'Both: a shelter and a run'
};
const PASTURE_LABELS: Record<(typeof PASTURE_USES)[number], string> = {
  hay: 'Hay',
  graze: 'Grazing',
  both: 'Hay and grazing'
};

const opts = <T extends string>(values: readonly T[], labels: Record<T, string>): Option[] =>
  values.map((value) => ({ value, label: labels[value] }));

const organic: DetailField = {
  key: 'organicStatus',
  label: 'Organic status',
  type: 'select',
  options: opts(ORGANIC_STATUSES, ORGANIC_LABELS)
};
const transition: DetailField = {
  key: 'transitionDate',
  label: 'Transition started',
  type: 'date',
  onlyWhen: { key: 'organicStatus', equals: 'transitional' }
};

/** The kind-aware form: what each Area kind asks for beyond name and size. */
export const AREA_DETAIL_FIELDS: Readonly<Record<AreaKind, readonly DetailField[]>> = {
  field: [],
  garden: [
    organic,
    transition,
    {
      key: 'irrigation',
      label: 'Watering',
      type: 'select',
      options: opts(IRRIGATION_KINDS, IRRIGATION_LABELS)
    }
  ],
  greenhouse: [
    {
      key: 'structure',
      label: 'Structure',
      type: 'select',
      options: opts(GREENHOUSE_STRUCTURES, STRUCTURE_LABELS)
    },
    { key: 'heated', label: 'Heated', type: 'boolean' },
    { key: 'supplementalLight', label: 'Grow lights', type: 'boolean' },
    organic
  ],
  orchard: [
    { key: 'rowSpacingFt', label: 'Row spacing', type: 'feet' },
    { key: 'treeSpacingFt', label: 'Tree spacing', type: 'feet' }
  ],
  pasture: [
    { key: 'use', label: 'Used for', type: 'select', options: opts(PASTURE_USES, PASTURE_LABELS) }
  ],
  barn: [
    { key: 'washPack', label: 'Wash and pack', type: 'boolean' },
    { key: 'coldStorage', label: 'Cold storage', type: 'boolean' },
    { key: 'chemicalStorage', label: 'Chemical storage', type: 'boolean' }
  ],
  coop_pen: [
    { key: 'speciesId', label: 'Animal type', type: 'species' },
    {
      key: 'space',
      label: 'Is it indoors, a run, or both?',
      type: 'select',
      options: opts(COOP_SPACE_KINDS, COOP_SPACE_LABELS)
    },
    {
      key: 'shelterSqFt',
      label: 'Shelter floor',
      type: 'sqft',
      onlyWhen: { key: 'space', equals: 'both' }
    },
    { key: 'runSqFt', label: 'Run', type: 'sqft', onlyWhen: { key: 'space', equals: 'both' } },
    { key: 'capacity', label: 'Holds up to', type: 'count', unit: 'animals' },
    {
      key: 'capacityProvenance',
      label: 'Number from',
      type: 'provenance',
      options: CAPACITY_PROVENANCES
    }
  ],
  residence: [],
  natural_area: [],
  water: [{ key: 'usedForIrrigation', label: 'Used for irrigation', type: 'boolean' }],
  boundary: []
};

export type DetailsDraft = Record<string, string | boolean | number | null | undefined>;

export function hasDetailFields(kind: AreaKind): boolean {
  return AREA_DETAIL_FIELDS[kind].length > 0;
}

export function fieldShown(field: DetailField, draft: DetailsDraft): boolean {
  const when = 'onlyWhen' in field ? field.onlyWhen : undefined;
  return !when || draft[when.key] === when.equals;
}

const NUMERIC_TYPES = new Set<DetailField['type']>(['feet', 'count', 'sqft']);

export function draftFromDetails(
  kind: AreaKind,
  details: AreaDetails | null | undefined
): DetailsDraft {
  const src = (details ?? {}) as Record<string, unknown>;
  const draft: DetailsDraft = {};
  for (const f of AREA_DETAIL_FIELDS[kind]) {
    const v = src[f.key];
    if (f.type === 'boolean') draft[f.key] = v === true;
    else if (NUMERIC_TYPES.has(f.type)) draft[f.key] = typeof v === 'number' ? v : null;
    else draft[f.key] = typeof v === 'string' ? v : '';
  }
  return draft;
}

/** Cleans a form draft (blank selects, unchecked boxes, hidden dates) and
 *  validates it against the kind's schema. */
export function detailsFromDraft(kind: AreaKind, draft: DetailsDraft): DetailsResult {
  const out: Record<string, unknown> = {};
  for (const f of AREA_DETAIL_FIELDS[kind]) {
    if (!fieldShown(f, draft)) continue;
    const v = draft[f.key];
    if (f.type === 'boolean') {
      if (v === true) out[f.key] = true;
    } else if (NUMERIC_TYPES.has(f.type)) {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (typeof v === 'string' && v.trim()) {
      out[f.key] = v.trim();
    }
  }
  return validateAreaDetails(kind, out);
}

/** Label/value pairs for showing stored details on a card. */
export interface DetailSummaryRow {
  label: string;
  value: string;
  provenance?: 'data' | 'manual';
}

function humanizeId(id: string): string {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function detailsSummary(
  kind: AreaKind,
  details: AreaDetails | null | undefined,
  speciesNames?: Readonly<Record<string, string>>,
  /** Lower-case plurals by species id, so a coop's capacity reads
   *  "12 chickens" rather than "12 animals". */
  speciesPlurals?: Readonly<Record<string, string>>
): DetailSummaryRow[] {
  if (!details) return [];
  const src = details as Record<string, unknown>;
  const rows: DetailSummaryRow[] = [];
  for (const f of AREA_DETAIL_FIELDS[kind]) {
    const v = src[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === 'provenance') continue;
    if (f.type === 'boolean') rows.push({ label: f.label, value: v ? 'Yes' : 'No' });
    else if (f.type === 'feet' && typeof v === 'number')
      rows.push({ label: f.label, value: `${v} ft` });
    else if (f.type === 'count' && typeof v === 'number') {
      const prov = src[`${f.key}Provenance`];
      const species = typeof src.speciesId === 'string' ? src.speciesId : null;
      const unit = (species && speciesPlurals?.[species]) || f.unit;
      rows.push({
        label: f.label,
        value: `${formatCount(v)} ${unit}`,
        ...(prov === 'data' || prov === 'manual' ? { provenance: prov } : {})
      });
    } else if (f.type === 'sqft' && typeof v === 'number')
      rows.push({ label: f.label, value: `${v} sq ft` });
    else if (f.type === 'species' && typeof v === 'string')
      rows.push({ label: f.label, value: speciesNames?.[v] ?? humanizeId(v) });
    else if (f.type === 'select') {
      const opt = f.options.find((o) => o.value === v);
      rows.push({ label: f.label, value: opt?.label ?? String(v) });
    } else rows.push({ label: f.label, value: String(v) });
  }
  return rows;
}
