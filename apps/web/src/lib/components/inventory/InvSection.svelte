<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Phase 27A primitive (#257). White card with a serif title bar +
   * optional right-action slot — the section-level chrome shared by
   * Pesticide / Fertility / Seed / Crop / Sprayer detail and edit
   * surfaces. Keeps every inventory screen visually identical at the
   * section level even when the per-type field set differs.
   */
  interface Props {
    title: string;
    /** Optional kicker rendered above the serif title (e.g., "Identity",
     *  "Storage & reorder"). When absent the title sits alone. */
    kicker?: string;
    /** Right-aligned action slot — typically a small button (Edit,
     *  Export, "Propose change"). */
    action?: Snippet;
    children: Snippet;
  }

  const { title, kicker, action, children }: Props = $props();
</script>

<section class="inv-section" aria-labelledby="inv-section-{title.replace(/\s+/g, '-')}">
  <header class="inv-section-header">
    <div class="inv-section-title-wrap">
      {#if kicker}<span class="kicker">{kicker}</span>{/if}
      <h2 id="inv-section-{title.replace(/\s+/g, '-')}" class="serif">{title}</h2>
    </div>
    {#if action}
      <div class="inv-section-action">{@render action()}</div>
    {/if}
  </header>
  <div class="inv-section-body">{@render children()}</div>
</section>

<style>
  .inv-section {
    background: var(--color-paper, #fff);
    border-radius: 10px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .inv-section-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }
  .inv-section-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .kicker {
    font-size: var(--font-size-kicker, 0.7rem);
    font-weight: 600;
    color: var(--color-ink-muted, #6a6f63);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .inv-section-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
