<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 block-header bar.
   *
   * 1:1 port of the block-header in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * (lines 88–111). Kicker line ("Block · 0.8 ac · 2 plantings") + serif
   * h1 ("Block A — Bloody Butcher corn") + pill stack + action button
   * cluster (View on map · Refine with AI · Edit block · Add planting).
   *
   * Action callbacks all optional — parent wires them to whatever
   * legacy flows /plan still owns. Provided as buttons (not anchors)
   * so the consumer can route them however it likes (navigate, open
   * a Modal, etc.).
   */
  import { Map, MapPin, Sprout, Wrench, Plus, Layers } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import { fmt } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    block: BlockWithPlantings;
    /** Optional: shows the harvest-window summary pill when known. */
    harvestWindowLabel?: string;
    /** Status pill content + tone. */
    statusLabel?: string;
    statusTone?: 'forest' | 'wheat' | 'rust' | 'sky' | 'neutral';
    /** Where the "No map geometry" pill links (the farm-map editor).
     *  Omitted for roles that can't edit geometry — the pill still shows. */
    geometryEditHref?: string;
    /** Optional action handlers. Buttons hide when handler is null. */
    onOpenMap?: () => void;
    onRefineWithAi?: () => void;
    onEditBlock?: () => void;
    /** Show "ask the owner" in place of the edit controls. */
    askOwner?: boolean;
    onAddPlanting?: () => void;
  }
  const {
    block,
    harvestWindowLabel,
    statusLabel,
    statusTone = 'forest',
    geometryEditHref,
    onOpenMap,
    onRefineWithAi,
    onEditBlock,
    askOwner = false,
    onAddPlanting
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const isPoly = $derived(block.plantings.length > 1);
  const geometryMissing = $derived(!block.geometryGeojson);
  const geometryNote = $derived(tr('planui.bh.geoNote'));
  const cropSummary = $derived.by(() => {
    if (block.plantings.length === 0) return tr('planui.bh.noPlantings');
    if (block.plantings.length === 1) return block.plantings[0].varietyDisplayName;
    return tr('planui.bh.plantingsSummary', {
      count: block.plantings.length,
      names: block.plantings
        .slice(0, 2)
        .map((p) => p.varietyDisplayName)
        .join(', ')
    });
  });
  const kickerText = $derived.by(() => {
    const ac = block.acres !== undefined ? fmt.area(block.acres) : tr('planui.bh.noAcres');
    const polyLabel = isPoly
      ? tr('planui.bh.plantingsCount', { count: block.plantings.length })
      : block.plantings.length === 1
        ? tr('planui.bh.single')
        : tr('planui.bh.empty');
    return tr('planui.bh.kicker', { area: ac, label: polyLabel });
  });
</script>

<header class="bh">
  <div class="bh-left">
    <Kicker>{kickerText}</Kicker>
    <h1 class="serif title">
      {block.name} <span class="dash">—</span>
      <span class="crop-name">{cropSummary}</span>
    </h1>
    <div class="pills">
      {#if isPoly}
        <Pill tone="forest">
          <Layers size={10} strokeWidth={1.75} />
          {tr('planui.bh.polyculture')}
        </Pill>
      {/if}
      {#if block.acres !== undefined}
        <Pill tone="neutral">{fmt.area(block.acres)}</Pill>
      {/if}
      {#if geometryMissing}
        {#if geometryEditHref}
          <a
            class="geo-link"
            href={geometryEditHref}
            title="{geometryNote} {tr('planui.bh.geoDraw')}"
            data-testid="geometry-missing"
          >
            <Pill tone="wheat">
              <MapPin size={10} strokeWidth={1.75} aria-hidden="true" />
              {tr('planui.bh.noGeometry')}
            </Pill>
          </a>
        {:else}
          <span
            class="geo-static"
            title="{geometryNote} {tr('planui.bh.geoOwner')}"
            data-testid="geometry-missing"
          >
            <Pill tone="wheat">
              <MapPin size={10} strokeWidth={1.75} aria-hidden="true" />
              {tr('planui.bh.noGeometry')}
            </Pill>
          </span>
        {/if}
      {/if}
      {#if harvestWindowLabel}
        <Pill tone="wheat">{tr('planui.bh.harvest', { label: harvestWindowLabel })}</Pill>
      {/if}
      {#if statusLabel}
        <Pill tone={statusTone}>{statusLabel}</Pill>
      {/if}
    </div>
  </div>
  <div class="bh-actions">
    {#if onOpenMap}
      <button class="ghost" onclick={onOpenMap} title={tr('planui.bh.viewMapTitle')}>
        <Map size={14} strokeWidth={1.75} />
        {tr('planui.bh.viewMap')}
      </button>
    {/if}
    {#if onRefineWithAi}
      <button class="ghost" onclick={onRefineWithAi} title={tr('planui.bh.refineTitle')}>
        <Sprout size={14} strokeWidth={1.75} />
        {tr('planui.bh.refine')}
      </button>
    {/if}
    {#if onEditBlock}
      <button class="ghost" onclick={onEditBlock}>
        <Wrench size={14} strokeWidth={1.75} />
        {tr('planui.bh.editBlock')}
      </button>
    {:else if askOwner}
      <p class="ask-owner" data-testid="plan-ask-owner">{tr('planui.bh.askOwner')}</p>
    {/if}
    {#if onAddPlanting}
      <button class="primary" onclick={onAddPlanting} data-hint-anchor="plan_first_crop">
        <Plus size={14} strokeWidth={1.75} />
        {tr('planui.bh.addPlanting')}
      </button>
    {/if}
  </div>
</header>

<style>
  .ask-owner {
    margin: 0;
    align-self: center;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .bh {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 18px;
    gap: 16px;
    flex-wrap: wrap;
  }
  .bh-left {
    flex: 1;
    min-width: 0;
  }
  .title {
    margin: 6px 0 0;
    font-size: 30px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
    line-height: 1.1;
    font-family: var(--font-serif, serif);
  }
  .dash {
    color: var(--color-ink-muted);
    font-weight: 400;
  }
  .crop-name {
    color: var(--color-ink-soft);
    font-weight: 500;
  }
  .pills {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .bh-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 1;
    min-width: 0;
    flex-wrap: wrap;
  }
  .geo-link,
  .geo-static {
    display: inline-flex;
    align-items: center;
  }
  .geo-link {
    min-height: 48px;
    text-decoration: none;
    border-radius: var(--radius-pill);
  }
  .geo-link:hover :global(.pill) {
    border-color: var(--color-forest-deep);
  }
  .geo-link:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .ghost,
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 8px 14px;
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    border: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-forest-deep);
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
    background: var(--color-cream);
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border-color: var(--color-forest);
  }
  .primary:hover {
    background: var(--color-forest-deep);
    border-color: var(--color-forest-deep);
  }
  @media (max-width: 700px) {
    .title {
      font-size: 24px;
    }
    .bh-actions {
      flex-shrink: 1;
      min-width: 0;
    }
  }
</style>
