import {
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

export type DetailField =
  | { key: string; label: string; type: 'select'; options: readonly Option[] }
  | { key: string; label: string; type: 'boolean' }
  | { key: string; label: string; type: 'date'; onlyWhen?: { key: string; equals: string } }
  | { key: string; label: string; type: 'feet' };

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
  return (
    field.type !== 'date' || !field.onlyWhen || draft[field.onlyWhen.key] === field.onlyWhen.equals
  );
}

export function draftFromDetails(
  kind: AreaKind,
  details: AreaDetails | null | undefined
): DetailsDraft {
  const src = (details ?? {}) as Record<string, unknown>;
  const draft: DetailsDraft = {};
  for (const f of AREA_DETAIL_FIELDS[kind]) {
    const v = src[f.key];
    if (f.type === 'boolean') draft[f.key] = v === true;
    else if (f.type === 'feet') draft[f.key] = typeof v === 'number' ? v : null;
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
    } else if (f.type === 'feet') {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (typeof v === 'string' && v.trim()) {
      out[f.key] = v.trim();
    }
  }
  return validateAreaDetails(kind, out);
}

/** Label/value pairs for showing stored details on a card. */
export function detailsSummary(
  kind: AreaKind,
  details: AreaDetails | null | undefined
): Array<{ label: string; value: string }> {
  if (!details) return [];
  const src = details as Record<string, unknown>;
  const rows: Array<{ label: string; value: string }> = [];
  for (const f of AREA_DETAIL_FIELDS[kind]) {
    const v = src[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === 'boolean') rows.push({ label: f.label, value: v ? 'Yes' : 'No' });
    else if (f.type === 'feet' && typeof v === 'number')
      rows.push({ label: f.label, value: `${v} ft` });
    else if (f.type === 'select') {
      const opt = f.options.find((o) => o.value === v);
      rows.push({ label: f.label, value: opt?.label ?? String(v) });
    } else rows.push({ label: f.label, value: String(v) });
  }
  return rows;
}
