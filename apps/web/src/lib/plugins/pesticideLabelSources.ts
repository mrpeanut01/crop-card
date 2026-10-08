/**
 * #640 #661 #716 — source checks for pesticide label values that the
 * library may only carry with a quoted primary source in
 * apps/web/scripts/epa-reg-sources.json:
 *
 * - a herbicide `reEntryIntervalHours` needs a `rei` entry whose quote
 *   states the hours;
 * - every `preHarvestIntervalsByCrop` row needs a `phiByCrop` entry for the
 *   same crop (`cropPluginId`, or one of a shared `cropPluginIds` list) or
 *   family whose quote states the days; a crop is listed once per plugin and
 *   names a crop plugin in the library;
 * - a display name that says OMRI may not sit beside flags that mark the
 *   product not allowed for organic use;
 * - `omriListed`, `certifiedOrganicAllowed` or `transitioningAllowed` set to
 *   true needs a `complianceFlags` entry that quotes an OMRI Products List
 *   NOP listing, or (never for `omriListed`) a 7 CFR 205 quote (#779);
 * - a herbicide default `ratePerAcre` ships only as `rateProvenance:
 *   'label'` with a `rate` entry whose quote states the amount, or as an
 *   explicit `rateProvenance: 'fallback'` (swarm 2026-10-07, #737);
 * - a herbicide whose chemistry class is in `LABEL_SOURCED_CLASSES` needs a
 *   `chemistryClass` entry for that class whose quote states the HRAC group
 *   (#654).
 */

export const LABEL_SOURCED_CLASSES: Readonly<Record<string, number>> = { thiocarbamate: 15 };

export interface LabelSourcePlugin {
  pluginId: string;
  type: string;
  displayName: string;
  reEntryIntervalHours?: number;
  ratePerAcre?: { amount: number; unit: string };
  rateProvenance?: string;
  preHarvestIntervalsByCrop?: ReadonlyArray<{
    cropPluginId?: string;
    cropFamily?: string;
    preHarvestIntervalDays: number;
  }>;
  complianceFlags?: {
    omriListed?: boolean;
    certifiedOrganicAllowed?: boolean;
    transitioningAllowed?: boolean;
  };
  activeIngredients?: ReadonlyArray<{ chemistryClass?: string }>;
}

interface QuotedSource {
  sourceUrl?: unknown;
  quote?: unknown;
}

export interface LabelSources {
  rei?: Record<string, unknown>;
  phiByCrop?: Record<string, unknown>;
  rate?: Record<string, unknown>;
  chemistryClass?: Record<string, unknown>;
  complianceFlags?: Record<string, unknown>;
}

function statesNumber(quote: unknown, n: number): boolean {
  return typeof quote === 'string' && new RegExp(`(^|[^0-9.])${n}([^0-9]|$)`).test(quote);
}

function hasUrl(s: QuotedSource): boolean {
  return typeof s.sourceUrl === 'string' && /^https:\/\//.test(s.sourceUrl);
}

type PhiSource = QuotedSource & {
  cropPluginId?: unknown;
  cropPluginIds?: unknown;
  cropFamily?: unknown;
};

/** `cropPluginIds`, when given, are the crop plugins in the library; a
 *  by-crop PHI naming any other id is a gap. */
export function pesticideLabelSourceGaps(
  plugins: readonly LabelSourcePlugin[],
  sources: LabelSources,
  cropPluginIds?: ReadonlySet<string>
): string[] {
  const gaps: string[] = [];
  for (const p of plugins) {
    if (p.type === 'herbicide' && typeof p.reEntryIntervalHours === 'number') {
      const s = sources.rei?.[p.pluginId] as
        (QuotedSource & { reEntryIntervalHours?: unknown }) | undefined;
      if (!s) gaps.push(`${p.pluginId}: reEntryIntervalHours has no rei source`);
      else if (
        s.reEntryIntervalHours !== p.reEntryIntervalHours ||
        !hasUrl(s) ||
        !statesNumber(s.quote, p.reEntryIntervalHours)
      ) {
        gaps.push(`${p.pluginId}: rei source does not quote ${p.reEntryIntervalHours} hours`);
      }
    }
    if (p.type === 'herbicide') gaps.push(...rateGaps(p, sources), ...classGaps(p, sources));
    const seen = new Set<string>();
    for (const row of p.preHarvestIntervalsByCrop ?? []) {
      const key = row.cropPluginId ?? row.cropFamily ?? '?';
      if (seen.has(key)) gaps.push(`${p.pluginId}: PHI for ${key} is listed twice`);
      seen.add(key);
      if (row.cropPluginId && cropPluginIds && !cropPluginIds.has(row.cropPluginId)) {
        gaps.push(`${p.pluginId}: PHI names ${row.cropPluginId}, which is not a crop plugin`);
      }
      const list = sources.phiByCrop?.[p.pluginId];
      const match = (Array.isArray(list) ? list : []).find((s: PhiSource) =>
        row.cropPluginId
          ? s.cropPluginId === key ||
            (Array.isArray(s.cropPluginIds) && s.cropPluginIds.includes(key))
          : s.cropFamily === key
      ) as (QuotedSource & { preHarvestIntervalDays?: unknown }) | undefined;
      if (!match) gaps.push(`${p.pluginId}: PHI for ${key} has no phiByCrop source`);
      else if (
        match.preHarvestIntervalDays !== row.preHarvestIntervalDays ||
        !hasUrl(match) ||
        !statesNumber(match.quote, row.preHarvestIntervalDays)
      ) {
        gaps.push(
          `${p.pluginId}: phiByCrop source does not quote ${row.preHarvestIntervalDays} days for ${key}`
        );
      }
    }
    if (
      /\bOMRI\b/.test(p.displayName) &&
      (p.complianceFlags?.omriListed === false ||
        p.complianceFlags?.certifiedOrganicAllowed === false)
    ) {
      gaps.push(`${p.pluginId}: the name says OMRI but the flags mark it not allowed`);
    }
    gaps.push(...organicFlagGaps(p, sources));
  }
  return gaps;
}

function rateGaps(p: LabelSourcePlugin, sources: LabelSources): string[] {
  const s = sources.rate?.[p.pluginId] as
    (QuotedSource & { ratePerAcre?: { amount?: unknown; unit?: unknown } }) | undefined;
  if (!p.ratePerAcre) {
    return p.rateProvenance ? [`${p.pluginId}: rateProvenance set but no ratePerAcre`] : [];
  }
  if (p.rateProvenance === 'fallback') {
    return s ? [`${p.pluginId}: has a quoted label rate but is marked fallback`] : [];
  }
  if (p.rateProvenance !== 'label') {
    return [`${p.pluginId}: ratePerAcre needs a rate label quote or rateProvenance "fallback"`];
  }
  if (!s) return [`${p.pluginId}: label ratePerAcre has no rate source`];
  if (
    s.ratePerAcre?.amount !== p.ratePerAcre.amount ||
    s.ratePerAcre?.unit !== p.ratePerAcre.unit ||
    !hasUrl(s) ||
    !statesNumber(s.quote, p.ratePerAcre.amount)
  ) {
    return [
      `${p.pluginId}: rate source does not quote ${p.ratePerAcre.amount} ${p.ratePerAcre.unit}`
    ];
  }
  return [];
}

function classGaps(p: LabelSourcePlugin, sources: LabelSources): string[] {
  const gaps: string[] = [];
  for (const ai of p.activeIngredients ?? []) {
    const cls = ai.chemistryClass;
    if (!cls || !(cls in LABEL_SOURCED_CLASSES)) continue;
    const group = LABEL_SOURCED_CLASSES[cls];
    const s = sources.chemistryClass?.[p.pluginId] as
      (QuotedSource & { chemistryClass?: unknown; hracGroup?: unknown }) | undefined;
    if (!s) gaps.push(`${p.pluginId}: ${cls} has no chemistryClass source`);
    else if (
      s.chemistryClass !== cls ||
      s.hracGroup !== group ||
      !hasUrl(s) ||
      typeof s.quote !== 'string' ||
      !new RegExp(`Group ${group}\\b`).test(s.quote)
    ) {
      gaps.push(`${p.pluginId}: chemistryClass source does not quote Group ${group} for ${cls}`);
    }
  }
  return gaps;
}

const ALLOWED_ORGANIC_FLAGS = [
  'omriListed',
  'certifiedOrganicAllowed',
  'transitioningAllowed'
] as const;

interface OrganicSource extends QuotedSource {
  omriListed?: unknown;
  basis?: unknown;
  citation?: unknown;
}

function isOmriListing(s: OrganicSource): boolean {
  return (
    s.omriListed === true &&
    typeof s.sourceUrl === 'string' &&
    s.sourceUrl.startsWith('https://www.omri.org/') &&
    typeof s.quote === 'string' &&
    /\| [a-z]{3}-\d{3,6} \| NOP \| Allowed( with Restrictions)? \|/.test(s.quote)
  );
}

function isCfr205(s: OrganicSource): boolean {
  return (
    s.basis === '7 CFR 205' &&
    typeof s.citation === 'string' &&
    /^7 CFR 205\.\d+/.test(s.citation) &&
    typeof s.sourceUrl === 'string' &&
    s.sourceUrl.startsWith('https://www.ecfr.gov/') &&
    typeof s.quote === 'string' &&
    s.quote.trim().length > 0
  );
}

function organicFlagGaps(p: LabelSourcePlugin, sources: LabelSources): string[] {
  const set = ALLOWED_ORGANIC_FLAGS.filter((k) => p.complianceFlags?.[k] === true);
  if (set.length === 0) return [];
  const s = sources.complianceFlags?.[p.pluginId] as OrganicSource | undefined;
  if (s && isOmriListing(s)) return [];
  if (s && isCfr205(s)) {
    return p.complianceFlags?.omriListed === true
      ? [`${p.pluginId}: omriListed needs an OMRI listing, not a 7 CFR 205 quote`]
      : [];
  }
  return [`${p.pluginId}: ${set.join(', ')} true with no OMRI listing or 7 CFR 205 quote`];
}
