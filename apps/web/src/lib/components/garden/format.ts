import type { BedStyle } from '$lib/farm/areaKinds';
import { createT, type MessageKey, type Translator, type TranslateKey } from '$lib/i18n';
import { plantingInGround, type GroundFacts } from '$lib/garden/inGround';
import { familyLabel } from '$lib/garden/rotation';
import type { BedLayout, PlacedPlanting, SpacingPattern } from '$lib/garden/types';

const EN = createT('en');

export const PATTERN_LABELS: Record<SpacingPattern, string> = {
  square: 'Rows',
  offset: 'Offset',
  sfg: 'Square foot'
};

export function patternLabel(pattern: SpacingPattern, tr: Translator = EN): string {
  return tr(`garden.pattern.${pattern}` as MessageKey);
}

/** "July 15" for a UTC day. */
export function longDate(ms: number, tr: Translator = EN): string {
  const d = new Date(ms);
  return tr('garden.date.long', {
    month: tr(`garden.month.${d.getUTCMonth()}` as MessageKey),
    day: d.getUTCDate()
  });
}

/** "Jul 1" for a UTC day. */
export function shortDate(ms: number, tr: Translator = EN): string {
  const d = new Date(ms);
  return tr('garden.date.short', {
    month: tr(`garden.monthShort.${d.getUTCMonth()}` as MessageKey),
    day: d.getUTCDate()
  });
}

/** `YYYY-MM-DD` for a UTC day. */
export function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseYmd(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Feet with at most one decimal, no trailing zero: 4, 2.5. */
export function ft(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "1 foot", "2.5 feet". */
export function feet(n: number, tr: Translator = EN): string {
  return tr('garden.feet', { count: Number(ft(n)), n: ft(n) });
}

export function sizeLabel(widthFt: number, lengthFt: number): string {
  return `${ft(widthFt)}×${ft(lengthFt)} ft`;
}

export function bedStyleLabel(style: BedStyle, tr: Translator = EN): string {
  return tr(`garden.bedStyle.${style}` as MessageKey);
}

export function bedKindLabel(
  bed: Pick<BedLayout, 'kind' | 'bedStyle'>,
  tr: Translator = EN
): string {
  if (bed.kind === 'container') return tr('garden.bedKind.container');
  const style = bed.bedStyle ? bedStyleLabel(bed.bedStyle, tr).toLowerCase() : null;
  return style ? tr('garden.bedKind.styled', { style }) : tr('garden.bedKind.bed');
}

export function countOf(
  kind: 'plant' | 'sowing' | 'planting',
  n: number,
  tr: Translator = EN
): string {
  return tr(`garden.count.${kind}` as TranslateKey, { count: n });
}

/** The family's plain name, translated when the catalog knows it. */
export function familyName(family: string, tr: Translator = EN): string {
  const key = `garden.family.${family}` as MessageKey;
  const hit = tr(key);
  return hit === key ? familyLabel(family) : hit;
}

export function stageLabel(stage: 'Growing' | 'Harvesting', tr: Translator = EN): string {
  return tr(`garden.stage.${stage}` as MessageKey);
}

/** The planting row's status; mirrors `plantingStatusText`. */
export function statusLabel(
  p: GroundFacts,
  nowMs: number,
  stage: 'Growing' | 'Harvesting' | null | undefined,
  tr: Translator = EN
): string {
  if (p.status === 'harvested') return tr('garden.status.harvested');
  if (p.status === 'failed') return tr('garden.status.failed');
  if (p.status === 'archived') return tr('garden.status.archived');
  if (!plantingInGround(p, nowMs)) {
    return p.plantingDateMs != null
      ? tr('garden.status.planned', { date: shortDate(p.plantingDateMs, tr) })
      : tr('garden.status.notDated');
  }
  return stage ? stageLabel(stage, tr) : tr('garden.status.inGround');
}

export function plantingLabel(p: Pick<PlacedPlanting, 'varietyDisplayName'>): string {
  return p.varietyDisplayName;
}

/** Stable family tint index so a family keeps its color everywhere. */
export function familyTone(family: string): number {
  let h = 0;
  for (let i = 0; i < family.length; i++) h = (h * 31 + family.charCodeAt(i)) >>> 0;
  return h % 6;
}
