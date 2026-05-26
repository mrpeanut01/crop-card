<script lang="ts">
  import { Lock, Unlock } from 'lucide-svelte';

  interface Props {
    locked: boolean;
    hash?: string;
  }

  const { locked, hash }: Props = $props();
</script>

<span class="lock-pill" class:locked class:unlocked={!locked}>
  {#if locked}
    <Lock size={11} strokeWidth={2} />
    <span class="label">locked</span>
  {:else}
    <Unlock size={11} strokeWidth={2} />
    <span class="label">editable</span>
  {/if}
  {#if hash}
    <span class="hash">· {hash}</span>
  {/if}
</span>

<style>
  .lock-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--radius-pill, 99px);
    font-size: 11px;
    font-weight: 600;
    border: 1px solid transparent;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .locked {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    border-color: var(--pill-forest-bd);
  }
  .unlocked {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    border-color: var(--pill-wheat-bd);
  }
  .label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 9.5px;
    font-family: inherit;
  }
  .hash {
    opacity: 0.85;
  }
</style>
