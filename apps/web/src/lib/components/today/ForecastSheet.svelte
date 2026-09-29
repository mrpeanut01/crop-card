<script lang="ts">
  import { MapPin } from 'lucide-svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import WeatherIcon from './WeatherIcon.svelte';
  import { RAIN_POP_PCT, type TodayWeather } from '$lib/today/weatherSummary';
  import { fmt } from '$lib/prefsState.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    weather: TodayWeather;
    canSetLocation: boolean;
  }
  const { open, onClose, weather, canSetLocation }: Props = $props();
</script>

<Modal {open} {onClose} title="7-day forecast">
  <div class="sheet" data-testid="forecast-sheet">
    {#if weather.status === 'ok' && weather.days.length > 0}
      <ul class="days">
        {#each weather.days as d (d.date)}
          <li class="day">
            <div class="when">
              <span class="wd">{fmt.day(d.date, 'weekday')}</span>
              <span class="md">{fmt.day(d.date, 'month-day')}</span>
            </div>
            <WeatherIcon sky={d.sky} size={22} />
            <div class="temps">
              {#if d.overnightOnly}
                <span class="lbl">Tonight</span>
                <span class="mono">{fmt.qty(d.lowF, 'temperature')}</span>
              {:else}
                <span class="mono hi">{fmt.qty(d.highF, 'temperature')}</span>
                <span class="mono lo">{fmt.qty(d.lowF, 'temperature')}</span>
              {/if}
            </div>
            <div class="detail">
              {#if d.shortForecast}<span class="short">{d.shortForecast}</span>{/if}
              <span class="meta">
                <span class:wet={d.popPct >= RAIN_POP_PCT}>Rain {d.popPct}%</span>
                {#if d.windMph !== undefined}
                  · Wind {fmt.qty(d.windMph, 'speed')}{/if}
              </span>
            </div>
          </li>
        {/each}
      </ul>
      <p class="source">
        <Provenance source="data" label="NWS" long="National Weather Service forecast" />
        National Weather Service forecast for {weather.source === 'farm'
          ? 'your farm location'
          : 'your first mapped block'}. Updated {fmt.instant(weather.fetchedAt, 'datetime')}.
      </p>
    {:else if weather.status === 'needs-location'}
      <p class="empty">There is no farm location yet, so there is no forecast to show.</p>
      {#if canSetLocation}
        <a class="btn" href="/settings/farm">
          <MapPin size={16} strokeWidth={1.75} aria-hidden="true" />Set farm location
        </a>
      {:else}
        <p class="ask">Ask the owner to set the farm location in Settings.</p>
      {/if}
    {:else}
      <p class="empty">
        The National Weather Service forecast could not be reached just now. Try again in a few
        minutes.
      </p>
    {/if}
  </div>
</Modal>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .days {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .day {
    display: grid;
    grid-template-columns: 3.4rem 28px 4.6rem minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-top: 1px solid var(--color-divider-soft);
    color: var(--color-ink);
  }
  .day:first-child {
    border-top: none;
  }
  .when {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .wd {
    font-weight: 700;
    font-size: 14px;
  }
  .md {
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .temps {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .hi {
    font-weight: 700;
  }
  .lo,
  .lbl {
    font-size: 12.5px;
    color: var(--color-ink-soft);
  }
  .detail {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .short {
    font-size: 14px;
  }
  .meta {
    font-size: 12.5px;
    color: var(--color-ink-soft);
  }
  .wet {
    color: var(--color-sky-deep, #2a5a7a);
    font-weight: 700;
  }
  .source {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-ink-soft);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .empty,
  .ask {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    background: var(--color-forest);
    color: var(--color-cream);
    font-weight: 600;
    text-decoration: none;
  }
  .btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
