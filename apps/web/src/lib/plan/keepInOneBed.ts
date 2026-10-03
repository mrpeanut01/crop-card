import { z } from 'zod';

/** Owner setting key holding the crops the farm keeps in one bed (R-15). */
export const KEEP_IN_ONE_BED_SETTING = 'layout_keep_in_one_bed';
export const KEEP_IN_ONE_BED_MAX = 500;

export const keepInOneBedRequestSchema = z.object({
  cropPluginId: z.string().min(1).max(200),
  keep: z.boolean()
});

/** Reads the stored JSON list; anything malformed reads as empty. */
export function parseKeepInOneBed(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeKeepInOneBed(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return [];
  }
}

/** Sorted, unique, non-empty, at most 500 ids. */
export function normalizeKeepInOneBed(ids: ReadonlyArray<string>): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))].sort().slice(0, KEEP_IN_ONE_BED_MAX);
}

/** The list after turning one crop on or off. */
export function withKeepInOneBed(
  current: ReadonlyArray<string>,
  cropPluginId: string,
  keep: boolean
): string[] {
  const set = new Set(current);
  if (keep) set.add(cropPluginId);
  else set.delete(cropPluginId);
  return normalizeKeepInOneBed([...set]);
}
