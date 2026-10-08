import type { Translator } from '$lib/i18n';

export interface SoilLineValues {
  ph?: number | null;
  organicMatterPct?: number | null;
  nitratePpm?: number | null;
  phosphorusPpm?: number | null;
  potassiumPpm?: number | null;
  unitsBasis?: string | null;
}

const present = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** #703: a soil test history line built only from the values on file. */
export function soilTestLine(t: SoilLineValues, tr: Translator): string {
  const parts: string[] = [];
  if (present(t.ph)) parts.push(tr('fert.soil.ph', { v: t.ph.toFixed(1) }));
  if (present(t.organicMatterPct))
    parts.push(tr('fert.soil.om', { v: t.organicMatterPct.toFixed(1) }));
  const nutrients: string[] = [];
  if (present(t.nitratePpm)) nutrients.push(tr('fert.soil.no3', { v: t.nitratePpm }));
  if (present(t.phosphorusPpm)) nutrients.push(tr('fert.soil.p', { v: t.phosphorusPpm }));
  if (present(t.potassiumPpm)) nutrients.push(tr('fert.soil.k', { v: t.potassiumPpm }));
  if (nutrients.length) {
    const unit = t.unitsBasis === 'lb-per-acre' ? 'lb/A' : 'ppm';
    nutrients[nutrients.length - 1] = `${nutrients[nutrients.length - 1]} ${unit}`;
  }
  const all = [...parts, ...nutrients];
  return all.length ? all.join(', ') : tr('fert.soil.none');
}
