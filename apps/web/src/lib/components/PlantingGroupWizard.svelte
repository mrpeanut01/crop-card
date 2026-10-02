<!--
  PlantingGroupWizard.svelte (Phase 15b)
  ──────────────────────────────────────
  AI-driven approval-cards wizard. On open it calls `/api/plan/groups` which
  proposes a batch of plans (Three Sisters groups + singleton plantings)
  with anchor + companion dates that respect soil-temp / frost / DTM.
  Operator never picks an anchor — the AI does. Operator approves cards,
  optionally tweaks dates, then batch-commits.

  Falls back to the deterministic engine when no Claude key or AI fails
  validation twice; the wizard surfaces this via a fallback banner.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import { planFamilyText } from './planFamily';

  type PlanMember = {
    cropId: string;
    cropPluginId: string;
    varietyDisplayName: string;
    cropFamily: string;
    offsetDays: number;
    plantingDateMs: number;
  };

  type ProposedPlan =
    | {
        kind: 'group';
        systemKind: 'three-sisters';
        blockId: string;
        anchor: PlanMember;
        companions: PlanMember[];
        rationale: string;
        advisories: string[];
      }
    | {
        kind: 'singleton';
        systemKind: 'singleton';
        blockId: string;
        anchor: PlanMember;
        rationale: string;
        advisories: string[];
      };

  type SuggestResponse = {
    proposed: ProposedPlan[];
    unscheduled: Array<{ cropId: string; reason: string }>;
    meta: {
      model: string;
      usdEstimate: number;
      fallback?: string;
      fallbackMessage?: string | null;
    };
    spend?: { monthlyUsdSoFar: number; cap: number; warnAt80: boolean };
  };

  type BlockLabel = { id: string; label: string };

  let {
    blockLabels,
    blockIds,
    onClose,
    onCommitted
  }: {
    blockLabels: BlockLabel[];
    /** Phase 15d — restrict the wizard's planning to this set of blocks
     *  (the Schedule tab's filter). Empty/undefined = all blocks. */
    blockIds?: string[];
    onClose: () => void;
    onCommitted: (committedGroupIds: string[]) => void;
  } = $props();

  const tr = $derived(createT(page.data?.locale));
  const DAY_MS = 24 * 60 * 60 * 1000;

  let response = $state<SuggestResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  // Per-plan state.
  let acceptedIdx = $state<Set<number>>(new Set());
  let editedAnchorMs = $state<Map<number, number>>(new Map());
  let committing = $state(false);
  let commitProgress = $state<{ done: number; total: number; failed: string[] }>({
    done: 0,
    total: 0,
    failed: []
  });

  async function generate(blockId?: string) {
    loading = true;
    error = null;
    response = null;
    acceptedIdx = new Set();
    editedAnchorMs = new Map();
    try {
      const body: { blockId?: string; blockIds?: string[] } = {};
      if (blockId) body.blockId = blockId;
      else if (blockIds && blockIds.length > 0) body.blockIds = blockIds;
      const r = await fetch('/api/plan/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) {
        error = j.error ?? tr('group.wiz.requestFailedStatus', { status: r.status });
        return;
      }
      response = j as SuggestResponse;
      // Default-accept everything the AI/engine proposed.
      acceptedIdx = new Set(response.proposed.map((_, i) => i));
    } catch (e) {
      error = e instanceof Error ? e.message : tr('group.wiz.requestFailed');
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void generate();
  });

  function blockLabelOf(id: string): string {
    return blockLabels.find((b) => b.id === id)?.label ?? id;
  }

  function fmtDate(ms: number): string {
    return fmt.day(ms, 'month-day');
  }

  function fmtDateInput(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function familyLabel(f: string): string {
    return planFamilyText(f, page.data?.locale, f.replace(/-/g, ' '));
  }

  function effectiveAnchorMs(idx: number, plan: ProposedPlan): number {
    return editedAnchorMs.get(idx) ?? plan.anchor.plantingDateMs;
  }

  function effectiveCompanionMs(idx: number, plan: ProposedPlan, member: PlanMember): number {
    const anchorMs = effectiveAnchorMs(idx, plan);
    return anchorMs + member.offsetDays * DAY_MS;
  }

  function toggleAccept(idx: number) {
    const next = new Set(acceptedIdx);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    acceptedIdx = next;
  }

  function setAnchorDate(idx: number, dateStr: string) {
    if (!dateStr) return;
    const ms = new Date(dateStr).getTime();
    const next = new Map(editedAnchorMs);
    next.set(idx, ms);
    editedAnchorMs = next;
  }

  async function commitAll() {
    if (!response) return;
    const accepted = [...acceptedIdx]
      .sort((a, b) => a - b)
      .map((i) => ({ idx: i, plan: response!.proposed[i] }))
      .filter((x) => x.plan);
    if (accepted.length === 0) return;
    committing = true;
    commitProgress = { done: 0, total: accepted.length, failed: [] };
    const committedGroupIds: string[] = [];

    for (const { idx, plan } of accepted) {
      const anchorMs = effectiveAnchorMs(idx, plan);
      try {
        if (plan.kind === 'group') {
          const r = await fetch('/api/plantings/groups', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              blockId: plan.blockId,
              anchorPlantingDateMs: anchorMs,
              systemKind: plan.systemKind,
              anchor: {
                cropPluginId: plan.anchor.cropPluginId,
                varietyDisplayName: plan.anchor.varietyDisplayName,
                existingCropId: plan.anchor.cropId
              },
              companions: plan.companions.map((c) => ({
                cropPluginId: c.cropPluginId,
                varietyDisplayName: c.varietyDisplayName,
                offsetDays: c.offsetDays,
                existingCropId: c.cropId
              }))
            })
          });
          if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            commitProgress.failed.push(
              `${plan.anchor.varietyDisplayName}: ${e.error ?? r.statusText}`
            );
          } else {
            const j = await r.json();
            if (j.group?.groupId) committedGroupIds.push(j.group.groupId);
          }
        } else {
          // Singleton — set the existing draft's plantingDate via PATCH.
          const r = await fetch(`/api/crops/${encodeURIComponent(plan.anchor.cropId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'set-schedule',
              plantingDate: anchorMs
            })
          });
          if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            commitProgress.failed.push(
              `${plan.anchor.varietyDisplayName}: ${e.error ?? r.statusText}`
            );
          }
        }
      } catch (e) {
        commitProgress.failed.push(
          `${plan.anchor.varietyDisplayName}: ${e instanceof Error ? e.message : tr('group.wiz.commitFailed')}`
        );
      }
      commitProgress = { ...commitProgress, done: commitProgress.done + 1 };
    }
    committing = false;
    onCommitted(committedGroupIds);
  }

  const acceptedCount = $derived(acceptedIdx.size);
</script>

<div class="wizard-backdrop" role="dialog" aria-modal="true" aria-label={tr('group.wiz.aria')}>
  <div class="wizard">
    <header class="wizard-head">
      <div class="head-text">
        <h2>✨ {tr('group.wiz.title')}</h2>
        <p class="head-sub">{tr('group.wiz.sub')}</p>
      </div>
      <button type="button" class="close" onclick={onClose} aria-label={tr('group.wiz.close')}
        >×</button
      >
    </header>

    {#if response?.spend}
      <div class="spend-banner" class:warn={response.spend.warnAt80}>
        {tr('group.wiz.spend', {
          spent: response.spend.monthlyUsdSoFar.toFixed(2),
          cap: response.spend.cap.toFixed(2)
        })}
        {#if response.meta?.usdEstimate}{tr('group.wiz.thisCall', {
            cost: response.meta.usdEstimate.toFixed(3)
          })}{/if}
      </div>
    {/if}

    {#if response?.meta?.fallback}
      <div class="fallback-banner">
        {#if response.meta.fallback === 'no-api-key'}
          ℹ {tr('group.wiz.fbNoKey')}
        {:else if response.meta.fallback === 'ai-unavailable'}
          ℹ {tr('group.wiz.fbUnavailable', {
            message: response.meta.fallbackMessage ?? tr('group.wiz.claudeUnavailable')
          })}
        {:else if response.meta.fallback === 'engine-only'}
          ⚠ {tr('group.wiz.fbEngine')}
        {:else if response.meta.fallback === 'no-drafts'}
          ℹ {tr('group.wiz.fbNoDrafts')}
        {/if}
      </div>
    {/if}

    <section class="wizard-body">
      {#if loading}
        <div class="loading">
          <div class="spinner" aria-hidden="true"></div>
          <p>{tr('group.wiz.analyzing')}</p>
        </div>
      {:else if error}
        <div class="error">
          <p>{error}</p>
          <button type="button" class="btn-secondary" onclick={() => generate()}
            >{tr('group.wiz.retry')}</button
          >
        </div>
      {:else if response && response.proposed.length === 0}
        <div class="empty-card">
          <p>
            <strong>{tr('group.wiz.emptyTitle')}</strong>
          </p>
          <p>
            {tr('group.wiz.emptyBefore')} <strong>{tr('group.wiz.emptyTab')}</strong>
            {tr('group.wiz.emptyAfter')}
          </p>
        </div>
      {:else if response}
        <div class="cards">
          {#each response.proposed as plan, idx (plan.anchor.cropId)}
            {@const accepted = acceptedIdx.has(idx)}
            {@const anchorMs = effectiveAnchorMs(idx, plan)}
            <article class="plan-card" class:accepted class:skipped={!accepted}>
              <header class="plan-head">
                <div class="plan-title">
                  {#if plan.kind === 'group'}
                    <span class="badge badge-group"
                      >{plan.systemKind === 'three-sisters'
                        ? `🌽 ${tr('group.kind.threeSisters')}`
                        : tr('group.wiz.group')}</span
                    >
                  {:else}
                    <span class="badge badge-single">{tr('group.wiz.single')}</span>
                  {/if}
                  <span class="plan-block"
                    >{tr('group.wiz.on', { block: blockLabelOf(plan.blockId) })}</span
                  >
                </div>
                <label class="accept-toggle">
                  <input type="checkbox" checked={accepted} onchange={() => toggleAccept(idx)} />
                  {accepted ? tr('group.wiz.accepted') : tr('group.wiz.skipped')}
                </label>
              </header>

              <ul class="member-list">
                <li class="member member-anchor">
                  <span class="role-glyph" aria-hidden="true">⚓</span>
                  <span class="member-name">{plan.anchor.varietyDisplayName}</span>
                  <span class="family">{familyLabel(plan.anchor.cropFamily)}</span>
                  <span class="member-date">{fmtDate(anchorMs)}</span>
                </li>
                {#if plan.kind === 'group'}
                  {#each plan.companions as c (c.cropId)}
                    <li class="member member-companion">
                      <span class="member-name">{c.varietyDisplayName}</span>
                      <span class="family">{familyLabel(c.cropFamily)}</span>
                      <span class="offset">+{c.offsetDays}d</span>
                      <span class="member-date">{fmtDate(effectiveCompanionMs(idx, plan, c))}</span>
                    </li>
                  {/each}
                {/if}
              </ul>

              {#if plan.rationale}
                <p class="rationale"><em>{tr('group.wiz.why')}</em> {plan.rationale}</p>
              {/if}

              {#if plan.advisories.length > 0}
                <ul class="advisories">
                  {#each plan.advisories as a, ai (idx + ':adv:' + ai)}
                    <li>· {a}</li>
                  {/each}
                </ul>
              {/if}

              <details class="edit-dates">
                <summary>{tr('group.wiz.editAnchor')}</summary>
                <label>
                  {tr('group.wiz.anchorPlanting')}
                  <input
                    type="date"
                    value={fmtDateInput(anchorMs)}
                    oninput={(e) => setAnchorDate(idx, (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <p class="edit-hint">{tr('group.wiz.editHint')}</p>
              </details>
            </article>
          {/each}
        </div>

        {#if response.unscheduled.length > 0}
          <details class="unscheduled-block">
            <summary>{tr('group.wiz.notPlaced', { count: response.unscheduled.length })}</summary>
            <ul>
              {#each response.unscheduled as u (u.cropId)}
                <li>{u.reason}</li>
              {/each}
            </ul>
          </details>
        {/if}
      {/if}

      {#if committing}
        <div class="commit-progress">
          <p>
            {tr('group.wiz.committingN', {
              done: commitProgress.done,
              total: commitProgress.total
            })}
          </p>
          <progress value={commitProgress.done} max={commitProgress.total}></progress>
          {#if commitProgress.failed.length > 0}
            <ul class="commit-fail">
              {#each commitProgress.failed as f, fi (fi)}
                <li>{f}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </section>

    <footer class="wizard-foot">
      <button
        type="button"
        class="btn-secondary"
        onclick={() => generate()}
        disabled={loading || committing}
      >
        {tr('group.wiz.regenerate')}
      </button>
      <span class="counter"
        >{tr('group.wiz.acceptedOf', {
          n: acceptedCount,
          total: response?.proposed?.length ?? 0
        })}</span
      >
      <button
        type="button"
        class="btn-primary"
        onclick={commitAll}
        disabled={committing || loading || acceptedCount === 0}
      >
        {committing
          ? tr('group.wiz.committing')
          : tr('group.wiz.commitN', { count: acceptedCount })}
      </button>
    </footer>
  </div>
</div>

<style>
  .wizard-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .wizard {
    background: #fff;
    border-radius: 0.5rem;
    width: min(820px, 94vw);
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  }
  .wizard-head {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .head-text {
    flex: 1;
  }
  .head-text h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .head-sub {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    color: #6b7280;
  }
  .close {
    background: transparent;
    border: none;
    font-size: 1.4rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.25rem 0.5rem;
  }
  .spend-banner {
    padding: 0.4rem 1rem;
    background: #ecfdf5;
    color: #065f46;
    font-size: 0.78rem;
    border-bottom: 1px solid #d1fae5;
  }
  .spend-banner.warn {
    background: #fef3c7;
    color: #92400e;
    border-color: #fde68a;
  }
  .fallback-banner {
    padding: 0.4rem 1rem;
    background: #f1f5f9;
    color: #475569;
    font-size: 0.78rem;
    border-bottom: 1px solid #e2e8f0;
  }
  .wizard-body {
    padding: 1rem;
    overflow-y: auto;
    flex: 1;
  }
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 2rem;
    color: #4b5563;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid #e5e7eb;
    border-top-color: #4338ca;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .error {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    border-radius: 0.4rem;
    padding: 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }
  .empty-card {
    padding: 0.8rem 1rem;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 0.4rem;
    color: #9a3412;
    font-size: 0.85rem;
  }
  .empty-card p {
    margin: 0 0 0.4rem;
  }
  .empty-card p:last-child {
    margin: 0;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .plan-card {
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 0.7rem 0.9rem;
    background: #fafafa;
    transition:
      opacity 0.15s,
      border-color 0.15s;
  }
  .plan-card.accepted {
    border-color: #4338ca;
    background: #fff;
    box-shadow: 0 1px 4px rgba(67, 56, 202, 0.1);
  }
  .plan-card.skipped {
    opacity: 0.6;
  }
  .plan-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.4rem;
    flex-wrap: wrap;
  }
  .plan-title {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .badge {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .badge-group {
    background: #fef3c7;
    color: #92400e;
  }
  .badge-single {
    background: #ede9fe;
    color: #5b21b6;
  }
  .plan-block {
    color: #4b5563;
    font-size: 0.85rem;
  }
  .accept-toggle {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
    font-size: 0.85rem;
    user-select: none;
  }
  .accept-toggle input {
    width: 1.1rem;
    height: 1.1rem;
    cursor: pointer;
  }
  .member-list {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .member {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.3rem 0.45rem;
    background: #fff;
    border-left: 3px solid #cbd5e1;
    border-radius: 0 0.25rem 0.25rem 0;
    font-size: 0.85rem;
    flex-wrap: wrap;
  }
  .member-anchor {
    border-left-color: #b45309;
  }
  .member-companion {
    border-left-color: #312e81;
  }
  .role-glyph {
    color: #b45309;
    font-size: 0.8rem;
  }
  .member-name {
    font-weight: 500;
  }
  .family {
    font-size: 0.72rem;
    background: #ede9fe;
    color: #5b21b6;
    padding: 0 0.35rem;
    border-radius: 2px;
    text-transform: capitalize;
  }
  .offset {
    font-size: 0.72rem;
    background: #ecfeff;
    color: #0e7490;
    padding: 0 0.35rem;
    border-radius: 2px;
  }
  .member-date {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: #1f5e3a;
    font-weight: 500;
  }
  .rationale {
    margin: 0.3rem 0;
    font-size: 0.82rem;
    color: #4b5563;
  }
  .rationale em {
    color: #6b7280;
    font-style: italic;
    margin-right: 0.25rem;
  }
  .advisories {
    list-style: none;
    padding: 0.3rem 0.5rem;
    margin: 0.3rem 0;
    background: #fffbeb;
    border-radius: 0.3rem;
    font-size: 0.78rem;
    color: #92400e;
  }
  .edit-dates {
    margin-top: 0.4rem;
    font-size: 0.85rem;
  }
  .edit-dates summary {
    cursor: pointer;
    color: #4338ca;
    font-size: 0.78rem;
  }
  .edit-dates label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.4rem;
    font-size: 0.78rem;
  }
  .edit-dates input {
    padding: 0.35rem 0.5rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.25rem;
    width: 180px;
    min-height: 36px;
  }
  .edit-hint {
    margin: 0.3rem 0 0;
    font-size: 0.72rem;
    color: #6b7280;
  }
  .unscheduled-block {
    margin-top: 1rem;
    padding: 0.6rem 0.9rem;
    background: #f9fafb;
    border-radius: 0.4rem;
    font-size: 0.82rem;
  }
  .unscheduled-block summary {
    cursor: pointer;
    font-weight: 500;
  }
  .unscheduled-block ul {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
    color: #4b5563;
  }
  .commit-progress {
    margin-top: 1rem;
    padding: 0.7rem 0.9rem;
    background: #eef2ff;
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
  .commit-progress progress {
    width: 100%;
    height: 8px;
  }
  .commit-fail {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
    color: #b91c1c;
    font-size: 0.78rem;
  }
  .wizard-foot {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: center;
    padding: 0.7rem 1rem;
    border-top: 1px solid #e5e7eb;
    background: #f9fafb;
    border-bottom-left-radius: 0.5rem;
    border-bottom-right-radius: 0.5rem;
  }
  .counter {
    font-size: 0.85rem;
    color: #4b5563;
    flex: 1;
    text-align: center;
  }
  .btn-primary,
  .btn-secondary {
    padding: 0.5rem 1rem;
    border-radius: 0.3rem;
    cursor: pointer;
    min-height: 40px;
    font-weight: 600;
    font-size: 0.88rem;
  }
  .btn-primary {
    background: #4338ca;
    color: #fff;
    border: 1px solid #312e81;
  }
  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: #fff;
    color: #4338ca;
    border: 1px solid #c7d2fe;
  }
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
