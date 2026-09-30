/**
 * Plain-English watering copy (Phase 32E, E4-6, E4-9, E4-10). Pure and
 * client-safe, so the rendered strings are testable. Never mentions spraying.
 */

import { dateTimeFormat } from '$lib/intlCache';
import type { TodayAdviceCard } from '$lib/today/advice';
import {
  verdictRank,
  type BedVerdict,
  type StationRef,
  type UnknownReason,
  type WaterBalance,
  type WaterVerdict
} from './waterBalance';
import { WATER_TARGET_SOURCE } from './waterSources';

export const RAIN_UNKNOWN_LINE = 'Rain unknown here, check your gauge.';
export const NO_TARGET_LINE = 'No weekly water target set.';
export const GREENHOUSE_LINE = "Rain doesn't reach a greenhouse. Check the soil.";
export const GAUGE_PARTIAL_LINE =
  'Your gauge readings cover only part of the week. Enter a reading each time you empty the gauge.';
export const GALLONS_NO_SIZE_LINE =
  "Gallons can't be counted until this Area or bed has a size. Add its size on the farm map.";
export const COVERED_LINE = 'A cover keeps the rain off. Check the soil by hand.';

export function inchesText(n: number): string {
  const v = Math.round(n * 10) / 10;
  return `${v === 0 && n > 0 ? '<0.1' : v.toFixed(1).replace(/\.0$/, '')} in`;
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function weekdayText(ms: number, timeZone: string): string {
  return dateTimeFormat('en-US', { weekday: 'short', timeZone }).format(new Date(ms));
}

export function stationText(s: StationRef): string {
  return `${s.name}, ${s.distanceMi.toFixed(1).replace(/\.0$/, '')} mi away`;
}

function latestUnknownLog(beds: readonly BedVerdict[]): BedVerdict {
  return beds.reduce((a, b) => ((b.unknownLogAtMs ?? 0) > (a.unknownLogAtMs ?? 0) ? b : a));
}

function rainUnknownLine(balance: WaterBalance): string {
  return balance.gaugeHours > 0 ? GAUGE_PARTIAL_LINE : RAIN_UNKNOWN_LINE;
}

function bedGroupLine(
  verdict: WaterVerdict,
  reason: UnknownReason | null,
  beds: readonly BedVerdict[],
  timeZone: string,
  balance: WaterBalance
): string {
  const names = joinNames(beds.map((b) => b.bedName));
  if (verdict === 'water') {
    const short = Math.max(...beds.map((b) => b.shortIn ?? 0));
    return `Water ${names}. About ${inchesText(short)} short this week.`;
  }
  if (verdict === 'skip') return `Skip watering ${names} today.`;
  if (verdict === 'ok') return `${names}: watered enough this week.`;
  if (reason === 'covered') return `Check ${names} by hand. ${COVERED_LINE}`;
  if (reason === 'amount-not-logged') {
    const latest = latestUnknownLog(beds);
    const day = weekdayText(latest.unknownLogAtMs ?? 0, timeZone);
    return latest.unknownLogNeedsSize
      ? `${names}: you watered ${day}. ${GALLONS_NO_SIZE_LINE}`
      : `${names}: you watered ${day}, amount not logged.`;
  }
  if (reason === 'no-target') return `${names}: ${NO_TARGET_LINE.toLowerCase()}`;
  const line = rainUnknownLine(balance);
  return `${names}: ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}

function uniformTitle(area: string, balance: WaterBalance, open: BedVerdict[], tz: string) {
  const v = balance.verdict;
  if (v === 'skip') return { title: `Skip watering the ${area} today`, lines: [] };
  if (v === 'ok') return { title: `${area}: watered enough this week`, lines: [] };
  if (v === 'water') {
    return {
      title: `Water the ${area}`,
      lines: [`About ${inchesText(balance.shortIn ?? 0)} short this week.`]
    };
  }
  if (balance.reason === 'greenhouse') return { title: area, lines: [GREENHOUSE_LINE] };
  if (balance.reason === 'covered') {
    return { title: `Check the ${area} by hand`, lines: [COVERED_LINE] };
  }
  if (balance.reason === 'no-target') {
    return { title: `${area}: no water target`, lines: [NO_TARGET_LINE] };
  }
  if (balance.reason === 'amount-not-logged') {
    const latest = latestUnknownLog(open);
    const day = weekdayText(latest.unknownLogAtMs ?? 0, tz);
    return {
      title: `${area}: rain alone is not enough`,
      lines: latest.unknownLogNeedsSize
        ? [`You watered ${day}.`, GALLONS_NO_SIZE_LINE]
        : [`You watered ${day}, amount not logged.`]
    };
  }
  if (balance.gaugeHours > 0) {
    return { title: `${area}: rain only partly known`, lines: [GAUGE_PARTIAL_LINE] };
  }
  return { title: `${area}: rain unknown here`, lines: [RAIN_UNKNOWN_LINE] };
}

/** The week's rain, or an honest lower bound over the part of the week
 *  that has readings (E0-4: a partial total is never the week's total). */
export function rainTotalLine(rainIn: number, trusted: boolean, coveredHours: number): string {
  if (trusted) return `Rain in the last 7 days: about ${inchesText(rainIn)}.`;
  const days = Math.floor(coveredHours / 24);
  const span = days < 1 ? 'less than a day' : days === 1 ? '1 day' : `${days} days`;
  return `Rain known for only ${span} of the last 7: at least ${inchesText(rainIn)}.`;
}

export interface WaterCardInput {
  fieldId: string;
  areaName: string;
  balance: WaterBalance;
  /** The nearest station even when too far to count, for the detail line. */
  nearestStation: StationRef | null;
  forecastIn: number | null;
  timeZone: string;
  /** Neither the Area nor the farm has a location. */
  noLocation?: boolean;
}

export function waterDetail(input: WaterCardInput): string {
  const b = input.balance;
  const parts: string[] = [];
  const counts = b.station !== null && (b.rainSource === 'station' || b.rainSource === 'both');
  if (b.rainSource === 'gauge') parts.push('Rain from your gauge');
  else if (b.rainSource === 'both' && b.station) {
    parts.push(`Rain from your gauge and ${stationText(b.station)}`);
  } else if (counts && b.station) parts.push(`Rain from ${stationText(b.station)}`);
  if (!counts) {
    const s = input.nearestStation;
    if (input.noLocation) parts.push('Set the farm location to count station rain');
    else if (s && s.distanceMi > 10)
      parts.push(`Nearest station ${stationText(s)}, too far to count`);
    else if (s) parts.push(`Nearest station ${stationText(s)}, no rain reports`);
    else parts.push('No weather station within 30 miles');
  }
  if (b.target) {
    parts.push(
      `Target ${inchesText(b.target.inches)} a week (${
        b.target.provenance === 'manual' ? 'your setting' : WATER_TARGET_SOURCE
      })`
    );
  }
  return `${parts.join('. ')}.`;
}

export function wateringCard(input: WaterCardInput): TodayAdviceCard {
  const b = input.balance;
  const tz = input.timeZone;
  const open = b.perBed.filter((x) => x.reason !== 'covered' && x.reason !== 'greenhouse');
  const covered = b.perBed.filter((x) => x.reason === 'covered');
  const uniform =
    open.length === 0 ||
    open.every((x) => x.verdict === open[0].verdict && x.reason === open[0].reason);

  let title: string;
  const lines: string[] = [];
  if (uniform) {
    const u = uniformTitle(input.areaName, b, open, tz);
    title = u.title;
    lines.push(...u.lines);
    if (open.length > 0 && covered.length > 0) {
      lines.push(bedGroupLine('unknown', 'covered', covered, tz, b));
    }
  } else {
    title = `Watering the ${input.areaName}`;
    const groups = new Map<string, BedVerdict[]>();
    for (const bed of b.perBed) {
      const key = `${bed.verdict}|${bed.reason ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), bed]);
    }
    const ordered = [...groups.values()].sort(
      (x, y) => verdictRank(x[0].verdict) - verdictRank(y[0].verdict)
    );
    for (const g of ordered) lines.push(bedGroupLine(g[0].verdict, g[0].reason, g, tz, b));
  }
  if (b.rainIn !== null && b.reason !== 'greenhouse') {
    lines.push(rainTotalLine(b.rainIn, b.rainTrusted, b.coveredHours));
  }
  if (input.forecastIn !== null && input.forecastIn >= 0.05) {
    lines.push(
      `Rain forecast: about ${inchesText(input.forecastIn)} over the next 24 hours (NWS).`
    );
  }
  const provenance =
    b.rainSource === 'gauge' || b.rainSource === 'both'
      ? 'manual'
      : b.rainSource === 'station'
        ? 'data'
        : 'fallback';
  return {
    id: `water:${input.fieldId}`,
    kind: 'watering',
    title,
    lines,
    provenance,
    detail: waterDetail(input),
    tone: b.verdict === 'water' ? 'wheat' : 'info',
    actions: [
      { kind: 'sheet', label: 'Log watering', sheet: 'log-watering', fieldId: input.fieldId },
      { kind: 'sheet', label: 'Enter rain gauge', sheet: 'rain-gauge', fieldId: input.fieldId }
    ],
    sortKey: 100 + verdictRank(b.verdict) * 10
  };
}
