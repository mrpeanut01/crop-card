/** A crop's own sourced prune and harvest steps (Phase 37F, R-20). The
 *  English is plugin data quoted word for word from a source; the Spanish
 *  lives in the `herbsf` catalog under `herbsf.care.<pluginId>.<key>.
 *  <title|body>` and replaces the English only while the shown text still
 *  equals the shipped English, so a farm copy's own wording shows as
 *  written. Client-safe. */

import { t, type MessageKey } from '$lib/i18n';
import { enHerbsf } from '$lib/i18n/catalogs/en/herbsf';
import type { CropCareTask } from '$lib/plugins/schemas';
import type { SnapshotCareTask } from '$lib/cards/snapshot';

export type CropCarePart = 'title' | 'body';

const SHIPPED = enHerbsf as Readonly<Record<string, string | undefined>>;

export function cropCareMessageKey(pluginId: string, key: string, part: CropCarePart): string {
  return `herbsf.care.${pluginId}.${key}.${part}`;
}

export function cropCareTasksOf(p: { careTasks?: readonly CropCareTask[] }): SnapshotCareTask[] {
  return (p.careTasks ?? []).map((c) => ({
    key: c.key,
    title: c.title,
    ...(c.body ? { body: c.body } : {}),
    crop: c.topic
  }));
}

/** A crop care row's title or body in `locale`, while it is the shipped English. */
export function cropCareText(
  pluginId: string,
  key: string | undefined,
  part: CropCarePart,
  shown: string,
  locale?: string | null
): string {
  if (!locale || locale === 'en' || !key) return shown;
  const msg = cropCareMessageKey(pluginId, key, part);
  if (SHIPPED[msg] === undefined || SHIPPED[msg] !== shown) return shown;
  return t(locale, msg as MessageKey);
}
