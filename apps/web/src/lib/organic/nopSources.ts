import { sourceEntrySchema } from '$lib/plugins/sourceCoverage';
import { NOP_RULE_SOURCE_KEYS, type NopRules } from './nopRules';

/** B-01: the regulation's own sites, so a quote is tied to the text. */
const REGULATION_HOSTS = new Set(['ecfr.gov', 'www.ecfr.gov', 'govinfo.gov', 'www.govinfo.gov']);

export interface NopSourcesFile {
  ecfrAsOf: string | null;
  entries: Record<string, unknown>;
  researched?: unknown[];
}

export function isVerifiedNopEntry(entry: unknown): boolean {
  const parsed = sourceEntrySchema.safeParse(entry);
  if (!parsed.success) return false;
  try {
    return REGULATION_HOSTS.has(new URL(parsed.data.url).hostname);
  } catch {
    return false;
  }
}

function ruleIsOn(value: NopRules[keyof NopRules]): boolean {
  return value !== null && value !== false;
}

/** Every problem with the rules against their sources (B-03). Empty when
 *  each switched-on rule has a verified entry whose `value` matches, and
 *  no switched-off rule has an entry. */
export function nopRuleGaps(rules: Readonly<NopRules>, file: NopSourcesFile): string[] {
  const gaps: string[] = [];
  for (const field of Object.keys(NOP_RULE_SOURCE_KEYS) as (keyof NopRules)[]) {
    const key = NOP_RULE_SOURCE_KEYS[field];
    const value = rules[field];
    const entry = file.entries[key] as Record<string, unknown> | undefined;
    if (!ruleIsOn(value)) {
      if (entry !== undefined) gaps.push(`${key}: entry exists but ${field} ships off`);
      continue;
    }
    if (entry === undefined) {
      gaps.push(`${key}: ${field} is on with no source`);
      continue;
    }
    if (!isVerifiedNopEntry(entry)) {
      gaps.push(`${key}: entry is not a verified ecfr.gov or govinfo.gov quote`);
      continue;
    }
    if (typeof value !== 'boolean' && entry.value !== value) {
      gaps.push(`${key}: value ${String(entry.value)} != ${String(value)}`);
    }
  }
  for (const [key, entry] of Object.entries(file.entries)) {
    if (!isVerifiedNopEntry(entry)) gaps.push(`${key}: entry is not verified`);
  }
  if (Object.keys(file.entries).length > 0 && !file.ecfrAsOf) {
    gaps.push('ecfrAsOf: missing while entries exist');
  }
  return gaps;
}
