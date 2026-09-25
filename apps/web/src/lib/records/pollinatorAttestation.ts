/**
 * #130 — shared formatting for the pollinator-gate attestation persisted on
 * `insecticide_events` (bloom status, how it was obtained, the no-foragers
 * attestation, and the overall gate verdict at record time). Pre-#130 rows
 * carry none of these; every formatter renders them blank rather than
 * inventing a value.
 */

export type AttestedBloomStatus = 'in-bloom' | 'not-in-bloom' | 'unknown';
export type AttestedBloomSource = 'operator' | 'plugin' | 'default';
export type AttestedPollinatorVerdict = 'pass' | 'warn' | 'block';

export interface PollinatorAttestation {
  bloomStatus?: AttestedBloomStatus;
  bloomStatusSource?: AttestedBloomSource;
  attestedNoForagers?: boolean;
  pollinatorVerdict?: AttestedPollinatorVerdict;
}

export const BLOOM_STATUS_LABEL: Record<AttestedBloomStatus, string> = {
  'in-bloom': 'In bloom',
  'not-in-bloom': 'Not in bloom',
  unknown: 'Not attested'
};

export const BLOOM_SOURCE_LABEL: Record<AttestedBloomSource, string> = {
  operator: 'operator attested',
  plugin: 'crop bloom window',
  default: 'no attestation — defaulted'
};

export const VERDICT_LABEL: Record<AttestedPollinatorVerdict, string> = {
  pass: 'Pass',
  warn: 'Warn',
  block: 'Block'
};

export interface PollinatorAttestationCells {
  bloom_status: string;
  bloom_status_source: string;
  attested_no_foragers: string;
  pollinator_verdict: string;
}

export const EMPTY_POLLINATOR_CELLS: PollinatorAttestationCells = {
  bloom_status: '',
  bloom_status_source: '',
  attested_no_foragers: '',
  pollinator_verdict: ''
};

/** Machine-stable CSV cells; blank for legacy rows. */
export function pollinatorAttestationCells(a: PollinatorAttestation): PollinatorAttestationCells {
  return {
    bloom_status: a.bloomStatus ?? '',
    bloom_status_source: a.bloomStatusSource ?? '',
    attested_no_foragers:
      a.attestedNoForagers === undefined ? '' : a.attestedNoForagers ? 'yes' : 'no',
    pollinator_verdict: a.pollinatorVerdict ?? ''
  };
}

/** One-line human summary, or '' when nothing was recorded (legacy row). */
export function pollinatorAttestationSummary(a: PollinatorAttestation): string {
  const parts: string[] = [];
  if (a.bloomStatus) {
    const src = a.bloomStatusSource ? ` (${BLOOM_SOURCE_LABEL[a.bloomStatusSource]})` : '';
    parts.push(`Bloom: ${BLOOM_STATUS_LABEL[a.bloomStatus]}${src}`);
  }
  if (a.attestedNoForagers === true) parts.push('no foragers attested');
  if (a.pollinatorVerdict) parts.push(`pollinator gate ${VERDICT_LABEL[a.pollinatorVerdict]}`);
  return parts.join(' · ');
}
