/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { HOUR_MS, type HourlyPoint } from '$lib/weather/leafWet';
import {
  assessFhbRisk,
  assessVernalization,
  buildZadoksTimeline,
  currentStageIndex,
  dailyScabFavorableHours,
  DAY_MS,
  FHB_WINDOW_HOURS
} from '$lib/plan/smallGrain';
import FhbRiskPanel from './FhbRiskPanel.svelte';
import PlantingCard from './PlantingCard.svelte';
import VernalizationPanel from './VernalizationPanel.svelte';
import ZadoksTimeline from './ZadoksTimeline.svelte';

const PLANT = Date.UTC(2025, 9, 8, 12);
const PLUGIN = {
  pluginId: 'wheat-hard-white-winter',
  displayName: 'Wheat — Hard White Winter',
  daysToMaturity: { min: 240, max: 280 }
};

describe('ZadoksTimeline', () => {
  it('highlights the current stage and lists decision points with fallback provenance', () => {
    const stages = buildZadoksTimeline(PLUGIN, PLANT);
    const now = Date.UTC(2026, 3, 24, 12);
    const idx = currentStageIndex(stages, now);
    const { container } = render(ZadoksTimeline, { stages, currentIndex: idx, nowMs: now });
    const current = container.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain('Z39');
    expect(screen.getByText('FHB fungicide window')).toBeTruthy();
    expect(screen.getByText('Herbicide cutoff')).toBeTruthy();
    expect(container.textContent).toContain('typical');
  });
});

describe('FhbRiskPanel', () => {
  const anthesis = Date.UTC(2026, 4, 12, 12);
  const start = anthesis - FHB_WINDOW_HOURS * HOUR_MS;
  const hours: HourlyPoint[] = Array.from({ length: FHB_WINDOW_HOURS }, (_, i) => ({
    t: start + i * HOUR_MS,
    tempF: 68,
    dewpointF: 60,
    rhPct: i % 2 === 0 ? 95 : 70,
    popPct: 20,
    precipMm: 0,
    windMph: 4
  }));

  it('shows the assessed level, the curve and the scab-initiative link', () => {
    const a = assessFhbRisk({ anthesisMs: anthesis, hours, provenance: 'data', nowMs: start });
    render(FhbRiskPanel, {
      assessment: a,
      daily: dailyScabFavorableHours(hours),
      nowMs: start,
      fungicides: [{ occurredAt: anthesis + DAY_MS, products: ['Prosaro'] }]
    });
    expect(screen.getByTestId('fhb-level').textContent).toBe('High');
    expect(screen.getByRole('img', { name: /Scab-favorable hours per day/ })).toBeTruthy();
    const link = screen.getByRole('link', { name: /wheatscab\.psu\.edu/ });
    expect(link.getAttribute('href')).toBe('https://www.wheatscab.psu.edu/');
    expect(screen.getByText(/Prosaro/)).toBeTruthy();
  });

  it('says weather unavailable on the fallback path', () => {
    const a = assessFhbRisk({
      anthesisMs: anthesis,
      hours: [],
      provenance: 'fallback',
      nowMs: start
    });
    render(FhbRiskPanel, { assessment: a, daily: [], nowMs: start });
    expect(screen.getByTestId('fhb-level').textContent).toBe('Unknown');
    expect(screen.getByText(/Weather unavailable/)).toBeTruthy();
  });

  it('says not in window when flowering is beyond the forecast', () => {
    const now = anthesis - 60 * DAY_MS;
    const a = assessFhbRisk({
      anthesisMs: anthesis,
      hours: [{ ...hours[0], t: now }],
      provenance: 'data',
      nowMs: now
    });
    render(FhbRiskPanel, { assessment: a, daily: [], nowMs: now });
    expect(screen.getByTestId('fhb-level').textContent).toBe('Not in window');
  });
});

describe('VernalizationPanel', () => {
  it('shows accumulated cold days with a climatology note for winter wheat', () => {
    const v = assessVernalization({
      habit: 'winter',
      plantMs: PLANT,
      nowMs: Date.UTC(2025, 11, 1),
      hours: [],
      provenance: 'fallback'
    });
    render(VernalizationPanel, { assessment: v });
    expect(Number(screen.getByTestId('vern-days').textContent)).toBeGreaterThan(0);
    expect(screen.getByText('Accumulating')).toBeTruthy();
    expect(screen.getByText(/Dulles 1991–2020/)).toBeTruthy();
  });

  it('names the NOAA station when past hours are observed', () => {
    const start = Date.UTC(2025, 10, 1);
    const now = Date.UTC(2025, 10, 11);
    const hours = Array.from({ length: (now - start) / (60 * 60 * 1000) }, (_, i) => ({
      t: start + i * 60 * 60 * 1000,
      tempF: 40,
      dewpointF: null,
      rhPct: 80,
      popPct: null,
      precipMm: null,
      windMph: null
    }));
    const v = assessVernalization({
      habit: 'winter',
      plantMs: start,
      nowMs: now,
      hours,
      provenance: 'data'
    });
    expect(v.provenance).toBe('data');
    render(VernalizationPanel, {
      assessment: v,
      observedLabel: 'Leesburg Executive AP (KJYO)'
    });
    expect(screen.getAllByText(/Leesburg Executive AP \(KJYO\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Dulles 1991–2020/)).toBeNull();
  });

  it('shows not required for spring habit', () => {
    const v = assessVernalization({
      habit: 'spring',
      plantMs: PLANT,
      nowMs: PLANT + DAY_MS,
      hours: [],
      provenance: 'fallback'
    });
    render(VernalizationPanel, { assessment: v });
    expect(screen.getByText('Not required')).toBeTruthy();
    expect(screen.queryByTestId('vern-days')).toBeNull();
  });
});

describe('PlantingCard small-grain entry point', () => {
  const planting = {
    id: 'p1',
    blockId: 'b1',
    cropPluginId: 'wheat-soft-red-winter',
    varietyDisplayName: 'Shirley SRW',
    plantingDate: PLANT
  };
  it('renders the detail link only when given an href', () => {
    const { unmount } = render(PlantingCard, { planting, detailHref: '/plan/wheat?planting=p1' });
    const link = screen.getByRole('link', { name: /scab risk/i });
    expect(link.getAttribute('href')).toBe('/plan/wheat?planting=p1');
    unmount();
    render(PlantingCard, { planting });
    expect(screen.queryByRole('link', { name: /scab risk/i })).toBeNull();
  });
});
