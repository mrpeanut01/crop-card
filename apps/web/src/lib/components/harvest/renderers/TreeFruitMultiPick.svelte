<script lang="ts">
  import { TreeDeciduous } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererData } from '../HarvestRouter.svelte';

  /**
   * Sprint 9 / Phase 27E (#181) — tree-fruit multi-pick renderer.
   *
   * Apple, pear, stone-fruit (peach, plum, cherry). Multiple ripening
   * passes per orchard — pickers walk the block 2-4 times across a
   * 2-3 week window picking only what's at color/firmness target.
   *
   * Enrichment:
   *   • prior-pick count comes from `rendererData.priorPickCount`
   *     (built server-side in /harvest +page.server.ts by counting
   *     harvest events for this (blockId, cropPluginId) pair). Shown
   *     as a "Pick N" badge so the operator knows which pass this is.
   *   • A typical-pass guidance hint (3-pass apple, 2-pass peach)
   *     keyed by cropFamily. The plugin schema does not yet carry
   *     per-cultivar pick-pass counts (Phase 28 lift); the renderer
   *     surfaces a structured timeline anchored on the prior-pick log.
   */

  interface Props {
    plantingId: string;
    blockId: string;
    blockName: string;
    cropPluginId: string;
    varietyDisplayName: string;
    cropFamily?: string;
    plantingDate: number | null;
    windowStartMs?: number;
    windowEndMs?: number;
    harvestIndicators: string[];
    onCommit: (input: { quantity?: string; lotNumber?: string }) => Promise<string | null>;
    error?: string | null;
    onCancel: () => void;
    rendererData?: RendererData;
  }

  const props: Props = $props();

  /** Family-keyed pass-count guidance until Phase 28 lifts this onto
   *  the plugin schema. Apples = 3 passes (early/peak/late), pears = 2,
   *  stone fruit = 2 (with cherry effectively 1). */
  const FAMILY_PASS_GUIDANCE: Record<string, { typical: number; spreadDays: number; note: string }> = {
    pome: { typical: 3, spreadDays: 21, note: 'Pick over 3 passes ~7 days apart.' },
    'stone-fruit': { typical: 2, spreadDays: 10, note: 'Two passes, ~5 days apart by color.' },
    bramble: { typical: 4, spreadDays: 21, note: 'Pick every 3–5 days through the window.' }
  };

  const priorPicks = $derived(props.rendererData?.priorPickCount ?? 0);
  const guidance = $derived(
    props.cropFamily ? FAMILY_PASS_GUIDANCE[props.cropFamily] : undefined
  );
  const currentPick = $derived(priorPicks + 1);
</script>

<div class="tree-renderer">
  <header class="archetype-head">
    <TreeDeciduous size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Tree-fruit multi-pick harvest</span>
      <span class="archetype-sub">
        Multiple ripening passes — pick only what's at color/firmness target each pass. Record this
        pass's yield; the planting stays open across the window.
      </span>
    </div>
  </header>

  <div class="pick-timeline">
    <div class="pick-head">
      <span class="pick-badge mono">Pick {currentPick}{guidance ? ` of ~${guidance.typical}` : ''}</span>
      {#if guidance}
        <span class="pick-note">{guidance.note}</span>
      {/if}
    </div>
    {#if guidance && guidance.typical > 1}
      <ol class="pass-list">
        {#each Array(guidance.typical) as _, i (i)}
          {@const passNum = i + 1}
          {@const isDone = passNum < currentPick}
          {@const isNow = passNum === currentPick}
          <li class:done={isDone} class:now={isNow}>
            <span class="pass-num mono">#{passNum}</span>
            <span class="pass-state">
              {#if isDone}logged{:else if isNow}this pass{:else}upcoming{/if}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </div>

  <FallbackHarvestRenderer
    plantingId={props.plantingId}
    blockId={props.blockId}
    blockName={props.blockName}
    cropPluginId={props.cropPluginId}
    varietyDisplayName={props.varietyDisplayName}
    cropFamily={props.cropFamily}
    plantingDate={props.plantingDate}
    windowStartMs={props.windowStartMs}
    windowEndMs={props.windowEndMs}
    harvestIndicators={props.harvestIndicators}
    onCommit={props.onCommit}
    error={props.error}
    onCancel={props.onCancel}
  />
</div>

<style>
  .tree-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(214, 92, 64, 0.14);
    border-left: 3px solid #c75634;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #c75634;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .archetype-head > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .archetype-name {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .archetype-sub {
    font-size: 12px;
    color: var(--color-ink-soft);
    line-height: 1.35;
  }
  .pick-timeline {
    background: var(--color-cream, #fff8e1);
    border: 1px solid rgba(199, 86, 52, 0.35);
    border-radius: 4px;
    padding: 8px 12px;
  }
  .pick-head {
    display: flex;
    gap: 10px;
    align-items: baseline;
    margin-bottom: 6px;
  }
  .pick-badge {
    background: #c75634;
    color: white;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .pick-note {
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .pass-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pass-list li {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-ink-soft);
    padding: 3px 6px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.04);
  }
  .pass-list li.done {
    background: rgba(31, 94, 58, 0.18);
    color: var(--color-forest-deep, #1f3522);
    text-decoration: line-through;
  }
  .pass-list li.now {
    background: #c75634;
    color: white;
    font-weight: 700;
  }
  .pass-num {
    font-weight: 700;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
</style>
