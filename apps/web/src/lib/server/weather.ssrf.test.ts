import { afterEach, describe, expect, it, vi } from 'vitest';
import { getForecast, isNwsUrl, nwsFetch, WeatherFetchError } from './weather';
import { getHourlyForecast } from './weatherHourly';

let latSeq = 0;
function freshLat(): number {
  latSeq += 1;
  return 20 + latSeq / 1000 + Math.random() / 1e6;
}

function pointsWith(properties: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify({ properties }), { status: 200 }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNwsUrl', () => {
  it.each([
    'https://api.weather.gov/gridpoints/LWX/1,2/forecast',
    'https://api.weather.gov/points/39,-77'
  ])('accepts %s', (u) => expect(isNwsUrl(u)).toBe(true));

  it.each([
    'http://api.weather.gov/gridpoints/LWX/1,2/forecast',
    'https://api.weather.gov.evil.example/x',
    'https://api.weather.gov@evil.example/x',
    'https://evil.example/https://api.weather.gov/',
    'http://169.254.169.254/latest/meta-data/',
    'https://api.weather.gov',
    '',
    null,
    42
  ])('rejects %j', (u) => expect(isNwsUrl(u)).toBe(false));
});

describe('nwsFetch', () => {
  it('refuses a non-NWS URL without touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(nwsFetch('http://169.254.169.254/latest/')).rejects.toBeInstanceOf(
      WeatherFetchError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies a default timeout signal when the caller passes none', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await nwsFetch('https://api.weather.gov/points/39,-77');
    const init = fetchMock.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps a caller-supplied signal', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await nwsFetch('https://api.weather.gov/points/39,-77', { signal: controller.signal });
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('wraps an aborted/timed-out request as WeatherFetchError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      })
    );
    await expect(nwsFetch('https://api.weather.gov/points/39,-77')).rejects.toBeInstanceOf(
      WeatherFetchError
    );
  });
});

describe('points → follow-up URL validation', () => {
  it('getForecast refuses a forecast URL off api.weather.gov', async () => {
    const fetchMock = pointsWith({ forecast: 'http://169.254.169.254/latest/meta-data/' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getForecast(freshLat(), -77.5)).rejects.toBeInstanceOf(WeatherFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getHourlyForecast refuses a forecastGridData URL off api.weather.gov', async () => {
    const fetchMock = pointsWith({
      forecast: 'https://api.weather.gov/gridpoints/LWX/1,2/forecast',
      forecastGridData: 'https://attacker.example/grid'
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getHourlyForecast(freshLat(), -77.5)).rejects.toBeInstanceOf(WeatherFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
