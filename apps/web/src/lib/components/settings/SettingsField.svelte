<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Phase 25c (#88) — labeled field wrapper for /settings/* subpages.
   *
   * Renders a uppercase-kicker label + optional hint (right-aligned)
   * + optional "required" indicator, then the input slot. Matches
   * `SField` from the canonical mockup.
   */

  interface Props {
    label: string;
    hint?: string;
    required?: boolean;
    children: Snippet;
  }

  const { label, hint, required = false, children }: Props = $props();
</script>

<label class="field">
  <div class="label-row">
    <span class="label-text">{label}</span>
    {#if required}<span class="req">· required</span>{/if}
    {#if hint}<span class="hint mono">{hint}</span>{/if}
  </div>
  {@render children()}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .label-text {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .req {
    font-size: 10px;
    color: var(--color-rust, #ba4b38);
    font-weight: 700;
  }
  .hint {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-left: auto;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
</style>
