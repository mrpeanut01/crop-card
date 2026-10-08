import { cropDisplayName } from '$lib/i18n/cropName';

export interface NamedBlock {
  id: string;
  name: string;
}

/** Block id → name, for lists that only carry the id (recent events, REI). */
export function blockNameMap(blocks: readonly NamedBlock[]): Record<string, string> {
  return Object.fromEntries(blocks.map((b) => [b.id, b.name]));
}

/** A block's name, or `fallback` when the block is gone; never the raw id. */
export function blockNameOf(
  names: Readonly<Record<string, string>>,
  blockId: string,
  fallback: string
): string {
  const name = names[blockId];
  return name && name.trim() !== '' ? name : fallback;
}

/** Crop names for plugin ids in the reader's language; an id the loader has
 *  no name for is shown as is. */
export function cropNamesFor(
  pluginIds: readonly string[],
  englishNames: Readonly<Record<string, string>> | null | undefined,
  locale: string | null | undefined
): string[] {
  return pluginIds.map((id) => cropDisplayName(id, englishNames?.[id] ?? id, locale));
}

/** Sentences as one line with a space between each, skipping empty ones. */
export function joinSentences(...parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '')
    .join(' ');
}

/** The context strip's crop line: one crop by name, several as a count. */
export function cropContextLabel(
  pluginIds: readonly string[],
  englishNames: Readonly<Record<string, string>> | null | undefined,
  locale: string | null | undefined,
  countLabel: (count: number) => string
): string {
  if (pluginIds.length === 0) return '—';
  if (pluginIds.length === 1) return cropNamesFor(pluginIds, englishNames, locale)[0];
  return countLabel(pluginIds.length);
}
