/**
 * The forage check section on the live Area Card (Phase 33C, M-53).
 * Pure and client-safe. The advisory is fetched in the browser from
 * `GET /api/forage/advisory` when the card opens; it never blocks and an
 * absent or failed check never reads as "no risk".
 */

import { mergeProvenance, type CardModel, type CardSection } from '$lib/cards/model';
import type { ForageAdvisory } from '$lib/forage/advisory';
import { t } from '$lib/i18n';

export type {
  ForageAdvisory,
  ForageAdvisoryItem,
  ForageTestView,
  ForageTriggerOnFile
} from '$lib/forage/advisory';

export const FORAGE_FAILED_TEXT = 'Could not load the forage check.';
export const FORAGE_FROST_UNKNOWN_TEXT = 'Frost data could not be read. Check whether it froze.';
export const FORAGE_SECTION_TITLE = 'Forage check';
export const FORAGE_ADVICE_LEAD = 'Sources advise:';

/** The plain lines of an advisory, in reading order. The hazard lines stay
 *  English; only the lead-in follows `locale`. */
export function forageLines(advisory: ForageAdvisory, locale?: string | null): string[] {
  const lead = locale ? t(locale, 'forage.panel.lead') : FORAGE_ADVICE_LEAD;
  const out: string[] = [];
  for (const item of advisory.items) {
    out.push(item.headline);
    for (const t of item.triggersOnFile) out.push(t.text);
    if (item.frostUnknown) out.push(FORAGE_FROST_UNKNOWN_TEXT);
    out.push(item.raisesRisk);
    if (item.advice.length) out.push(lead);
    for (const a of item.advice) out.push(a.text);
    if (item.latestTest) {
      if (item.latestTest.ratingText) out.push(item.latestTest.ratingText);
      if (item.latestTest.valueText) out.push(item.latestTest.valueText);
      if (item.latestTest.convertedText) out.push(item.latestTest.convertedText);
    }
  }
  return out;
}

/** The lines of `forageLines` that stay English as hazard wording. */
export function forageHazardLines(advisory: ForageAdvisory): string[] {
  const out: string[] = [];
  for (const item of advisory.items) {
    out.push(item.headline);
    for (const t of item.triggersOnFile) out.push(t.text);
    if (item.frostUnknown) out.push(FORAGE_FROST_UNKNOWN_TEXT);
    out.push(item.raisesRisk);
    for (const a of item.advice) out.push(a.text);
  }
  return out;
}

export function forageSection(
  advisory: ForageAdvisory | null | undefined,
  failed = false,
  locale?: string | null
): CardSection | null {
  const title = locale ? t(locale, 'forage.section.title') : FORAGE_SECTION_TITLE;
  if (failed) {
    return { title, items: [locale ? t(locale, 'forage.panel.failed') : FORAGE_FAILED_TEXT] };
  }
  if (!advisory || advisory.items.length === 0) return null;
  const hasTest = advisory.items.some((i) => i.latestTest);
  return {
    title,
    items: forageLines(advisory, locale),
    englishOnlyItems: forageHazardLines(advisory),
    provenance: hasTest ? 'manual' : advisory.provenance,
    collapsible: true
  };
}

/** The Area Card with its forage check added after any grazing section,
 *  plus the "Record a forage test" link. Unchanged when nothing applies. */
export function withForageAdvisory(
  card: CardModel,
  advisory: ForageAdvisory | null | undefined,
  failed = false,
  locale?: string | null
): CardModel {
  const section = forageSection(advisory, failed, locale);
  if (!section) return card;
  const at = card.sections[0]?.title === 'Grazing' ? 1 : 0;
  const sections = [...card.sections.slice(0, at), section, ...card.sections.slice(at)];
  if (failed || !advisory) return { ...card, sections };
  const provenance = mergeProvenance([
    ...card.provenance,
    { source: 'plugin', detail: locale ? t(locale, 'forage.prov.hazards') : 'forage hazards' },
    ...(advisory.items.some((i) => i.latestTest)
      ? [
          {
            source: 'manual' as const,
            detail: locale ? t(locale, 'forage.prov.labRating') : 'lab rating entered by you'
          }
        ]
      : [])
  ]);
  return {
    ...card,
    sections,
    provenance,
    links: [
      ...(card.links ?? []),
      {
        label: locale ? t(locale, 'forage.record') : 'Record a forage test',
        href: advisory.recordHref
      }
    ]
  };
}
