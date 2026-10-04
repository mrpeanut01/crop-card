import { orchardCopyProblems, type OrchardCalendarPlugin } from './schemas';

/**
 * Ruling OC-8: the checks behind apps/web/scripts/orchard-calendar-sources.json.
 * Pure, so the gate test runs them on the shipped folder and on fixtures.
 */

export interface OrchardSource {
  url: string;
  publisher: string;
  date: string;
  quote: string;
  edition: string;
  page: string;
  note?: string;
}

export interface OrchardSourceEntry {
  sources: OrchardSource[];
  /** Two agreeing sources from different hosts (OC-5). Needed for a
   *  degree-day estimate. */
  gateEligible?: boolean;
  note?: string;
}

export interface OrchardSourcesFile {
  entries: Record<string, OrchardSourceEntry>;
}

export interface OrchardSourceContext {
  cropFamilyOf(pluginId: string): string | undefined;
  /** Input product display names and active ingredients from the library,
   *  none of which may appear in calendar text. */
  productNames: readonly string[];
}

const SOURCE_KEYS: readonly string[] = [
  'url',
  'publisher',
  'date',
  'quote',
  'edition',
  'page',
  'note'
];

/** A source taken from a page reader's extraction never counts. */
export function isPageReaderSource(s: { note?: string }): boolean {
  return /page reader/i.test(s.note ?? '');
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Problems with the sources file itself: shape, hosts and gate claims. */
export function orchardSourceFileProblems(file: OrchardSourcesFile): string[] {
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(file.entries)) {
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
      problems.push(`${key}: needs at least one source`);
      continue;
    }
    entry.sources.forEach((s, i) => {
      const at = `${key}.sources.${i}`;
      for (const k of Object.keys(s)) {
        if (!SOURCE_KEYS.includes(k)) problems.push(`${at}: unknown field ${k}`);
      }
      for (const k of ['url', 'publisher', 'date', 'quote', 'edition', 'page'] as const) {
        if (typeof s[k] !== 'string' || s[k].trim() === '') problems.push(`${at}: missing ${k}`);
      }
      const host = typeof s.url === 'string' ? hostOf(s.url) : null;
      if (!host) problems.push(`${at}: url must be https`);
      else if (!/\.(edu|gov)$/.test(host))
        problems.push(`${at}: ${host} is not an .edu or .gov host`);
    });
    if (entry.gateEligible === true) {
      const counted = entry.sources.filter((s) => !isPageReaderSource(s));
      const hosts = new Set(counted.map((s) => hostOf(s.url)).filter((h) => h !== null));
      if (hosts.size < 2) {
        problems.push(`${key}: gateEligible needs two agreeing sources from different hosts`);
      }
    } else if (entry.gateEligible === false && !entry.note?.trim()) {
      problems.push(`${key}: say in note why it is not gateEligible`);
    }
  }
  return problems;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function productNameHit(text: string, names: readonly string[]): string | null {
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue;
    if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(trimmed)}($|[^a-z0-9])`, 'i').test(text)) {
      return trimmed;
    }
  }
  return null;
}

/** Problems with one calendar against the sources file and the library. */
export function orchardCalendarProblems(
  calendar: OrchardCalendarPlugin,
  file: OrchardSourcesFile,
  ctx: OrchardSourceContext
): string[] {
  const problems: string[] = [];
  const id = calendar.pluginId;
  const resolves = (key: string, at: string) => {
    const entry = file.entries[key];
    const counted = entry?.sources?.filter((s) => !isPageReaderSource(s)) ?? [];
    if (counted.length === 0) problems.push(`${id} ${at}: source ${key} does not resolve`);
    return entry;
  };
  const checkCopy = (text: string | undefined, at: string) => {
    if (text === undefined) return;
    for (const reason of orchardCopyProblems(text)) problems.push(`${id} ${at}: ${reason}`);
    const hit = productNameHit(text, ctx.productNames);
    if (hit) problems.push(`${id} ${at}: names the library product or ingredient ${hit}`);
  };

  const families: readonly string[] = calendar.hostCropFamilies;
  for (const crop of calendar.hostCropPluginIds) {
    const family = ctx.cropFamilyOf(crop);
    if (family === undefined) problems.push(`${id}: host ${crop} is not a registered crop plugin`);
    else if (!families.includes(family)) {
      problems.push(`${id}: host ${crop} is in family ${family}, not in hostCropFamilies`);
    }
  }

  for (const stage of calendar.stages) {
    const at = `stage ${stage.id}`;
    checkCopy(stage.name, `${at} name`);
    checkCopy(stage.recognise.description, `${at} description`);
    resolves(stage.recognise.sourceKey, `${at} description`);
    const gdd = stage.recognise.gddEstimate;
    if (gdd) {
      const entry = resolves(gdd.sourceKey, `${at} gddEstimate`);
      if (entry && entry.gateEligible !== true) {
        problems.push(`${id} ${at} gddEstimate: ${gdd.sourceKey} is not gateEligible (OC-5)`);
      }
    }
    for (const w of stage.windows) {
      checkCopy(w.note, `${at} window ${w.id} note`);
      for (const key of w.sourceKeys) resolves(key, `${at} window ${w.id}`);
    }
  }
  return problems;
}
