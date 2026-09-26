<script lang="ts">
  import { Layers, ChevronRight } from 'lucide-svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import type { PlantingRecord } from '$lib/db/blocks';
  import { planPlantingCard, plantingColor, type PlantingSourceTag } from '$lib/plan/planCards';
  import { currentPrefs } from '$lib/prefsState.svelte';

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
    detailHref
  }: Props = $props();

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
      detailHref
    })
  );
</script>

<div class="planting-card" data-testid="planting-card">
  <CardView {card} prefs={currentPrefs()} showAsOf={false}>
    {#snippet actions()}
      {#if companions.length > 0}
        <div class="companions">
          <div class="comp-head">
            <Layers size={12} strokeWidth={1.75} />
            Companions in this block
          </div>
          <div class="comp-chips">
            {#each companions as c (c.id)}
              <button
                type="button"
                class="comp-chip"
                onclick={() => onCompanionClick?.(c.id)}
                title="Jump to {c.varietyDisplayName}"
              >
                <span class="dot" style:background={plantingColor(c.id)}></span>
                {c.varietyDisplayName.split(' ').slice(0, 2).join(' ')}
              </button>
            {/each}
          </div>
        </div>
      {/if}
      {#if onRefine}
        <button class="refine" onclick={onRefine} type="button">
          Refine
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
