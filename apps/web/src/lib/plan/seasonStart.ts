export interface SeasonStartBlock {
  id: string;
  name: string;
  blockLabel?: string;
  plantings: Array<{ varietyDisplayName: string; plantingDate: number | null }>;
}

export interface PriorSeasonBlock {
  blockId: string;
  blockName: string;
  crops: string[];
}

export interface PriorSeasonSummary {
  year: number;
  blocks: PriorSeasonBlock[];
}

function yearOf(ms: number): number {
  return new Date(ms).getFullYear();
}

/**
 * True when nothing has been planned for `year` yet: no blocks, or no
 * planting dated in `year` or later and no undated (planned) planting.
 * Prior-year history alone does not count as a plan for this season.
 */
export function isEmptySeason(blocks: SeasonStartBlock[], year: number): boolean {
  for (const b of blocks) {
    for (const p of b.plantings) {
      if (p.plantingDate === null || yearOf(p.plantingDate) >= year) return false;
    }
  }
  return true;
}

/** Per-block crop list for `year - 1`, or null when that season has no plantings. */
export function priorSeasonSummary(
  blocks: SeasonStartBlock[],
  year: number
): PriorSeasonSummary | null {
  const prior = year - 1;
  const out: PriorSeasonBlock[] = [];
  for (const b of blocks) {
    const crops: string[] = [];
    for (const p of b.plantings) {
      if (p.plantingDate === null || yearOf(p.plantingDate) !== prior) continue;
      if (!crops.includes(p.varietyDisplayName)) crops.push(p.varietyDisplayName);
    }
    if (crops.length > 0) out.push({ blockId: b.id, blockName: b.blockLabel ?? b.name, crops });
  }
  return out.length > 0 ? { year: prior, blocks: out } : null;
}

/** The planting dates `listCrops({ year })` returns (planted on or after
 *  Jan 1 of `year`, up to and including Jan 1 of the next), read off blocks
 *  already loaded with every planting instead of a second crops query. */
export function plantingsInYear(
  blocks: readonly SeasonStartBlock[],
  year: number
): Array<{ plantingDate: number }> {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const out: Array<{ plantingDate: number }> = [];
  for (const b of blocks)
    for (const p of b.plantings)
      if (p.plantingDate !== null && p.plantingDate >= start && p.plantingDate <= end)
        out.push({ plantingDate: p.plantingDate });
  return out;
}
