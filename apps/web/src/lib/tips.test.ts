import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HINT_KEYS, isTipKey } from '$lib/hints';
import { en } from '$lib/i18n/catalogs/en';
import { es } from '$lib/i18n/catalogs/es';
import { TIP_IDS, tipContent, tipForRoute, tipKey, tipVisible, type TipVisibility } from './tips';

const SHOWN: TipVisibility = {
  enabled: true,
  key: 'tip_today',
  serverSeen: [],
  localSeen: new Set(),
  stopOnScreen: false
};

describe('tipVisible', () => {
  it('shows an unseen tip to a user who asked for tips', () => {
    expect(tipVisible(SHOWN)).toBe(true);
  });

  it('stays off for no, never asked and signed out', () => {
    expect(tipVisible({ ...SHOWN, enabled: false })).toBe(false);
    expect(tipVisible({ ...SHOWN, enabled: null })).toBe(false);
    expect(tipVisible({ ...SHOWN, enabled: undefined })).toBe(false);
  });

  it('hides once seen on the server or on this device', () => {
    expect(tipVisible({ ...SHOWN, serverSeen: ['tip_today'] })).toBe(false);
    expect(tipVisible({ ...SHOWN, localSeen: new Set(['tip_today']) })).toBe(false);
    expect(
      tipVisible({ ...SHOWN, serverSeen: ['tip_plan'], localSeen: new Set(['tip_spray']) })
    ).toBe(true);
  });

  it('hides under a safety stop and when the page holds it back', () => {
    expect(tipVisible({ ...SHOWN, stopOnScreen: true })).toBe(false);
    expect(tipVisible({ ...SHOWN, suppressed: true })).toBe(false);
  });
});

describe('tipContent', () => {
  it('has a hint key for every tip', () => {
    for (const id of TIP_IDS) {
      expect(HINT_KEYS).toContain(tipKey(id));
      expect(isTipKey(tipKey(id))).toBe(true);
    }
  });

  it('only sends the owner to a setup step', () => {
    expect(tipContent('today', 'owner').action).toEqual({
      href: '/plan',
      label: 'tips.today.action'
    });
    for (const role of ['helper', 'inspector', 'custom-operator', null]) {
      for (const id of TIP_IDS) expect(tipContent(id, role).action).toBeNull();
    }
  });

  it('gives everyone but the owner wording that asks for nothing owner-only', () => {
    expect(tipContent('inventory', 'owner').body).toBe('tips.inventory.body');
    expect(tipContent('inventory', 'helper').body).toBe('tips.inventory.bodyOther');
    expect(tipContent('spray', 'helper').body).toBe('tips.spray.body');
  });

  it('every string a tip can show exists in English and Spanish', () => {
    for (const id of TIP_IDS) {
      for (const role of ['owner', 'helper']) {
        const c = tipContent(id, role);
        for (const key of [c.title, c.body, ...(c.action ? [c.action.label] : [])]) {
          expect(en[key], key).toBeTruthy();
          expect(es[key], key).toBeTruthy();
        }
      }
    }
  });
});

describe('tipForRoute', () => {
  const on = { beginnerTips: true };

  it('maps each main screen to its tip', () => {
    expect(tipForRoute('/today', on)).toBe('today');
    expect(tipForRoute('/plan/farm', on)).toBe('farm_map');
    expect(tipForRoute('/settings/farm/map', on)).toBe('farm_map');
    expect(tipForRoute('/plan/areas/[id]/design', on)).toBe('designer');
    expect(tipForRoute('/plan/calendar', on)).toBe('calendar');
    expect(tipForRoute('/settings/account', on)).toBeNull();
    expect(tipForRoute(null, on)).toBeNull();
  });

  it('gives nothing when tips are off or the page refused the visitor', () => {
    expect(tipForRoute('/today', { beginnerTips: false })).toBeNull();
    expect(tipForRoute('/today', {})).toBeNull();
    expect(tipForRoute('/today', null)).toBeNull();
    expect(tipForRoute('/settings/farm/map', { beginnerTips: true, refused: true })).toBeNull();
  });

  it('every tip is placed on a route that exists', () => {
    const routes = new Set<string>();
    const walk = (dir: string, id: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, `${id}/${name}`);
        else if (name === '+page.svelte') routes.add(id || '/');
      }
    };
    walk('src/routes', '');
    const placed = new Set<string>();
    for (const route of routes) {
      const tip = tipForRoute(route, on);
      if (tip) placed.add(tip);
    }
    expect([...placed].sort()).toEqual([...TIP_IDS].sort());
  });
});

describe('tip copy', () => {
  const tipKeys = (Object.keys(en) as Array<keyof typeof en>).filter((k) => k.startsWith('tips.'));

  it('has Spanish for every tip string', () => {
    for (const k of tipKeys) expect(es[k], k).toBeTruthy();
  });

  it('carries no numbers, no dashes and never claims anything is safe', () => {
    for (const k of tipKeys) {
      for (const text of [en[k], es[k] ?? '']) {
        expect(text, k).not.toMatch(/\d/);
        expect(text, k).not.toMatch(/[–—]/);
        expect(text, k).not.toMatch(/\bsafe(ly|ty)?\b|\bsegur[oa]s?\b/i);
      }
    }
  });

  it('the spray tip records, points at the label and gives no advice', () => {
    expect(en['tips.spray.body']).toContain('Always read and follow the product label.');
    expect(en['tips.spray.body']).not.toMatch(/rate|mix|dose|weather|wind|rain|wait|hour|day\b/i);
  });
});
