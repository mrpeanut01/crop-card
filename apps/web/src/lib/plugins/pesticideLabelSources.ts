/**
 * #640 #661 #716 — source checks for pesticide label values that the
 * library may only carry with a quoted primary source in
 * apps/web/scripts/epa-reg-sources.json:
 *
 * - a herbicide `reEntryIntervalHours` needs a `rei` entry whose quote
 *   states the hours;
 * - every `preHarvestIntervalsByCrop` row needs a `phiByCrop` entry for the
 *   same crop or family whose quote states the days;
 * - a display name that says OMRI may not sit beside flags that mark the
 *   product not allowed for organic use;
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
  complianceFlags?: { omriListed?: boolean; certifiedOrganicAllowed?: boolean };
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
}

function statesNumber(quote: unknown, n: number): boolean {
  return typeof quote === 'string' && new RegExp(`(^|[^0-9.])${n}([^0-9]|$)`).test(quote);
}

function hasUrl(s: QuotedSource): boolean {
  return typeof s.sourceUrl === 'string' && /^https:\/\//.test(s.sourceUrl);
}

export function pesticideLabelSourceGaps(
  plugins: readonly LabelSourcePlugin[],
  sources: LabelSources
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
    for (const row of p.preHarvestIntervalsByCrop ?? []) {
      const key = row.cropPluginId ?? row.cropFamily ?? '?';
      const list = sources.phiByCrop?.[p.pluginId];
      const match = (Array.isArray(list) ? list : []).find(
        (s: QuotedSource & { cropPluginId?: unknown; cropFamily?: unknown }) =>
          (s.cropPluginId ?? s.cropFamily) === key
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
