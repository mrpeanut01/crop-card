import { describe, expect, it } from 'vitest';
import { createEquipment } from '$lib/db/equipment';
import { runWithTenant } from '$lib/db/tenant';
import { load } from './+page.server';

const OWNER = 'owner_home_farm';

type Out = {
  equipment: Array<{ id: string; typeName: string; templateCategory: string | null }>;
  templates: Array<{ templateId: string; type: string }>;
};
const run = (role: string, locale = 'en') =>
  load({
    locals: { user: { role }, locale },
    url: new URL('http://x/equipment')
  } as never) as Out;

describe('/equipment loader', () => {
  it('names a templated tedder by its category, not as a rake (#670)', () =>
    runWithTenant(OWNER, () => {
      const row = createEquipment({
        type: 'rake',
        label: 'Tedder',
        spec: { templateId: 'tedder-4basket' }
      });
      const en = run('owner').equipment.find((e) => e.id === row.id)!;
      expect(en.templateCategory).toBe('Hay tedder');
      const es = run('owner', 'es').equipment.find((e) => e.id === row.id)!;
      expect(es.templateCategory).toBe('Henificadora');
      const typed = createEquipment({ type: 'rake', label: 'Hand rake' });
      expect(run('owner').equipment.find((e) => e.id === typed.id)!.templateCategory).toBeNull();
    }));

  it('offers the starter templates to owners only (#647)', () =>
    runWithTenant(OWNER, () => {
      const ids = run('owner').templates.map((t) => t.templateId);
      expect(ids).toContain('sprayer-50gal-pull');
      expect(ids).toContain('baler-small-square');
      expect(run('helper').templates).toEqual([]);
    }));
});
