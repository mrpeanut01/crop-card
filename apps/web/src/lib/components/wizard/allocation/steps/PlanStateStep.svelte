<script lang="ts">
  import { getWizardContext } from '../wizardState.svelte';

  const w = getWizardContext();
  const blocks = $derived(w.props.blocks);
</script>

<section class="aw-plan-state">
  <h3>You have a plan in place</h3>
  <p class="aw-plan-state-lede">
    {#each blocks.filter((b) => b.plantings.length > 0) as b, i (b.id)}
      {#if i > 0},
      {/if}
      <strong>{b.name}</strong>: {b.plantings.length} planting{b.plantings.length === 1 ? '' : 's'}
    {/each}
  </p>
  <p>Pick what to do next:</p>
  <div class="aw-plan-state-actions">
    <button
      type="button"
      class="aw-plan-state-btn aw-plan-state-continue"
      onclick={() => w.planReset.continueExistingPlan()}
    >
      <span class="aw-plan-state-icon" aria-hidden="true">✚</span>
      <span class="aw-plan-state-title">Continue planning</span>
      <span class="aw-plan-state-sub">Add more plantings to the current plan.</span>
    </button>
    <button
      type="button"
      class="aw-plan-state-btn aw-plan-state-reset"
      onclick={() => w.planReset.openResetConfirm()}
    >
      <span class="aw-plan-state-icon" aria-hidden="true">↻</span>
      <span class="aw-plan-state-title">Start over</span>
      <span class="aw-plan-state-sub">
        Clear the current plan and start fresh. Historical (planted / harvested) crops are
        preserved.
      </span>
    </button>
  </div>
  {#if w.planReset.resetError}
    <p class="aw-error" role="alert">Reset failed: {w.planReset.resetError}</p>
  {/if}

  {#if w.planReset.resetConfirmOpen}
    <div
      class="aw-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="aw-reset-title"
    >
      <div class="aw-confirm-card">
        <h4 id="aw-reset-title">Clear the current plan?</h4>
        <p>
          This deletes every <strong>planned</strong> crop on your blocks and any open Inputs Plan tasks.
          Active and harvested crops are kept. This cannot be undone.
        </p>
        <div class="aw-confirm-actions">
          <button
            type="button"
            class="btn-secondary"
            onclick={() => w.planReset.cancelReset()}
            disabled={w.planReset.resetting}>Cancel</button
          >
          <button
            type="button"
            class="btn-danger"
            onclick={() => w.planReset.confirmReset()}
            disabled={w.planReset.resetting}
          >
            {w.planReset.resetting ? 'Clearing…' : 'Yes — clear the plan'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .aw-plan-state {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .aw-plan-state h3 {
    margin: 0;
    color: var(--color-forest);
  }
  .aw-plan-state-lede {
    margin: 0;
    color: #555;
    font-size: 0.95rem;
  }
  .aw-plan-state-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  @media (max-width: 600px) {
    .aw-plan-state-actions {
      grid-template-columns: 1fr;
    }
  }
  .aw-plan-state-btn {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-start;
    padding: 1rem;
    border: 2px solid #ddd;
    border-radius: 8px;
    background: #fff;
    cursor: pointer;
    text-align: left;
    min-height: 96px;
  }
  .aw-plan-state-btn:hover {
    border-color: var(--color-forest);
    background: #f4f9f5;
  }
  .aw-plan-state-icon {
    font-size: 1.5rem;
    line-height: 1;
  }
  .aw-plan-state-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--color-forest);
  }
  .aw-plan-state-reset .aw-plan-state-title {
    color: var(--color-rust);
  }
  .aw-plan-state-reset:hover {
    border-color: var(--color-rust);
    background: #fdecea;
  }
  .aw-plan-state-sub {
    font-size: 0.9rem;
    color: #555;
    font-weight: normal;
  }
  .aw-confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .aw-confirm-card {
    background: #fff;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    max-width: 480px;
    width: calc(100% - 2rem);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .aw-confirm-card h4 {
    margin: 0 0 0.5rem;
    color: var(--color-rust);
  }
  .aw-confirm-card p {
    margin: 0 0 1rem;
    color: #333;
  }
  .aw-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .btn-danger {
    min-height: 48px;
    padding: 0 1.25rem;
    background: var(--color-rust);
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-danger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .aw-error {
    color: #b22222;
    font-weight: 600;
  }
  .btn-secondary {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #cbd5cb;
  }
  .btn-secondary {
    background: white;
    color: #4a5d4a;
  }
</style>
