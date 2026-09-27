<script lang="ts">
  import Pill from '$lib/components/ui/Pill.svelte';

  interface Props {
    foodProducing: boolean;
    /** One plain line saying why, shown beside the chip. */
    explanation?: string | null;
  }

  const { foodProducing, explanation = null }: Props = $props();
</script>

{#if foodProducing}
  <span class="food-chip" data-testid="food-chip">
    <Pill tone="wheat">Food animal</Pill>
    {#if explanation}<span class="why">{explanation}</span>{/if}
  </span>
{:else if explanation}
  <span class="food-chip">
    <Pill tone="neutral">Not a food animal</Pill>
    <span class="why">{explanation}</span>
  </span>
{/if}

<style>
  .food-chip {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .why {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
</style>
