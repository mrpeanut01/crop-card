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
 *   product not allowed for organic use.
 */

export interface LabelSourcePlugin {
  pluginId: string;
  type: string;
  displayName: string;
  reEntryIntervalHours?: number;
  preHarvestIntervalsByCrop?: ReadonlyArray<{
    cropPluginId?: string;
    cropFamily?: string;
    preHarvestIntervalDays: number;
  }>;
  complianceFlags?: { omriListed?: boolean; certifiedOrganicAllowed?: boolean };
}

interface QuotedSource {
  sourceUrl?: unknown;
  quote?: unknown;
}

export interface LabelSources {
  rei?: Record<string, unknown>;
  phiByCrop?: Record<string, unknown>;
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
