<script lang="ts">
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { lifecycleLabel, lifecycleLine, type LifecycleDetail } from '$lib/garden/lifecycleHere';

  interface Props {
    verdict: LifecycleDetail;
    /** The short label only, with the whole line as its title (picker rows). */
    compact?: boolean;
  }

  const { verdict, compact = false }: Props = $props();

  const locale = $derived(page.data?.locale);
  const line = $derived(lifecycleLine(verdict, locale));
  const label = $derived(lifecycleLabel(verdict, locale));
</script>

{#if compact}
  <span
    class="lifecycle compact"
    data-testid="lifecycle-line"
    data-lifecycle={verdict.lifecycle}
    title={line}
  >
    <span>{label}</span>
    <Provenance source={verdict.provenance} compact />
  </span>
{:else}
  <p class="lifecycle" data-testid="lifecycle-line" data-lifecycle={verdict.lifecycle}>
    <span class="label">{label}</span>
    <span class="text">{line}</span>
    <Provenance source={verdict.provenance} compact />
  </p>
{/if}

<style>
  .lifecycle {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: var(--space-1) 0 0;
    color: var(--color-ink-soft);
  }
  p.lifecycle {
    display: flex;
  }
  .label {
    font-weight: 600;
  }
  .compact {
    font-size: var(--font-size-caption);
  }
</style>
