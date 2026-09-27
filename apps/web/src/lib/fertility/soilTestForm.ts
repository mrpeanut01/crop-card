import { soilTestCreateSchema, type SoilTestCreate } from './apiSchemas';
import type { ExtractionMethod, LabRating, RatedNutrient, UnitsBasis } from './soilInterpret';

export interface SoilTestPlace {
  id: string;
  name: string;
}

export interface SetupSoilTestResult {
  soilTestId: string;
  blockId: string;
}

export interface SoilTestFormValues {
  blockId: string;
  /** `YYYY-MM-DD` from the date input. */
  sampledOn: string;
  lab: string;
  extractionMethod: ExtractionMethod | '';
  unitsBasis: UnitsBasis;
  ph: number | null;
  bufferPh: number | null;
  organicMatterPct: number | null;
  nutrients: Record<RatedNutrient, number | null>;
  ratings: Record<RatedNutrient, LabRating | ''>;
}

const NUTRIENT_FIELD: Record<RatedNutrient, 'phosphorusPpm' | 'potassiumPpm' | 'caPpm' | 'mgPpm'> =
  {
    p: 'phosphorusPpm',
    k: 'potassiumPpm',
    ca: 'caPpm',
    mg: 'mgPpm'
  };

function num(v: number | null | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Noon local time on the sampled day, so the date reads the same in every
 *  nearby time zone. */
export function sampledOnToMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

export type SoilTestFormResult = { ok: true; body: SoilTestCreate } | { ok: false; error: string };

export function buildSoilTestBody(v: SoilTestFormValues, now = Date.now()): SoilTestFormResult {
  if (!v.blockId) return { ok: false, error: 'Pick the bed or block this sample came from.' };
  const sampledAt = sampledOnToMs(v.sampledOn);
  if (sampledAt === null) return { ok: false, error: 'Enter the date the sample was taken.' };
  if (sampledAt > now + 86_400_000) {
    return { ok: false, error: 'The sample date is in the future.' };
  }
  const body: Record<string, unknown> = {
    blockId: v.blockId,
    sampledAt,
    unitsBasis: v.unitsBasis
  };
  const lab = v.lab.trim();
  if (lab) body.lab = lab;
  if (v.extractionMethod) body.extractionMethod = v.extractionMethod;
  if (num(v.ph) !== undefined) body.ph = v.ph;
  if (num(v.bufferPh) !== undefined) body.bufferPh = v.bufferPh;
  if (num(v.organicMatterPct) !== undefined) body.organicMatterPct = v.organicMatterPct;
  const ratings: Partial<Record<RatedNutrient, LabRating>> = {};
  for (const n of Object.keys(NUTRIENT_FIELD) as RatedNutrient[]) {
    const value = num(v.nutrients[n]);
    if (value !== undefined) body[NUTRIENT_FIELD[n]] = value;
    if (v.ratings[n]) ratings[n] = v.ratings[n] as LabRating;
  }
  if (Object.keys(ratings).length) body.labRatings = ratings;

  const hasReading =
    body.ph !== undefined ||
    body.organicMatterPct !== undefined ||
    Object.values(NUTRIENT_FIELD).some((f) => body[f] !== undefined);
  if (!hasReading) {
    return { ok: false, error: 'Enter at least one number from the report, such as pH.' };
  }
  const parsed = soilTestCreateSchema.safeParse(body);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    if (path === 'ph' || path === 'bufferPh') {
      return { ok: false, error: 'pH is a number between 0 and 14.' };
    }
    if (path === 'organicMatterPct') {
      return { ok: false, error: 'Organic matter is a percent between 0 and 100.' };
    }
    return { ok: false, error: 'Check the numbers. None of them can be negative.' };
  }
  return { ok: true, body: parsed.data };
}
