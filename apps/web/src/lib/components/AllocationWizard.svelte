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
