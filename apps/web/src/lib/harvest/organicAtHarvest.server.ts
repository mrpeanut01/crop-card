/**
 * The two organic reads the disposition endpoints need (B-27, B-32), on
 * top of B1's status projection.
 */

import { hasOrganicStatusRows } from '$lib/db/organicStatus';
import { blockOrganicStatusAt } from '$lib/organic/status.server';
import { organicStatusLine } from '$lib/organic/status';

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
  fmtDate: (ms: number) => string
): string | null {
  const s = blockOrganicStatusAt(blockId, harvestMs);
  if (s?.status === 'organic') return null;
  const day = fmtDate(harvestMs);
  if (!s) return `This block had no organic status on file on ${day}.`;
  const line = organicStatusLine(s, fmtDate) ?? '';
  return `This block was ${line.charAt(0).toLowerCase()}${line.slice(1)} on ${day}.`;
}
