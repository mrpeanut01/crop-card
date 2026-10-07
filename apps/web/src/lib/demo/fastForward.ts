/** Demo fast forward choices (client-safe, no DB). The sample farm is
 *  rebuilt as it would look on the new date; a Start from scratch farm only
 *  moves its clock. Time only ever moves forward. */

import { DAY_MS, addDaysYmd, ymdInYear, ymdOf, zonedMs } from './time';

export const DEMO_CLOCK_OFFSET_KEY = 'demo_clock_offset_ms';
export const DEMO_FARM_KIND_KEY = 'demo_farm_kind';
export type DemoFarmKind = 'sample' | 'scratch';

/** No further than this ahead of the real date. */
export const MAX_DEMO_OFFSET_MS = 730 * DAY_MS;

export const DEMO_STEPS = [
  { id: 'day', days: 1 },
  { id: 'week', days: 7 },
  { id: 'month', days: 30 }
] as const;
export type DemoStepId = (typeof DEMO_STEPS)[number]['id'];

/** Season phases on the sample farm, by the day each one starts. */
export const DEMO_PHASES = [
  { id: 'planning', mmdd: '02-01' },
  { id: 'planting', mmdd: '04-25' },
  { id: 'earlySummer', mmdd: '06-10' },
  { id: 'midsummer', mmdd: '07-25' },
  { id: 'fall', mmdd: '09-20' },
  { id: 'winter', mmdd: '12-05' }
] as const;
export type DemoPhaseId = (typeof DEMO_PHASES)[number]['id'];

const PHASE_HOUR = 9;

/** The next start of `phase` strictly after the day of `virtualNow`. */
export function nextPhaseStart(phase: DemoPhaseId, virtualNow: number): number {
  const p = DEMO_PHASES.find((x) => x.id === phase)!;
  const today = ymdOf(virtualNow);
  const year = Number(today.slice(0, 4));
  let ymd = ymdInYear(year, p.mmdd);
  if (ymd <= today) ymd = ymdInYear(year + 1, p.mmdd);
  return zonedMs(ymd, PHASE_HOUR);
}

/** The phase whose window holds `virtualNow`. */
export function currentPhase(virtualNow: number): DemoPhaseId {
  const mmdd = ymdOf(virtualNow).slice(5);
  let id: DemoPhaseId = 'winter';
  for (const p of DEMO_PHASES) if (mmdd >= p.mmdd) id = p.id;
  return id;
}

export type FastForwardChoice = { step: DemoStepId } | { phase: DemoPhaseId };

export function parseFastForwardChoice(raw: string | null): FastForwardChoice | null {
  if (!raw) return null;
  const [kind, id] = raw.split(':');
  if (kind === 'step' && DEMO_STEPS.some((s) => s.id === id)) return { step: id as DemoStepId };
  if (kind === 'phase' && DEMO_PHASES.some((p) => p.id === id)) return { phase: id as DemoPhaseId };
  return null;
}

/** The new offset from the real clock, or null when the choice would pass
 *  the limit. Never smaller than the current offset. */
export function fastForwardOffset(
  choice: FastForwardChoice,
  realNow: number,
  currentOffsetMs: number
): number | null {
  const virtualNow = realNow + currentOffsetMs;
  const target =
    'step' in choice
      ? zonedMs(
          addDaysYmd(ymdOf(virtualNow), DEMO_STEPS.find((s) => s.id === choice.step)!.days),
          0
        ) +
        (virtualNow - zonedMs(ymdOf(virtualNow), 0))
      : nextPhaseStart(choice.phase, virtualNow);
  const offset = Math.max(currentOffsetMs, target - realNow);
  return offset > MAX_DEMO_OFFSET_MS ? null : offset;
}

export function parseOffset(raw: string | undefined | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
