<script lang="ts">
  import { Sprout } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    hardinessZoneDetail,
    hardinessZoneText,
    type HardinessZoneView
  } from '$lib/climate/zone';

  interface Props {
    zone: HardinessZoneView | null;
  }

  const { zone }: Props = $props();

  const REFERENCE_LONG =
    'Published weather-station averages for your area, not something you entered';
</script>

{#if zone}
  <p class="zone" data-testid="hardiness-zone">
    <Sprout size={14} aria-hidden="true" />
    <span class="text">{hardinessZoneText(zone)}</span>
    <Provenance
      source={zone.provenance}
      detail={hardinessZoneDetail(zone)}
      label={zone.provenance === 'data' ? 'Weather service' : undefined}
      long={zone.provenance === 'data' ? REFERENCE_LONG : undefined}
    />
  </p>
{/if}

<style>
  .zone {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin: 0;
    font-size: 13px;
    color: var(--color-ink);
    min-width: 0;
  }
  .text {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
</style>
