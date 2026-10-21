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
import { cropDisplayName } from '$lib/i18n/cropName';
import { atText } from '$lib/i18n/atTime';
import { ymdInZone } from '$lib/prefs';
import type { TimerSkipReason, TodayAdviceAction, TodayAdviceSkip } from '$lib/today/advice';

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
    if (latest.unknownLogTimer) {
      return line('herbse.water.bedTimerNoAmount', { timer: latest.unknownLogTimer, day });
    }
    return line(
      latest.unknownLogNeedsSize
        ? 'advice.water.bedWateredNoSize'
        : 'advice.water.bedWateredNotLogged',
      { day }
    );
  }
  if (reason === 'no-target') return line('advice.water.bedNoTarget');
  if (reason === 'indoors') return line('herbse.water.bedIndoors');
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
  if (balance.reason === 'indoors') {
    return { title: area, lines: [t(locale, 'herbse.water.indoors')] };
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
    if (latest.unknownLogTimer) {
      return {
        title: m('advice.water.notLoggedTitle'),
        lines: [t(locale, 'herbse.water.timerNoAmount', { timer: latest.unknownLogTimer, day })]
      };
    }
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
  /** Phase 37E: the automatic waterers on this Area. */
  timers?: readonly TimerCardInfo[];
  /** Owners and helpers get the one-tap skip; inspectors only read. */
  canRecord?: boolean;
  /** Owners get a link to type a timer's inches per run. */
  canEditTimers?: boolean;
  /** R-11: a container Area on a sourced hot day. */
  potHeat?: boolean;
  /** English crop names by plugin id, for the water-need words. */
  cropNames?: Readonly<Record<string, string>>;
  /** Defaults to the current time. */
  nowMs?: number;
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
  lines.push(...needLines(open, input.cropNames, loc));
  if (b.rainIn !== null && b.reason !== 'greenhouse' && b.reason !== 'indoors') {
    lines.push(rainTotalLine(b.rainIn, b.rainTrusted, b.coveredHours, loc));
  }
  const watered = wateredLine(open, loc);
  if (watered) lines.push(watered);
  if (input.forecastIn !== null && input.forecastIn >= 0.05 && b.reason !== 'indoors') {
    lines.push(t(loc, 'advice.water.forecast', { inches: inchesText(input.forecastIn) }));
  }
  if (input.potHeat) lines.push(t(loc, 'herbse.water.potHeat'));
  const timer = timerParts(input, open);
  lines.push(...timer.lines);
  const skips = skipItems(input.timers, tz, loc);
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
      },
      ...timer.actions
    ],
    ...(skips.length ? { skips } : {}),
    sortKey:
      100 + verdictRank(b.verdict) * 10 + (b.reason === 'no-target' ? NO_TARGET_SORT_OFFSET : 0)
  };
}

// ─── Phase 37E: water need and automatic waterers ───────────────────────

/** What a card says about one automatic waterer on its Area. */
export interface TimerCardInfo {
  equipmentId: string;
  label: string;
  minutes: number;
  /** The next run that was not skipped, within about a week. */
  nextRunAt: number | null;
  inchesPerRun: number | null;
  /** The latest run in the window that counts as water given. */
  lastRunAt: number | null;
  /** Beds it waters on this Area; null for the whole Area. */
  bedIds: readonly string[] | null;
  /** #870 (FU870-2): runs in the window someone marked as not watering. */
  skips?: ReadonlyArray<{
    id: string;
    scheduledAt: number;
    reason: TimerSkipReason;
    canUndo: boolean;
  }>;
}

/** "Wed, Oct 14 at 6:00 AM" in the farm's zone: a skip can sit a week back
 *  or a week ahead, so the weekday alone could name two runs. */
export function skipWhenText(ms: number, timeZone: string, locale?: Loc): string {
  const day = dateTimeFormat(intlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone
  }).format(new Date(ms));
  const time = dateTimeFormat(intlLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone
  }).format(new Date(ms));
  return t(locale, 'herbse.when.day', { day, at: atText(time, locale) });
}

/** One line per logged skip of the Area's timers, with an Undo the viewer
 *  may use (FU870-2). */
export function skipItems(
  timers: readonly TimerCardInfo[] | undefined,
  timeZone: string,
  locale?: Loc
): TodayAdviceSkip[] {
  const out: TodayAdviceSkip[] = [];
  for (const timer of timers ?? []) {
    for (const s of timer.skips ?? []) {
      const when = skipWhenText(s.scheduledAt, timeZone, locale);
      out.push({
        id: s.id,
        text: t(locale, 'herbsg.skip.line', {
          timer: timer.label,
          when,
          reason: t(locale, `herbsg.skip.reason.${s.reason}`)
        }),
        undoLabel: t(locale, 'herbsg.skip.undoLabel', { timer: timer.label, when }),
        canUndo: s.canUndo
      });
    }
  }
  return out;
}

/** "thyme" from "Thyme — English", in the viewer's language. */
export function shortCropName(
  pluginId: string,
  names: Readonly<Record<string, string>> | undefined,
  locale?: Loc
): string {
  const shown = cropDisplayName(pluginId, names?.[pluginId] ?? pluginId, locale);
  const base = (shown.split(/\s[—–]\s|,|\(/)[0] ?? shown).trim();
  return base.charAt(0).toLocaleLowerCase() + base.slice(1);
}

/** The need as words beside the verdict (R-10): "Check the soil first:
 *  thyme likes it dry" on a dry-loving bed told to water, a mixed-needs line
 *  for a shared bed, and the need words otherwise. Never changes the verdict. */
export function needLines(
  open: readonly BedVerdict[],
  names?: Readonly<Record<string, string>>,
  locale?: Loc
): string[] {
  const lines: string[] = [];
  const named = open.length > 1;
  for (const bed of open) {
    if (!bed.needLine) continue;
    const ids = bed.needCropPluginIds;
    const crops = joinNames(
      ids.map((id) => shortCropName(id, names, locale)),
      locale
    );
    if (bed.checkSoilFirst) {
      const many = ids.length > 1;
      const key: MessageKey = named
        ? many
          ? 'herbse.water.checkSoilBed.many'
          : 'herbse.water.checkSoilBed.one'
        : many
          ? 'herbse.water.checkSoil.many'
          : 'herbse.water.checkSoil.one';
      lines.push(t(locale, key, { bed: bed.bedName, crops }));
    } else if (bed.needLine === 'mixed') {
      lines.push(t(locale, 'herbse.water.mixed', { bed: bed.bedName }));
    } else {
      lines.push(
        t(locale, 'herbse.water.needLine', {
          bed: bed.bedName,
          level: t(locale, `herbse.need.${bed.needLine}`),
          crops
        })
      );
    }
  }
  return lines;
}

/** "today at 6:00 AM", "tomorrow at 6:00 AM" or "Fri at 6:00 AM" in the
 *  farm's time zone. */
export function runWhenText(ms: number, nowMs: number, timeZone: string, locale?: Loc): string {
  const time = dateTimeFormat(intlLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone
  }).format(new Date(ms));
  const day = ymdInZone(ms, timeZone);
  const at = atText(time, locale);
  if (day === ymdInZone(nowMs, timeZone)) return t(locale, 'herbse.when.today', { at });
  if (day === ymdInZone(nowMs + 86_400_000, timeZone)) {
    return t(locale, 'herbse.when.tomorrow', { at });
  }
  return t(locale, 'herbse.when.day', { day: weekdayText(ms, timeZone, locale), at });
}

/** Lines and one-tap actions for the Area's automatic waterers: "Drip timer
 *  gives 0.4 in tomorrow at 6:00 AM; the week is at 1.1 in already, skip it"
 *  when the beds it waters already have enough. */
export function timerParts(
  input: WaterCardInput,
  open: readonly BedVerdict[]
): { lines: string[]; actions: TodayAdviceAction[] } {
  const lines: string[] = [];
  const actions: TodayAdviceAction[] = [];
  const loc = input.locale;
  const tz = input.timeZone;
  const now = input.nowMs ?? Date.now();
  const b = input.balance;
  for (const timer of input.timers ?? []) {
    const beds = open.filter((x) => timer.bedIds === null || timer.bedIds.includes(x.bedId));
    const enough = beds.length > 0 && beds.every((x) => x.verdict === 'ok' || x.verdict === 'skip');
    const week = beds.length
      ? inchesText((b.rainIn ?? 0) + Math.min(...beds.map((x) => x.wateredIn)))
      : null;
    if (timer.nextRunAt !== null) {
      const when = runWhenText(timer.nextRunAt, now, tz, loc);
      const known = timer.inchesPerRun !== null;
      const params = {
        timer: timer.label,
        when,
        minutes: String(timer.minutes),
        inches: known ? inchesText(timer.inchesPerRun as number) : '',
        week: week ?? ''
      };
      const key: MessageKey =
        enough && week !== null
          ? known
            ? 'herbse.timer.skipIt'
            : 'herbse.timer.skipItNoAmount'
          : known
            ? 'herbse.timer.next'
            : 'herbse.timer.nextNoAmount';
      lines.push(t(loc, key, params));
      if (input.canRecord) {
        actions.push({
          kind: 'skip-run',
          label: t(loc, 'herbse.timer.skipAction', { timer: timer.label, when }),
          equipmentId: timer.equipmentId,
          scheduledAt: timer.nextRunAt,
          reason: enough ? 'turned-off-for-rain' : 'other'
        });
      }
    }
    if (timer.lastRunAt !== null && input.canRecord) {
      actions.push({
        kind: 'skip-run',
        label: t(loc, 'herbse.timer.didNotRun', {
          timer: timer.label,
          day: weekdayText(timer.lastRunAt, tz, loc)
        }),
        equipmentId: timer.equipmentId,
        scheduledAt: timer.lastRunAt,
        reason: 'did-not-run'
      });
    }
    if (timer.inchesPerRun === null && input.canEditTimers) {
      actions.push({
        kind: 'link',
        label: t(loc, 'herbse.timer.setAmount', { timer: timer.label }),
        href: `/equipment/${encodeURIComponent(timer.equipmentId)}`
      });
    }
  }
  return { lines, actions };
}
