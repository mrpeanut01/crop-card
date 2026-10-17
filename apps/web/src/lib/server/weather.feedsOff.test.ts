import { afterEach, describe, expect, it, vi } from 'vitest';
import { nwsFetch, WeatherFetchError, weatherFeedsOff } from './weather';
import { fetchActiveAlertsBody } from './nwsAlerts';
import { nceiFetchText, nceiUrl, ObservedFetchError } from './weatherObserved';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('WEATHER_FEEDS=off', () => {
  it('reads only the exact value off', () => {
    expect(weatherFeedsOff({ WEATHER_FEEDS: 'off' })).toBe(true);
    expect(weatherFeedsOff({ WEATHER_FEEDS: '' })).toBe(false);
    expect(weatherFeedsOff({})).toBe(false);
  });

  it('makes nwsFetch throw without touching the network', async () => {
    vi.stubEnv('WEATHER_FEEDS', 'off');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(nwsFetch('https://api.weather.gov/points/39.1,-77.5')).rejects.toBeInstanceOf(
      WeatherFetchError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes the alerts and NCEI requests throw before connecting', async () => {
    vi.stubEnv('WEATHER_FEEDS', 'off');
    const connector = vi.fn();
    const resolver = vi.fn();
    await expect(
      fetchActiveAlertsBody(39.1 + Math.random() / 1e3, -77.5, { connector, resolver })
    ).rejects.toBeInstanceOf(WeatherFetchError);
    await expect(
      nceiFetchText({ connector, resolver })(nceiUrl('USW00093738', 0, 3_600_000))
    ).rejects.toBeInstanceOf(ObservedFetchError);
    expect(connector).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });
});
