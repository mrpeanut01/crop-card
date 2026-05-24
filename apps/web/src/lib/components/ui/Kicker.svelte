<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  const { children }: Props = $props();
</script>

<div class="kicker">{@render children()}</div>

<style>
  /* Uppercase metadata label that sits above card titles, dates, etc. */
  .kicker {
    font-size: var(--font-size-kicker);
    font-weight: 600;
    color: var(--color-ink-muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
</style>
