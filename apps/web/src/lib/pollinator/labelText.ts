import type { BeeToxicity, BloomRestriction } from '$lib/safety/pollinatorProtection';

export interface PollinatorLabelFields {
  pollinator?: { beeToxicity: BeeToxicity; bloomRestriction: BloomRestriction } | null;
  pollinatorRisk?: string | null;
}

/** English-only by rule (pollinator hazard wording): render inside a `data-english-only="safety"` marker. */
export function pollinatorLabelText(p: PollinatorLabelFields): string {
  if (p.pollinator) {
    const r = p.pollinator.bloomRestriction;
    return `Bees: ${p.pollinator.beeToxicity}${r === 'none' ? '' : ` · ${r}`}`;
  }
  return `Pollinator risk ${p.pollinatorRisk ?? 'unknown'}`;
}
