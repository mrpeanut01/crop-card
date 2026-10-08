/**
 * Ruling LF-2 (#737 follow-up): when the label behind a plugin's rates by
 * crop or stage limits was filed under a registration number other than the
 * plugin's own, every place those show says so. The notice is derived from
 * the source URL in epa-reg-sources.json, never typed per plugin. EPA PPLS
 * file names carry the registration and the stamp date:
 * `066330-00276-20090911.pdf` is registration 66330-276, stamped 2009-09-11.
 */

import { t } from '$lib/i18n';

export interface EarlierLabel {
  /** The registration the label was filed under, e.g. "66330-276". */
  registration: string;
  /** The label's year, e.g. "2009". */
  year: string;
}

export interface LabelSourceRef {
  sourceUrl?: unknown;
  docDate?: unknown;
}

const PPLS_FILE = /\/ppls\/(\d+)-(\d+)-(\d{8})\.pdf$/i;

/** The registration and stamp date a PPLS label URL names, or null for any
 *  other URL. */
export function pplsLabelRegistration(
  url: unknown
): { registration: string; stamped: string } | null {
  if (typeof url !== 'string') return null;
  const m = PPLS_FILE.exec(url.trim().split(/[?#]/)[0]);
  if (!m) return null;
  const [, company, product, date] = m;
  return {
    registration: `${Number(company)}-${Number(product)}`,
    stamped: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  };
}

/** Company and product number of a registration, leading zeros dropped. A
 *  distributor number (1381-146-34704) shares its base with 1381-146. */
export function baseRegistration(reg: unknown): string | null {
  if (typeof reg !== 'string') return null;
  const parts = reg.trim().split('-');
  if (parts.length < 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  return `${Number(parts[0])}-${Number(parts[1])}`;
}

/** The labels among `sources` filed under a registration other than the
 *  plugin's, one per registration and year, oldest first. Sources that are
 *  not PPLS files, and plugins with no registration number, give none. */
export function earlierRegistrationLabels(
  pluginRegistration: unknown,
  sources: ReadonlyArray<LabelSourceRef>
): EarlierLabel[] {
  const own = baseRegistration(pluginRegistration);
  if (!own) return [];
  const seen = new Map<string, EarlierLabel>();
  for (const s of sources) {
    const file = pplsLabelRegistration(s.sourceUrl);
    if (!file || file.registration === own) continue;
    const year =
      typeof s.docDate === 'string' && /^\d{4}/.test(s.docDate)
        ? s.docDate.slice(0, 4)
        : file.stamped.slice(0, 4);
    const key = `${file.registration}|${year}`;
    if (!seen.has(key)) seen.set(key, { registration: file.registration, year });
  }
  return [...seen.values()].sort(
    (a, b) => a.year.localeCompare(b.year) || a.registration.localeCompare(b.registration)
  );
}

/** "From a 2009 label of the earlier registration 66330-276. Check your
 *  current label." */
export function earlierLabelNotice(label: EarlierLabel, locale?: string | null): string {
  return t(locale, 'sprayui.cropRate.earlierLabel', {
    year: label.year,
    number: label.registration
  });
}
