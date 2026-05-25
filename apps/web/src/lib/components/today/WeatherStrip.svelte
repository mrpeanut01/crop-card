<script lang="ts">
  /**
   * Phase 25e (#97) — /today greeting header + right-aligned weather strip.
   *
   * 1:1 port of the `ATodayScreen` header in
   * [`direction-almanac-today.jsx`](../../../../docs/design/almanac/direction-almanac-today.jsx)
   * (lines 214–230). Render with `data.weatherSummary` from the loader.
   * If the summary is null (no geometry on any block, or NWS unreachable),
   * the weather row is hidden so the greeting still looks correct.
   */
  import { Sun, Wind, CloudRain } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import type { WeatherSummary } from '$lib/today/weatherSummary';

  interface Props {
    /** Local date string ("May 24") — kicker above the greeting. */
    dateLabel: string;
    /** "Good morning, Sherry." */
    greeting: string;
    /** "One thing to do today. · 5 items this week." */
    subtitle: string;
    weather: WeatherSummary | null;
  }
  const { dateLabel, greeting, subtitle, weather }: Props = $props();
</script>

<header class="hdr">
  <div>
    <Kicker>{dateLabel}</Kicker>
    <h1 class="serif greeting">{greeting}</h1>
    <div class="subtitle">{subtitle}</div>
  </div>
  {#if weather}
    <div class="weather" aria-label="Local weather">
      <div class="w-cell"><Sun size={16} strokeWidth={1.75} /><span class="mono">{weather.tempF}°F</span></div>
      {#if weather.windMph !== undefined}
        <div class="w-cell"><Wind size={16} strokeWidth={1.75} /><span class="mono">{weather.windMph} mph</span></div>
      {/if}
      {#if weather.rainHint}
        <div class="w-cell"><CloudRain size={16} strokeWidth={1.75} /><span class="mono">{weather.rainHint}</span></div>
      {/if}
    </div>
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
    display: flex;
    align-items: center;
    gap: 6px;
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
