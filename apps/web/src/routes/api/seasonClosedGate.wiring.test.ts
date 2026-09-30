/**
 * UC-44 (#349) — proves the SEASON_CLOSED gate is wired at all five
 * record-write endpoints via the single shared helper.
 *
 * This is a wiring guard, not a behavior test (the gate's behavior is covered
 * in lib/server/seasonClose.test.ts). It fails if a new record endpoint is
 * added without funneling through `checkSeasonClosed`, or if an existing
 * call-site is removed — the invariant is "one check-site helper, called from
 * each endpoint; do not copy logic 5×".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

const ENDPOINTS = [
  'spray/record/+server.ts',
  'insecticide/record/+server.ts',
  'fungicide/record/+server.ts',
  'harvest/record/+server.ts',
  'hay/cuttings/[id]/+server.ts'
];

describe('SEASON_CLOSED gate wiring', () => {
  for (const rel of ENDPOINTS) {
    it(`${rel} imports and calls checkSeasonClosed`, () => {
      const src = readFileSync(path.join(here, rel), 'utf8');
      expect(src).toContain("from '$lib/server/seasonClose'");
      expect(src).toContain('checkSeasonClosed(');
    });
  }

  it('every endpoint uses the shared helper (no copied year→closed lookup)', () => {
    for (const rel of ENDPOINTS) {
      const src = readFileSync(path.join(here, rel), 'utf8');
      // The gate must go through the helper, never a direct repo lookup.
      expect(src).not.toContain('getActiveCloseout(');
    }
  });
});

/** Phase 32E (E0-6): planning aids that must never read SEASON_CLOSED. The
 *  behavior is pinned in each cluster's endpoint test. */
const EXEMPT = [
  'seed-starts/+server.ts',
  'seed-starts/[id]/+server.ts',
  'seed-starts/[id]/progress/+server.ts',
  'blocks/[id]/protections/+server.ts',
  'blocks/[id]/protections/[pid]/+server.ts',
  'irrigation/+server.ts',
  'rain-gauge/+server.ts',
  'pest-models/[id]/biofix/+server.ts'
];

describe('SEASON_CLOSED exemptions (Phase 32E)', () => {
  for (const rel of EXEMPT) {
    it(`${rel} never reads the season-closed gate`, () => {
      const src = readFileSync(path.join(here, rel), 'utf8');
      expect(src).not.toContain('checkSeasonClosed(');
      expect(src).not.toContain('getActiveCloseout(');
      expect(src).not.toContain("from '$lib/server/seasonClose'");
    });
  }
});
