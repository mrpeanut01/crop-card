import { describe, expect, it } from 'vitest';
import frostAdvisory from '../__fixtures__/nws-alerts-frost-advisory-garrett.json';
import { parseFrostAlerts } from '../nwsAlerts';
import { frostTonightAlerts, type FrostPlantingSnapshot } from './frost';
import { t } from '$lib/i18n';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-24T18:00:00Z');
const advisory = parseFrostAlerts(frostAdvisory, NOW);

const rosemary: FrostPlantingSnapshot = {
  status: 'active',
  plantingDate: NOW - 120 * DAY,
  name: 'Rosemary',
  blockName: 'Herb bed',
  hardiness: 'hardy',
  bringIn: true
};

describe('frost-tonight for tender perennial herbs (R-8)', () => {
  it('a tender perennial herb is at risk in any frost and is told to come in or be covered', () => {
    const [alert] = frostTonightAlerts(advisory, [rosemary], NOW);
    expect(alert.body).toContain('Rosemary is at risk.');
    expect(alert.body).toContain('Rosemary: bring it in or cover it.');
    expect(alert.body).not.toContain('Cover or harvest');
  });

  it('keeps the other crops line when a tender crop is out too', () => {
    const tomato: FrostPlantingSnapshot = { ...rosemary, name: 'Tomato', hardiness: 'tender' };
    delete tomato.bringIn;
    const [alert] = frostTonightAlerts(advisory, [rosemary, tomato], NOW);
    expect(alert.body).toContain('Rosemary: bring it in or cover it.');
    expect(alert.body).toContain('Cover or harvest before the cold sets in.');
  });

  it('a hardy herb that is not a tender perennial stays out', () => {
    expect(frostTonightAlerts(advisory, [{ ...rosemary, bringIn: false }], NOW)).toEqual([]);
  });

  it('a heated bed keeps it out, and the line is Spanish for a Spanish recipient', () => {
    expect(frostTonightAlerts(advisory, [{ ...rosemary, cover: 'heated' }], NOW)).toEqual([]);
    const [alert] = frostTonightAlerts(advisory, [rosemary], NOW, 'es');
    expect(alert.body).toContain(t('es', 'herbsd.push.bringIn', { names: 'Rosemary' }));
  });
});
