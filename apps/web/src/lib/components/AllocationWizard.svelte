<script lang="ts">
  import type { PollinationConstraint } from '$lib/plan/types';
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
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';
  import {
    AllocationWizardState,
    STEP_LABELS,
    STEP_ORDER,
    setWizardContext
  } from '$lib/components/wizard/allocation/wizardState.svelte';
  import {
    aiProgressLabel,
    fmtDateMs,
    fmtElapsed,
    sufficiencyChip
  } from '$lib/components/wizard/allocation/format';
  import type {
    BlockEntry,
    CropCatalogItem,
    InitialChatMessage,
    ProgressStage,
    SeedStockEntry
  } from '$lib/components/wizard/allocation/types';
  import CommitStep from '$lib/components/wizard/allocation/steps/CommitStep.svelte';

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

  const filteredEligibleStock = $derived.by(() => {
    const q = w.seedSearch.trim().toLowerCase();
    const matches = q
      ? w.eligibleStock.filter(
          (s) =>
            s.displayName.toLowerCase().includes(q) ||
            (s.cropFamily ?? '').toLowerCase().includes(q)
        )
      : w.eligibleStock;
    return [...matches].sort((a, b) => {
      const fa = a.cropFamily ?? 'zz';
      const fb = b.cropFamily ?? 'zz';
      if (fa !== fb) return fa.localeCompare(fb);
      return a.displayName.localeCompare(b.displayName);
    });
  });

  const seedFamilyGroups = $derived.by(() => {
    const groups = new Map<string, typeof filteredEligibleStock>();
    for (const s of filteredEligibleStock) {
      const key = s.cropFamily ?? '';
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([family, items]) => ({
      family: family || null,
      items
    }));
  });

  /** Pollination chips for a single assignment row. Surfaces only the
   *  unresolved (must-stagger) constraints so the table doesn't bloat. */
  function pollinationChipsFor(stockItemId: string, blockId: string): PollinationConstraint[] {
    const list = w.response?.pollinationConstraints ?? [];
    return list.filter(
      (p) =>
        p.kind === 'must-stagger' &&
        ((p.pair[0] === stockItemId && p.blockIds[0] === blockId) ||
          (p.pair[1] === stockItemId && p.blockIds[1] === blockId))
    );
  }

  function partnerStockId(p: PollinationConstraint, stockItemId: string): string {
    return p.pair[0] === stockItemId ? p.pair[1] : p.pair[0];
  }

  /** Single compact stagger summary per row. Lists up to 3 partners by
   *  shortName, "+N more" for the rest, and stuffs the full list into a
   *  tooltip for hover. Returns null when no staggers apply. */
  function pollinationSummary(
    stockItemId: string,
    blockId: string
  ): { label: string; tooltip: string; days: number } | null {
    const chips = pollinationChipsFor(stockItemId, blockId);
    if (chips.length === 0) return null;
    const days = Math.max(...chips.map((c) => c.staggerDays));
    const partners = Array.from(
      new Set(chips.map((c) => w.varietyDisplayFor(partnerStockId(c, stockItemId))))
    );
    const visible = partners.slice(0, 3);
    const overflow = partners.length - visible.length;
    const label =
      `⚠ ${days}d stagger from ${visible.join(' · ')}` + (overflow > 0 ? ` +${overflow} more` : '');
    const tooltip = `Plant ≥${days} d apart from: ${partners.join(', ')}.`;
    return { label, tooltip, days };
  }

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

  function onChatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void w.sendChat();
    }
  }

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

{#snippet aiProgress(stage: ProgressStage, startMs: number | null)}
  {@const elapsed = startMs == null ? 0 : Math.max(0, w.nowMs - startMs)}
  <div class="ai-progress" role="status" aria-live="polite">
    <span class="ai-spinner" aria-hidden="true"></span>
    <div class="ai-progress-text">
      <span class="ai-progress-label">{aiProgressLabel(stage, elapsed)}</span>
      <span class="ai-progress-elapsed" aria-label="elapsed time">{fmtElapsed(elapsed)}</span>
    </div>
  </div>
{/snippet}

{#snippet chatPanel()}
  <!-- #171 — header now surfaces the model identity ("haiku-4-5 ·
       grounded on your plugins") when AI is enabled, and swaps to a
       distinct "AI assistant is off" variant otherwise. The full
       right-rail layout pull-out from the design mockup remains a
       follow-on refactor (touches every step's aw-body shape); the
       in-step chat panel keeps working in the meantime and now reads
       correctly across all modes. -->
  <section class="aw-chat" aria-label="Refine plan with AI">
    {#if aiEnabled}
      <header class="aw-chat-header">
        <h3>💬 Refine with AI</h3>
        <span class="muted aw-chat-model"> claude-haiku-4-5 · grounded on your plugins </span>
        <span class="muted">
          {#if w.step === 'schedule'}Ask for date changes; the schedule above updates each turn.
          {:else}Ask for changes; the plan above updates each turn.
          {/if}
        </span>
      </header>
    {:else}
      <header class="aw-chat-header aw-chat-header-off">
        <h3>AI assistant is off</h3>
        <span class="muted">
          Add an Anthropic API key on
          <a href="/settings/ai" class="aw-chat-key-link">Settings → AI</a>
          to refine this plan with Claude. Without a key, every value above is the deterministic engine's
          output — edit by hand or regenerate.
        </span>
      </header>
    {/if}
    <div class="aw-chat-log" bind:this={w.chatLogEl} role="log" aria-live="polite">
      {#each w.chatMessages as msg, i (i)}
        <div class={`chat-msg chat-${msg.role}`}>
          <span class="chat-role" aria-hidden="true">{msg.role === 'assistant' ? '🌱' : '👤'}</span>
          <pre class="chat-bubble">{msg.content}</pre>
        </div>
      {/each}
      {#if w.chatBusy}
        <div class="chat-msg chat-assistant">
          <span class="chat-role" aria-hidden="true">🌱</span>
          <span class="chat-bubble chat-thinking">
            {aiProgressLabel(
              w.step === 'schedule' ? 'chat-schedule' : 'chat-allocate',
              w.chatStartMs == null ? 0 : Math.max(0, w.nowMs - w.chatStartMs)
            )}
            <span class="chat-elapsed"
              >{fmtElapsed(w.chatStartMs == null ? 0 : Math.max(0, w.nowMs - w.chatStartMs))}</span
            >
          </span>
        </div>
      {/if}
    </div>
    {#if w.chatError}<p class="aw-error chat-error" role="alert">{w.chatError}</p>{/if}
    {#if w.step === 'review' && w.lastRejectedAssignments && w.lastRejectedAssignments.length > 0}
      <div class="aw-override-row" role="region" aria-label="Override validators">
        <button
          type="button"
          class="btn-secondary btn-override"
          onclick={() => w.applyRejectedAnyway()}
          title="Apply the AI's proposed plan even though it failed agronomic validation."
        >
          🛠 Apply anyway ({w.lastRejectedAssignments.length} rows)
        </button>
        <span class="muted override-hint">
          Bypasses density / capacity checks. Spray-time safety rules are NOT affected.
        </span>
      </div>
    {/if}
    {#if aiEnabled}
      <form
        class="aw-chat-input"
        onsubmit={(e) => {
          e.preventDefault();
          void w.sendChat();
        }}
      >
        <textarea
          rows="2"
          placeholder={w.step === 'schedule'
            ? 'e.g. "Plant the corn the first week of May" or "Push brassicas two weeks later"'
            : 'e.g. "Move the corn off the narrow block" or "Give the brassicas more room"'}
          bind:value={w.chatDraft}
          onkeydown={onChatKeydown}
          disabled={w.chatBusy}
          aria-label="Refinement request"
        ></textarea>
        <button
          type="submit"
          class="btn-primary chat-send"
          disabled={w.chatBusy || !w.chatDraft.trim()}
        >
          {w.chatBusy ? '…' : 'Send'}
        </button>
      </form>
    {/if}
  </section>
{/snippet}

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
        <p class="aw-intro">
          Pick the seed lots you want to plant. Adjust quantity per row — defaults to on-hand.
        </p>

        <!-- #252 / CT-W-007 — surface no-plugin seeds so the operator
             can link them inline without leaving the wizard. Hits
             /api/plugins/search-by-name with skipWebSearch=true (no AI
             quota), then PATCHes /api/stock/[id] with the chosen
             pluginId. On 200 the seed migrates from noPluginStock →
             eligibleStock via the existing onRefreshParent path. -->
        {#if w.noPluginStock.length > 0}
          <div class="needs-plugin-section" data-empty-state="needs-plugin">
            <h3 class="needs-plugin-title">
              {w.noPluginStock.length} seed{w.noPluginStock.length === 1 ? '' : 's'} need a crop plugin
            </h3>
            <p class="needs-plugin-lede">
              These seed lots are in your inventory but aren’t linked to a crop plugin yet. Link
              each one to a known crop so the planner can match planting guides, days-to-maturity,
              and companion rules. Picking a plugin is local-only — no Anthropic key needed.
            </p>
            <ul class="needs-plugin-list">
              {#each w.noPluginStock as s (s.stockItemId)}
                <li class="needs-plugin-row">
                  <div class="needs-plugin-name">
                    <strong>{s.shortName ?? s.displayName}</strong>
                    <span class="muted"> · {s.onHand} {s.defaultUnit}</span>
                  </div>
                  <button
                    type="button"
                    class="btn-secondary needs-plugin-btn"
                    onclick={() => w.seedLink.openLinkPicker(s.stockItemId)}
                    disabled={!!w.seedLink.linkAssigningId}
                    data-action="open-link-picker"
                  >
                    {w.seedLink.linkPickerOpenFor === s.stockItemId
                      ? 'Picking…'
                      : 'Link to crop plugin →'}
                  </button>
                  {#if w.seedLink.linkPickerOpenFor === s.stockItemId}
                    <div class="link-picker" role="dialog" aria-label="Pick a crop plugin">
                      <input
                        type="search"
                        class="aw-search"
                        placeholder="Search by crop name (e.g. corn, lettuce, basil)…"
                        bind:value={w.seedLink.linkQuery}
                        oninput={() => w.seedLink.onLinkQueryChange()}
                        aria-label="Search crop plugin library"
                      />
                      {#if w.seedLink.linkSearching}
                        <p class="muted">Searching plugin library…</p>
                      {:else if w.seedLink.linkError}
                        <p class="error" role="alert">{w.seedLink.linkError}</p>
                      {:else if w.seedLink.linkQuery.trim().length < 2}
                        <p class="muted">
                          Type at least 2 characters to search your local plugin library.
                        </p>
                      {:else if w.seedLink.linkResults.length === 0}
                        <p class="muted">
                          No matches in your plugin library. Try a different search, or open
                          <a href="/plugins" target="_blank" rel="noopener">/plugins</a> to add a new
                          crop plugin first.
                        </p>
                      {:else}
                        <ul class="link-results">
                          {#each w.seedLink.linkResults as r (r.pluginId)}
                            <li>
                              <button
                                type="button"
                                class="link-result"
                                onclick={() =>
                                  w.seedLink.assignPluginToStock(s.stockItemId, r.pluginId)}
                                disabled={!!w.seedLink.linkAssigningId}
                              >
                                <span class="link-result-name">{r.displayName}</span>
                                <span class="muted link-result-score"
                                  >{Math.round(r.score * 100)}% match</span
                                >
                              </button>
                            </li>
                          {/each}
                        </ul>
                      {/if}
                      <div class="link-picker-footer">
                        <button
                          type="button"
                          class="btn-secondary"
                          onclick={() => w.seedLink.closeLinkPicker()}
                          disabled={w.seedLink.linkAssigningId === s.stockItemId}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if w.eligibleStock.length === 0 && w.noPluginStock.length === 0}
          <!-- #175 (CT-W-006) — empty-state card replaces the previous
               dead-end `<p>`. The Sprint-1 link-out path opens
               /stock/add in a new tab so the wizard modal + step state
               stay mounted while the user adds inventory; the Sprint-3
               follow-up extends this same `.aw-seed-empty` block with
               an inline embedded form (toggle pattern) without changing
               the CTAs below. Touch this block, not its callers. -->
          <div class="aw-seed-empty" data-empty-state="seed-stock">
            <h3 class="aw-seed-empty-title">No seed stock yet</h3>
            <p class="aw-seed-empty-lede">
              Seed lots are tracked in Inventory — packets, bulk orders, and saved seed all belong
              there. Add at least one lot with a known crop plugin and on-hand greater than zero,
              then come back here to plan the season.
            </p>
            <div class="aw-seed-empty-actions">
              <a
                class="btn-primary"
                href="/inventory/seed/add"
                target="_blank"
                rel="noopener"
                data-action="add-seed-stock"
              >
                Add seed stock ↗
              </a>
              <a
                class="btn-secondary"
                href="/inventory?type=seed"
                target="_blank"
                rel="noopener"
                data-action="open-stock"
              >
                Open Inventory ↗
              </a>
              <button
                type="button"
                class="btn-secondary"
                onclick={() => w.seedLink.refreshSeedStock()}
                disabled={w.seedLink.seedStockRefreshing || !onRefreshParent}
                data-action="refresh-seed-stock"
              >
                {w.seedLink.seedStockRefreshing ? 'Refreshing…' : 'I’ve added stock — refresh'}
              </button>
              <!-- #175 — explicit skip path so the seeds step is never a
                   dead-end. Closes the wizard with a clear "come back later"
                   gesture; pairs with #173 Save & resume later once that
                   lands. -->
              <button
                type="button"
                class="btn-link"
                onclick={onClose}
                data-action="skip-seeds-for-now"
              >
                Skip — I’ll add seed stock later
              </button>
            </div>
          </div>
        {:else if w.eligibleStock.length === 0 && w.noPluginStock.length > 0}
          <p class="empty">Link a crop plugin to a seed above to make it available for planning.</p>
        {:else}
          <div class="aw-search-row">
            <input
              type="search"
              class="aw-search"
              placeholder="Search by variety or family…"
              aria-label="Search seed lots"
              bind:value={w.seedSearch}
            />
            {#if w.seedSearch.trim().length > 0}
              <span class="muted">
                {filteredEligibleStock.length} of {w.eligibleStock.length}
              </span>
            {/if}
          </div>
          {#if filteredEligibleStock.length === 0}
            <p class="empty">No seeds match “{w.seedSearch}”.</p>
          {:else}
            <table class="aw-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Variety</th>
                  <th>On hand</th>
                  <th>Quantity</th>
                  <th>
                    ≈ plants
                    <button
                      type="button"
                      class="aw-info"
                      aria-label="Why is this less than the seed count?"
                      title="Estimated plants the seed will yield, applying an 85% germination assumption.&#10;&#10;• Seeds: count × 0.85 (e.g. 25 seeds → ~21 plants)&#10;• lb / oz / g: converted to seeds via the crop's seeds-per-lb (from the plugin if known, else a family default), then × 0.85&#10;• Count: treated 1:1 (no germination discount — already discrete plants like transplants or plugs)&#10;&#10;Real germination varies by lot and conditions; treat this as a sizing estimate, not a guarantee."
                      >ⓘ</button
                    >
                  </th>
                </tr>
              </thead>
              <tbody>
                {#each seedFamilyGroups as g (g.family ?? '__unc__')}
                  {@const famCount = w.familySelectedCount(g.items)}
                  <tr class="family-row">
                    <td colspan="5">
                      <span class="family-name">{g.family ?? 'Unclassified'}</span>
                      <span class="muted">({famCount} of {g.items.length} selected)</span>
                      <span class="family-actions">
                        <button
                          type="button"
                          class="family-action-btn"
                          onclick={() => w.selectAllInFamily(g.items)}
                          disabled={famCount === g.items.length}
                          aria-label={`Select all ${g.family ?? 'unclassified'} seeds`}
                          >Select all</button
                        >
                        {#if famCount > 0}
                          <button
                            type="button"
                            class="family-action-btn family-action-clear"
                            onclick={() => w.clearFamily(g.items)}
                            aria-label={`Clear ${g.family ?? 'unclassified'} selection`}
                            >Clear</button
                          >
                        {/if}
                      </span>
                    </td>
                  </tr>
                  {#each g.items as s (s.stockItemId)}
                    {@const checked = w.selectedSeeds.has(s.stockItemId)}
                    {@const qty = w.selectedSeeds.get(s.stockItemId) ?? s.onHand}
                    {@const plants = w.plantsFor(s.stockItemId, qty)}
                    <tr class:row-checked={checked}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${s.shortName ?? s.displayName}`}
                          {checked}
                          onchange={() => w.toggleSeed(s)}
                        />
                      </td>
                      <td title={s.displayName}>
                        <div class="seed-name-cell">
                          <span class="seed-name-primary">{s.shortName ?? s.displayName}</span>
                          {#if s.shortName && s.shortName !== s.displayName}
                            <span class="seed-name-sub">{s.displayName}</span>
                          {/if}
                        </div>
                      </td>
                      <td>{s.onHand} {s.defaultUnit}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={s.onHand}
                          step="0.25"
                          value={qty}
                          disabled={!checked}
                          oninput={(e) =>
                            w.setSeedQuantity(
                              s.stockItemId,
                              Number((e.target as HTMLInputElement).value)
                            )}
                        />
                        {s.defaultUnit}
                      </td>
                      <td>{plants !== null ? plants.toLocaleString() : '—'}</td>
                    </tr>
                  {/each}
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      {:else if w.step === 'blocks'}
        <div class="aw-blocks-header">
          <p class="aw-intro">Pick the blocks the wizard may use.</p>
          <div class="aw-blocks-actions">
            <span class="muted">{w.selectedBlockIds.size} of {blocks.length} selected</span>
            <button type="button" class="aw-link" onclick={() => w.selectAllBlocks()}
              >Select all</button
            >
            {#if w.selectedBlockIds.size > 0}
              <button
                type="button"
                class="aw-link"
                onclick={() => (w.selectedBlockIds = new Set())}
              >
                Clear
              </button>
            {/if}
          </div>
        </div>
        <ul class="aw-blocklist">
          {#each blocks as b (b.id)}
            {@const checked = w.selectedBlockIds.has(b.id)}
            {@const acresText = b.acres !== undefined ? `${b.acres.toFixed(2)} ac` : null}
            {@const sunText = b.sunExposure ? `${b.sunExposure} sun` : null}
            {@const plantingsText =
              b.plantings.length > 0
                ? `${b.plantings.length} active planting${b.plantings.length === 1 ? '' : 's'}`
                : null}
            <li class:checked>
              <label>
                <input type="checkbox" {checked} onchange={() => w.toggleBlock(b.id)} />
                <span class="aw-block-info">
                  <span class="aw-block-name">{b.blockLabel ?? b.name}</span>
                  <span class="aw-chips">
                    {#if acresText}<span class="aw-chip">{acresText}</span>{/if}
                    {#if sunText}<span class="aw-chip">☀ {sunText}</span>{/if}
                    {#if plantingsText}<span class="aw-chip aw-chip-warn">🌱 {plantingsText}</span
                      >{/if}
                  </span>
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {:else if w.step === 'review'}
        {#if w.loading}
          {@render aiProgress('allocate', w.allocateStartMs)}
        {:else if w.error}
          <p class="aw-error">Error: {w.error}</p>
        {:else if w.response}
          {#if w.response.meta.fallback}
            <div class="aw-banner warn" role="alert" aria-live="assertive">
              {w.response.meta.fallback === 'no-api-key'
                ? 'No Anthropic API key configured — plan generated by the deterministic engine. Add a key on /settings/ai to enable the AI rationale layer.'
                : w.response.meta.fallback === 'over-cap'
                  ? 'Monthly AI cap reached — plan generated by the deterministic engine. Raise the cap on /settings/ai to restore AI refinement.'
                  : w.response.meta.fallback === 'quota-exceeded'
                    ? 'Today’s AI quota reached — plan generated by the deterministic engine. Retry tomorrow or raise the quota on /settings/ai.'
                    : 'Plan generated by the deterministic engine after AI output failed validation twice.'}
            </div>
          {/if}
          {#if (w.response.geometryMissingBlockIds ?? []).length > 0}
            <div class="aw-banner info">
              📐 Pollination check skipped for {w.response.geometryMissingBlockIds!.length} block{w
                .response.geometryMissingBlockIds!.length === 1
                ? ''
                : 's'}
              ({w.response.geometryMissingBlockIds!.map((id) => w.blockNameFor(id)).join(', ')}) —
              add field geometry on /fields to enable.
            </div>
          {/if}
          <!-- #172 — provenance legend mirroring the Schedule step so every
               pre-populated value carries an explicit source signal per
               Invariant 7 + the AI provenance addendum. -->
          <ProvenanceLegend
            shown={aiEnabled && !w.response.meta.fallback
              ? ['plugin', 'data', 'ai', 'manual']
              : ['plugin', 'data', 'fallback', 'manual']}
            note={aiEnabled && !w.response.meta.fallback
              ? 'Blocks AI-proposed within plugin-derived constraints · editable per row'
              : 'AI off · deterministic allocator · plugin rules + your blocks'}
          />
          <!-- #209 / CT-PP-007 — on fallback the AI's stale narrative is
               discarded and replaced with a deterministic engine handoff
               so chat narrative cannot contradict the per-row table below.
               Server already swaps response.rationale; this is the
               defence-in-depth render-side check. -->
          <p class="aw-rationale">
            {#if w.response.meta.fallback}
              {w.response.rationale ||
                'Deterministic engine plan — see the "Why" column for per-row reasoning.'}
            {:else}
              {w.response.rationale}
            {/if}
            <Provenance
              source={w.response.meta.fallback ? 'fallback' : aiEnabled ? 'ai' : 'plugin'}
              detail={w.response.meta.fallback ? 'deterministic allocator' : undefined}
              compact
            />
          </p>
          <table class="aw-table">
            <thead>
              <tr>
                <th>Seed</th>
                <th>Block</th>
                <th>Plants</th>
                <th>Block fit</th>
                <th>Why</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {#each w.response.assignments as a}
                {@const key = `${a.stockItemId}:${a.blockId}`}
                {@const suff = w.response.sufficiency[key]}
                {@const chip = suff ? sufficiencyChip(suff) : null}
                {@const poll = pollinationSummary(a.stockItemId, a.blockId)}
                <tr>
                  <td>{w.varietyDisplayFor(a.stockItemId)}</td>
                  <td>{w.blockNameFor(a.blockId)}</td>
                  <td>{a.plants.toLocaleString()}</td>
                  <td class="cell-fit">
                    {#if chip}
                      <span class={`chip chip-sm ${chip.cls}`} title={chip.tooltip}
                        >{chip.label}</span
                      >
                    {/if}
                    {#if poll}
                      <span class="chip chip-sm chip-pollination" title={poll.tooltip}
                        >{poll.label}</span
                      >
                    {/if}
                  </td>
                  <td class="why">{w.response.perRowRationale[key] ?? ''}</td>
                  <td class="cell-provenance">
                    <Provenance
                      source={w.response.meta.fallback ? 'fallback' : aiEnabled ? 'ai' : 'plugin'}
                      compact
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>

          {@render chatPanel()}

          {#if w.response.unplaced.length > 0}
            <h3>Unplaced</h3>
            <ul>
              {#each w.response.unplaced as u}
                <li>
                  {w.varietyDisplayFor(u.stockItemId)}: {u.quantityPlants} plants couldn't be placed.
                </li>
              {/each}
            </ul>
          {/if}

          {#if w.response.meta.usdEstimate > 0}
            <p class="aw-cost">
              Cost: ${w.response.meta.usdEstimate.toFixed(4)} ({w.response.meta.model})
            </p>
          {/if}
        {/if}
      {:else if w.step === 'schedule'}
        {#if w.response}
          <!-- Phase 25 v2-addendum (#82 partial) — AI-on/off legend strip
               at the top of the schedule step. Per the addendum spec,
               AI on/off is a real product mode, not an error state —
               the operator sees the provenance map for the dates they're
               about to commit. -->
          <ProvenanceLegend
            shown={aiEnabled
              ? ['plugin', 'data', 'ai', 'manual']
              : ['plugin', 'data', 'fallback', 'manual']}
            note={aiEnabled
              ? 'Dates AI-proposed within plugin-derived windows · all editable'
              : 'AI off · deterministic scheduler · plugin windows + your records'}
          />
          {#if w.scheduleLoading}
            {@render aiProgress('schedule', w.scheduleStartMs)}
          {:else if w.scheduleError}
            <p class="aw-error">Error: {w.scheduleError}</p>
            <button class="btn-secondary" onclick={() => w.advanceToSchedule()}>Retry</button>
          {:else if w.scheduleResponse}
            {#if w.scheduleResponse.meta.fallback}
              <div class="aw-banner info" role="alert" aria-live="assertive">
                {w.scheduleResponse.meta.fallback === 'no-api-key'
                  ? '🛟 Dates picked by the deterministic scheduler (no Anthropic API key). Staggers + companion offsets honored.'
                  : '🛟 AI needed help — deterministic scheduler took over. See chat below for what tripped it up and refine from there.'}
              </div>
            {/if}
            <p class="aw-rationale">
              {w.scheduleResponse.rationale}
              <Provenance
                source={w.scheduleResponse.meta.fallback ? 'fallback' : aiEnabled ? 'ai' : 'plugin'}
                detail={w.scheduleResponse.meta.fallback ? 'deterministic scheduler' : undefined}
                compact
              />
            </p>
            <table class="aw-table">
              <thead>
                <tr>
                  <th>Seed</th>
                  <th>Block</th>
                  <th>Planting date</th>
                  <th>Plants</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {#each w.scheduleResponse.scheduled as p, i (i)}
                  <tr>
                    <td>
                      {p.varietyDisplayName}
                      {#if p.successionIndex}
                        <span class="chip chip-succession" title="Succession sowing">
                          {p.successionIndex.i}/{p.successionIndex.n}
                        </span>
                      {/if}
                    </td>
                    <td>{w.blockNameFor(p.blockId)}</td>
                    <td>{fmtDateMs(p.plantingDateMs)}</td>
                    <td>{p.plants.toLocaleString()}</td>
                    <td class="why">{p.rationale}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if w.scheduleResponse.advisories.length > 0}
              <section class="aw-banner info">
                <strong>Schedule notes:</strong>
                <ul>
                  {#each w.scheduleResponse.advisories as a}<li>{a}</li>{/each}
                </ul>
              </section>
            {/if}
            {@render chatPanel()}
          {/if}
        {/if}
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
  .aw-intro {
    margin: 0 0 0.75rem;
    color: #4a5d4a;
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
  .aw-table {
    width: 100%;
    border-collapse: collapse;
  }
  .aw-table th,
  .aw-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #e4e9e4;
    text-align: left;
    vertical-align: middle;
  }
  .aw-table th {
    background: #f8fbf9;
    color: var(--color-forest);
    font-weight: 700;
    font-size: 0.9rem;
  }
  .aw-table input[type='number'] {
    width: 5rem;
    min-height: 32px;
    padding: 0.25rem 0.4rem;
    border: 1px solid #cbd5cb;
    border-radius: 4px;
    text-align: right;
  }
  .row-checked {
    background: #f3f9f4;
  }
  .seed-name-cell {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    line-height: 1.2;
  }
  .seed-name-primary {
    font-weight: 600;
    color: #1a1a1a;
  }
  .seed-name-sub {
    font-size: 0.78rem;
    color: #6b7280;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 320px;
  }
  .muted {
    color: #6a7d6a;
    font-size: 0.9rem;
  }
  .aw-search-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .aw-search {
    flex: 1;
    min-height: 36px;
    padding: 0.4rem 0.6rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    font-size: 0.95rem;
  }
  .family-row td {
    background: #eef4ef;
    color: var(--color-forest);
    font-weight: 700;
    font-size: 0.85rem;
    text-transform: capitalize;
    padding: 0.35rem 0.75rem;
  }
  .family-row .family-name {
    margin-right: 0.4rem;
  }
  .family-actions {
    float: right;
    display: inline-flex;
    gap: 0.4rem;
  }
  .family-action-btn {
    background: white;
    color: var(--color-forest);
    border: 1px solid var(--color-forest);
    border-radius: 4px;
    padding: 0.12rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    line-height: 1.4;
    min-height: 24px;
  }
  .family-action-btn:hover:not(:disabled) {
    background: #f0f5f1;
  }
  .family-action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .family-action-clear {
    border-color: #b8860b;
    color: #6a4f00;
  }
  .family-action-clear:hover {
    background: #fff8e6;
  }
  .aw-info {
    display: inline-block;
    margin-left: 0.25rem;
    padding: 0;
    background: none;
    border: 0;
    color: #6a7d6a;
    cursor: help;
    font-size: 0.85em;
    line-height: 1;
    user-select: none;
  }
  .aw-info:hover,
  .aw-info:focus {
    color: var(--color-forest);
    outline: none;
  }
  .aw-blocks-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .aw-blocks-header .aw-intro {
    margin: 0;
  }
  .aw-blocks-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  .aw-blocklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.5rem;
  }
  .aw-blocklist li {
    border: 1px solid #cbd5cb;
    border-radius: 8px;
    background: white;
    transition:
      border-color 0.1s,
      background 0.1s;
  }
  .aw-blocklist li:hover {
    border-color: var(--color-forest);
  }
  .aw-blocklist li.checked {
    border-color: var(--color-forest);
    background: #f3f9f4;
  }
  .aw-blocklist label {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 0.65rem 0.8rem;
    cursor: pointer;
    width: 100%;
  }
  .aw-blocklist input[type='checkbox'] {
    margin-top: 0.15rem;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--color-forest);
  }
  .aw-block-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    flex: 1;
  }
  .aw-block-name {
    font-weight: 700;
    color: #1f3a26;
    font-size: 0.95rem;
    line-height: 1.2;
  }
  .aw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .aw-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.5rem;
    background: #eef4ef;
    color: #4a5d4a;
    border-radius: 999px;
    font-size: 0.78rem;
    line-height: 1.4;
    white-space: nowrap;
    text-transform: capitalize;
  }
  .aw-chip-warn {
    background: #fff1cc;
    color: #6a4f00;
  }
  .aw-link {
    background: none;
    border: none;
    color: var(--color-forest);
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
  }
  .aw-rationale {
    background: #f3f9f4;
    border-left: 3px solid var(--color-forest);
    padding: 0.75rem 1rem;
    margin: 0 0 0.75rem;
    color: var(--color-forest);
    font-size: 0.95rem;
  }
  .aw-chat {
    margin: 1rem 0 0.25rem;
    border: 1px solid #cbd5cb;
    border-radius: 10px;
    background: #fafcfa;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .aw-chat-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.55rem 0.9rem;
    background: #eef4ef;
    border-bottom: 1px solid #d8e2d8;
    gap: 0.75rem;
  }
  .aw-chat-header h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--color-forest);
  }
  .aw-chat-header-off {
    background: var(--color-wheat-soft, #fbf3df);
    border-color: #e0d5b0;
    flex-direction: column;
    align-items: flex-start;
  }
  .aw-chat-header-off h3 {
    color: var(--color-wheat-deep, #8a6722);
  }
  .aw-chat-model {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.78rem;
    color: var(--color-ink-muted);
  }
  .aw-chat-key-link {
    color: var(--color-forest-deep, #1f3522);
    text-decoration: underline;
  }
  .aw-chat-log {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem 0.9rem;
    max-height: 280px;
    overflow-y: auto;
    background: white;
  }
  .chat-msg {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
  }
  .chat-msg.chat-user {
    flex-direction: row-reverse;
  }
  .chat-role {
    font-size: 1.05rem;
    line-height: 1.6;
    flex-shrink: 0;
  }
  .chat-bubble {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    font-size: 0.92rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 80%;
    font-family: inherit;
  }
  .chat-msg.chat-assistant .chat-bubble {
    background: #f3f9f4;
    color: #1f3a26;
    border-top-left-radius: 4px;
  }
  .chat-msg.chat-user .chat-bubble {
    background: var(--color-forest);
    color: white;
    border-top-right-radius: 4px;
  }
  .chat-thinking {
    font-style: italic;
    color: #4a5d4a;
  }
  .chat-error {
    margin: 0.25rem 0.9rem 0;
    font-size: 0.85rem;
  }
  .aw-override-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.75rem;
    margin: 0 0.75rem;
    background: #fff8e1;
    border: 1px solid #f1c40f;
    border-radius: 6px;
  }
  .btn-override {
    background: #fff;
    color: #5b3a00;
    border: 1px solid #f1c40f;
    font-weight: 600;
    padding: 0.4rem 0.9rem;
    border-radius: 6px;
    min-height: 40px;
    cursor: pointer;
  }
  .btn-override:hover {
    background: #fff3c4;
  }
  .override-hint {
    font-size: 0.85rem;
    flex: 1;
    min-width: 12rem;
  }
  .aw-chat-input {
    display: flex;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem 0.75rem;
    background: #fafcfa;
    border-top: 1px solid #e4e9e4;
  }
  .aw-chat-input textarea {
    flex: 1;
    min-height: 44px;
    max-height: 140px;
    resize: vertical;
    padding: 0.5rem 0.6rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
    line-height: 1.4;
  }
  .aw-chat-input textarea:focus {
    outline: 2px solid var(--color-forest);
    outline-offset: 1px;
  }
  .chat-send {
    align-self: stretch;
    min-height: 44px;
    padding: 0 1rem;
  }
  .aw-banner.warn {
    background: #fff8e6;
    border-left: 3px solid #b8860b;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    color: #6a4f00;
    font-size: 0.92rem;
  }
  .aw-banner.info {
    background: #eaf3fb;
    border-left: 3px solid #2e6dbf;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    color: #1f4a85;
    font-size: 0.92rem;
  }
  .chip-pollination {
    background: #fbe7d8;
    color: #8a3a00;
    cursor: help;
  }
  .chip-sm {
    padding: 0.08rem 0.45rem;
    font-size: 0.78rem;
    font-weight: 500;
    line-height: 1.35;
    display: inline-block;
    margin: 0 0.25rem 0.25rem 0;
    max-width: 26rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
  td.cell-fit {
    max-width: 28rem;
    min-width: 12rem;
  }
  .chip-succession {
    background: #e6efff;
    color: #1f4a85;
    margin-left: 0.3rem;
    font-weight: 600;
  }
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
  .chat-elapsed {
    display: block;
    font-size: 0.72rem;
    color: #4a5d4a;
    font-variant-numeric: tabular-nums;
    margin-top: 0.15rem;
    font-style: normal;
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
  .chip {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .chip-match {
    background: #d6efdc;
    color: var(--color-forest);
  }
  .chip-surplus {
    background: #fff1cc;
    color: #6a4f00;
  }
  .chip-deficit {
    background: #f9d6d6;
    color: #8a1f1f;
  }
  .why {
    color: #4a5d4a;
    font-size: 0.9rem;
    max-width: 22rem;
  }
  .aw-cost {
    color: #6a7d6a;
    font-size: 0.85rem;
    text-align: right;
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
  .empty {
    color: #6a7d6a;
    font-style: italic;
  }
  /* #175 (CT-W-006) — Seeds step empty-state card. Sized to feel like
     a "next step" card rather than an error. Sprint 3 extends this
     block with an inline embedded stock-add form; keep the class
     names stable so that work doesn't need to re-style. */
  .aw-seed-empty {
    border: 1px solid var(--color-divider, #d8dcd1);
    border-radius: 12px;
    padding: 1.25rem 1.4rem 1.4rem;
    background: var(--color-cream, #fbfaf3);
    margin-block: 1rem 0.5rem;
  }
  .aw-seed-empty-title {
    margin: 0 0 0.4rem 0;
    font-size: 1.05rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .aw-seed-empty-lede {
    margin: 0 0 1rem 0;
    color: #4a5a4a;
    line-height: 1.45;
  }
  .aw-seed-empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
  }
  .aw-seed-empty-actions .btn-primary,
  .aw-seed-empty-actions .btn-secondary {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .aw-seed-empty-actions .btn-link {
    background: transparent;
    border: none;
    color: var(--color-ink-muted);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    padding: 0.5rem 0.6rem;
    margin-left: auto;
  }
  .aw-seed-empty-actions .btn-link:hover {
    color: var(--color-forest-deep, #1f3522);
  }
  /* #252 / CT-W-007 — needs-plugin section. Same visual register as
     the wizard-Seeds empty-state (#175) so the operator reads the
     two empty-states as a consistent "data is incomplete; here's how
     to recover" pattern. */
  .needs-plugin-section {
    border: 1px solid var(--color-wheat-deep, #c98e2e);
    border-radius: 12px;
    padding: 1.25rem 1.4rem 1.4rem;
    background: #fff7e6;
    margin-block: 1rem;
  }
  .needs-plugin-title {
    margin: 0 0 0.4rem 0;
    font-size: 1.05rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .needs-plugin-lede {
    margin: 0 0 1rem 0;
    color: #4a5a4a;
    line-height: 1.45;
  }
  .needs-plugin-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .needs-plugin-row {
    background: var(--color-cream, #fbfaf3);
    border: 1px solid var(--color-divider, #d8dcd1);
    border-radius: 8px;
    padding: 0.75rem 0.875rem;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem 0.75rem;
    align-items: center;
  }
  .needs-plugin-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .needs-plugin-btn {
    min-height: 38px;
    white-space: nowrap;
  }
  /* Inline picker spans both grid columns so the search input has room. */
  .link-picker {
    grid-column: 1 / -1;
    border-top: 1px dashed var(--color-divider);
    padding-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .link-results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .link-result {
    width: 100%;
    text-align: left;
    background: #fff;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 44px;
    font-family: inherit;
    font-size: 14px;
    color: var(--color-ink);
  }
  .link-result:hover:not(:disabled) {
    border-color: var(--color-forest-deep);
    background: var(--color-paper);
  }
  .link-result:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .link-result-name {
    font-weight: 500;
  }
  .link-result-score {
    font-size: 12px;
  }
  .link-picker-footer {
    display: flex;
    justify-content: flex-end;
  }
</style>
