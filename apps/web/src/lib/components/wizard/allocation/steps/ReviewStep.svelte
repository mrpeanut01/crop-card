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
  import { groupSplitRows, leftoverHasRuledOut, leftoverReasons } from '../split';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { areaText, seedAmountLine } from '$lib/plan/seedAmountText';
  import { shortNameList } from '$lib/plan/nameList';
  import { intlLocale } from '$lib/prefs';
  import { numberToLocaleString } from '$lib/intlCache';

  const w = getWizardContext();
  const tr = $derived(createT(page.data?.locale));
  const aiEnabled = $derived(w.props.aiEnabled);
  /** Every picked block lacks a size, so no seed, counted or not, had anywhere to go. */
  const pickedBlocksUnsized = $derived(
    w.props.blocks.filter((b) => w.selectedBlockIds.has(b.id)).every((b) => !blockHasSize(b))
  );

  const rows = $derived(groupSplitRows(w.response?.assignments ?? [], w.splitLotCounts));
  const leftoverByLot = $derived(
    new Map((w.response?.leftover ?? []).map((r) => [r.stockItemId, r]))
  );

  /** The first Review row of each lot carries its keep-in-one-bed toggle. */
  function isFirstRowOfLot(i: number): boolean {
    const id = rows[i]?.assignment.stockItemId;
    return !!id && rows.findIndex((r) => r.assignment.stockItemId === id) === i;
  }

  function rowHasToggle(i: number): boolean {
    const a = rows[i]?.assignment;
    if (!a || !isFirstRowOfLot(i) || w.isFillToBed(a.stockItemId)) return false;
    return (
      !!w.splitLotCounts.get(a.stockItemId) ||
      w.isKeptInOneBed(a.cropPluginId) ||
      leftoverHasRuledOut(leftoverByLot.get(a.stockItemId))
    );
  }

  function unplacedHasToggle(u: { stockItemId: string; cropPluginId: string }): boolean {
    if (pickedBlocksUnsized || w.isFillToBed(u.stockItemId)) return false;
    const report = leftoverByLot.get(u.stockItemId);
    if (!report || report.blocks.length === 0) return false;
    return (
      (leftoverHasRuledOut(report) || w.isKeptInOneBed(u.cropPluginId)) &&
      !rows.some((r) => r.assignment.stockItemId === u.stockItemId)
    );
  }

  const anyKeepToggle = $derived(
    rows.some((_, i) => rowHasToggle(i)) || (w.response?.unplaced ?? []).some(unplacedHasToggle)
  );

  function cropNameFor(pluginId: string): string | undefined {
    const c = (w.props.cropCatalog ?? []).find((x) => x.pluginId === pluginId);
    return c ? cropDisplayName(pluginId, c.displayName, page.data?.locale) : undefined;
  }

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

{#snippet keepToggle(cropPluginId: string)}
  <button
    type="button"
    class="keep-toggle"
    data-testid="keep-in-one-bed"
    aria-pressed={w.isKeptInOneBed(cropPluginId)}
    title={tr('wizard.split.keepHint')}
    aria-describedby="aw-keep-note"
    disabled={w.keepInOneBedBusy}
    onclick={() => void w.toggleKeepInOneBed(cropPluginId)}
  >
    {tr('wizard.split.keep')}
  </button>
{/snippet}

{#if w.keepInOneBedError}
  <p class="aw-error" role="alert">{w.keepInOneBedError}</p>
{/if}
{#if w.loading}
  <AiProgress stage="allocate" startMs={w.allocateStartMs} />
{:else if w.error}
  <p class="aw-error">{tr('wizard.review.error', { error: w.error })}</p>
{:else if w.response}
  {#if w.response.meta.fallback}
    <div class="aw-banner warn" role="alert" aria-live="assertive">
      {w.response.meta.aiOff
        ? tr('wizard.review.fbAiOff')
        : w.response.meta.fallback === 'no-api-key'
          ? tr('wizard.review.fbNoKey')
          : w.response.meta.fallback === 'over-cap'
            ? tr('wizard.review.fbOverCap')
            : w.response.meta.fallback === 'quota-exceeded'
              ? tr('wizard.review.fbQuota')
              : w.response.meta.fallback === 'ai-unavailable'
                ? tr('wizard.review.fbUnavailable')
                : tr('wizard.review.fbInvalid')}
    </div>
    {#if w.response.meta.aiOff}
      <!-- AI is off for this farm: no usage chip to show. -->
    {:else if w.response.meta.fallback === 'quota-exceeded'}
      <AiUsageChip planning />
    {:else if w.response.meta.fallback === 'over-cap'}
      <AiUsageChip />
    {/if}
  {/if}
  {#if (w.response.geometryMissingBlockIds ?? []).length > 0}
    <div class="aw-banner info" data-testid="no-geometry">
      {tr('wizard.review.noGeometry', {
        count: w.response.geometryMissingBlockIds!.length,
        names: shortNameList(
          w.response.geometryMissingBlockIds!.map((id) => w.blockNameFor(id)),
          page.data?.locale
        )
      })}
      <a href="/plan/farm">{tr('wizard.review.noGeometryLink')}</a>
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
  {#if anyKeepToggle}
    <p id="aw-keep-note" class="keep-note" data-testid="keep-note">
      {tr('wizard.split.keepNote')}
    </p>
  {/if}
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
      {#each rows as row, idx (row.index)}
        {@const a = row.assignment}
        {@const key = `${a.stockItemId}:${a.blockId}`}
        {@const suff = w.response.sufficiency[key]}
        {@const byArea = w.isAreaCrop(a.cropPluginId)}
        {@const chip = suff
          ? sufficiencyChip(suff, byArea ? (n) => areaText(n, w.prefs.units) : undefined)
          : null}
        {@const poll = pollinationSummary(a.stockItemId, a.blockId)}
        {@const splitN = w.splitLotCounts.get(a.stockItemId)}
        <tr data-split={splitN ? a.stockItemId : undefined}>
          <td class="cell-seed">{w.varietyDisplayFor(a.stockItemId)}</td>
          <td data-label={tr('wizard.review.thBlock')}>{w.blockNameFor(a.blockId)}</td>
          <td data-label={tr('wizard.review.thPlants')}>
            {#if byArea}
              {@const line = seedAmountLine(
                w.spacingFor(a.cropPluginId),
                w.sowMethodFor(a.cropPluginId),
                a.plants,
                w.prefs.units,
                page.data?.locale,
                w.manualRateFor(a.cropPluginId)
              )}
              <span data-testid="review-area">{areaText(a.plants, w.prefs.units)}</span>
              <span class="seed-line" data-testid="review-seed-amount">
                {#if line.provenance}<Provenance source={line.provenance} compact />{/if}
                {line.text}
              </span>
            {:else}
              {#if a.spacingProvenance === 'fallback'}<span
                  data-testid="review-spacing-fallback"
                  title={tr('wizard.review.spacingFallback')}
                  ><Provenance source="fallback" compact /></span
                >{/if}
              {numberToLocaleString(a.plants, intlLocale(page.data?.locale))}
            {/if}
          </td>
          <td class="cell-fit">
            {#if chip}
              <span class={`chip chip-sm ${chip.cls}`} title={chip.tooltip}>{chip.label}</span>
            {/if}
            {#if poll}
              <span class="chip chip-sm chip-pollination" title={poll.tooltip}>{poll.label}</span>
            {/if}
            {#if splitN}
              <span class="chip chip-sm chip-split" data-testid="split-chip">
                {w.splitNounFor(a.stockItemId) === 'beds'
                  ? tr('wizard.split.chipBeds', { n: splitN })
                  : tr('wizard.split.chipBlocks', { n: splitN })}
              </span>
            {/if}
            {#if rowHasToggle(idx)}
              {@render keepToggle(a.cropPluginId)}
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
            {#if w.isAreaCrop(u.cropPluginId)}
              {tr('wizard.review.didntFitArea', {
                name: w.varietyDisplayFor(u.stockItemId),
                area: areaText(u.quantityPlants, w.prefs.units)
              })}
            {:else}
              {tr('wizard.review.didntFit', {
                name: w.varietyDisplayFor(u.stockItemId),
                count: u.quantityPlants,
                n: numberToLocaleString(u.quantityPlants, intlLocale(page.data?.locale))
              })}
            {/if}
            {@const report = leftoverByLot.get(u.stockItemId)}
            {#if report && report.blocks.length > 0}
              <ul class="leftover-reasons" data-testid="leftover-reasons">
                {#each leftoverReasons(report, { block: (id) => w.blockNameFor(id), crop: cropNameFor }, page.data?.locale) as reason, ri (ri)}
                  <li>{reason}</li>
                {/each}
              </ul>
              {#if unplacedHasToggle(u)}
                {@render keepToggle(u.cropPluginId)}
              {/if}
            {/if}
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
  .chip-split {
    background: #e3eefb;
    color: #1f4a85;
  }
  .keep-toggle {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 0.9rem;
    margin: 0.25rem 0;
    border: 1px solid var(--color-forest);
    border-radius: 999px;
    background: #fff;
    color: var(--color-forest);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .keep-toggle[aria-pressed='true'] {
    background: var(--color-forest);
    color: #fff;
  }
  .keep-toggle:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .seed-line {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8rem;
    color: #4a5d4a;
  }
  .leftover-reasons {
    margin: 0.35rem 0 0.25rem;
    padding-left: 1.2rem;
    color: #4a5d4a;
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
  .keep-note {
    margin: 0 0 0.5rem;
    color: #4a5d4a;
    font-size: 0.9rem;
  }
  @media (max-width: 560px) {
    .aw-table,
    .aw-table tbody,
    .aw-table tr,
    .aw-table td {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    .aw-table thead {
      display: none;
    }
    .aw-table tr {
      border-bottom: 1px solid #e4e9e4;
      padding: 0.35rem 0;
    }
    .aw-table td {
      border-bottom: none;
      padding: 0.2rem 0.5rem;
    }
    .aw-table td.cell-seed {
      font-weight: 700;
    }
    .aw-table td[data-label]::before {
      content: attr(data-label) ': ';
      font-weight: 600;
      color: var(--color-forest);
    }
    td.cell-fit,
    .why {
      max-width: 100%;
    }
    .chip-sm {
      max-width: 100%;
    }
  }
  .aw-cost {
    color: #6a7d6a;
    font-size: 0.85rem;
    text-align: right;
  }
</style>
