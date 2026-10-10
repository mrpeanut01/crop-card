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
 *   (#654);
 * - every herbicide `ratePerAcreByCrop` row needs a `rateByCrop` entry for
 *   the same crop whose quote states the amount (and the maximum, when one
 *   is given), and every `stageLimitByCrop` row a `stageLimitByCrop` entry
 *   for the same crop whose quote contains the limit sentence (#737);
 * - every herbicide `seasonCapByCrop` row needs a `seasonCapByCrop` entry
 *   with the same crops, amount, unit and period whose quote states the
 *   amount and the period ("per crop year", "per 365 days"), and a crop is
 *   capped at most once per plugin (#820).
 */

export const LABEL_SOURCED_CLASSES: Readonly<Record<string, number>> = { thiocarbamate: 15 };

export interface LabelSourcePlugin {
  pluginId: string;
  type: string;
  displayName: string;
  reEntryIntervalHours?: number;
  ratePerAcre?: { amount: number; unit: string };
  rateProvenance?: string;
  ratePerAcreByCrop?: ReadonlyArray<{
    cropPluginId: string;
    amount: number;
    maxAmount?: number;
    unit: string;
  }>;
  stageLimitByCrop?: ReadonlyArray<{ cropPluginId: string; limit: string }>;
  seasonCapByCrop?: ReadonlyArray<{
    cropPluginIds: readonly string[];
    amount: number;
    unit: string;
    period: string;
  }>;
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
  rateByCrop?: Record<string, unknown>;
  stageLimitByCrop?: Record<string, unknown>;
  seasonCapByCrop?: Record<string, unknown>;
}

function statesNumber(quote: unknown, n: number): boolean {
  return typeof quote === 'string' && new RegExp(`(^|[^0-9.])${n}([^0-9]|$)`).test(quote);
}

const WEEK_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A PHI quote states its days as a number, as whole weeks ("three weeks
 *  prior to harvest" for 21), or a 0-day PHI as the label's "day of harvest"
 *  wording ("May be applied the day of harvest."). */
export function statesPhiDays(quote: unknown, n: number): boolean {
  if (statesNumber(quote, n)) return true;
  if (typeof quote !== 'string') return false;
  if (n > 0 && n % 7 === 0) {
    const w = n / 7;
    const forms = [String(w), ...(w <= WEEK_WORDS.length ? [WEEK_WORDS[w - 1]] : [])];
    if (forms.some((f) => new RegExp(`(^|[^0-9a-z])${f}[ -]weeks?\\b`, 'i').test(quote)))
      return true;
  }
  return (
    n === 0 &&
    /\b(the|up to(?: and including)?(?: the)?)(?: \.\.\.)? day(?: \.\.\.)? of(?: \.\.\.)? harvest\b/i.test(
      quote
    )
  );
}

const FRACTIONS: Record<string, readonly string[]> = {
  '0.25': ['1/4', '¼'],
  '0.5': ['1/2', '½'],
  '0.75': ['3/4', '¾']
};

/** A quote states an amount as a decimal or, for quarters and halves, as a
 *  label fraction ("½ pint", "1 1/2 pints"). */
export function statesAmount(quote: unknown, n: number): boolean {
  if (typeof quote !== 'string') return false;
  if (statesNumber(quote, n)) return true;
  const whole = Math.floor(n);
  const frac = FRACTIONS[String(Math.round((n - whole) * 100) / 100)];
  if (!frac) return false;
  return frac.some((f) => {
    const forms = whole === 0 ? [f] : [`${whole} ${f}`, `${whole}${f}`];
    return forms.some((form) => {
      const esc = form.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      return new RegExp(`(^|[^0-9/])${esc}([^0-9/]|$)`).test(quote);
    });
  });
}

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function hasUrl(s: QuotedSource): boolean {
  return typeof s.sourceUrl === 'string' && /^https:\/\//.test(s.sourceUrl);
}

export interface TraitClaimPlugin {
  pluginId: string;
  type: string;
  epaRegistrationNumber?: string;
  activeIngredients?: ReadonlyArray<{ chemistryClass?: string }>;
  traitGatedSafeFor?: ReadonlyArray<{ cropPluginId: string; requiresTraits: string[] }>;
}

/** "100-1182" as the PPLS file stem "000100-01182". */
function pplsStem(reg: string): string | null {
  const m = /^(\d+)-(\d+)$/.exec(reg);
  return m ? `${m[1].padStart(6, '0')}-${m[2].padStart(5, '0')}` : null;
}

/**
 * #720 ruling R720-1: a glyphosate herbicide's `traitGatedSafeFor` claim
 * lifts the kernel's family-kill stop for that crop, so each one needs a
 * `traitGatedSafeFor.<pluginId>.<cropPluginId>` entry in
 * epa-reg-sources.json quoting the product's own PPLS label (the file for
 * its EPA number) on postemergence use over Roundup Ready or
 * glyphosate-tolerant plantings of that crop. An entry with no matching
 * claim is stale.
 */
export function traitClaimSourceGaps(
  plugins: readonly TraitClaimPlugin[],
  sources: { traitGatedSafeFor?: Record<string, unknown> }
): string[] {
  const gaps: string[] = [];
  const section = sources.traitGatedSafeFor ?? {};
  const byId = new Map(plugins.map((p) => [p.pluginId, p]));
  for (const p of plugins) {
    if (p.type !== 'herbicide') continue;
    if (!(p.activeIngredients ?? []).some((a) => a.chemistryClass === 'glyphosate')) continue;
    for (const claim of p.traitGatedSafeFor ?? []) {
      const key = `${p.pluginId} -> ${claim.cropPluginId}`;
      const entry = (section[p.pluginId] as Record<string, QuotedSource> | undefined)?.[
        claim.cropPluginId
      ];
      if (!entry) {
        gaps.push(`${key}: trait claim has no label source`);
        continue;
      }
      const stem = p.epaRegistrationNumber ? pplsStem(p.epaRegistrationNumber) : null;
      const ppls = `https://www3.epa.gov/pesticides/chem_search/ppls/${stem}-`;
      if (!hasUrl(entry) || !stem || !String(entry.sourceUrl).startsWith(ppls)) {
        gaps.push(`${key}: source is not the product's own PPLS label`);
      }
      const quote = typeof entry.quote === 'string' ? entry.quote : '';
      const crop = claim.cropPluginId.split('-')[0];
      if (
        !/postemergence/i.test(quote) ||
        !/roundup ready|glyphosate.tolerant/i.test(quote) ||
        !new RegExp(`\\b${crop}`, 'i').test(quote)
      ) {
        gaps.push(`${key}: quote does not state postemergence use over tolerant ${crop}`);
      }
    }
  }
  for (const [pluginId, claims] of Object.entries(section)) {
    if (pluginId.startsWith('$') || !claims || typeof claims !== 'object') continue;
    for (const cropPluginId of Object.keys(claims)) {
      const has = byId
        .get(pluginId)
        ?.traitGatedSafeFor?.some((c) => c.cropPluginId === cropPluginId);
      if (!has) gaps.push(`${pluginId} -> ${cropPluginId}: source has no matching trait claim`);
    }
  }
  return gaps;
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
    if (p.type === 'herbicide') {
      gaps.push(
        ...rateGaps(p, sources),
        ...classGaps(p, sources),
        ...rateByCropGaps(p, sources),
        ...seasonCapGaps(p, sources, cropPluginIds)
      );
    }
    const seen = new Set<string>();
    for (const row of p.preHarvestIntervalsByCrop ?? []) {
      const key = row.cropPluginId ?? row.cropFamily ?? '?';
      const seenKey = `${row.cropPluginId ? 'crop' : 'family'}:${key}`;
      if (seen.has(seenKey)) gaps.push(`${p.pluginId}: PHI for ${key} is listed twice`);
      seen.add(seenKey);
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
        !statesPhiDays(match.quote, row.preHarvestIntervalDays)
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

interface NotAllowedSource extends OrganicSource {
  certifiedOrganicAllowed?: unknown;
  material?: unknown;
  inference?: unknown;
  definition?: QuotedSource & { citation?: unknown };
}

/** #834 (ruling F834-7): `certifiedOrganicAllowed: false` reads "not allowed
 *  for organic use", so it needs a quoted basis too: an unconditional 7 CFR
 *  205.602 paragraph that names the material, or 205.105(a) with the 205.2
 *  definition of synthetic and the app's own inference recorded as such. */
function notAllowedGaps(p: LabelSourcePlugin, s: NotAllowedSource | undefined): string[] {
  const marked = p.complianceFlags?.certifiedOrganicAllowed === false;
  if (!marked) {
    return s?.certifiedOrganicAllowed === false
      ? [`${p.pluginId}: a not-allowed source but the plugin carries no false mark`]
      : [];
  }
  if (p.complianceFlags?.omriListed === true || p.complianceFlags?.transitioningAllowed === true) {
    return [`${p.pluginId}: certifiedOrganicAllowed false beside an allowed flag`];
  }
  if (!s || s.certifiedOrganicAllowed !== false || !isCfr205(s)) {
    return [`${p.pluginId}: certifiedOrganicAllowed false with no 7 CFR 205 quote`];
  }
  const citation = s.citation as string;
  const quote = (s.quote as string).toLowerCase();
  if (citation.startsWith('7 CFR 205.602(')) {
    const material = typeof s.material === 'string' ? s.material.trim().toLowerCase() : '';
    if (!material || !quote.includes(material) || !p.displayName.toLowerCase().includes(material)) {
      return [`${p.pluginId}: the 205.602 quote does not name the plugin's material`];
    }
    return /\b(unless|except)\b/.test(quote)
      ? [`${p.pluginId}: a conditional 205.602 paragraph cannot back a not-allowed mark`]
      : [];
  }
  if (citation.startsWith('7 CFR 205.105(a)')) {
    const d = s.definition;
    const defined =
      !!d &&
      d.citation === '7 CFR 205.2' &&
      typeof d.sourceUrl === 'string' &&
      d.sourceUrl.startsWith('https://www.ecfr.gov/') &&
      typeof d.quote === 'string' &&
      d.quote.startsWith('Synthetic.');
    const inferred = typeof s.inference === 'string' && s.inference.startsWith('App inference');
    return quote.includes('synthetic substances') && defined && inferred
      ? []
      : [`${p.pluginId}: a 205.105(a) basis needs the 205.2 definition and a stated inference`];
  }
  return [`${p.pluginId}: certifiedOrganicAllowed false must cite 205.602 or 205.105(a)`];
}

/** #805: the same organic-flag rule for fertilizer plugins, whose sources
 *  live in apps/web/scripts/fertilizer-organic-sources.json (one entry per
 *  pluginId, the shape of the `complianceFlags` section above). A name that
 *  says OMRI needs `omriListed: true`, and every entry names a plugin. */
export function fertilizerOrganicSourceGaps(
  plugins: readonly LabelSourcePlugin[],
  sources: Record<string, unknown>
): string[] {
  const gaps: string[] = [];
  const ids = new Set(plugins.map((p) => p.pluginId));
  for (const p of plugins) {
    if (/\bOMRI\b/.test(p.displayName) && p.complianceFlags?.omriListed !== true) {
      gaps.push(`${p.pluginId}: the name says OMRI but omriListed is not true`);
    }
    gaps.push(...organicFlagGaps(p, { complianceFlags: sources }));
    gaps.push(...notAllowedGaps(p, sources[p.pluginId] as NotAllowedSource | undefined));
  }
  for (const id of Object.keys(sources)) {
    if (!id.startsWith('$') && !ids.has(id)) gaps.push(`${id}: source entry names no plugin`);
  }
  return gaps;
}

type CropRow = QuotedSource & { cropPluginId?: unknown };

function cropRows(list: unknown, cropPluginId: string): CropRow[] {
  return (Array.isArray(list) ? (list as CropRow[]) : []).filter(
    (s) => s.cropPluginId === cropPluginId
  );
}

function rateByCropGaps(p: LabelSourcePlugin, sources: LabelSources): string[] {
  const gaps: string[] = [];
  for (const row of p.ratePerAcreByCrop ?? []) {
    const match = cropRows(sources.rateByCrop?.[p.pluginId], row.cropPluginId).find((s) => {
      const r = s as CropRow & { amount?: unknown; maxAmount?: unknown; unit?: unknown };
      return r.amount === row.amount && r.maxAmount === row.maxAmount && r.unit === row.unit;
    });
    if (!match) {
      gaps.push(`${p.pluginId}: rate for ${row.cropPluginId} has no matching rateByCrop source`);
    } else if (
      !hasUrl(match) ||
      !statesAmount(match.quote, row.amount) ||
      (row.maxAmount !== undefined && !statesAmount(match.quote, row.maxAmount))
    ) {
      gaps.push(`${p.pluginId}: rateByCrop source does not quote the rate for ${row.cropPluginId}`);
    }
  }
  for (const row of p.stageLimitByCrop ?? []) {
    const limit = normalizeSpace(row.limit);
    const ok = cropRows(sources.stageLimitByCrop?.[p.pluginId], row.cropPluginId).some(
      (s) => hasUrl(s) && typeof s.quote === 'string' && normalizeSpace(s.quote).includes(limit)
    );
    if (!ok) {
      gaps.push(`${p.pluginId}: stage limit for ${row.cropPluginId} has no quote containing it`);
    }
  }
  return gaps;
}

/** #820: the label's own words for each season cap period. */
export const SEASON_CAP_PERIOD_WORDS: Readonly<Record<string, RegExp>> = {
  'crop-year': /\bper crop year\b/i,
  season: /\bper season\b/i,
  'growing-season': /\bper growing season\b/i,
  year: /\bper year\b/i,
  '365-days': /\bper 365[ -]days?\b/i
};

function sameSet(a: unknown, b: readonly string[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => typeof x === 'string' && set.has(x)) && new Set(a).size === a.length;
}

type CapSource = QuotedSource & {
  cropPluginIds?: unknown;
  amount?: unknown;
  unit?: unknown;
  period?: unknown;
};

function seasonCapGaps(
  p: LabelSourcePlugin,
  sources: LabelSources,
  cropPluginIds?: ReadonlySet<string>
): string[] {
  const gaps: string[] = [];
  const capped = new Set<string>();
  const list = sources.seasonCapByCrop?.[p.pluginId];
  for (const row of p.seasonCapByCrop ?? []) {
    for (const id of row.cropPluginIds) {
      if (capped.has(id)) gaps.push(`${p.pluginId}: season cap for ${id} is listed twice`);
      capped.add(id);
      if (cropPluginIds && !cropPluginIds.has(id)) {
        gaps.push(`${p.pluginId}: season cap names ${id}, which is not a crop plugin`);
      }
    }
    const label = `${row.amount} ${row.unit} ${row.period}`;
    const words = SEASON_CAP_PERIOD_WORDS[row.period];
    const match = (Array.isArray(list) ? (list as CapSource[]) : []).find(
      (s) =>
        sameSet(s.cropPluginIds, row.cropPluginIds) &&
        s.amount === row.amount &&
        s.unit === row.unit &&
        s.period === row.period
    );
    if (!match) {
      gaps.push(`${p.pluginId}: season cap ${label} has no matching seasonCapByCrop source`);
    } else if (
      !hasUrl(match) ||
      !words ||
      typeof match.quote !== 'string' ||
      !statesAmount(match.quote, row.amount) ||
      !words.test(normalizeSpace(match.quote))
    ) {
      gaps.push(`${p.pluginId}: seasonCapByCrop source does not quote ${label}`);
    }
  }
  return gaps;
}
