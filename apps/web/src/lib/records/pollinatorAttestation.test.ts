import { describe, expect, it } from 'vitest';
import {
  EMPTY_POLLINATOR_CELLS,
  pollinatorAttestationCells,
  pollinatorAttestationSummary
} from './pollinatorAttestation';

describe('pollinatorAttestation formatters (#130)', () => {
  it('legacy rows render blank', () => {
    expect(pollinatorAttestationCells({})).toEqual(EMPTY_POLLINATOR_CELLS);
    expect(pollinatorAttestationSummary({})).toBe('');
  });

  it('CSV cells use stable machine values', () => {
    expect(
      pollinatorAttestationCells({
        bloomStatus: 'not-in-bloom',
        bloomStatusSource: 'operator',
        attestedNoForagers: false,
        pollinatorVerdict: 'pass'
      })
    ).toEqual({
      bloom_status: 'not-in-bloom',
      bloom_status_source: 'operator',
      attested_no_foragers: 'no',
      pollinator_verdict: 'pass'
    });
  });

  it('summary names status, source, foragers, and verdict', () => {
    expect(
      pollinatorAttestationSummary({
        bloomStatus: 'in-bloom',
        bloomStatusSource: 'plugin',
        attestedNoForagers: true,
        pollinatorVerdict: 'warn'
      })
    ).toBe('Bloom: In bloom (crop bloom window) · no foragers attested · pollinator gate Warn');
  });
});
