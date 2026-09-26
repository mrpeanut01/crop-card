import {
  MAX_FLOW_GPM,
  WATER_SOURCE_TYPES,
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
  source: '' | WaterSourceType;
  flowRate: string;
}

export function draftFromFeature(
  feature?: Pick<MapFeatureView, 'name' | 'fieldId' | 'details'> | null
): FeatureFormDraft {
  return {
    name: feature?.name ?? '',
    fieldId: feature?.fieldId ?? '',
    source: feature?.details?.source ?? '',
    flowRate: feature?.details?.flowRateGpm !== undefined ? String(feature.details.flowRateGpm) : ''
  };
}

export type FeatureFormResult =
  | {
      ok: true;
      body: { name: string; fieldId: string | null; details: MapFeatureDetails | null };
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
  return { ok: true, body: { name, fieldId: draft.fieldId || null, details } };
}
