<script lang="ts">
  import { ChevronLeft } from 'lucide-svelte';
  import type { Snippet } from 'svelte';

  /**
   * Phase 25c (#88) — shared shell for /settings/* subpages.
   *
   * Matches the canonical mockup at
   * `docs/design/almanac/direction-almanac-settings.jsx` ASettingsShell.
   * Provides:
   *   - Breadcrumb header bar: back chevron + "Settings · <kicker>" +
   *     serif title + optional badge slot + optional dirty indicator
   *   - Body area (cream background) with max-width container
   *   - Sticky footer with Cancel + Save changes (unless hideFooter)
   *
   * Each subpage just provides `title`, `kicker`, body slot, and
   * optionally `badge` + `dirty` + form action targets.
   */

  interface Props {
    title: string;
    kicker: string;
    /** Optional pill rendered next to the title (e.g., "1 PENDING"). */
    badge?: Snippet;
    /** Pulses the unsaved indicator when true. */
    dirty?: boolean;
    /** Hide the sticky Cancel/Save footer (e.g., danger-zone-only pages). */
    hideFooter?: boolean;
    /** Form action for the sticky Save button. */
    saveAction?: string;
    /** Where Cancel + back-arrow goes. */
    backHref?: string;
    children: Snippet;
  }

  const {
    title,
    kicker,
    badge,
    dirty = false,
    hideFooter = false,
    saveAction,
    backHref = '/settings',
    children
  }: Props = $props();
</script>

<div class="shell">
  <header class="head">
    <a class="back" href={backHref} aria-label="Back to Settings">
      <ChevronLeft size={16} strokeWidth={1.75} />
    </a>
    <div class="head-text">
      <div class="kicker">Settings · {kicker}</div>
      <div class="title-row">
        <h1 class="serif">{title}</h1>
        {#if badge}{@render badge()}{/if}
      </div>
    </div>
    {#if dirty}
      <span class="dirty">● Unsaved</span>
    {/if}
  </header>

  <div class="body">
    <div class="body-inner">
      {@render children()}
    </div>
  </div>

  {#if !hideFooter}
    <footer class="footer">
      <a class="ghost" href={backHref}>Cancel</a>
      {#if saveAction}
        <form method="POST" action={saveAction}>
          <button type="submit" class="primary">Save changes</button>
        </form>
      {:else}
        <button type="button" class="primary" disabled>Save changes</button>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 56px);
    background: var(--color-cream);
    margin: -16px;
  }
  .head {
    background: var(--color-paper);
    border-bottom: 1px solid var(--color-divider);
    padding: 14px 28px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .back {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-input, 6px);
    border: 1px solid var(--color-divider);
    display: grid;
    place-items: center;
    color: var(--color-ink-muted);
    text-decoration: none;
    flex-shrink: 0;
  }
  .back:hover {
    color: var(--color-ink);
    border-color: var(--color-forest-deep);
  }
  .head-text {
    display: flex;
    flex-direction: column;
  }
  .kicker {
    font-size: 11px;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  h1 {
    margin: 2px 0 0;
    font-size: 26px;
    color: var(--color-forest-deep);
    letter-spacing: -0.015em;
    line-height: 1.1;
  }
  .dirty {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--color-wheat, #d4a75c);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 22px 28px 28px;
  }
  .body-inner {
    max-width: 1100px;
    margin: 0 auto;
  }
  .footer {
    border-top: 1px solid var(--color-divider);
    background: var(--color-paper);
    padding: 12px 28px;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    position: sticky;
    bottom: 0;
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 9px 18px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    min-height: 38px;
    display: inline-flex;
    align-items: center;
  }
  .primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 10px 22px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    min-height: 40px;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @media (max-width: 700px) {
    .head,
    .body,
    .footer {
      padding-left: 16px;
      padding-right: 16px;
    }
    h1 {
      font-size: 22px;
    }
  }
</style>
