import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { t } from '$lib/i18n';
import {
  lifecycleHere,
  lifecycleLabel,
  lifecycleLine,
  lifecycleSentences,
  zoneOrder,
  type LifecycleFarmZone,
  type LifecyclePluginSlice
} from './lifecycleHere';
import type { SourcedLifecycle } from './lifecycleSources';

const ROSEMARY = 'rosemary-tuscan-blue';
const rosemary = (zone?: string, lifecycle = 'perennial'): LifecyclePluginSlice => ({
  pluginId: ROSEMARY,
  agronomy: { lifecycle },
  ...(zone ? { winterHardyToZone: zone } : {})
});
const sourced = (zone?: string): Record<string, SourcedLifecycle> => ({
  [ROSEMARY]: { lifecycle: 'perennial', ...(zone ? { winterHardyToZone: zone } : {}) }
});
const farm = (
  zone: string,
  provenance: 'data' | 'manual' = 'data',
  reach?: 'near' | 'wide'
): LifecycleFarmZone => ({ zone, provenance, ...(reach ? { reach } : {}) });

describe('zoneOrder', () => {
  it('orders half zones and reads a whole zone as its colder half', () => {
    expect(zoneOrder('1a')).toBe(2);
    expect(zoneOrder('7a')).toBe(14);
    expect(zoneOrder('7')).toBe(14);
    expect(zoneOrder('7b')).toBe(15);
    expect(zoneOrder('13b')).toBe(27);
  });

  it('refuses anything that is not a zone', () => {
    for (const z of ['', '0', '14', '7c', 'zone 7', '7 a', null, undefined]) {
      expect(zoneOrder(z as string)).toBeNull();
    }
  });
});

describe('lifecycleHere', () => {
  it('reads a family default as unknown', () => {
    const v = lifecycleHere({ pluginId: 'basil-genovese' }, farm('7a'));
    expect(v).toMatchObject({
      lifecycle: 'unknown',
      reason: 'no-lifecycle',
      provenance: 'fallback'
    });
    expect(lifecycleLine(v)).toBe('Annual or perennial is not known yet.');
  });

  it('tags an unsourced annual fallback and a sourced one plugin', () => {
    const plugin = { pluginId: 'dill-mammoth', agronomy: { lifecycle: 'annual' } };
    expect(lifecycleHere(plugin, null)).toMatchObject({
      lifecycle: 'annual',
      provenance: 'fallback',
      sourced: false
    });
    expect(lifecycleLine(lifecycleHere(plugin, null))).toBe(
      'One season. Not yet checked against a source.'
    );
    const v = lifecycleHere(plugin, null, { 'dill-mammoth': { lifecycle: 'annual' } });
    expect(v).toMatchObject({ lifecycle: 'annual', provenance: 'plugin', sourced: true });
    expect(lifecycleLine(v)).toBe('One season.');
  });

  it('a sourced value for another lifecycle does not count', () => {
    const v = lifecycleHere(rosemary(undefined, 'annual'), null, sourced());
    expect(v).toMatchObject({ lifecycle: 'annual', provenance: 'fallback', sourced: false });
  });

  it('says a biennial gives leaves the first year', () => {
    const v = lifecycleHere(
      { pluginId: 'parsley-italian-flat-leaf', agronomy: { lifecycle: 'biennial' } },
      farm('7a'),
      { 'parsley-italian-flat-leaf': { lifecycle: 'biennial' } }
    );
    expect(v.lifecycle).toBe('biennial');
    expect(lifecycleLine(v)).toBe('Two years; harvest leaves the first year.');
  });

  it('a perennial with no farm zone is unknown', () => {
    const v = lifecycleHere(rosemary('8'), null, sourced('8'));
    expect(v).toMatchObject({
      lifecycle: 'unknown',
      reason: 'no-farm-zone',
      provenance: 'fallback'
    });
    expect(lifecycleLine(v)).toBe("Perennial in warm zones; this farm's zone is not known.");
  });

  it('a perennial with no sourced crop zone is unknown and names the typed zone', () => {
    const v = lifecycleHere(rosemary(), farm('7b', 'manual'));
    expect(v).toMatchObject({
      lifecycle: 'unknown',
      reason: 'no-crop-zone',
      provenance: 'fallback'
    });
    expect(lifecycleLine(v)).toBe(
      'Perennial; the coldest zone it survives is not known yet. Not yet checked against a source. Using the zone you entered, 7b.'
    );
  });

  it('ignores a crop zone that is not the quoted one', () => {
    const v = lifecycleHere(rosemary('6a'), farm('7a'), sourced('8a'));
    expect(v.reason).toBe('no-crop-zone');
  });

  it('a farm colder than the crop reads tender-perennial', () => {
    const v = lifecycleHere(rosemary('8'), farm('7b'), sourced('8'));
    expect(v).toMatchObject({ lifecycle: 'tender-perennial', provenance: 'plugin', cropZone: '8' });
    expect(lifecycleLine(v)).toBe(
      'Comes back in zones 8 and warmer; here, bring it in or grow it as an annual.'
    );
  });

  it('a whole crop zone compares as its colder half', () => {
    expect(lifecycleHere(rosemary('8'), farm('8a'), sourced('8')).lifecycle).toBe('perennial-here');
    expect(lifecycleHere(rosemary('8b'), farm('8a'), sourced('8b')).lifecycle).toBe(
      'tender-perennial'
    );
  });

  it('trusts the typed zone as manual', () => {
    const v = lifecycleHere(rosemary('7'), farm('7b', 'manual'), sourced('7'));
    expect(v).toMatchObject({ lifecycle: 'perennial-here', provenance: 'manual' });
    expect(lifecycleLine(v)).toBe('Comes back every year here. Using the zone you entered, 7b.');
  });

  it('adds near its limit only for a wide estimate that equals the crop zone', () => {
    const wide = lifecycleHere(rosemary('7a'), farm('7a', 'data', 'wide'), sourced('7a'));
    expect(wide.nearLimit).toBe(true);
    expect(lifecycleLine(wide)).toBe('Comes back every year here. It is near its limit here.');
    expect(lifecycleHere(rosemary('7a'), farm('7a', 'data', 'near'), sourced('7a')).nearLimit).toBe(
      undefined
    );
    expect(lifecycleHere(rosemary('7a'), farm('7b', 'data', 'wide'), sourced('7a')).nearLimit).toBe(
      undefined
    );
    expect(lifecycleHere(rosemary('7a'), farm('7a', 'manual'), sourced('7a')).nearLimit).toBe(
      undefined
    );
  });
});

const zoneArb = fc
  .tuple(fc.integer({ min: 1, max: 13 }), fc.constantFrom('', 'a', 'b'))
  .map(([n, h]) => `${n}${h}`);
const halfZoneArb = fc
  .tuple(fc.integer({ min: 1, max: 13 }), fc.constantFrom('a', 'b'))
  .map(([n, h]) => `${n}${h}`);

describe('lifecycleHere properties', () => {
  it('over every zone pair and both provenances', () => {
    fc.assert(
      fc.property(
        zoneArb,
        halfZoneArb,
        fc.constantFrom<'data' | 'manual'>('data', 'manual'),
        fc.constantFrom<'near' | 'wide' | undefined>('near', 'wide', undefined),
        fc.boolean(),
        (cropZone, farmZone, provenance, reach, isSourced) => {
          const sources = isSourced ? sourced(cropZone) : {};
          const v = lifecycleHere(rosemary(cropZone), farm(farmZone, provenance, reach), sources);
          if (!isSourced) {
            expect(v.lifecycle).toBe('unknown');
            expect(v.provenance).toBe('fallback');
            return;
          }
          const tender = zoneOrder(farmZone)! < zoneOrder(cropZone)!;
          expect(v.lifecycle).toBe(tender ? 'tender-perennial' : 'perennial-here');
          expect(v.provenance).toBe(provenance === 'manual' ? 'manual' : 'plugin');
          expect(v.nearLimit === true).toBe(
            zoneOrder(farmZone) === zoneOrder(cropZone) && provenance === 'data' && reach === 'wide'
          );
          const en = lifecycleLine(v);
          expect(en).toBe(lifecycleLine(v, 'en'));
          expect(en.includes('Using the zone you entered')).toBe(provenance === 'manual');
          expect(lifecycleLine(v, 'es')).not.toBe(en);
        }
      )
    );
  });

  it('a colder farm never reads "comes back every year"', () => {
    fc.assert(
      fc.property(zoneArb, halfZoneArb, (cropZone, farmZone) => {
        fc.pre(zoneOrder(farmZone)! < zoneOrder(cropZone)!);
        const v = lifecycleHere(rosemary(cropZone), farm(farmZone), sourced(cropZone));
        expect(v.lifecycle).toBe('tender-perennial');
        expect(lifecycleLine(v)).not.toContain('every year');
      })
    );
  });
});

describe('sentences', () => {
  it('every reason has English and Spanish, and Spanish differs', () => {
    const cases = [
      lifecycleHere({ pluginId: 'x' }, null),
      lifecycleHere({ pluginId: 'x', agronomy: { lifecycle: 'annual' } }, null),
      lifecycleHere({ pluginId: 'x', agronomy: { lifecycle: 'biennial' } }, null),
      lifecycleHere(rosemary('8'), null, sourced('8')),
      lifecycleHere(rosemary(), farm('7a'), sourced()),
      lifecycleHere(rosemary('8'), farm('7a', 'manual'), sourced('8')),
      lifecycleHere(rosemary('7a'), farm('7a', 'data', 'wide'), sourced('7a'))
    ];
    for (const v of cases) {
      const en = lifecycleSentences(v);
      const es = lifecycleSentences(v, 'es');
      expect(es).toHaveLength(en.length);
      for (let i = 0; i < en.length; i++) expect(es[i]).not.toBe(en[i]);
      expect(lifecycleLabel(v, 'es')).not.toBe(lifecycleLabel(v));
      for (const s of [...en, ...es]) expect(s).not.toMatch(/[—{}]/);
    }
  });

  it('labels each verdict', () => {
    expect(lifecycleLabel({ lifecycle: 'perennial-here', provenance: 'plugin' })).toBe(
      t(undefined, 'herbsb.label.perennialHere')
    );
    expect(lifecycleLabel({ lifecycle: 'unknown', provenance: 'fallback' }, 'es')).toBe(
      'No se sabe'
    );
  });
});
