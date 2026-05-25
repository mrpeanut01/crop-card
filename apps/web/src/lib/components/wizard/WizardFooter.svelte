<script lang="ts">
  /**
   * Phase 25b (#96 partial) — wizard footer chrome.
   *
   * 1:1 port of `AWizardFooter` in
   * [`direction-almanac-wizard.jsx`](../../../../docs/design/almanac/direction-almanac-wizard.jsx)
   * (lines 258–274). Sticky bottom bar with Back + (optional summary
   * caption) + Continue. The Continue button can be disabled via
   * `canContinue` so each step's contract drives the gate.
   */
  import { ChevronRight, ArrowRight } from 'lucide-svelte';

  interface Props {
    backLabel?: string;
    nextLabel?: string;
    canContinue?: boolean;
    /** Status text shown between Back and Continue ("11 plantings · 5 blocks"). */
    summary?: string;
    onBack?: () => void;
    onContinue?: () => void;
  }
  const {
    backLabel = 'Back',
    nextLabel = 'Continue',
    canContinue = true,
    summary,
    onBack,
    onContinue
  }: Props = $props();
</script>

<footer class="wf">
  <button type="button" class="ghost" onclick={onBack} disabled={!onBack}>
    <ChevronRight size={14} strokeWidth={1.75} class="wf-back-icon" />
    {backLabel}
  </button>
  {#if summary}
    <div class="summary">{summary}</div>
  {/if}
  <button type="button" class="primary" onclick={onContinue} disabled={!canContinue || !onContinue}>
    {nextLabel}
    <ArrowRight size={14} strokeWidth={1.75} />
  </button>
</footer>

<style>
  .wf {
    position: sticky;
    bottom: 0;
    background: var(--color-paper);
    border-top: 1px solid var(--color-divider);
    padding: 14px 28px;
    display: flex;
    align-items: center;
    gap: 14px;
    z-index: 10;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 14px;
    background: transparent;
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  :global(.wf .wf-back-icon) {
    transform: rotate(180deg);
  }
  .ghost:hover:not(:disabled) {
    border-color: var(--color-forest-deep);
  }
  .ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .summary {
    font-size: 12.5px;
    color: var(--color-ink-soft);
  }
  .primary {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: var(--color-forest);
    color: var(--color-cream);
    border: none;
    border-radius: var(--radius-input, 6px);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .primary:hover:not(:disabled) {
    background: var(--color-forest-deep);
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
