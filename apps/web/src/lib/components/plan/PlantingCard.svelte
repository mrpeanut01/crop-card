<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 planting card.
   *
   * 1:1 port of the planting grid card in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * (lines 134–192). Color stripe on top, serif title + italic variety
   * subtitle, status pill on the right, 2-col metadata grid
   * (Role/Stage/Planted/Harvest/Area), optional companions row, and
   * provenance footer (shown when wizard or AI generated this row).
   */
  import { Info, Layers, User, Sprout, ArrowRight, ChevronRight } from 'lucide-svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import type { PlantingRecord } from '$lib/db/blocks';

  export type PlantingSourceTag =
    | 'AI plan'
    | 'Companion AI'
    | 'Carry-forward'
    | 'Manual'
    | 'Perennial';

  interface Props {
    planting: PlantingRecord;
    /** Days-to-maturity from the crop plugin, used to compute harvest hint. */
    daysToMaturity?: number;
    /** Stage label from the calendar engine (e.g., "V8 · pre-tassel"). */
    stage?: string;
    /** Role within the block (e.g., "primary", "companion", "border"). */
    role?: string;
    /** Optional companion plantings in the same block — render their
     *  swatches as click targets. */
    companions?: PlantingRecord[];
    /** Provenance tag — drives the bottom badge color + label. */
    sourceTag?: PlantingSourceTag;
    /** Number of edits / refinement passes. */
    refineCount?: number;
    /** Provenance "seeded at" date string for display. */
    seededAtLabel?: string;
    onCompanionClick?: (plantingId: string) => void;
    onRefine?: () => void;
  }
  const {
    planting,
    daysToMaturity,
    stage,
    role,
    companions = [],
    sourceTag,
    refineCount = 0,
    seededAtLabel,
    onCompanionClick,
    onRefine
  }: Props = $props();

  function plantingColor(plantingId: string): string {
    const PALETTE = [
      '#7a8f5a',
      '#c9961f',
      '#6f8fa8',
      '#a85a1f',
      '#4a8b54',
      '#a23a3a',
      '#8a6722',
      '#7a3a4d'
    ];
    let h = 0;
    for (let i = 0; i < plantingId.length; i++) h = (h * 31 + plantingId.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  const color = $derived(plantingColor(planting.id));
  const plantedLabel = $derived.by(() => {
    if (!planting.plantingDate) return 'planned';
    return new Date(planting.plantingDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  });
  const harvestLabel = $derived.by(() => {
    if (!planting.plantingDate || !daysToMaturity) return '—';
    const ms = planting.plantingDate + daysToMaturity * 24 * 60 * 60 * 1000;
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const areaLabel = $derived.by(() => {
    if (planting.quantityPlanted !== undefined && planting.quantityUnit) {
      return `${planting.quantityPlanted} ${planting.quantityUnit}`;
    }
    return '—';
  });
  const statusLabel = $derived.by(() => {
    if (!planting.plantingDate) return 'planned';
    const now = Date.now();
    const dap = (now - planting.plantingDate) / (24 * 60 * 60 * 1000);
    if (daysToMaturity && dap > daysToMaturity) return 'mature';
    if (dap < 0) return 'planned';
    return 'active';
  });
  const statusTone = $derived<'forest' | 'sky' | 'wheat' | 'rust' | 'neutral'>(
    statusLabel === 'active' ? 'forest' : statusLabel === 'planned' ? 'sky' : 'wheat'
  );

  const sourceMeta = $derived.by(() => {
    if (!sourceTag) return null;
    return {
      'AI plan': { color: 'var(--color-forest)', bg: '#e5eedf', bd: '#c9dbc0', icon: Sprout },
      'Companion AI': {
        color: 'var(--color-wheat-deep, #8a6722)',
        bg: 'var(--color-wheat-soft, #e8d9b5)',
        bd: '#d9c18f',
        icon: Layers
      },
      'Carry-forward': {
        color: 'var(--color-sky, #6f8fa8)',
        bg: '#dee7ef',
        bd: '#bdcdd9',
        icon: ArrowRight
      },
      Manual: {
        color: 'var(--color-ink-soft)',
        bg: 'var(--color-divider-soft, var(--color-divider))',
        bd: 'var(--color-divider)',
        icon: User
      },
      Perennial: { color: 'var(--color-rust)', bg: '#f1d9ce', bd: '#e2b69e', icon: Sprout }
    }[sourceTag];
  });
</script>

<article class="pc">
  <div class="pc-stripe" style:background={color}></div>
  <div class="pc-body">
    <div class="pc-head">
      <div class="pc-title-wrap">
        <div class="serif pc-title">{planting.varietyDisplayName}</div>
        {#if role}
          <div class="pc-sub">{role}</div>
        {/if}
      </div>
      <Pill tone={statusTone}>{statusLabel}</Pill>
    </div>

    <div class="pc-meta">
      {#if role}
        <div class="pc-cell">
          <div class="k">Role</div>
          <div class="v mono">{role}</div>
        </div>
      {/if}
      {#if stage}
        <div class="pc-cell">
          <div class="k">Stage</div>
          <div class="v mono">{stage}</div>
        </div>
      {/if}
      <div class="pc-cell">
        <div class="k">Planted</div>
        <div class="v mono">{plantedLabel}</div>
      </div>
      <div class="pc-cell">
        <div class="k">Harvest</div>
        <div class="v mono">{harvestLabel}</div>
      </div>
      <div class="pc-cell">
        <div class="k">Area</div>
        <div class="v mono">{areaLabel}</div>
      </div>
    </div>

    {#if companions.length > 0}
      <div class="companions">
        <div class="comp-head">
          <Layers size={11} strokeWidth={1.75} />
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

    {#if sourceMeta}
      {@const Icon = sourceMeta.icon}
      <footer class="pc-prov">
        <span
          class="prov-badge"
          style:color={sourceMeta.color}
          style:background={sourceMeta.bg}
          style:border-color={sourceMeta.bd}
        >
          <Icon size={10} strokeWidth={1.75} />
          {sourceTag}
        </span>
        <span class="prov-meta">
          {seededAtLabel ?? ''}
          {#if refineCount > 0}· refined {refineCount}×{/if}
        </span>
        {#if onRefine}
          <button class="refine" onclick={onRefine} type="button">
            Refine
            <ChevronRight size={11} strokeWidth={1.75} />
          </button>
        {/if}
      </footer>
    {:else}
      <footer class="pc-source">
        <Info size={12} strokeWidth={1.75} />
        Manual entry
      </footer>
    {/if}
  </div>
</article>

<style>
  .pc {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .pc-stripe {
    height: 4px;
  }
  .pc-body {
    padding: 16px 18px 14px;
  }
  .pc-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .pc-title-wrap {
    flex: 1;
    min-width: 0;
  }
  .pc-title {
    font-size: 17px;
    color: var(--color-ink);
    letter-spacing: -0.01em;
    line-height: 1.2;
    font-family: var(--font-serif, serif);
  }
  .pc-sub {
    font-size: 12px;
    color: var(--color-ink-muted);
    margin-top: 3px;
    font-style: italic;
  }
  .pc-meta {
    margin-top: 12px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 14px;
  }
  .pc-cell {
    min-width: 0;
  }
  .k {
    font-size: 10px;
    color: var(--color-ink-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .v {
    font-size: 12px;
    color: var(--color-ink);
    margin-top: 2px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .companions {
    margin-top: 12px;
    padding: 8px 10px;
    background: var(--color-wheat-tint, #efe6cc);
    border: 1px dashed #d9c18f;
    border-radius: 6px;
  }
  .comp-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-wheat-deep, #8a6722);
    font-weight: 600;
  }
  .comp-chips {
    margin-top: 5px;
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }
  .comp-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 99px;
    font-size: 11px;
    color: var(--color-ink);
    cursor: pointer;
    font-family: inherit;
  }
  .comp-chip:hover {
    border-color: var(--color-forest-deep);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 99px;
  }
  .pc-source {
    margin-top: 10px;
    font-size: 11.5px;
    color: var(--color-ink-muted);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .pc-prov {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--color-divider-soft, var(--color-divider));
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .prov-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border: 1px solid;
    border-radius: 99px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .prov-meta {
    font-size: 11px;
    color: var(--color-ink-muted);
  }
  .refine {
    margin-left: auto;
    background: transparent;
    border: none;
    color: var(--color-forest);
    font-size: 11.5px;
    font-weight: 600;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    font-family: inherit;
  }
  .refine:hover {
    text-decoration: underline;
  }
</style>
