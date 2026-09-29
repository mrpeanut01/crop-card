/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import WeatherStrip from './WeatherStrip.svelte';
import ForecastSheet from './ForecastSheet.svelte';
import type { TodayWeather } from '$lib/today/weatherSummary';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

const ok: TodayWeather = {
  status: 'ok',
  source: 'farm',
  summary: { tempF: 70, tempKind: 'high', sky: 'clear', windMph: 6, shortForecast: 'Sunny' },
  fetchedAt: Date.UTC(2026, 8, 29, 14),
  days: [
    {
      date: '2026-09-29',
      sky: 'clear',
      highF: 70,
      lowF: 50,
      popPct: 0,
      windMph: 6,
      shortForecast: 'Sunny',
      overnightOnly: false
    },
    {
      date: '2026-09-30',
      sky: 'rain',
      highF: 62,
      lowF: 49,
      popPct: 80,
      shortForecast: 'Rain',
      overnightOnly: false
    }
  ]
};

describe('Current conditions', () => {
  it('is a button that opens the forecast, even with no location', async () => {
    const onOpenForecast = vi.fn();
    render(WeatherStrip, {
      dateLabel: 'Tuesday, September 29',
      greeting: 'Good morning.',
      subtitle: '',
      weather: { status: 'needs-location' },
      canSetLocation: false,
      onOpenForecast
    });
    const btn = screen.getByTestId('current-conditions');
    expect(btn).toHaveTextContent('Current conditions');
    expect(btn).toHaveTextContent('No farm location set');
    await fireEvent.click(btn);
    expect(onOpenForecast).toHaveBeenCalled();
  });
});

describe('ForecastSheet', () => {
  it('lists each forecast day with sky, temps, rain, wind and the source', () => {
    render(ForecastSheet, { open: true, onClose: vi.fn(), weather: ok, canSetLocation: true });
    const sheet = screen.getByTestId('forecast-sheet');
    expect(screen.getByRole('heading', { name: '7-day forecast' })).toBeInTheDocument();
    expect(sheet.querySelectorAll('.day')).toHaveLength(2);
    expect(sheet).toHaveTextContent('Rain 80%');
    expect(sheet).toHaveTextContent('Sunny');
    expect(sheet).toHaveTextContent('National Weather Service forecast for your farm location');
  });

  it('owners get a set-location link, helpers are told to ask the owner', () => {
    const { unmount } = render(ForecastSheet, {
      open: true,
      onClose: vi.fn(),
      weather: { status: 'needs-location' },
      canSetLocation: true
    });
    expect(screen.getByRole('link', { name: 'Set farm location' })).toHaveAttribute(
      'href',
      '/settings/farm'
    );
    unmount();
    render(ForecastSheet, {
      open: true,
      onClose: vi.fn(),
      weather: { status: 'needs-location' },
      canSetLocation: false
    });
    expect(screen.queryByRole('link', { name: 'Set farm location' })).toBeNull();
    expect(screen.getByText(/Ask the owner/)).toBeInTheDocument();
  });
});
