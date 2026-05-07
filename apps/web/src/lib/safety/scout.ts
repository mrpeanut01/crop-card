/**
 * Scout-and-spray decision logic (FR-07, UC-05).
 *
 * Spec rule: spray when ≥ 3 broadleaf weeds per 10 sq ft on average across
 * scouting spots, OR any individual weed taller than 2 inches.
 *
 * Pure function — UI feeds in counts and the worst observed weed height,
 * gets back a decision + the reason that drove it.
 */

export const SCOUT_THRESHOLD_WEEDS_PER_10_SQ_FT = 3;
export const SCOUT_HEIGHT_TRIGGER_INCHES = 2;

export type ScoutDecision = 'SPRAY' | 'SKIP';

export interface ScoutSpot {
  /** Number of broadleaf weeds counted in a 10 sq ft scouting spot. */
  weedsPer10SqFt: number;
}

export interface ScoutInput {
  spots: ReadonlyArray<ScoutSpot>;
  /** Tallest weed observed in any spot (inches). */
  maxWeedHeightInches?: number;
}

export interface ScoutResult {
  decision: ScoutDecision;
  averagePer10SqFt: number;
  reason: string;
  spotsCounted: number;
}

export function evaluateScout(input: ScoutInput): ScoutResult {
  const { spots } = input;
  if (spots.length === 0) {
    return {
      decision: 'SKIP',
      averagePer10SqFt: 0,
      reason: 'No scouting spots recorded — re-walk and count.',
      spotsCounted: 0
    };
  }
  const total = spots.reduce((acc, s) => acc + Math.max(0, s.weedsPer10SqFt), 0);
  const avg = total / spots.length;
  const heightTrigger =
    typeof input.maxWeedHeightInches === 'number' &&
    input.maxWeedHeightInches > SCOUT_HEIGHT_TRIGGER_INCHES;

  if (avg >= SCOUT_THRESHOLD_WEEDS_PER_10_SQ_FT) {
    return {
      decision: 'SPRAY',
      averagePer10SqFt: avg,
      reason: `Average ${avg.toFixed(1)} weeds / 10 sq ft ≥ ${SCOUT_THRESHOLD_WEEDS_PER_10_SQ_FT} threshold.`,
      spotsCounted: spots.length
    };
  }
  if (heightTrigger) {
    return {
      decision: 'SPRAY',
      averagePer10SqFt: avg,
      reason: `Tallest weed ${input.maxWeedHeightInches}" exceeds ${SCOUT_HEIGHT_TRIGGER_INCHES}" trigger — spray before they set seed.`,
      spotsCounted: spots.length
    };
  }
  return {
    decision: 'SKIP',
    averagePer10SqFt: avg,
    reason: `Average ${avg.toFixed(1)} weeds / 10 sq ft below threshold; no weeds over ${SCOUT_HEIGHT_TRIGGER_INCHES}".`,
    spotsCounted: spots.length
  };
}
