/**
 * The two organic reads the disposition endpoints need (B-27, B-32), on
 * top of B1's status projection.
 */

import { hasOrganicStatusRows } from '$lib/db/organicStatus';
import { blockOrganicStatusAt } from '$lib/organic/status.server';
import { organicStatusLine } from '$lib/organic/status';
import { t } from '$lib/i18n';

/** B-15 `full`: the farm has any organic status entry at all. Only then is
 *  "sold as organic" asked or stored. */
export function farmHasOrganicStatus(): boolean {
  return hasOrganicStatusRows();
}

/** B-32: the notice for a sale marked "sold as organic" from a block whose
 *  status at harvest was not `organic`. Null when no notice is due. */
export function soldAsOrganicNotice(
  blockId: string,
  harvestMs: number,
  fmtDate: (ms: number) => string,
  locale?: string | null
): string | null {
  const s = blockOrganicStatusAt(blockId, harvestMs);
  if (s?.status === 'organic') return null;
  const day = fmtDate(harvestMs);
  if (!s) return t(locale, 'harvestui.disp.noStatusOnDay', { date: day });
  const line = organicStatusLine(s, fmtDate, locale) ?? '';
  return t(locale, 'harvestui.disp.blockWas', {
    line: `${line.charAt(0).toLowerCase()}${line.slice(1)}`,
    date: day
  });
}
