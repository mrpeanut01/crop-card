/**
 * Herbicide rate provenance (swarm 2026-10-07, 3-0; partly addresses #737).
 * A herbicide's default `ratePerAcre` counts as a label rate (`plugin`) only
 * when the plugin marks it `rateProvenance: 'label'`, which the source gate
 * allows only beside a quoted label sentence in epa-reg-sources.json. Any
 * other rate, including one on a farm upload or an AI-scanned draft, is a
 * typical rate (`fallback`): shown with FALLBACK_RATE_LINE and never used as
 * a legal maximum.
 */

export type RateProvenance = 'plugin' | 'fallback';

export const FALLBACK_RATE_LINE =
  'Typical rate, not from the label. Check the label before mixing.';

interface RateCarrier {
  type?: unknown;
  ratePerAcre?: unknown;
  rateProvenance?: unknown;
}

export function herbicideRateProvenance(plugin: object | null | undefined): RateProvenance | null {
  const p = plugin as RateCarrier | null | undefined;
  if (!p || p.type !== 'herbicide' || !p.ratePerAcre) return null;
  return p.rateProvenance === 'label' ? 'plugin' : 'fallback';
}

export function isFallbackRate(p: object | null | undefined): boolean {
  return herbicideRateProvenance(p) === 'fallback';
}

/** A stored herbicide record's rate: only a rate saved as `plugin` is a label
 *  rate; records saved before provenance was stored are read as fallback,
 *  since no shipped herbicide rate had a label quote before then. */
export function recordedRateProvenance(stored: unknown): RateProvenance {
  return stored === 'plugin' ? 'plugin' : 'fallback';
}
