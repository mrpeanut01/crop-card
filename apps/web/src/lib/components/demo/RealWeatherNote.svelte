<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { demoClockShifted } from '$lib/demo/clientClock';

  const { inline = false }: { inline?: boolean } = $props();
  const tr = $derived(createT(page.data?.locale));
  const shifted = $derived(demoClockShifted(page.data));
</script>

{#if shifted}
  {#if inline}
    <span class="real-wx" data-testid="real-weather-note">{tr('entry.demo.realWeather')}</span>
  {:else}
    <p class="real-wx" data-testid="real-weather-note">{tr('entry.demo.realWeather')}</p>
  {/if}
{/if}

<style>
  .real-wx {
    display: block;
    margin: 4px 0 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-ink-soft);
  }
</style>
