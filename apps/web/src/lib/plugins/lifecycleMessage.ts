import { t } from '$lib/i18n';

interface LifecycleErrorLike {
  message: string;
  code: 'not-found' | 'still-referenced' | 'fs-error';
  references?: { total: number };
}

/** The UI text for a plugin retire / unretire / uninstall refusal. A file
 *  system error keeps its English detail. */
export function lifecycleErrorMessage(
  e: LifecycleErrorLike,
  pluginId: string,
  locale?: string | null
): string {
  if (e.code === 'not-found') return t(locale, 'pluginui.api.notFound', { id: pluginId });
  if (e.code === 'still-referenced' && e.references) {
    return t(locale, 'pluginui.api.stillReferenced', {
      id: pluginId,
      count: e.references.total
    });
  }
  return e.message;
}
