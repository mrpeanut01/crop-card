import {
  MAX_FLOW_GPM,
  WATER_SOURCE_TYPES,
  servedAreaIds,
  servesManyAreas,
  validateFeatureDetails,
  type MapFeatureDetails,
  type MapFeatureKind,
  type MapFeatureView,
  type WaterSourceType
} from './mapFeatures';

/** The line-and-point form as typed: every field a string, like the inputs. */
export interface FeatureFormDraft {
  name: string;
  fieldId: string;
  /** Hydrants and waterers: every Area it serves (#478). */
  areaIds: string[];
  source: '' | WaterSourceType;
  flowRate: string;
}

export function draftFromFeature(
  feature?: Pick<MapFeatureView, 'name' | 'fieldId' | 'details' | 'areaIds'> | null
): FeatureFormDraft {
  return {
    name: feature?.name ?? '',
    fieldId: feature?.fieldId ?? '',
    areaIds: feature ? servedAreaIds(feature) : [],
    source: feature?.details?.source ?? '',
    flowRate: feature?.details?.flowRateGpm !== undefined ? String(feature.details.flowRateGpm) : ''
  };
}

export interface FeatureBody {
  name: string;
  fieldId: string | null;
  details: MapFeatureDetails | null;
  /** Sent for hydrants and waterers only. */
  areaIds?: string[];
}

export type FeatureFormResult =
  | {
      ok: true;
      body: FeatureBody;
    }
  | { ok: false; message: string };

/** Turns the typed form into the API body, or says what to fix. */
export function bodyFromDraft(kind: MapFeatureKind, draft: FeatureFormDraft): FeatureFormResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, message: 'Give it a name first.' };
  let details: MapFeatureDetails | null = null;
  if (kind === 'water_source') {
    const raw: MapFeatureDetails = {};
    if (draft.source) {
      if (!(WATER_SOURCE_TYPES as readonly string[]).includes(draft.source)) {
        return { ok: false, message: 'Pick where the water comes from.' };
      }
      raw.source = draft.source;
    }
    const flow = draft.flowRate.trim();
    if (flow) {
      const n = Number(flow);
      if (!Number.isFinite(n) || n <= 0 || n > MAX_FLOW_GPM) {
        return {
          ok: false,
          message: `Flow rate should be a number above 0 and up to ${MAX_FLOW_GPM.toLocaleString('en-US')}.`
        };
      }
      raw.flowRateGpm = n;
    }
    const checked = validateFeatureDetails(kind, raw);
    if (!checked.ok) return { ok: false, message: 'Check the water details and try again.' };
    details = checked.details;
  }
  if (servesManyAreas(kind)) {
    const areaIds = [...new Set(draft.areaIds.filter(Boolean))];
    return { ok: true, body: { name, fieldId: areaIds[0] ?? null, details, areaIds } };
  }
  return { ok: true, body: { name, fieldId: draft.fieldId || null, details } };
}
