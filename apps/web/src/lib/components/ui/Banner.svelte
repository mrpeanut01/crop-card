<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PillTone } from '$lib/styles/tokens';

  interface Props {
    tone?: PillTone;
    /** True for tones like 'rust' that should be announced immediately. */
    urgent?: boolean;
    dismissible?: boolean;
    onDismiss?: () => void;
    children: Snippet;
    /** Optional right-side slot for an action link/button. */
    action?: Snippet;
  }

  const {
    tone = 'neutral',
    urgent = false,
    dismissible = false,
    onDismiss,
    children,
    action
  }: Props = $props();

  // Banners get either status or alert per WCAG: alert for blocking errors,
  // status for everything else. Defaults to status; consumers opt into alert
  // via `urgent`.
  const role = $derived(urgent ? 'alert' : 'status');
</script>

<div class="banner {tone}" {role}>
  <div class="content">{@render children()}</div>
  {#if action}
    <div class="action">{@render action()}</div>
  {/if}
  {#if dismissible}
    <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => onDismiss?.()}
      >×</button
    >
  {/if}
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 28px;
    border-bottom: 1px solid transparent;
    font-size: var(--font-size-body);
  }
  .content {
    flex: 1;
  }
  .action {
    flex: 0 0 auto;
  }
  .neutral {
    background: var(--pill-neutral-bg);
    color: var(--pill-neutral-fg);
    border-bottom-color: var(--pill-neutral-bd);
  }
  .forest {
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    border-bottom-color: var(--pill-forest-bd);
  }
  .wheat {
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    border-bottom-color: var(--pill-wheat-bd);
  }
  .rust {
    background: var(--pill-rust-bg);
    color: var(--pill-rust-fg);
    border-bottom-color: var(--pill-rust-bd);
  }
  .sky {
    background: var(--pill-sky-bg);
    color: var(--pill-sky-fg);
    border-bottom-color: var(--pill-sky-bd);
  }
  .dismiss {
    background: transparent;
    border: none;
    font-size: 20px;
    line-height: 1;
    color: inherit;
    min-width: 44px;
    min-height: 44px;
    border-radius: var(--radius-pill);
    display: grid;
    place-items: center;
  }
  .dismiss:hover {
    background: rgba(0, 0, 0, 0.08);
  }
</style>
