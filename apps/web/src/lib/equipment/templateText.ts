import { t, type MessageKey } from '$lib/i18n';
import { en } from '$lib/i18n/catalogs/en';

export type TemplatePart = 'category' | 'label' | 'description';

const SHIPPED = en as Record<string, string | undefined>;

export function templateMessageKey(templateId: string, part: TemplatePart): string {
  return `equip.tpl.${templateId}.${part}`;
}

/** A starter-library equipment template's category, label or description in
 *  the viewer's language. Text that no longer matches the shipped English
 *  (or a template the catalog does not know) is shown as given. */
export function templateText(
  templateId: string,
  part: TemplatePart,
  english: string,
  locale?: string | null
): string {
  if (!locale || locale === 'en') return english;
  const key = templateMessageKey(templateId, part);
  if (SHIPPED[key] !== english) return english;
  return t(locale, key as MessageKey);
}
