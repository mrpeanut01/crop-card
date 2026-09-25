<script lang="ts">
  import { aiProgressLabel, fmtElapsed } from './format';
  import type { ProgressStage } from './types';
  import { getWizardContext } from './wizardState.svelte';

  const { stage, startMs }: { stage: ProgressStage; startMs: number | null } = $props();

  const w = getWizardContext();

  const elapsed = $derived(startMs == null ? 0 : Math.max(0, w.nowMs - startMs));
</script>

<div class="ai-progress" role="status" aria-live="polite">
  <span class="ai-spinner" aria-hidden="true"></span>
  <div class="ai-progress-text">
    <span class="ai-progress-label">{aiProgressLabel(stage, elapsed)}</span>
    <span class="ai-progress-elapsed" aria-label="elapsed time">{fmtElapsed(elapsed)}</span>
  </div>
</div>

<style>
  .ai-progress {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: #f3f9f4;
    border: 1px solid #cbd5cb;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: var(--color-forest);
  }
  .ai-progress-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    line-height: 1.3;
  }
  .ai-progress-label {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .ai-progress-elapsed {
    font-size: 0.78rem;
    color: #4a5d4a;
    font-variant-numeric: tabular-nums;
  }
  .ai-spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid #cbd5cb;
    border-top-color: var(--color-forest);
    border-radius: 50%;
    animation: ai-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes ai-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
