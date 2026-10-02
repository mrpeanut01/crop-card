import { page } from '$app/state';
import { cropDisplayName } from './cropName';

/** `cropDisplayName` for the page's active locale, for client code that is
 *  not a component template. Display only. */
export function pageCropName(pluginId: string | null | undefined, englishName: string): string {
  let locale: string | null | undefined;
  try {
    locale = page.data?.locale;
  } catch {
    locale = undefined;
  }
  return cropDisplayName(pluginId, englishName, locale);
}
