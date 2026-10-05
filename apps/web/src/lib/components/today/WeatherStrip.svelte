<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  /**
   * /today greeting header with the current conditions on the right. The
   * conditions are a button that opens the 7-day forecast sheet, including
   * when there is no forecast yet (the sheet says why and what to do).
   */
  import { Wind, CloudRain, MapPin, ChevronRight } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import WeatherIcon from './WeatherIcon.svelte';
  import { RAIN_POP_PCT, type TodayWeather } from '$lib/today/weatherSummary';
  import { fmt } from '$lib/prefsState.svelte';

  interface Props {
    dateLabel: string;
    greeting: string;
    subtitle: string;
    weather: TodayWeather;
    /** Helpers can't open /settings/farm, so their sheet says to ask. */
    canSetLocation?: boolean;
    onOpenForecast?: () => void;
  }
  const {
    dateLabel,
    greeting,
    subtitle,
    weather,
    canSetLocation = false,
    onOpenForecast
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const rainHint = $derived.by(() => {
    if (weather.status !== 'ok') return null;
    const wet = weather.days.slice(0, 3).filter((d) => d.popPct >= RAIN_POP_PCT);
    const day = (d: string) => fmt.day(d, 'weekday').toLowerCase();
    if (wet.length === 1)
      return tr('today.weather.rainOn', { pct: wet[0].popPct, day: day(wet[0].date) });
    if (wet.length >= 2) {
      return tr('today.weather.rainRange', {
        from: day(wet[0].date),
        to: day(wet[wet.length - 1].date)
      });
    }
    return null;
  });
</script>

<header class="hdr">
  <div>
    <Kicker>{dateLabel}</Kicker>
    <h1 class="serif greeting">{greeting}</h1>
    <div class="subtitle">{subtitle}</div>
  </div>
  <button
    type="button"
    class="weather"
    data-testid="current-conditions"
    aria-haspopup="dialog"
    onclick={() => onOpenForecast?.()}
  >
    <span class="cc-label"
      >{tr('today.weather.current')} <ChevronRight size={14} aria-hidden="true" /></span
    >
    {#if weather.status === 'ok'}
      {@const w = weather.summary}
      <span
        class="cells"
        aria-label={weather.source === 'farm'
          ? tr('today.weather.atFarm')
          : tr('today.weather.local')}
      >
        <span class="w-cell" title={w.shortForecast}>
          <WeatherIcon sky={w.sky} />
          {#if w.shortForecast}<span class="sr-only">{w.shortForecast},</span>{/if}
          {#if w.tempKind === 'low'}<span class="lbl">{tr('today.weather.low')}</span>{/if}
          <span class="mono">{fmt.qty(w.tempF, 'temperature')}</span>
        </span>
        {#if w.windMph !== undefined}
          <span class="w-cell">
            <Wind size={16} strokeWidth={1.75} aria-hidden="true" /><span class="sr-only"
              >{tr('today.weather.wind')}</span
            ><span class="mono">{fmt.qty(w.windMph, 'speed')}</span>
          </span>
        {/if}
        {#if rainHint}
          <span class="w-cell">
            <CloudRain size={16} strokeWidth={1.75} aria-hidden="true" /><span class="mono"
              >{rainHint}</span
            >
          </span>
        {/if}
      </span>
    {:else if weather.status === 'needs-location'}
      <span class="cells set-loc">
        <MapPin size={16} strokeWidth={1.75} aria-hidden="true" />
        {canSetLocation ? tr('today.weather.setLocation') : tr('today.weather.noLocation')}
      </span>
    {:else}
      <span class="cells muted">{tr('today.weather.unavailable')}</span>
    {/if}
  </button>
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
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-height: 48px;
    max-width: 100%;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-input, 6px);
    background: transparent;
    color: var(--color-ink-soft);
    font: inherit;
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
  }
  .weather:hover {
    border-color: var(--color-divider);
    background: var(--color-paper);
  }
  .weather:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .cc-label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-forest-deep);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .cells {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 22px;
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
    color: var(--color-forest-deep);
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
      font-size: 12.5px;
    }
    .cells {
      gap: 6px 14px;
    }
  }
</style>
