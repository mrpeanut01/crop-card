import { describe, expect, it } from 'vitest';
import { t } from '$lib/i18n';

describe('/harvest stat line and banner in Spanish (#664)', () => {
  it('agrees with the count', () => {
    expect(t('es', 'harvestui.readyToday', { count: 1 })).toBe('lista hoy ·');
    expect(t('es', 'harvestui.readyToday', { count: 3 })).toBe('listas hoy ·');
    expect(t('es', 'harvestui.upcomingWindows', { count: 1 })).toBe('ventana próxima ·');
    expect(t('es', 'harvestui.eventsYtd', { count: 1 })).toBe('evento registrado en el año');
    expect(t('es', 'harvestui.nReady', { count: 1 })).toBe('1 lista');
    expect(t('en', 'harvestui.upcomingWindows', { count: 1 })).toBe('upcoming window ·');
    expect(t('en', 'harvestui.nReady', { count: 4 })).toBe('4 ready');
  });

  it('never doubles "de" in the repeat-harvest banner', () => {
    for (const k of ['fruit', 'leafy', 'tree'] as const) {
      const label = t('es', `harvestui.reLabel.${k}`);
      const banner = t('es', 'harvestui.reBanner', { label });
      expect(banner).not.toMatch(/\bde de\b/);
      expect(banner).toContain(`Esta siembra ${label}`);
    }
  });
});

describe('/today sprayer cleanout card (#665)', () => {
  it('reads its chrome in Spanish with a plural body', () => {
    expect(t('es', 'today.decon.title')).not.toBe(t('en', 'today.decon.title'));
    expect(t('es', 'today.decon.body', { count: 1 })).toMatch(/^Un pulverizador/);
    expect(t('es', 'today.decon.body', { count: 2 })).toMatch(/^Hay pulverizadores/);
    expect(t('en', 'today.decon.body', { count: 1 })).toMatch(/^A sprayer still holds/);
    expect(t('es', 'today.decon.allEquipment')).toBe('Todo el equipo');
  });
});
