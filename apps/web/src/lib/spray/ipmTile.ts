export interface IpmThreshold {
  pest: string;
  metric: string;
  threshold: number;
}

export interface IpmObservation {
  pest: string;
  metric: string;
  value: number;
  occurredAt: number;
}

export interface IpmTileWeek {
  weeksAgo: number;
  value: number | null;
  triggered: boolean;
}

export interface IpmTile {
  threshold: IpmThreshold;
  /** The latest observation of this threshold's pest and metric: the one
   *  the gate reads. */
  latest: IpmObservation | null;
  met: boolean;
  /** Latest value per week, oldest first; null for a week with no count. */
  weeks: IpmTileWeek[];
}

const WEEK_MS = 7 * 86_400_000;

function latestFor(t: IpmThreshold, obs: readonly IpmObservation[]): IpmObservation | null {
  let best: IpmObservation | null = null;
  for (const o of obs) {
    if (o.pest !== t.pest || o.metric !== t.metric) continue;
    if (best === null || o.occurredAt > best.occurredAt) best = o;
  }
  return best;
}

/** Which declared threshold the IPM tile shows, read the same way as the
 *  gate (`checkIpmThreshold`): the latest observation of each threshold's
 *  pest and metric. A met threshold wins; otherwise the one with the most
 *  recent count; otherwise the first declared. Weeks run back from `nowMs`. */
export function ipmTile(
  thresholds: readonly IpmThreshold[],
  observations: readonly IpmObservation[],
  nowMs: number
): IpmTile | null {
  if (thresholds.length === 0) return null;
  const rows = thresholds.map((threshold) => {
    const latest = latestFor(threshold, observations);
    return { threshold, latest, met: latest !== null && latest.value >= threshold.threshold };
  });
  const pick =
    rows.find((r) => r.met) ??
    rows
      .filter((r) => r.latest !== null)
      .sort((a, b) => b.latest!.occurredAt - a.latest!.occurredAt)[0] ??
    rows[0];
  const weeks: IpmTileWeek[] = [];
  for (let i = 4; i >= 0; i--) {
    const startMs = nowMs - (i + 1) * WEEK_MS;
    const endMs = i === 0 ? Number.POSITIVE_INFINITY : nowMs - i * WEEK_MS;
    const inWeek = observations.filter(
      (o) =>
        o.pest === pick.threshold.pest &&
        o.metric === pick.threshold.metric &&
        o.occurredAt >= startMs &&
        o.occurredAt < endMs
    );
    const last = latestFor(pick.threshold, inWeek);
    weeks.push({
      weeksAgo: i,
      value: last ? last.value : null,
      triggered: last !== null && last.value >= pick.threshold.threshold
    });
  }
  return { ...pick, weeks };
}
