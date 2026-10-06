/** App-owned lines on orchard calendar windows (OP-8). Plugins carry
 *  neither line. The bee line is the guide's own caution, word for word from
 *  apps/web/scripts/orchard-calendar-sources.json (`appLines.test.ts` keeps
 *  each one equal to its source quote), and stays English as safety text.
 *  "Check the label." is translated (`orchardui.checkLabel`). */

import { t, type MessageKey } from '$lib/i18n';
import { orchardStageName, orchardTargetLabel } from '$lib/i18n/orchardCalendarText';
import { en } from '$lib/i18n/catalogs/en';
import { scoutTitleParts } from './calendar';
import type { OrchardWindow } from '$lib/plugins/schemas';

export interface BeeLine {
  text: string;
  /** The source entry whose quote this is. */
  sourceKey: string;
}

/** By the guide's `publicationId`. */
export const ORCHARD_BEE_LINES: Readonly<Record<string, BeeLine>> = {
  'VCE 456-419': {
    text: 'CAUTION: To avoid killing bees, do not spray pesticides on open blooms of trees or ground vegetation.',
    sourceKey: 'pome-va-2026.petal-fall.bees'
  },
  'VCE 456-018': {
    text: 'Do not apply insecticides at bloom.',
    sourceKey: 'pome-home-va-2026.bloom.bees'
  }
};

/** A guide with no caution of its own still gets a bee line. */
export const FALLBACK_BEE_LINE =
  'Bees may be working open blossoms. Answer the bloom question on the insecticide form.';

export function beeLineFor(publicationId: string): string {
  return ORCHARD_BEE_LINES[publicationId]?.text ?? FALLBACK_BEE_LINE;
}

// ─── Scouting task titles (OC-7) ────────────────────────────────────────

function joinTargets(ids: readonly string[], more: number, locale: string): string {
  const names = ids.map((id) => orchardTargetLabel(id, locale)).join(', ');
  return more > 0 ? `${names} +${more}` : names;
}

/** "Scout: Apple scab, Fire blight +2" or, with no pest or disease named,
 *  "Check: Pink". Never names a product or a spray. */
export function orchardScoutTitle(
  calendarId: string,
  stage: { id: string; name: string },
  window: Pick<OrchardWindow, 'targets'>,
  locale?: string | null
): string {
  const loc = locale ?? 'en';
  const { targetIds, more } = scoutTitleParts(window);
  if (targetIds.length)
    return t(loc, 'orchardui.task.scout', { targets: joinTargets(targetIds, more, loc) });
  return t(loc, 'orchardui.task.check', { stage: orchardStageName(calendarId, stage, loc) });
}

const SHIPPED = en as Record<string, string | undefined>;
let reverse: { targets: Map<string, string>; stages: Map<string, string> } | null = null;

function reverseMaps() {
  if (reverse) return reverse;
  const targets = new Map<string, string>();
  const stages = new Map<string, string>();
  for (const [k, v] of Object.entries(SHIPPED)) {
    if (!v) continue;
    if (k.startsWith('orchard.target.')) targets.set(v, k);
    else if (k.startsWith('orchard.stage.') || /^orchard\.cal\..+\.stage\..+\.name$/.test(k))
      if (!stages.has(v)) stages.set(v, k);
  }
  reverse = { targets, stages };
  return reverse;
}

const SCOUT_EN = /^Scout: (.+?)(?: \+(\d+))?$/;
const CHECK_EN = /^Check: (.+)$/;

/** A stored scouting task title in `locale`, while it is still the English
 *  this app wrote. Anything else comes back as saved. */
export function orchardScoutTitleIn(title: string, locale: string | null | undefined): string {
  if (!locale || locale === 'en') return title;
  const maps = reverseMaps();
  const scout = SCOUT_EN.exec(title);
  if (scout) {
    const keys = scout[1].split(', ').map((n) => maps.targets.get(n));
    if (keys.some((k) => !k)) return title;
    const names = keys.map((k) => t(locale, k as MessageKey)).join(', ');
    return t(locale, 'orchardui.task.scout', {
      targets: scout[2] ? `${names} +${scout[2]}` : names
    });
  }
  const check = CHECK_EN.exec(title);
  if (check) {
    const key = maps.stages.get(check[1]);
    if (key) return t(locale, 'orchardui.task.check', { stage: t(locale, key as MessageKey) });
  }
  return title;
}
