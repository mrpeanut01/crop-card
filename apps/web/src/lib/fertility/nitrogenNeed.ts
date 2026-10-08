import type { NitrogenNeed } from '$lib/plugins/schemas';

/** #739: one crop's N need row on the /fertility budget, lb N per acre. */
export interface NitrogenNeedRow {
  cropPluginId: string;
  cropName: string;
  minLbPerAcre: number;
  maxLbPerAcre: number;
}

/** The sourced parts summed: fall plus spring topdress, or one range. */
export function nitrogenNeedTotal(parts: NitrogenNeed): { min: number; max: number } {
  return parts.reduce((acc, p) => ({ min: acc.min + p.min, max: acc.max + p.max }), {
    min: 0,
    max: 0
  });
}

/** A planting belongs to a budget year when it went in that year, or from
 *  August of the year before (a fall-sown small grain fertilized in the fall
 *  and topdressed in spring). A planting with no date is kept. */
export function inBudgetYear(plantingDate: number | null | undefined, year: number): boolean {
  if (plantingDate == null) return true;
  const from = new Date(year - 1, 7, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime();
  return plantingDate >= from && plantingDate < to;
}

/** One row per crop on the block in the budget year that has a sourced N
 *  need, in planting order. */
export function nitrogenNeedRows(
  plantings: ReadonlyArray<{ cropPluginId: string; plantingDate?: number | null }>,
  year: number,
  lookup: (
    pluginId: string
  ) => { nitrogenNeedLbPerAcre?: NitrogenNeed; name: string } | null | undefined
): NitrogenNeedRow[] {
  const rows: NitrogenNeedRow[] = [];
  const seen = new Set<string>();
  for (const p of plantings) {
    if (seen.has(p.cropPluginId) || !inBudgetYear(p.plantingDate, year)) continue;
    const crop = lookup(p.cropPluginId);
    if (!crop?.nitrogenNeedLbPerAcre) continue;
    seen.add(p.cropPluginId);
    const total = nitrogenNeedTotal(crop.nitrogenNeedLbPerAcre);
    rows.push({
      cropPluginId: p.cropPluginId,
      cropName: crop.name,
      minLbPerAcre: total.min,
      maxLbPerAcre: total.max
    });
  }
  return rows;
}
