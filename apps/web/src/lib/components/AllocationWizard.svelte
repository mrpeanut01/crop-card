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
    PriorSeason,
    SeedStockEntry
  } from '$lib/components/wizard/allocation/types';
  import PriorSeasonPanel from '$lib/components/wizard/allocation/PriorSeasonPanel.svelte';
  import CommitStep from '$lib/components/wizard/allocation/steps/CommitStep.svelte';
  import ScheduleStep from '$lib/components/wizard/allocation/steps/ScheduleStep.svelte';
  import ReviewStep from '$lib/components/wizard/allocation/steps/ReviewStep.svelte';
  import BlocksStep from '$lib/components/wizard/allocation/steps/BlocksStep.svelte';
  import SeedsStep from '$lib/components/wizard/allocation/steps/SeedsStep.svelte';
  import PlanStateStep from '$lib/components/wizard/allocation/steps/PlanStateStep.svelte';

  const {
    seedStock,
    blocks,
    plantingGuides,
    cropCatalog: _cropCatalog,
    seasonSetup = null,
    lastYearSetup = null,
    priorSeason = null,
    emptySeason = false,
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
    /** Last season's crops per block (carry-forward context). */
    priorSeason?: PriorSeason | null;
    /** True when nothing is planned for `currentYear` yet. */
    emptySeason?: boolean;
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
        get priorSeason() {
          return priorSeason;
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
      untrack(() => ({ seasonSetup, initialChatMessages, initialStep, emptySeason }))
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
        {#if priorSeason}
          <PriorSeasonPanel {priorSeason} />
        {/if}
        <SeasonSetupStep
          existing={w.activeSetup}
          {lastYearSetup}
          {currentYear}
          onSave={(saved) => w.handleSeasonSetupSaved(saved)}
        />
      {:else if w.step === 'plan-state'}
        <PlanStateStep />
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
