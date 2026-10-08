export interface PestThreshold {
  pest: string;
  metric: string;
  threshold: number;
  product: string;
}

/** Pest names offered on /scout: the ones the planner's scout reminder
 *  names for the bed's crops first, then every pest an insecticide label
 *  on file sets a threshold for, so a count can match the label exactly. */
export function pestOptionsFor(
  scoutTargets: readonly string[],
  thresholds: readonly PestThreshold[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string) => {
    const name = p.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const p of scoutTargets) add(p);
  for (const p of [...thresholds.map((t) => t.pest)].sort((a, b) => a.localeCompare(b))) add(p);
  return out;
}

/** Label thresholds that a count of this pest and metric is checked
 *  against. Matching is exact, as in the insecticide IPM gate. */
export function thresholdsFor(
  thresholds: readonly PestThreshold[],
  pest: string,
  metric: string
): PestThreshold[] {
  const name = pest.trim();
  if (!name) return [];
  const seen = new Set<string>();
  return thresholds
    .filter((t) => t.pest === name && t.metric === metric)
    .filter((t) => (seen.has(t.product) ? false : (seen.add(t.product), true)))
    .sort((a, b) => a.threshold - b.threshold || a.product.localeCompare(b.product));
}
