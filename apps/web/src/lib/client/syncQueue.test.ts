/**
 * Unit coverage for the offline sync-queue pure logic (#314 fail-safe drain
 * guard + #316 kind→endpoint routing). These exercise the extracted pure
 * helpers so no IndexedDB / fake-indexeddb is required — the Dexie store
 * itself is thin glue over these decisions.
 */

import { describe, it, expect } from 'vitest';
import {
  drainDecisionFor,
  endpointForRecord,
  kindOf,
  ENDPOINT_BY_KIND,
  type DrainDecision
} from './syncQueue';
import type { PendingRecordKind } from './dexie';

describe('#314 — drainDecisionFor (tenant-safety fail-safe)', () => {
  it('halts the drain when the active owner is null (never drain unfiltered)', () => {
    // The whole point of #314: a null active owner must NOT fall through to
    // an unfiltered drain that would replay every tenant's rows.
    expect(drainDecisionFor(null, 'owner_a')).toBe<DrainDecision>('halt-no-active-owner');
    expect(drainDecisionFor(undefined, 'owner_a')).toBe<DrainDecision>('halt-no-active-owner');
    expect(drainDecisionFor('', 'owner_a')).toBe<DrainDecision>('halt-no-active-owner');
  });

  it('submits rows that belong to the active owner', () => {
    expect(drainDecisionFor('owner_a', 'owner_a')).toBe<DrainDecision>('submit');
  });

  it('skips rows that belong to a different owner', () => {
    expect(drainDecisionFor('owner_a', 'owner_b')).toBe<DrainDecision>('skip-other-owner');
  });

  it('never routes another owner’s row to submit, regardless of ordering', () => {
    // Mixed queue: only the matching owner’s rows resolve to submit; the
    // rest are skipped (counted as skippedOtherOwner by the caller).
    const active = 'owner_home_farm';
    const rows: Array<{ ownerId: string }> = [
      { ownerId: 'owner_home_farm' },
      { ownerId: 'owner_other' },
      { ownerId: 'owner_home_farm' },
      { ownerId: 'owner_third' }
    ];
    const decisions = rows.map((r) => drainDecisionFor(active, r.ownerId));
    expect(decisions).toEqual(['submit', 'skip-other-owner', 'submit', 'skip-other-owner']);
  });

  it('halts before evaluating any row when active owner is unknown', () => {
    // Even a row whose ownerId matches the home-farm fallback must NOT be
    // treated as submittable when we have no active owner signal.
    expect(drainDecisionFor(null, 'owner_home_farm')).toBe<DrainDecision>('halt-no-active-owner');
  });
});

describe('#316 — kind → endpoint routing', () => {
  it('maps every declared record kind to a distinct POST endpoint', () => {
    expect(ENDPOINT_BY_KIND).toEqual({
      herbicide: '/api/spray/record',
      insecticide: '/api/insecticide/record',
      fungicide: '/api/fungicide/record',
      harvest: '/api/harvest/record',
      'hay-cutting': '/api/hay/cuttings'
    });
    const endpoints = Object.values(ENDPOINT_BY_KIND);
    expect(new Set(endpoints).size).toBe(endpoints.length);
  });

  it.each<[PendingRecordKind, string]>([
    ['herbicide', '/api/spray/record'],
    ['insecticide', '/api/insecticide/record'],
    ['fungicide', '/api/fungicide/record'],
    ['harvest', '/api/harvest/record'],
    ['hay-cutting', '/api/hay/cuttings']
  ])('routes kind %s to %s', (kind, endpoint) => {
    expect(endpointForRecord({ kind })).toBe(endpoint);
  });

  it('coalesces a missing kind to herbicide (pre-v3 back-compat)', () => {
    // Rows written before the v3 Dexie upgrade lack `kind`; they were all
    // herbicide sprays and must keep replaying to /api/spray/record.
    expect(kindOf({ kind: undefined })).toBe('herbicide');
    expect(endpointForRecord({ kind: undefined })).toBe('/api/spray/record');
  });

  it('falls back to the herbicide endpoint for an unknown kind value', () => {
    // Defensive: a corrupted/forward-incompatible kind never throws — it
    // routes to the safest existing endpoint rather than crashing the drain.
    const rogue = { kind: 'not-a-real-kind' as unknown as PendingRecordKind };
    expect(endpointForRecord(rogue)).toBe('/api/spray/record');
  });
});
