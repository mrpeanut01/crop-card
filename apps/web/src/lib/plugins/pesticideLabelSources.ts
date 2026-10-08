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
 * - an organic "allowed" flag or an OMRI claim needs an OMRI or 7 CFR 205
 *   quote (`organicAllowedFlagGaps`, #779).
 */

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
}

interface QuotedSource {
  sourceUrl?: unknown;
  quote?: unknown;
}

export interface LabelSources {
  rei?: Record<string, unknown>;
  phiByCrop?: Record<string, unknown>;
  rate?: Record<string, unknown>;
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
    if (p.type === 'herbicide') gaps.push(...rateGaps(p, sources));
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

/**
 * #779 — an organic "allowed" mark (`omriListed`, `certifiedOrganicAllowed`
 * or `transitioningAllowed` set to true) ships only with an entry in
 * epa-reg-sources.json (`complianceFlags.<pluginId>` or a `complianceFlags`
 * data correction) that records that flag as true and quotes the OMRI
 * Products List (omri.org) or 7 CFR 205 (ecfr.gov or govinfo.gov). A
 * display name or note that says OMRI needs a sourced `omriListed: true`.
 */

export const ORGANIC_ALLOWED_FLAGS = [
  'omriListed',
  'certifiedOrganicAllowed',
  'transitioningAllowed'
] as const;

export type OrganicAllowedFlag = (typeof ORGANIC_ALLOWED_FLAGS)[number];

export interface OrganicFlagPlugin {
  pluginId: string;
  displayName: string;
  notes?: string;
  complianceFlags?: Partial<Record<OrganicAllowedFlag, boolean>>;
}

export interface OrganicFlagSources {
  complianceFlags?: Record<string, unknown>;
  dataCorrections?: Record<string, unknown>;
}

const OMRI_HOSTS = new Set(['omri.org', 'www.omri.org']);
const CFR_HOSTS = new Set(['ecfr.gov', 'www.ecfr.gov', 'govinfo.gov', 'www.govinfo.gov']);

type FlagSource = QuotedSource & Record<string, unknown>;

function isOrganicSource(s: FlagSource): boolean {
  if (typeof s.sourceUrl !== 'string' || typeof s.quote !== 'string') return false;
  let url: URL;
  try {
    url = new URL(s.sourceUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (OMRI_HOSTS.has(url.hostname)) return s.quote.trim().length > 0;
  return CFR_HOSTS.has(url.hostname) && /\b205\.\d/.test(s.quote);
}

function sourcedOrganicFlags(
  pluginId: string,
  sources: OrganicFlagSources
): Set<OrganicAllowedFlag> {
  const candidates: FlagSource[] = [];
  const entry = sources.complianceFlags?.[pluginId];
  if (entry && typeof entry === 'object') candidates.push(entry as FlagSource);
  const corrections = sources.dataCorrections?.[pluginId];
  for (const c of Array.isArray(corrections) ? corrections : []) {
    if (c?.path !== 'complianceFlags' || !c.to || typeof c.to !== 'object') continue;
    candidates.push({ ...c.to, sourceUrl: c.sourceUrl, quote: c.quote });
  }
  const out = new Set<OrganicAllowedFlag>();
  for (const c of candidates) {
    if (!isOrganicSource(c)) continue;
    for (const f of ORGANIC_ALLOWED_FLAGS) if (c[f] === true) out.add(f);
  }
  return out;
}

export function organicAllowedFlagGaps(
  plugins: readonly OrganicFlagPlugin[],
  sources: OrganicFlagSources
): string[] {
  const gaps: string[] = [];
  for (const p of plugins) {
    const sourced = sourcedOrganicFlags(p.pluginId, sources);
    for (const f of ORGANIC_ALLOWED_FLAGS) {
      if (p.complianceFlags?.[f] === true && !sourced.has(f)) {
        gaps.push(`${p.pluginId}: ${f} is true with no OMRI or 7 CFR 205 source`);
      }
    }
    const saysOmri = [p.displayName, p.notes].some(
      (s) => typeof s === 'string' && /\bOMRI\b/.test(s)
    );
    if (saysOmri && !(p.complianceFlags?.omriListed === true && sourced.has('omriListed'))) {
      gaps.push(`${p.pluginId}: the name or notes say OMRI with no sourced omriListed`);
    }
  }
  return gaps;
}
