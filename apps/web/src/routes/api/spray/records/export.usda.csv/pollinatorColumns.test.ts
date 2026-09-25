import { describe, expect, it, vi } from 'vitest';
import papa from 'papaparse';

const T = Date.parse('2026-06-21T04:00:00Z');
const conditions = { windMph: 3, tempF: 70, rainForecastMmNext24h: 0 };
const product = { pluginId: 'pyr', displayName: 'Pyrethroid', iracGroups: ['3A'] };

vi.mock('$lib/server/auth', () => ({ requireUser: () => ({ id: 'u1', email: 'o@x.test' }) }));
vi.mock('$lib/server/registry', () => ({ getRegistry: async () => ({ get: () => undefined }) }));
vi.mock('$lib/db/blocks', () => ({
  listBlocks: () => [{ id: 'b1', name: 'North', blockLabel: 'N1', acres: 1, plantings: [] }]
}));
vi.mock('$lib/db/sprayEvents', () => ({
  listSprayEvents: () => [
    {
      id: 's1',
      blockId: 'b1',
      performedById: 'u1',
      occurredAt: T,
      products: [{ pluginId: 'herb', chemistryClasses: ['glyphosate'] }],
      conditions
    }
  ]
}));
vi.mock('$lib/db/insecticideEvents', () => ({
  listInsecticideEvents: () => [
    {
      id: 'i-new',
      blockId: 'b1',
      performedById: 'u1',
      occurredAt: T + 1000,
      products: [product],
      conditions,
      bloomStatus: 'in-bloom',
      bloomStatusSource: 'operator',
      attestedNoForagers: true,
      pollinatorVerdict: 'warn'
    },
    {
      id: 'i-legacy',
      blockId: 'b1',
      performedById: 'u1',
      occurredAt: T + 2000,
      products: [{ ...product, displayName: 'Legacy' }],
      conditions
    }
  ]
}));
vi.mock('$lib/db/fungicideEvents', () => ({ listFungicideEvents: () => [] }));
vi.mock('$lib/db/harvestEvents', () => ({ listHarvestEvents: () => [] }));
vi.mock('$lib/db/tenant', () => ({ unscopedQueryNote: () => undefined }));
vi.mock('$lib/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }) }
}));

import { GET } from './+server';

async function rows() {
  const res = await GET({
    url: new URL('http://localhost/api/spray/records/export.usda.csv')
  } as never);
  const text = await res.text();
  const body = text
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#'))
    .join('\n');
  return papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
}

describe('USDA CSV — #130 pollinator columns', () => {
  it('appends the four columns after record_kind', async () => {
    const { meta } = await rows();
    const f = meta.fields ?? [];
    expect(f.slice(f.indexOf('record_kind'))).toEqual([
      'record_kind',
      'bloom_status',
      'bloom_status_source',
      'attested_no_foragers',
      'pollinator_verdict'
    ]);
  });

  it('fills attested insecticide rows and leaves legacy + herbicide rows blank', async () => {
    const { data } = await rows();
    const attested = data.find((r) => r.product_name === 'Pyrethroid');
    expect(attested).toMatchObject({
      bloom_status: 'in-bloom',
      bloom_status_source: 'operator',
      attested_no_foragers: 'yes',
      pollinator_verdict: 'warn'
    });
    for (const r of data.filter((r) => r.product_name !== 'Pyrethroid')) {
      expect(r.bloom_status).toBe('');
      expect(r.bloom_status_source).toBe('');
      expect(r.attested_no_foragers).toBe('');
      expect(r.pollinator_verdict).toBe('');
    }
  });
});
