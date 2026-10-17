<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { observedDays, observedFromMs, type ObservedDay } from '$lib/weather/observedDays';
  import type { HourlyPoint } from '$lib/weather/leafWet';

  interface Props {
    /** Fetch once the sheet first opens, never on the page load (R-22). */
    open: boolean;
    fetcher?: typeof fetch;
  }
  const { open, fetcher }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  type State =
    | { status: 'idle' | 'loading' | 'unavailable' }
    | { status: 'ok'; days: ObservedDay[]; station: string };
  let state = $state<State>({ status: 'idle' });

  async function load() {
    state = { status: 'loading' };
    const now = Date.now();
    try {
      const res = await (fetcher ?? fetch)(`/api/weather/observed?from=${observedFromMs(now)}`);
      if (!res.ok) {
        state = { status: 'unavailable' };
        return;
      }
      const body = (await res.json()) as {
        hours?: HourlyPoint[];
        provenance?: string;
        station?: { label?: string } | null;
        location?: { source?: string } | null;
      };
      const days = observedDays(body.hours ?? [], now, currentPrefs().timeZone);
      if (
        body.provenance !== 'data' ||
        !body.station ||
        body.location?.source === 'farm-default' ||
        days.every((d) => d.highF === null)
      ) {
        state = { status: 'unavailable' };
        return;
      }
      state = { status: 'ok', days, station: body.station.label ?? '' };
    } catch {
      state = { status: 'unavailable' };
    }
  }

  $effect(() => {
    if (open && state.status === 'idle') void load();
  });
</script>

<section class="observed" data-testid="observed-temps" aria-labelledby="observed-temps-h">
  <h3 id="observed-temps-h">{tr('herbsd.observed.title')}</h3>
  {#if state.status === 'ok'}
    <ul class="days">
      {#each state.days as d (d.date)}
        <li class="day" data-observed-day={d.date}>
          <span class="when">
            <span class="wd">{fmt.day(d.date, 'weekday')}</span>
            <span class="md">{fmt.day(d.date, 'month-day')}</span>
          </span>
          {#if d.highF === null || d.lowF === null}
            <span class="none">{tr('herbsd.observed.noDay')}</span>
          {:else}
            <span class="temps">
              <span class="mono hi"
                >{tr('herbsd.observed.high', { temp: fmt.qty(d.highF, 'temperature') })}</span
              >
              <span class="mono lo"
                >{tr('herbsd.observed.low', { temp: fmt.qty(d.lowF, 'temperature') })}</span
              >
            </span>
            {#if d.partial}<span class="partial">{tr('herbsd.observed.someMissing')}</span>{/if}
          {/if}
        </li>
      {/each}
    </ul>
    <p class="source">
      <Provenance
        source="data"
        label={tr('herbsd.observed.sourceLabel')}
        long={tr('herbsd.observed.sourceLong')}
      />
      {tr('herbsd.observed.source', { station: state.station })}
    </p>
  {:else if state.status === 'unavailable'}
    <p class="empty" data-testid="observed-unavailable">{tr('herbsd.observed.unavailable')}</p>
  {:else}
    <p class="empty" aria-live="polite">{tr('herbsd.observed.loading')}</p>
  {/if}
</section>

<style>
  .observed {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--color-divider);
  }
  h3 {
    margin: 0;
    font-size: 15px;
    color: var(--color-ink);
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
    grid-template-columns: 3.4rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
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
  .md,
  .lo,
  .partial,
  .none {
    font-size: 12.5px;
    color: var(--color-ink-soft);
  }
  .temps {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .hi {
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
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
  }
</style>
