import { t, type TranslateKey } from '$lib/i18n';

const DEFAULT_TYPES = [
  'sprayer',
  'planter',
  'drill',
  'rake',
  'baler',
  'tractor',
  'mower',
  'irrigation',
  'other'
] as const;
type DefaultType = (typeof DEFAULT_TYPES)[number];

function defaultType(name: string): DefaultType | null {
  const key = name.trim().toLowerCase();
  return (DEFAULT_TYPES as readonly string[]).includes(key) ? (key as DefaultType) : null;
}

/** A built-in equipment type's name in `locale`. A type the farm added itself,
 *  or no locale, comes back as given. */
export function equipmentTypeLabel(name: string, locale?: string | null): string {
  const known = defaultType(name);
  if (!known || !locale || locale === 'en') return name;
  return t(locale, `equip.typeName.${known}` as TranslateKey);
}

/** A built-in equipment type's description in `locale`; the stored text otherwise. */
export function equipmentTypeDescription(
  name: string,
  description: string | null | undefined,
  locale?: string | null
): string {
  const known = defaultType(name);
  if (!known || !locale || locale === 'en' || !description) return description ?? '';
  return t(locale, `equip.typeDesc.${known}` as TranslateKey);
}
