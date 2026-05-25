<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    padded?: boolean;
    loose?: boolean;
    children: Snippet;
  }

  const { padded = true, loose = false, children }: Props = $props();
</script>

<div class="card" class:padded class:loose>{@render children()}</div>

<style>
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
  }
  .padded {
    padding: var(--card-padding);
  }
  .loose {
    padding: var(--card-padding-loose);
  }
</style>
