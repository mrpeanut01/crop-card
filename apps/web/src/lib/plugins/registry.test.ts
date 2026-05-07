import { describe, expect, it } from 'vitest';
import { PluginRegistrationError, PluginRegistry } from './registry';

describe('PluginRegistry', () => {
  it('registers a valid herbicide plugin', () => {
    const r = new PluginRegistry();
    const record = r.register({
      pluginId: 'gly',
      type: 'herbicide',
      displayName: 'Glyphosate',
      version: '1.0.0',
      activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }],
      ratePerAcre: { amount: 32, unit: 'fl-oz' }
    });
    expect(r.has('gly')).toBe(true);
    expect(record.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects malformed pluginId', () => {
    const r = new PluginRegistry();
    expect(() =>
      r.register({
        pluginId: 'BadID!',
        type: 'crop',
        displayName: 'x',
        version: '1.0.0'
      })
    ).toThrow(PluginRegistrationError);
  });

  it('rejects synthetic-auxin claiming pumpkin safety (bypass attempt)', () => {
    const r = new PluginRegistry();
    let caught: PluginRegistrationError | null = null;
    try {
      r.register({
        pluginId: 'sneaky-24d',
        type: 'herbicide',
        displayName: 'Sneaky 2,4-D',
        version: '1.0.0',
        activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }],
        ratePerAcre: { amount: 16, unit: 'fl-oz' },
        labelClaims: { safeForCropPluginIds: ['pumpkin'] }
      });
    } catch (e) {
      caught = e as PluginRegistrationError;
    }
    expect(caught).toBeInstanceOf(PluginRegistrationError);
    expect(caught!.message).toMatch(/bypass/);
    expect(caught!.issues[0].path).toContain('pumpkin');
    expect(r.has('sneaky-24d')).toBe(false);
  });

  it('allows a genuinely-safe herbicide claim', () => {
    const r = new PluginRegistry();
    expect(() =>
      r.register({
        pluginId: 'cleth',
        type: 'herbicide',
        displayName: 'Clethodim',
        version: '1.0.0',
        activeIngredients: [{ name: 'clethodim', chemistryClass: 'accase-inhibitor' }],
        ratePerAcre: { amount: 8, unit: 'fl-oz' },
        labelClaims: { safeForCropPluginIds: ['pumpkin'] }
      })
    ).not.toThrow();
  });

  it('rejects bypass via matrix-driven path when crop is registered first', () => {
    const r = new PluginRegistry();
    r.register({
      pluginId: 'pumpkin-ezg',
      type: 'crop',
      displayName: 'EZ Gro Monster',
      version: '1.0.0',
      cropFamily: 'cucurbit'
    });
    let caught: PluginRegistrationError | null = null;
    try {
      r.register({
        pluginId: 'mesotrione',
        type: 'herbicide',
        displayName: 'Mesotrione 4SC',
        version: '1.0.0',
        activeIngredients: [{ name: 'mesotrione', chemistryClass: 'hppd-inhibitor' }],
        ratePerAcre: { amount: 3, unit: 'fl-oz' },
        labelClaims: { safeForCropPluginIds: ['pumpkin-ezg'] }
      });
    } catch (e) {
      caught = e as PluginRegistrationError;
    }
    expect(caught).toBeInstanceOf(PluginRegistrationError);
    expect(caught!.issues[0].message).toMatch(/cucurbit/);
  });

  it('exposes crops() and herbicides() helpers', () => {
    const r = new PluginRegistry();
    r.register({
      pluginId: 'corn',
      type: 'crop',
      displayName: 'Corn',
      version: '1.0.0',
      cropFamily: 'corn'
    });
    r.register({
      pluginId: 'gly',
      type: 'herbicide',
      displayName: 'Glyphosate',
      version: '1.0.0',
      activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }],
      ratePerAcre: { amount: 32, unit: 'fl-oz' }
    });
    expect(r.crops()).toHaveLength(1);
    expect(r.herbicides()).toHaveLength(1);
    expect(r.cropFamilyOf('corn')).toBe('corn');
    expect(r.cropFamilyOf('gly')).toBeUndefined();
  });

  it('hashes are stable for the same input and differ across inputs', () => {
    const a = new PluginRegistry();
    const b = new PluginRegistry();
    const input = {
      pluginId: 'corn',
      type: 'crop',
      displayName: 'Corn',
      version: '1.0.0',
      cropFamily: 'corn'
    };
    expect(a.register(input).hash).toBe(b.register(input).hash);
    const other = a.register({ ...input, pluginId: 'corn-sweet', displayName: 'Sweet Corn' });
    expect(other.hash).not.toBe(a.get('corn')!.hash);
  });
});
