/**
 * 33B server reads of owner-entered organic status (contract C-B1). Every
 * read is tenant-scoped through the repos.
 */

import { getBlock } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { hasOrganicStatusRows, listOrganicStatusEntries } from '$lib/db/organicStatus';
import { farmTimeZone } from '$lib/db/userProfile';
import { getFarmProfile } from '$lib/onboarding/state.server';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { formatInstant, todayYmd } from '$lib/prefs';
import { DEFAULT_PREFS } from '$lib/prefs';
import {
  organicChromeLevel,
  organicStatusLine,
  resolveAreaStatus,
  resolveBlockStatus,
  type EffectiveOrganicStatus,
  type OrganicChromeLevel,
  type OrganicStatusEntry
} from './status';

import { animalOrganicProjection } from './animalStatus.server';
import { organicHealthPlugins } from './plugins.server';

export { animalOrganicStatusAt } from './animalStatus.server';

function entriesByKey(entries: readonly OrganicStatusEntry[]): Map<string, OrganicStatusEntry[]> {
  const out = new Map<string, OrganicStatusEntry[]>();
  for (const e of entries) {
    const key = `${e.subjectType}:${e.subjectId}`;
    out.set(key, [...(out.get(key) ?? []), e]);
  }
  return out;
}

export function blockOrganicStatuses(
  blockIds: readonly string[],
  atMs: number
): Map<string, EffectiveOrganicStatus> {
  const out = new Map<string, EffectiveOrganicStatus>();
  if (blockIds.length === 0) return out;
  const entries = listOrganicStatusEntries().filter(
    (e) => e.subjectType === 'block' || e.subjectType === 'field'
  );
  if (entries.length === 0) return out;
  const byKey = entriesByKey(entries);
  const fieldNames = new Map<string, string | null>();
  for (const blockId of new Set(blockIds)) {
    const block = getBlock(blockId);
    if (!block) continue;
    let area: { id: string; name: string; entries: OrganicStatusEntry[] } | null = null;
    if (block.fieldId) {
      if (!fieldNames.has(block.fieldId)) {
        fieldNames.set(block.fieldId, getField(block.fieldId)?.name ?? null);
      }
      const name = fieldNames.get(block.fieldId);
      if (name !== null && name !== undefined) {
        area = { id: block.fieldId, name, entries: byKey.get(`field:${block.fieldId}`) ?? [] };
      }
    }
    const status = resolveBlockStatus(byKey.get(`block:${blockId}`) ?? [], area, atMs);
    if (status) out.set(blockId, status);
  }
  return out;
}

export function blockOrganicStatusAt(blockId: string, atMs: number): EffectiveOrganicStatus | null {
  return blockOrganicStatuses([blockId], atMs).get(blockId) ?? null;
}

export function fieldOrganicStatusAt(fieldId: string, atMs: number): EffectiveOrganicStatus | null {
  return resolveAreaStatus(
    listOrganicStatusEntries({ subjectType: 'field', subjectId: fieldId }),
    atMs
  );
}

/** Every entry, oldest first, with its live document ids. */
export function listOrganicStatusHistory(): OrganicStatusEntry[] {
  return listOrganicStatusEntries();
}

export function farmOrganicChrome(): OrganicChromeLevel {
  if (hasOrganicStatusRows()) return 'full';
  const prefs = { ...DEFAULT_PREFS, timeZone: farmTimeZone() };
  const year = Number(todayYmd(prefs).slice(0, 4));
  return organicChromeLevel({
    hasStatusRows: false,
    profile: getFarmProfile(),
    philosophy: loadSeasonSetup(year)?.philosophy ?? null
  });
}

/** Dates in status lines, in the farm's zone (B-08). */
export function organicDateFormatter(locale?: string | null): (ms: number) => string {
  const prefs = {
    ...DEFAULT_PREFS,
    timeZone: farmTimeZone(),
    ...(locale ? { locale } : {})
  };
  return (ms) => formatInstant(ms, prefs, 'date');
}

export interface OrganicSnapshotLines {
  line(subjectType: 'field' | 'animal' | 'group', id: string): string | null;
}

/** B-16: status lines for the offline snapshot, at the snapshot's window
 *  time. A farm with no entry pays one read and gets nulls. */
export async function organicSnapshotLines(atMs: number): Promise<OrganicSnapshotLines> {
  const entries = listOrganicStatusEntries();
  if (entries.length === 0) return { line: () => null };
  const fmt = organicDateFormatter();
  const byKey = entriesByKey(entries);
  const hasAnimal = entries.some((e) => e.subjectType === 'animal' || e.subjectType === 'group');
  const projection = hasAnimal ? animalOrganicProjection(await organicHealthPlugins()) : null;
  return {
    line(subjectType, id) {
      if (subjectType === 'field') {
        return organicStatusLine(resolveAreaStatus(byKey.get(`field:${id}`) ?? [], atMs), fmt);
      }
      if (!projection) return null;
      return organicStatusLine(projection.statusAt({ type: subjectType, id }, atMs), fmt);
    }
  };
}
