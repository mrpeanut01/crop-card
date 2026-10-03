<script lang="ts">
  import { Layers, ChevronRight } from 'lucide-svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import type { PlantingRecord } from '$lib/db/blocks';
  import { planPlantingCard, plantingColor, type PlantingSourceTag } from '$lib/plan/planCards';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { withCarryover, type CarryoverLine } from '$lib/farm/areaCarryover';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { cropDisplayName } from '$lib/i18n/cropName';

  interface Props {
    planting: PlantingRecord;
    daysToMaturity?: number;
    cropName?: string;
    /** Stage label from the calendar engine (e.g., "V8 · pre-tassel"). */
    stage?: string;
    /** Engine-derived harvest-window start; wins over the DTM estimate. */
    harvestStart?: string;
    role?: string;
    /** Other plantings in the same block, shown as jump-to chips. */
    companions?: PlantingRecord[];
    sourceTag?: PlantingSourceTag;
    refineCount?: number;
    seededAtLabel?: string;
    onCompanionClick?: (plantingId: string) => void;
    onRefine?: () => void;
    /** Archetype-specific plan view (e.g. /plan/wheat for small grains). */
    detailHref?: string;
    /** 33C after-spread lines on this planting's block (M-47 planting hint). */
    carryover?: readonly CarryoverLine[];
    /** Phase 35: this planting is one part of a seed lot in several blocks. */
    split?: {
      n: number;
      noun: 'beds' | 'blocks';
      others: ReadonlyArray<{ blockId: string; name: string; href: string }>;
    };
    /** Owner only: the farm keeps this crop in one bed in future plans. */
    keepInOneBed?: boolean;
    onToggleKeep?: () => void | Promise<void>;
    keepBusy?: boolean;
    keepError?: string | null;
  }
  const {
    planting,
    daysToMaturity,
    cropName,
    stage,
    harvestStart,
    role,
    companions = [],
    sourceTag,
    refineCount = 0,
    seededAtLabel,
    onCompanionClick,
    onRefine,
    detailHref,
    carryover = [],
    split,
    keepInOneBed = false,
    onToggleKeep,
    keepBusy = false,
    keepError = null
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const card = $derived(
    planPlantingCard({
      planting,
      daysToMaturity,
      cropName,
      stage,
      harvestStart,
      role,
      sourceTag,
      refineCount,
      seededAtLabel,
      detailHref,
      locale: page.data?.locale
    })
  );
  const shown = $derived(withCarryover(card, carryover, { link: true, locale: page.data?.locale }));
</script>

<div class="planting-card" data-testid="planting-card">
  <CardView card={shown} prefs={currentPrefs()} showAsOf={false}>
    {#snippet actions()}
      {#if split && split.n >= 2}
        <div class="split" data-testid="planting-split">
          <p class="split-line">
            {split.noun === 'beds'
              ? tr('plan.split.lineBeds', { n: split.n })
              : tr('plan.split.lineBlocks', { n: split.n })}
          </p>
          {#if split.others.length > 0}
            <p class="split-others">
              {tr('plan.split.alsoIn')}:
              {#each split.others as o, i (o.blockId)}
                <a href={o.href}>{o.name}</a>{i < split.others.length - 1 ? ', ' : ''}
              {/each}
            </p>
          {/if}
          {#if onToggleKeep}
            <button
              type="button"
              class="keep-toggle"
              data-testid="plan-keep-in-one-bed"
              aria-pressed={keepInOneBed}
              disabled={keepBusy}
              onclick={() => void onToggleKeep()}
            >
              {tr('plan.split.keep')}
            </button>
            <p class="split-note">{tr('plan.split.keepNote')}</p>
            {#if keepError}
              <p class="split-error" role="alert">{keepError}</p>
            {/if}
          {/if}
        </div>
      {/if}
      {#if companions.length > 0}
        <div class="companions">
          <div class="comp-head">
            <Layers size={12} strokeWidth={1.75} />
            {tr('planui.pcard.companions')}
          </div>
          <div class="comp-chips">
            {#each companions as c (c.id)}
              <button
                type="button"
                class="comp-chip"
                onclick={() => onCompanionClick?.(c.id)}
                title={tr('planui.pcard.jumpTo', {
                  name: cropDisplayName(c.cropPluginId, c.varietyDisplayName, page.data?.locale)
                })}
              >
                <span class="dot" style:background={plantingColor(c.id)}></span>
                {cropDisplayName(c.cropPluginId, c.varietyDisplayName, page.data?.locale)
                  .split(' ')
                  .slice(0, 2)
                  .join(' ')}
              </button>
            {/each}
          </div>
        </div>
      {/if}
      {#if onRefine}
        <button class="refine" onclick={onRefine} type="button">
          {tr('planui.pcard.refine')}
          <ChevronRight size={14} strokeWidth={1.75} />
        </button>
      {/if}
    {/snippet}
  </CardView>
</div>

<style>
  .planting-card {
    min-width: 0;
  }
  .split {
    padding: 8px 10px;
    background: #eef4fb;
    border: 1px solid #c9daf0;
    border-radius: 6px;
    font-size: 13px;
    color: var(--color-ink);
    overflow-wrap: anywhere;
  }
  .split p {
    margin: 0 0 6px;
  }
  .split-line {
    font-weight: 600;
  }
  .split-note {
    color: var(--color-ink-muted, #5b6b5b);
    font-size: 12px;
  }
  .split-error {
    color: #b22222;
    font-weight: 600;
  }
  .split a {
    display: inline-block;
    min-height: 48px;
    line-height: 48px;
    color: var(--color-forest-deep, #1f4a2f);
  }
  .keep-toggle {
    min-height: 48px;
    padding: 0 12px;
    margin: 0 0 6px;
    border: 1px solid var(--color-forest-deep, #1f4a2f);
    border-radius: 99px;
    background: var(--color-paper, #fff);
    color: var(--color-forest-deep, #1f4a2f);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .keep-toggle[aria-pressed='true'] {
    background: var(--color-forest-deep, #1f4a2f);
    color: #fff;
  }
  .companions {
    padding: 8px 10px;
    background: var(--color-wheat-tint, #efe6cc);
    border: 1px dashed #d9c18f;
    border-radius: 6px;
  }
  .comp-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--pill-wheat-fg, #8a6722);
    font-weight: 600;
  }
  .comp-chips {
    margin-top: 6px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .comp-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 0 12px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 99px;
    font-size: 13px;
    color: var(--color-ink);
    cursor: pointer;
    font-family: inherit;
  }
  .comp-chip:hover {
    border-color: var(--color-forest-deep);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 99px;
  }
  .refine {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 48px;
    padding: 0 12px;
    background: transparent;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    color: var(--color-forest);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .refine:hover {
    text-decoration: underline;
  }
</style>
