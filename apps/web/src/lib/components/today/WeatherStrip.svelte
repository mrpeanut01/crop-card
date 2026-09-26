<script lang="ts">
  /**
   * Phase 25e (#97) — /today greeting header + right-aligned weather strip.
   *
   * 1:1 port of the `ATodayScreen` header in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 214–230). Render with `data.weather` from the loader.
   */
  import {
    Sun,
    Moon,
    CloudSun,
    CloudMoon,
    Cloud,
    CloudRain,
    CloudLightning,
    CloudSnow,
    CloudFog,
    Wind,
    MapPin
  } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import type { TodayWeather, WeatherSky } from '$lib/today/weatherSummary';
  import { fmt } from '$lib/prefsState.svelte';

  interface Props {
    /** Local date string ("May 24") — kicker above the greeting. */
    dateLabel: string;
    /** "Good morning, Sherry." */
    greeting: string;
    /** "One thing to do today. · 5 items this week." */
    subtitle: string;
    weather: TodayWeather;
    /** Helpers can't open /settings/farm, so they get plain text. */
    canSetLocation?: boolean;
  }
  const { dateLabel, greeting, subtitle, weather, canSetLocation = false }: Props = $props();

  const SKY_ICON: Record<WeatherSky, typeof Sun> = {
    clear: Sun,
    'clear-night': Moon,
    partly: CloudSun,
    'partly-night': CloudMoon,
    cloudy: Cloud,
    rain: CloudRain,
    storm: CloudLightning,
    snow: CloudSnow,
    fog: CloudFog
  };
</script>

<header class="hdr">
  <div>
    <Kicker>{dateLabel}</Kicker>
    <h1 class="serif greeting">{greeting}</h1>
    <div class="subtitle">{subtitle}</div>
  </div>
  {#if weather.status === 'ok'}
    {@const w = weather.summary}
    {@const SkyIcon = SKY_ICON[w.sky]}
    <div
      class="weather"
      aria-label={weather.source === 'farm' ? 'Weather at your farm location' : 'Local weather'}
    >
      <div class="w-cell" title={w.shortForecast}>
        <SkyIcon size={16} strokeWidth={1.75} aria-hidden="true" />
        {#if w.shortForecast}<span class="sr-only">{w.shortForecast},</span>{/if}
        {#if w.tempKind === 'low'}<span class="lbl">Low</span>{/if}
        <span class="mono">{fmt.qty(w.tempF, 'temperature')}</span>
      </div>
      {#if w.windMph !== undefined}
        <div class="w-cell">
          <Wind size={16} strokeWidth={1.75} aria-hidden="true" /><span class="sr-only">Wind</span
          ><span class="mono">{fmt.qty(w.windMph, 'speed')}</span>
        </div>
      {/if}
      {#if w.rainHint}
        <div class="w-cell">
          <CloudRain size={16} strokeWidth={1.75} aria-hidden="true" /><span class="mono"
            >{w.rainHint}</span
          >
        </div>
      {/if}
    </div>
  {:else if weather.status === 'needs-location'}
    {#if canSetLocation}
      <a class="weather set-loc" href="/settings/farm">
        <MapPin size={16} strokeWidth={1.75} aria-hidden="true" />Set your farm location to see the
        forecast
      </a>
    {:else}
      <div class="weather muted">No farm location set for the forecast</div>
    {/if}
  {:else}
    <div class="weather muted" role="status">Weather unavailable right now</div>
  {/if}
</header>

<style>
  .hdr {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 22px;
    flex-wrap: wrap;
  }
  .greeting {
    margin: 6px 0 0;
    font-size: 38px;
    line-height: 1.05;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
    font-family: var(--font-serif, serif);
  }
  .subtitle {
    margin-top: 6px;
    color: var(--color-ink-soft);
    font-size: 14.5px;
  }
  .weather {
    display: flex;
    align-items: center;
    gap: 22px;
    color: var(--color-ink-soft);
    font-size: 13.5px;
  }
  .w-cell {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .lbl {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .set-loc {
    gap: 6px;
    min-height: 48px;
    color: var(--color-forest-deep);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .muted {
    font-style: italic;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .w-cell .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-weight: 500;
  }
  @media (max-width: 720px) {
    .greeting {
      font-size: 30px;
    }
    .weather {
      gap: 14px;
      font-size: 12.5px;
    }
  }
</style>
