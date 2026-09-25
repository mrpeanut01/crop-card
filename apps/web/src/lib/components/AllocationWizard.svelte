<script lang="ts">
  import type { CropPlugin } from '$lib/plugins/schemas';
  import { untrack } from 'svelte';
  import type { SeasonSetup } from '$lib/season/setup';
  import SeasonSetupStep from '$lib/components/SeasonSetupStep.svelte';
  import SeasonSetupChip from '$lib/components/SeasonSetupChip.svelte';
  import InputsPlanStep from '$lib/components/InputsPlanStep.svelte';
  // Phase 25b (#96) — Almanac wizard chrome. Shared header + stepper +
  // footer matching `direction-almanac-wizard.jsx` so every step renders
  // with consistent chrome.
  import WizardHeader, {
    type WizardStepDescriptor
  } from '$lib/components/wizard/WizardHeader.svelte';
  import {
    AllocationWizardState,
    STEP_LABELS,
    STEP_ORDER,
    setWizardContext
  } from '$lib/components/wizard/allocation/wizardState.svelte';
  import type {
    BlockEntry,
    CropCatalogItem,
    InitialChatMessage,
    SeedStockEntry
  } from '$lib/components/wizard/allocation/types';
  import CommitStep from '$lib/components/wizard/allocation/steps/CommitStep.svelte';
  import ScheduleStep from '$lib/components/wizard/allocation/steps/ScheduleStep.svelte';
  import ReviewStep from '$lib/components/wizard/allocation/steps/ReviewStep.svelte';
  import BlocksStep from '$lib/components/wizard/allocation/steps/BlocksStep.svelte';
  import SeedsStep from '$lib/components/wizard/allocation/steps/SeedsStep.svelte';

  const {
    seedStock,
    blocks,
    plantingGuides,
    cropCatalog: _cropCatalog,
    seasonSetup = null,
    lastYearSetup = null,
    currentYear = new Date().getFullYear(),
    aiEnabled = false,
    wizardPlanId,
    initialChatMessages = [],
    initialStep,
    onClose,
    onCommitted,
    onRefreshParent
  }: {
    seedStock: SeedStockEntry[];
    blocks: BlockEntry[];
    plantingGuides: Record<string, NonNullable<CropPlugin['plantingGuide']>>;
    cropCatalog: CropCatalogItem[];
    seasonSetup?: SeasonSetup | null;
    lastYearSetup?: SeasonSetup | null;
    currentYear?: number;
    /** Phase 25d v2-addendum (#82 partial / #89) — drives the schedule
     *  step's AI-on/off variant. Step 2 (Schedule) shows the deterministic
     *  planner chat instead of the Gantt chat when off. */
    aiEnabled?: boolean;
    /** Phase 25d (#89) — identifies the plan whose chat history this
     *  wizard run-through belongs to. Convention: `season-${year}`. When
     *  omitted, chat persistence is disabled (silent fallback to the
     *  pre-#89 in-memory behavior). */
    wizardPlanId?: string;
    /** Phase 25d (#89) — server-loaded chat messages, hydrated into the
     *  per-step transcripts on mount. The loader runs the GET before
     *  showing the wizard so the operator sees the resumed conversation
     *  without a flash of empty state. */
    initialChatMessages?: InitialChatMessage[];
    /** #120 — entry point chosen from the /plan workflow strip. The
     *  downstream steps (schedule / inputs / commit) consume an in-memory
     *  allocation, so only these two can be mounted cold. */
    initialStep?: 'season-setup' | 'allocation';
    onClose: () => void;
    onCommitted: () => void;
    /** Optional — refresh parent data WITHOUT closing the wizard. Used by
     *  the Start Over flow so the post-wipe seed/block list is fresh in
     *  the modal. When omitted, Start Over still wipes the DB but the
     *  wizard keeps its initial props until the next commit closes the
     *  modal naturally. */
    onRefreshParent?: () => void | Promise<void>;
  } = $props();

  const w = setWizardContext(
    new AllocationWizardState(
      {
        get seedStock() {
          return seedStock;
        },
        get blocks() {
          return blocks;
        },
        get plantingGuides() {
          return plantingGuides;
        },
        get aiEnabled() {
          return aiEnabled;
        },
        get wizardPlanId() {
          return wizardPlanId;
        },
        get onClose() {
          return onClose;
        },
        get onCommitted() {
          return onCommitted;
        },
        get onRefreshParent() {
          return onRefreshParent;
        }
      },
      untrack(() => ({ seasonSetup, initialChatMessages, initialStep }))
    )
  );

  const wizardSteps = $derived.by<WizardStepDescriptor[]>(() => {
    const currentIdx = STEP_ORDER.indexOf(w.step === 'plan-state' ? 'seeds' : w.step);
    return STEP_ORDER.map((sid, i) => ({
      id: sid,
      label: STEP_LABELS[sid],
      state: i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending'
    }));
  });

  // Heartbeat for the AI progress labels: tick `nowMs` every 500ms while
  // any long-running call is in flight.
  $effect(() => {
    const active = w.allocateStartMs != null || w.scheduleStartMs != null || w.chatStartMs != null;
    if (!active) return;
    const id = setInterval(() => {
      w.nowMs = Date.now();
    }, 500);
    return () => clearInterval(id);
  });

  // Diagnostic: log every step transition so we can trace the wizard's
  // path in the browser console. Cheap; only fires when `step` changes.
  $effect(() => {
    console.info('[AllocationWizard] step →', w.step);
  });

  $effect(() => {
    w.hydrateDraft();
  });

  // #187 — focus trap for the modal dialog. On mount we focus the modal so
  // screen readers announce "dialog" + the header; tabbing past the last
  // focusable element wraps to the first (and vice versa for Shift-Tab).
  let modalEl: HTMLDivElement | null = $state(null);

  function getFocusable(): HTMLElement[] {
    if (!modalEl) return [];
    const sel =
      'button:not([disabled]):not([aria-hidden="true"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(modalEl.querySelectorAll<HTMLElement>(sel)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
  }

  $effect(() => {
    if (!modalEl) return;
    queueMicrotask(() => {
      const focusables = getFocusable();
      if (focusables.length === 0) return;
      const active = document.activeElement;
      if (!active || !modalEl?.contains(active)) {
        focusables[0]?.focus();
      }
    });
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && w.step !== 'commit') {
      onClose();
      return;
    }
    if (e.key === 'Tab' && modalEl) {
      const focusables = getFocusable();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !modalEl.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div
  class="aw-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget && w.step !== 'commit') onClose();
  }}
>
  <div
    class="aw-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="aw-title"
    bind:this={modalEl}
    tabindex="-1"
  >
    <WizardHeader
      seasonYear={currentYear}
      activeStepId={w.step}
      steps={wizardSteps}
      onExit={onClose}
      onStepClick={(id) => w.canJumpToStep(id)}
      onSaveAndResume={() => w.saveAndResumeLater()}
    />

    {#if w.activeSetup && w.step !== 'season-setup'}
      <div class="aw-chip-row">
        <SeasonSetupChip setup={w.activeSetup} onEdit={() => (w.step = 'season-setup')} />
      </div>
    {/if}

    {#if w.error && w.step !== 'commit' && w.step !== 'review' && w.step !== 'season-setup'}
      <div class="aw-error-banner" role="alert">
        <strong>Couldn't generate plan:</strong>
        {w.error}
      </div>
    {/if}

    <div class="aw-body">
      {#if w.step === 'season-setup'}
        <SeasonSetupStep
          existing={w.activeSetup}
          {lastYearSetup}
          {currentYear}
          onSave={(saved) => w.handleSeasonSetupSaved(saved)}
        />
      {:else if w.step === 'plan-state'}
        <section class="aw-plan-state">
          <h3>You have a plan in place</h3>
          <p class="aw-plan-state-lede">
            {#each blocks.filter((b) => b.plantings.length > 0) as b, i (b.id)}
              {#if i > 0},
              {/if}
              <strong>{b.name}</strong>: {b.plantings.length} planting{b.plantings.length === 1
                ? ''
                : 's'}
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
                  This deletes every <strong>planned</strong> crop on your blocks and any open Inputs
                  Plan tasks. Active and harvested crops are kept. This cannot be undone.
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
      {:else if w.step === 'seeds'}
        <SeedsStep />
      {:else if w.step === 'blocks'}
        <BlocksStep />
      {:else if w.step === 'review'}
        <ReviewStep />
      {:else if w.step === 'schedule'}
        <ScheduleStep />
      {:else if w.step === 'inputs'}
        <InputsPlanStep
          plantings={w.provisionalPlantings()}
          year={currentYear}
          {aiEnabled}
          onCommit={(accepted) => w.handleInputsAccepted(accepted)}
          onBack={() => (w.step = 'schedule')}
        />
      {:else if w.step === 'commit'}
        <CommitStep />
      {/if}
    </div>

    <footer class="aw-footer">
      {#if w.step === 'season-setup'}
        <button class="btn-secondary" onclick={onClose}>Cancel</button>
        {#if w.activeSetup}
          <button
            class="btn-secondary"
            onclick={() => (w.step = w.hasExistingPlan ? 'plan-state' : 'seeds')}
          >
            Keep current & continue
          </button>
        {/if}
      {:else if w.step === 'plan-state'}
        <button class="btn-secondary" onclick={onClose}>Cancel</button>
      {:else if w.step === 'seeds'}
        <button class="btn-secondary" onclick={onClose}>Cancel</button>
        <button
          class="btn-primary"
          disabled={[...w.selectedSeeds.values()].every((v) => v <= 0)}
          onclick={() => (w.step = 'blocks')}
        >
          Next: blocks ({w.totalPlantsSelected.toLocaleString()} plants)
        </button>
      {:else if w.step === 'blocks'}
        <button class="btn-secondary" onclick={() => (w.step = 'seeds')}>Back</button>
        <button
          class="btn-primary"
          disabled={w.selectedBlockIds.size === 0 || w.loading}
          onclick={() => w.generatePlan()}
        >
          {w.loading ? 'Generating…' : `Generate plan (${w.selectedBlockIds.size} blocks)`}
        </button>
      {:else if w.step === 'review'}
        <button class="btn-secondary" onclick={() => (w.step = 'blocks')}>Back</button>
        <button class="btn-secondary" onclick={() => w.generatePlan()} disabled={w.loading}
          >Regenerate</button
        >
        <button
          class="btn-primary"
          onclick={() => w.advanceToSchedule()}
          disabled={!w.response || w.response.assignments.length === 0}
          title="Locks the layout above and moves on to picking planting dates."
        >
          Accept all → schedule
        </button>
      {:else if w.step === 'schedule'}
        <button class="btn-secondary" onclick={() => (w.step = 'review')}>Back to allocation</button
        >
        <button
          class="btn-secondary"
          onclick={() => w.advanceToSchedule()}
          disabled={w.scheduleLoading}>Re-schedule</button
        >
        <button
          class="btn-primary"
          onclick={() => w.advanceToInputs()}
          disabled={w.scheduleLoading ||
            !w.scheduleResponse ||
            w.scheduleResponse.scheduled.length === 0}
        >
          Accept dates → inputs plan ({w.scheduleResponse?.scheduled.length ?? 0})
        </button>
      {:else if w.step === 'inputs'}
        <!-- Footer actions live inside InputsPlanStep; no parent buttons here. -->
      {:else if w.step === 'commit'}
        <button
          class="btn-primary"
          onclick={onClose}
          disabled={w.commitProgress.done < w.commitProgress.total}
        >
          {w.commitProgress.done < w.commitProgress.total ? 'Committing…' : 'Done'}
        </button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .aw-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .aw-modal {
    background: white;
    border-radius: 12px;
    width: 100%;
    max-width: 1080px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-top: 6px solid var(--color-forest);
  }
  /* Phase 25b (#96) — `.aw-header` / `.aw-stepper` superseded by
     `WizardHeader.svelte` (Almanac chrome). The chip-row stays for
     SeasonSetupChip. */
  .aw-chip-row {
    padding: 0.5rem 1.25rem 0;
    background: var(--color-cream);
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .aw-body {
    padding: 1rem 1.25rem;
    overflow-y: auto;
    flex: 1;
  }
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
  .aw-error-banner {
    background: #fdecec;
    color: #8a1f1f;
    border-left: 3px solid #b22222;
    padding: 0.6rem 0.9rem;
    margin: 0.5rem 1.25rem 0;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .aw-error-banner strong {
    color: #6a1414;
  }
  .aw-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #e4e9e4;
    background: #fafcfa;
  }
  .btn-primary,
  .btn-secondary {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #cbd5cb;
  }
  .btn-primary {
    background: var(--color-forest);
    color: white;
    border-color: var(--color-forest);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: white;
    color: #4a5d4a;
  }
</style>
