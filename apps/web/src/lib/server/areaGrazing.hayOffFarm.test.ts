// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PluginRegistry } from '$lib/plugins/registry';
import { hayOffFarmNotices } from '$lib/farm/hayOffFarm';
import { toApplications } from './areaGrazing';

function registry(plugins: Record<string, Record<string, unknown>>): PluginRegistry {
  return {
    get: (id: string) => (plugins[id] ? { plugin: plugins[id] } : undefined),
    size: () => Object.keys(plugins).length
  } as unknown as PluginRegistry;
}

const farmOnly = {
  id: 'farm-picloram',
  type: 'herbicide',
  displayName: 'Farm picloram',
  activeIngredients: [{ name: 'picloram' }],
  grazingRestrictions: { source: 'Farm label copy', hayOffFarmRestricted: true }
};

const event = { id: 'e1', blockId: 'b1', occurredAt: Date.UTC(2026, 4, 1, 16) };

describe('hay off-farm notice from a farm-only plugin (M-16, M-19)', () => {
  it('carries the flag through toApplications into the /hay notice', () => {
    const apps = toApplications(
      'spray',
      [{ ...event, products: [{ pluginId: 'farm-picloram' }] }],
      registry({ 'farm-picloram': farmOnly }),
      registry({})
    );
    expect(apps[0].restrictions).toBeNull();
    expect(apps[0].hayOffFarm).toEqual({ source: 'Farm label copy' });
    const out = hayOffFarmNotices(
      [{ id: 'c1', blockId: 'b1', cutAtMs: Date.UTC(2026, 5, 1, 16) }],
      apps,
      'America/New_York'
    );
    expect(out.c1).toHaveLength(1);
    expect(out.c1[0]).toMatchObject({ productName: 'Farm picloram', source: 'Farm label copy' });
  });

  it('a farm copy cannot drop the shared flag', () => {
    const shared = {
      ...farmOnly,
      grazingRestrictions: { source: 'Shared label', hayOffFarmRestricted: true }
    };
    const copy = { ...farmOnly, grazingRestrictions: { source: 'Farm copy' } };
    const apps = toApplications(
      'spray',
      [{ ...event, products: [{ pluginId: 'farm-picloram' }] }],
      registry({ 'farm-picloram': copy }),
      registry({ 'farm-picloram': shared })
    );
    expect(apps[0].hayOffFarm).toEqual({ source: 'Shared label' });
  });

  it('no flag on either side adds nothing', () => {
    const plain = { ...farmOnly, grazingRestrictions: undefined };
    const apps = toApplications(
      'spray',
      [{ ...event, products: [{ pluginId: 'farm-picloram' }] }],
      registry({ 'farm-picloram': plain }),
      registry({})
    );
    expect(apps[0]).not.toHaveProperty('hayOffFarm');
  });
});
