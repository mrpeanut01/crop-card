/**
 * Plain-English watering copy (Phase 32E, E4-6, E4-9, E4-10). Pure and
 * client-safe, so the rendered strings are testable. Never mentions spraying.
 */

import { t, type MessageKey } from '$lib/i18n';
import { dateTimeFormat } from '$lib/intlCache';
import { intlLocale } from '$lib/prefs';
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

type Loc = string | null | undefined;

export function inchesText(n: number): string {
  const v = Math.round(n * 10) / 10;
  return `${v === 0 && n > 0 ? '<0.1' : v.toFixed(1).replace(/\.0$/, '')} in`;
}

export function joinNames(names: readonly string[], locale?: Loc): string {
  if (names.length <= 1) return names[0] ?? '';
  return t(locale, 'advice.water.joinLast', {
    list: names.slice(0, -1).join(', '),
    last: names[names.length - 1]
  });
}

export function weekdayText(ms: number, timeZone: string, locale?: Loc): string {
  return dateTimeFormat(intlLocale(locale), { weekday: 'short', timeZone }).format(new Date(ms));
}

export function stationText(s: StationRef, locale?: Loc): string {
  return t(locale, 'advice.water.station', {
    name: s.name,
    miles: s.distanceMi.toFixed(1).replace(/\.0$/, '')
  });
}

function latestUnknownLog(beds: readonly BedVerdict[]): BedVerdict {
  return beds.reduce((a, b) => ((b.unknownLogAtMs ?? 0) > (a.unknownLogAtMs ?? 0) ? b : a));
}

function bedGroupLine(
  verdict: WaterVerdict,
  reason: UnknownReason | null,
  beds: readonly BedVerdict[],
  timeZone: string,
  balance: WaterBalance,
  locale: Loc
): string {
  const names = joinNames(
    beds.map((b) => b.bedName),
    locale
  );
  const line = (key: MessageKey, params: Record<string, string> = {}) =>
    t(locale, key, { names, ...params });
  if (verdict === 'water') {
    const short = Math.max(...beds.map((b) => b.shortIn ?? 0));
    return line('advice.water.bedWater', { inches: inchesText(short) });
  }
  if (verdict === 'skip') return line('advice.water.bedSkip');
  if (verdict === 'ok') return line('advice.water.bedOk');
  if (reason === 'covered') return line('advice.water.bedCovered');
  if (reason === 'amount-not-logged') {
    const latest = latestUnknownLog(beds);
    const day = weekdayText(latest.unknownLogAtMs ?? 0, timeZone, locale);
    return line(
      latest.unknownLogNeedsSize
        ? 'advice.water.bedWateredNoSize'
        : 'advice.water.bedWateredNotLogged',
      { day }
    );
  }
  if (reason === 'no-target') return line('advice.water.bedNoTarget');
  return line(
    balance.gaugeHours > 0 ? 'advice.water.bedGaugePartial' : 'advice.water.bedRainUnknown'
  );
}

function uniformTitle(
  area: string,
  balance: WaterBalance,
  open: BedVerdict[],
  tz: string,
  locale: Loc,
  areaKind?: string | null
) {
  const v = balance.verdict;
  const m = (key: MessageKey, params: Record<string, string> = {}) =>
    t(locale, key, { area, ...params });
  if (v === 'skip') return { title: m('advice.water.skipTitle'), lines: [] };
  if (v === 'ok') return { title: m('advice.water.okTitle'), lines: [] };
  if (v === 'water') {
    return {
      title: m('advice.water.waterTitle'),
      lines: [m('advice.water.shortLine', { inches: inchesText(balance.shortIn ?? 0) })]
    };
  }
  if (balance.reason === 'greenhouse') {
    return { title: area, lines: [t(locale, 'advice.water.greenhouse')] };
  }
  if (balance.reason === 'covered') {
    return { title: m('advice.water.coveredTitle'), lines: [t(locale, 'advice.water.covered')] };
  }
  if (balance.reason === 'no-target') {
    return {
      title: m('advice.water.noTargetTitle'),
      lines: [
        t(locale, areaKind === 'field' ? 'advice.water.noTargetField' : 'advice.water.noTarget')
      ]
    };
  }
  if (balance.reason === 'amount-not-logged') {
    const latest = latestUnknownLog(open);
    const day = weekdayText(latest.unknownLogAtMs ?? 0, tz, locale);
    return {
      title: m('advice.water.notLoggedTitle'),
      lines: latest.unknownLogNeedsSize
        ? [m('advice.water.youWatered', { day }), t(locale, 'advice.water.gallonsNoSize')]
        : [m('advice.water.youWateredNotLogged', { day })]
    };
  }
  if (balance.gaugeHours > 0) {
    return {
      title: m('advice.water.partlyTitle'),
      lines: [t(locale, 'advice.water.gaugePartial')]
    };
  }
  return { title: m('advice.water.unknownTitle'), lines: [t(locale, 'advice.water.rainUnknown')] };
}

/** The week's rain, or an honest lower bound over the part of the week
 *  that has readings (E0-4: a partial total is never the week's total). */
export function rainTotalLine(
  rainIn: number,
  trusted: boolean,
  coveredHours: number,
  locale?: Loc
): string {
  const inches = inchesText(rainIn);
  if (trusted) return t(locale, 'advice.water.rainWeek', { inches });
  const days = Math.floor(coveredHours / 24);
  const span =
    days < 1
      ? t(locale, 'advice.water.lessThanDay')
      : t(locale, 'advice.water.days', { count: days });
  return t(locale, 'advice.water.rainPartial', { span, inches });
}

/** A card with no target sorts after every card that has a verdict. */
export const NO_TARGET_SORT_OFFSET = 50;

/** The watering logged on the open beds this week, the least of them when
 *  beds differ (#732). Null when none was logged with a known amount. */
export function wateredLine(open: readonly BedVerdict[], locale?: Loc): string | null {
  const amounts = open.map((x) => x.wateredIn);
  if (amounts.length === 0) return null;
  const least = Math.min(...amounts);
  const most = Math.max(...amounts);
  if (most <= 0) return null;
  if (least === most) return t(locale, 'advice.water.wateredWeek', { inches: inchesText(least) });
  return least > 0
    ? t(locale, 'advice.water.wateredWeekAtLeast', { inches: inchesText(least) })
    : t(locale, 'advice.water.wateredWeekSome');
}

export interface WaterCardInput {
  fieldId: string;
  areaName: string;
  /** The Area's kind; a field Area has no default target (#724). */
  areaKind?: string | null;
  balance: WaterBalance;
  /** The nearest station even when too far to count, for the detail line. */
  nearestStation: StationRef | null;
  forecastIn: number | null;
  timeZone: string;
  /** Neither the Area nor the farm has a location. */
  noLocation?: boolean;
  /** The viewer's language; English when unset. */
  locale?: string | null;
}

export function waterDetail(input: WaterCardInput): string {
  const b = input.balance;
  const loc = input.locale;
  const parts: string[] = [];
  const counts = b.station !== null && (b.rainSource === 'station' || b.rainSource === 'both');
  if (b.rainSource === 'gauge') parts.push(t(loc, 'advice.water.fromGauge'));
  else if (b.rainSource === 'both' && b.station) {
    parts.push(t(loc, 'advice.water.fromGaugeAnd', { station: stationText(b.station, loc) }));
  } else if (counts && b.station) {
    parts.push(t(loc, 'advice.water.fromStation', { station: stationText(b.station, loc) }));
  }
  if (!counts) {
    const s = input.nearestStation;
    if (input.noLocation) parts.push(t(loc, 'advice.water.setLocation'));
    else if (s && s.distanceMi > 10)
      parts.push(t(loc, 'advice.water.tooFar', { station: stationText(s, loc) }));
    else if (s) parts.push(t(loc, 'advice.water.noReports', { station: stationText(s, loc) }));
    else parts.push(t(loc, 'advice.water.noStation'));
  }
  if (b.target) {
    parts.push(
      t(loc, 'advice.water.target', {
        inches: inchesText(b.target.inches),
        source:
          b.target.provenance === 'manual'
            ? t(loc, 'advice.water.yourSetting')
            : WATER_TARGET_SOURCE
      })
    );
  }
  return `${parts.join('. ')}.`;
}

export function wateringCard(input: WaterCardInput): TodayAdviceCard {
  const b = input.balance;
  const tz = input.timeZone;
  const loc = input.locale;
  const open = b.perBed.filter((x) => x.reason !== 'covered' && x.reason !== 'greenhouse');
  const covered = b.perBed.filter((x) => x.reason === 'covered');
  const uniform =
    open.length === 0 ||
    open.every((x) => x.verdict === open[0].verdict && x.reason === open[0].reason);

  let title: string;
  const lines: string[] = [];
  if (uniform) {
    const u = uniformTitle(input.areaName, b, open, tz, loc, input.areaKind);
    title = u.title;
    lines.push(...u.lines);
    if (open.length > 0 && covered.length > 0) {
      lines.push(bedGroupLine('unknown', 'covered', covered, tz, b, loc));
    }
  } else {
    title = t(loc, 'advice.water.areaTitle', { area: input.areaName });
    const groups = new Map<string, BedVerdict[]>();
    for (const bed of b.perBed) {
      const key = `${bed.verdict}|${bed.reason ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), bed]);
    }
    const ordered = [...groups.values()].sort(
      (x, y) => verdictRank(x[0].verdict) - verdictRank(y[0].verdict)
    );
    for (const g of ordered) lines.push(bedGroupLine(g[0].verdict, g[0].reason, g, tz, b, loc));
  }
  if (b.rainIn !== null && b.reason !== 'greenhouse') {
    lines.push(rainTotalLine(b.rainIn, b.rainTrusted, b.coveredHours, loc));
  }
  const watered = wateredLine(open, loc);
  if (watered) lines.push(watered);
  if (input.forecastIn !== null && input.forecastIn >= 0.05) {
    lines.push(t(loc, 'advice.water.forecast', { inches: inchesText(input.forecastIn) }));
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
      {
        kind: 'sheet',
        label: t(loc, 'today.advice.logWatering'),
        sheet: 'log-watering',
        fieldId: input.fieldId
      },
      {
        kind: 'sheet',
        label: t(loc, 'today.advice.rainGauge'),
        sheet: 'rain-gauge',
        fieldId: input.fieldId
      }
    ],
    sortKey:
      100 + verdictRank(b.verdict) * 10 + (b.reason === 'no-target' ? NO_TARGET_SORT_OFFSET : 0)
  };
}
