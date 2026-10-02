/**
 * Loader data for the organic input notice (33B, B-21). Each record page
 * adds `organicBlocks`: the B-14 status line of every block that is under
 * an owner-entered organic or transitioning status today. Null when the
 * farm's organic chrome is not `full`, so the notice renders nothing.
 */

import {
  blockOrganicStatuses,
  farmOrganicChrome,
  organicDateFormatter
} from '$lib/organic/status.server';
import { isUnderOrganic, organicStatusLine } from '$lib/organic/status';

export function organicBlocksForNotice(
  blockIds: readonly string[],
  now: number = Date.now()
): Record<string, string> | null {
  if (farmOrganicChrome() !== 'full') return null;
  const out: Record<string, string> = {};
  if (blockIds.length === 0) return out;
  const fmt = organicDateFormatter();
  for (const [id, s] of blockOrganicStatuses(blockIds, now)) {
    if (!isUnderOrganic(s)) continue;
    const line = organicStatusLine(s, fmt);
    if (line) out[id] = line;
  }
  return out;
}
