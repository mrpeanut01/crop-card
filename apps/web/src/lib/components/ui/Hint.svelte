<script lang="ts">
  import type { Snippet } from 'svelte';
  import { markHintSeen } from '$lib/client/hints';
  import type { HintKey } from '$lib/hints';

  interface Props {
    hintKey: HintKey;
    children: Snippet;
    ondismiss?: () => void;
  }

  const { hintKey, children, ondismiss }: Props = $props();
  let open = $state(true);

  function dismiss(): void {
    open = false;
    void markHintSeen(hintKey);
    ondismiss?.();
  }
</script>

{#if open}
  <div class="hint" role="note" data-hint={hintKey}>
    <p>{@render children()}</p>
    <button type="button" class="got-it" onclick={dismiss}>Got it</button>
  </div>
{/if}

<style>
  .hint {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-input);
    background: var(--pill-sky-bg, var(--color-paper));
    border: 1px solid var(--pill-sky-bd, var(--color-divider));
    color: var(--color-ink);
  }
  p {
    margin: 0;
    flex: 1;
    font-size: var(--font-size-body);
  }
  .got-it {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
  }
  .got-it:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
