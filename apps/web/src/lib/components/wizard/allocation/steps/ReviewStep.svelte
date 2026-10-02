<script lang="ts">
  import type { PollinationConstraint } from '$lib/plan/types';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';
  import AiProgress from '../AiProgress.svelte';
  import AiUsageChip from '$lib/components/billing/AiUsageChip.svelte';
  import ChatPanel from '../ChatPanel.svelte';
  import { sufficiencyChip } from '../format';
  import { getWizardContext } from '../wizardState.svelte';
  import { blockHasSize } from '../types';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const w = getWizardContext();
  const tr = $derived(createT(page.data?.locale));
  const aiEnabled = $derived(w.props.aiEnabled);
  /** Every picked block lacks a size, so no seed, counted or not, had anywhere to go. */
  const pickedBlocksUnsized = $derived(
    w.props.blocks.filter((b) => w.selectedBlockIds.has(b.id)).every((b) => !blockHasSize(b))
  );

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
      tr('wizard.review.stagger', { days, partners: visible.join(' · ') }) +
      (overflow > 0 ? tr('wizard.review.staggerMore', { n: overflow }) : '');
    const tooltip = tr('wizard.review.staggerTip', { days, partners: partners.join(', ') });
    return { label, tooltip, days };
  }
</script>

{#if w.loading}
  <AiProgress stage="allocate" startMs={w.allocateStartMs} />
{:else if w.error}
  <p class="aw-error">{tr('wizard.review.error', { error: w.error })}</p>
{:else if w.response}
  {#if w.response.meta.fallback}
    <div class="aw-banner warn" role="alert" aria-live="assertive">
      {w.response.meta.fallback === 'no-api-key'
        ? tr('wizard.review.fbNoKey')
        : w.response.meta.fallback === 'over-cap'
          ? tr('wizard.review.fbOverCap')
          : w.response.meta.fallback === 'quota-exceeded'
            ? tr('wizard.review.fbQuota')
            : w.response.meta.fallback === 'ai-unavailable'
              ? tr('wizard.review.fbUnavailable')
              : tr('wizard.review.fbInvalid')}
    </div>
    {#if w.response.meta.fallback === 'quota-exceeded'}
      <AiUsageChip planning />
    {:else if w.response.meta.fallback === 'over-cap'}
      <AiUsageChip />
    {/if}
  {/if}
  {#if (w.response.geometryMissingBlockIds ?? []).length > 0}
    <div class="aw-banner info">
      {tr('wizard.review.noGeometry', {
        count: w.response.geometryMissingBlockIds!.length,
        names: w.response.geometryMissingBlockIds!.map((id) => w.blockNameFor(id)).join(', ')
      })}
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
      ? tr('wizard.review.noteAi')
      : tr('wizard.review.noteOff')}
  />
  <!-- #209 / CT-PP-007 — on fallback the AI's stale narrative is
       discarded and replaced with a deterministic engine handoff
       so chat narrative cannot contradict the per-row table below.
       Server already swaps response.rationale; this is the
       defence-in-depth render-side check. -->
  <p class="aw-rationale">
    {#if w.response.meta.fallback}
      {w.response.rationale || tr('wizard.review.engineRationale')}
    {:else}
      {w.response.rationale}
    {/if}
    <Provenance
      source={w.response.meta.fallback ? 'fallback' : aiEnabled ? 'ai' : 'plugin'}
      detail={w.response.meta.fallback ? tr('wizard.review.fallbackDetail') : undefined}
      compact
    />
  </p>
  <table class="aw-table">
    <thead>
      <tr>
        <th>{tr('wizard.review.thSeed')}</th>
        <th>{tr('wizard.review.thBlock')}</th>
        <th>{tr('wizard.review.thPlants')}</th>
        <th>{tr('wizard.review.thFit')}</th>
        <th>{tr('wizard.review.thWhy')}</th>
        <th>{tr('wizard.review.thSource')}</th>
      </tr>
    </thead>
    <tbody>
      {#each w.response.assignments as a, idx (idx)}
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
              <span class={`chip chip-sm ${chip.cls}`} title={chip.tooltip}>{chip.label}</span>
            {/if}
            {#if poll}
              <span class="chip chip-sm chip-pollination" title={poll.tooltip}>{poll.label}</span>
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

  <ChatPanel />

  {#if w.response.unplaced.length > 0}
    <h3>{tr('wizard.review.leftOver')}</h3>
    <ul>
      {#each w.response.unplaced as u, idx (idx)}
        <li data-testid="unplaced-row">
          {#if pickedBlocksUnsized}
            {tr('wizard.review.unsized', { name: w.varietyDisplayFor(u.stockItemId) })}
          {:else if w.isFillToBed(u.stockItemId)}
            {tr('wizard.review.noRoom', { name: w.varietyDisplayFor(u.stockItemId) })}
          {:else}
            {tr('wizard.review.didntFit', {
              name: w.varietyDisplayFor(u.stockItemId),
              count: u.quantityPlants
            })}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if w.response.meta.usdEstimate > 0}
    <p class="aw-cost">
      {tr('wizard.review.cost', {
        amount: w.response.meta.usdEstimate.toFixed(4),
        model: w.response.meta.model
      })}
    </p>
  {/if}
{/if}

<style>
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
  .aw-rationale {
    background: #f3f9f4;
    border-left: 3px solid var(--color-forest);
    padding: 0.75rem 1rem;
    margin: 0 0 0.75rem;
    color: var(--color-forest);
    font-size: 0.95rem;
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
  .aw-error {
    color: #b22222;
    font-weight: 600;
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
</style>
