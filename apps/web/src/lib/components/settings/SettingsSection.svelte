<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Phase 25c (#88) — section card for /settings/* subpages.
   *
   * Title + optional sub + optional right slot (action button), then
   * a body slot. Matches `SSection` from the canonical mockup.
   */

  interface Props {
    title: string;
    sub?: string;
    right?: Snippet;
    children: Snippet;
  }

  const { title, sub, right, children }: Props = $props();
</script>

<section class="section">
  <header class="sec-head">
    <div class="sec-text">
      <h3 class="serif">{title}</h3>
      {#if sub}<p class="sec-sub">{sub}</p>{/if}
    </div>
    {#if right}<div class="sec-right">{@render right()}</div>{/if}
  </header>
  <div class="sec-body">
    {@render children()}
  </div>
</section>

<style>
  .section {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    margin-bottom: 14px;
    overflow: hidden;
  }
  .sec-head {
    padding: 13px 18px 11px;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .sec-text {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: 16px;
    color: var(--color-forest-deep);
    letter-spacing: -0.01em;
  }
  .sec-sub {
    margin: 3px 0 0;
    font-size: 12px;
    color: var(--color-ink-muted);
    line-height: 1.4;
  }
  .sec-right {
    flex-shrink: 0;
  }
  .sec-body {
    padding: 16px 18px;
  }
</style>
