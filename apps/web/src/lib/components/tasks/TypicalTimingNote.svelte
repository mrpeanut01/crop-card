<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const tr = $derived(createT(page.data?.locale));
</script>

<span class="typical" data-typical-timing
  ><Provenance source="fallback" compact /><span>{tr('tasks.typicalTiming')}</span></span
>

<style>
  .typical {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    font-size: var(--font-size-meta);
    color: var(--color-ink-soft);
  }
</style>
