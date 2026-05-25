<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PillTone } from '$lib/styles/tokens';

  interface Props {
    tone?: PillTone;
    children: Snippet;
  }

  const { tone = 'neutral', children }: Props = $props();
</script>

<span class="pill {tone}">{@render children()}</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: var(--font-size-meta);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    border: 1px solid transparent;
  }
  .neutral {
    background: var(--pill-neutral-bg);
    color: var(--pill-neutral-fg);
    border-color: var(--pill-neutral-bd);
  }
  .forest {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    border-color: var(--pill-forest-bd);
  }
  .wheat {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    border-color: var(--pill-wheat-bd);
  }
  .rust {
    background: var(--pill-rust-bg);
    color: var(--pill-rust-fg);
    border-color: var(--pill-rust-bd);
  }
  .sky {
    background: var(--pill-sky-bg);
    color: var(--pill-sky-fg);
    border-color: var(--pill-sky-bd);
  }
</style>
