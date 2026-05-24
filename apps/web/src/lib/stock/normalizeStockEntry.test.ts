import { describe, it, expect } from 'vitest';
import { draftFromScanResult, normalizeStockEntry } from './normalizeStockEntry';

describe('normalizeStockEntry', () => {
  it('rejects when required fields are missing', () => {
    const r = normalizeStockEntry({ source: 'manual' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.issues.map((i) => i.field);
      expect(fields).toContain('category');
      expect(fields).toContain('displayName');
      expect(fields).toContain('defaultUnit');
    }
  });

  it('produces a minimal valid request from a manual draft', () => {
    const r = normalizeStockEntry({
      source: 'manual',
      category: 'fertilizer',
      displayName: ' Calcium Nitrate ',
      defaultUnit: 'lb'
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.displayName).toBe('Calcium Nitrate');
      expect(r.request.category).toBe('fertilizer');
      expect(r.request.defaultUnit).toBe('lb');
      expect(r.request.shortName).toBeUndefined();
    }
  });

  it('serializes activeIngredients + formulation + metadata to JSON', () => {
    const r = normalizeStockEntry({
      source: 'ai',
      category: 'insecticide',
      displayName: 'Spinosad',
      defaultUnit: 'fl-oz',
      activeIngredients: [{ name: 'spinosad', iracGroup: '5' }],
      formulation: { type: 'SC', productClass: 'organic' },
      metadata: { seedMeta: { daysToMaturity: 75 } }
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.parse(r.request.activeIngredientsJson!)).toEqual([
        { name: 'spinosad', iracGroup: '5' }
      ]);
      expect(JSON.parse(r.request.formulationJson!)).toEqual({
        type: 'SC',
        productClass: 'organic'
      });
      expect(JSON.parse(r.request.metadataJson!)).toEqual({
        seedMeta: { daysToMaturity: 75 }
      });
    }
  });

  it('rejects short name > 40 chars + notes > 500 + negative threshold', () => {
    const r = normalizeStockEntry({
      source: 'manual',
      category: 'seed',
      displayName: 'X',
      defaultUnit: 'count',
      shortName: 'a'.repeat(41),
      notes: 'b'.repeat(501),
      reorderThreshold: -1
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.issues.map((i) => i.field).sort();
      expect(fields).toEqual(['notes', 'reorderThreshold', 'shortName']);
    }
  });

  it('strips empty optional strings rather than sending empty', () => {
    const r = normalizeStockEntry({
      source: 'manual',
      category: 'herbicide',
      displayName: '2,4-D',
      defaultUnit: 'qt',
      shortName: '   ',
      notes: '',
      barcode: '   '
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.shortName).toBeUndefined();
      expect(r.request.notes).toBeUndefined();
      expect(r.request.barcode).toBeUndefined();
    }
  });
});

describe('draftFromScanResult', () => {
  it('auto-binds the top crop-plugin match when score ≥ 0.75', () => {
    const d = draftFromScanResult({
      displayName: 'Cherokee Purple',
      category: 'seed',
      defaultUnit: 'count',
      cropPluginMatches: [
        { pluginId: 'cherokee-purple', score: 0.92 },
        { pluginId: 'brandywine', score: 0.4 }
      ]
    });
    expect(d.pluginId).toBe('cherokee-purple');
  });

  it('leaves pluginId unset when no match clears 0.75', () => {
    const d = draftFromScanResult({
      displayName: 'X',
      cropPluginMatches: [{ pluginId: 'maybe', score: 0.6 }]
    });
    expect(d.pluginId).toBeUndefined();
  });

  it('defaults source to ai but accepts override', () => {
    const a = draftFromScanResult({ displayName: 'X' });
    const m = draftFromScanResult({ displayName: 'X' }, 'manual');
    expect(a.source).toBe('ai');
    expect(m.source).toBe('manual');
  });

  it('passes seedMeta through under metadata.seedMeta', () => {
    const d = draftFromScanResult({
      displayName: 'Tomato',
      seedMeta: { daysToMaturity: 80, spacingInches: 18 }
    });
    expect(d.metadata).toEqual({ seedMeta: { daysToMaturity: 80, spacingInches: 18 } });
  });
});
