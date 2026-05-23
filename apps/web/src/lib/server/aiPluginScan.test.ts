/**
 * Tests for the deterministic halves of aiPluginScan:
 *   - validateCandidate runs the full Zod + bypass pipeline; bad payloads
 *     surface schemaIssues / bypassIssues; valid payloads pass.
 *   - localFuzzyMatchPlugins token-overlaps against the live registry and
 *     respects the hintType filter.
 *
 * The Claude vision + web_search calls are NOT covered here — they require
 * a network call and a real API key. The vitest harness has neither.
 */

import { describe, expect, it } from 'vitest';
import { localFuzzyMatchPlugins, validateCandidate } from './aiPluginScan';

describe('validateCandidate', () => {
  it('accepts a minimal valid crop payload (auto-fills version + slug)', async () => {
    const r = await validateCandidate({
      type: 'crop',
      displayName: 'Some Brand New Crop',
      cropFamily: 'corn'
    });
    expect(r.validation.ok).toBe(true);
    expect(r.candidate).not.toBeNull();
    expect(r.candidate?.pluginId).toBe('some-brand-new-crop');
    expect(r.candidate?.version).toBe('1.0.0');
  });

  it('rejects a payload missing the type discriminator', async () => {
    const r = await validateCandidate({ displayName: 'Bare', cropFamily: 'corn' });
    expect(r.validation.ok).toBe(false);
    expect(r.validation.schemaIssues.length).toBeGreaterThan(0);
  });

  it('returns 0 candidate on a totally malformed object', async () => {
    const r = await validateCandidate({});
    expect(r.validation.ok).toBe(false);
    expect(r.candidate).toBeNull();
  });

  it('flags pluginId collision against a known existing plugin', async () => {
    const r = await validateCandidate({
      type: 'crop',
      pluginId: 'apple-orchard',
      displayName: 'Pretend Apple',
      cropFamily: 'orchard'
    });
    expect(r.validation.ok).toBe(false);
    expect(r.validation.schemaIssues.some((i) => i.path === 'pluginId')).toBe(true);
  });

  it('returns bypass issues for an unsafe herbicide claim', async () => {
    const r = await validateCandidate({
      type: 'herbicide',
      pluginId: 'fake-glyphosate-killer-for-test',
      displayName: 'Test Killer',
      version: '1.0.0',
      activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }],
      ratePerAcre: { amount: 1, unit: 'qt' },
      labelClaims: { safeForCropPluginIds: ['corn-bantam-sweet'] }
    });
    expect(r.validation.ok).toBe(false);
    expect(r.validation.bypassIssues.length).toBeGreaterThan(0);
  });
});

describe('localFuzzyMatchPlugins', () => {
  it('returns empty array for queries under 2 chars', async () => {
    expect(await localFuzzyMatchPlugins('a')).toEqual([]);
    expect(await localFuzzyMatchPlugins('')).toEqual([]);
  });

  it('finds a known plugin by partial display name', async () => {
    const matches = await localFuzzyMatchPlugins('apple orchard');
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(top.source).toBe('local');
    expect(top.candidate?.pluginId).toBe('apple-orchard');
    expect((top.score ?? 0) >= 0.3).toBe(true);
  });

  it('respects the hintType filter', async () => {
    const crops = await localFuzzyMatchPlugins('apple', 'crop');
    expect(crops.every((m) => m.candidate?.type === 'crop')).toBe(true);
  });

  it('returns empty when the hint kind has no match', async () => {
    const matches = await localFuzzyMatchPlugins('apple', 'fungicide');
    expect(matches.length).toBe(0);
  });

  it('marks every local result as validation.ok = true', async () => {
    const matches = await localFuzzyMatchPlugins('corn');
    for (const m of matches) {
      expect(m.validation.ok).toBe(true);
      expect(m.candidate).not.toBeNull();
    }
  });
});
