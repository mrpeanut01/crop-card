import { describe, expect, it } from 'vitest';
import { libraryOptionsFor } from './inventoryLibrary';

describe('libraryOptionsFor', () => {
  it('lists the two 2,4-D Amine labels under names a grower can tell apart (#658)', async () => {
    const options = await libraryOptionsFor('pesticide');
    const amine = options.filter((o) => o.id === '2-4-d-amine' || o.id === '24d');
    expect(amine).toHaveLength(2);
    expect(new Set(amine.map((o) => o.name)).size).toBe(2);
    expect(amine.every((o) => o.name.startsWith('2,4-D Amine ('))).toBe(true);
    const names = options.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives medicines their approval number (#697)', async () => {
    const options = await libraryOptionsFor('animal-health');
    expect(options.find((o) => o.id === 'safe-guard-suspension')?.approval).toEqual({
      kind: 'NADA',
      number: '128-620'
    });
  });
});
