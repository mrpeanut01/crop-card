<script lang="ts">
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    harvestTimingLabel,
    harvestTimingText,
    type HarvestTimingHint
  } from '$lib/garden/harvestTiming';

  interface Props {
    /** From `harvestTimingHints`: only methods the brief names, only on a
     *  crop with a sourced row. Nothing renders when empty. */
    hints: readonly HarvestTimingHint[];
  }

  const { hints }: Props = $props();

  const locale = $derived(page.data?.locale ?? null);
</script>

{#each hints as h (h.method)}
  <p class="timing" data-testid="harvest-timing" data-method={h.method} data-stage={h.stage}>
    <span class="label">{harvestTimingLabel(h.method, locale)}</span>
    <span class="text">{harvestTimingText(h.stage, locale)}</span>
    <Provenance source="plugin" compact />
  </p>
{/each}

<style>
  .timing {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1, 4px);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .label {
    font-weight: 600;
  }
</style>
