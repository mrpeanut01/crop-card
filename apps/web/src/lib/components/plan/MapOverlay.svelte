<script lang="ts">
  /**
   * Plan v2 map overlay: a quick "where am I?" view of the farm, not a
   * geometry editor (that's /settings/farm/map). Fields and blocks draw
   * their real outlines when mapped, or the dimension sketch when entered
   * as width × length. Each block is clickable to jump Plan to it.
   *
   * URL-driven: parent toggles `open` from `?map=open`.
   */
  import { ArrowRight, Info, Compass, MapPin } from 'lucide-svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import { layoutMapOverlay, type OverlayFieldInput } from '$lib/plan/mapOverlayLayout';

  interface Props {
    open: boolean;
    onClose: () => void;
    blocks: BlockWithPlantings[];
    /** Fields with their drawn geometry / dimensions; outlines behind blocks. */
    fields?: OverlayFieldInput[];
    selectedBlockId?: string;
    farmLabel?: string;
    onSelect?: (blockId: string) => void;
  }
  const {
    open,
    onClose,
    blocks,
    fields = [],
    selectedBlockId,
    farmLabel,
    onSelect
  }: Props = $props();

  const selected = $derived(blocks.find((b) => b.id === selectedBlockId));
  const titleText = $derived(
    `${farmLabel ?? 'Field map'}${selected ? ` · ${selected.name} highlighted` : ''}`
  );

  const layout = $derived(layoutMapOverlay(fields, blocks));
  const span = $derived(Math.max(layout.width, layout.height));
  const pad = $derived(span * 0.05);
  const viewBox = $derived(
    `${layout.minX - pad} ${layout.minY - pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`
  );
  const fontSize = $derived(span * 0.032);
  const plantingCount = $derived(new Map(blocks.map((b) => [b.id, b.plantings.length])));

  function pathFor(rings: Array<[number, number]>[]): string {
    return rings
      .map((r) => 'M' + r.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z')
      .join('');
  }

  const PALETTE = ['#7a8f5a', '#c9961f', '#6f8fa8', '#a85a1f', '#4a8b54', '#a23a3a'];
  const blockIndex = $derived(new Map(blocks.map((b, i) => [b.id, i])));
  function colorForBlock(id: string): string {
    return PALETTE[(blockIndex.get(id) ?? 0) % PALETTE.length];
  }

  function pick(id: string) {
    onSelect?.(id);
    onClose();
  }

  function plantingsLabel(id: string): string {
    const n = plantingCount.get(id) ?? 0;
    return `${n} planting${n === 1 ? '' : 's'}`;
  }
</script>

<Modal {open} {onClose} title={titleText}>
  <div class="map-shell">
    {#if blocks.length === 0}
      <div class="empty">
        <MapPin size={20} />
        <p>No blocks yet. Add one in the workflow strip or via the layout editor.</p>
      </div>
    {:else}
      {#if layout.mode === 'none'}
        <div class="empty" data-testid="map-overlay-undrawn">
          <MapPin size={20} />
          <p>
            None of your fields or blocks are drawn yet. Draw them on the map, or enter their width
            and length, in the <a href="/settings/farm/map">fields & blocks editor</a>.
          </p>
        </div>
      {:else}
        <div class="map-canvas">
          <div class="compass" title="North">
            <Compass size={11} />
            <span class="mono">N</span>
          </div>
          <svg
            {viewBox}
            preserveAspectRatio="xMidYMid meet"
            role="group"
            aria-label="Field and block layout{layout.mode === 'sketch'
              ? ', sketched from entered dimensions'
              : ''}"
            data-testid="map-overlay-svg"
          >
            {#each layout.fields as f (f.id)}
              <path class="field" d={pathFor(f.rings)} data-field-id={f.id} />
            {/each}
            {#each layout.blocks as b (b.id)}
              {@const isSel = b.id === selectedBlockId}
              <g
                class="block"
                class:selected={isSel}
                role="button"
                tabindex="0"
                aria-label="{b.name}, {plantingsLabel(b.id)}"
                aria-pressed={isSel}
                data-block-id={b.id}
                onclick={() => pick(b.id)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pick(b.id);
                  }
                }}
              >
                <title>{b.name} · {plantingsLabel(b.id)}</title>
                <path d={pathFor(b.rings)} style:fill={colorForBlock(b.id)} />
              </g>
            {/each}
            {#if layout.fields.length > 1}
              {#each layout.fields as f (f.id)}
                <text
                  class="mo-field-label"
                  x={f.labelX}
                  y={f.topY + fontSize * 0.3}
                  style:font-size="{fontSize * 0.85}px"
                  text-anchor="middle"
                  dominant-baseline="hanging">{f.name}</text
                >
              {/each}
            {/if}
            {#each layout.blocks as b (b.id)}
              <text
                class="mo-block-label"
                class:selected={b.id === selectedBlockId}
                x={b.labelX}
                y={b.labelY}
                style:font-size="{fontSize}px"
                text-anchor="middle"
                dominant-baseline="middle">{b.name}</text
              >
            {/each}
          </svg>
        </div>
      {/if}
      {#if layout.undrawn.length > 0 && layout.mode !== 'none'}
        <div class="undrawn">
          <span class="undrawn-label">Not on the map yet:</span>
          {#each layout.undrawn as u (u.id)}
            <button
              type="button"
              class="chip"
              class:selected={u.id === selectedBlockId}
              onclick={() => pick(u.id)}>{u.name}</button
            >
          {/each}
        </div>
      {/if}
      <div class="footer-hint">
        <Info size={13} />
        <p>
          Click any block to jump there in Plan.
          {#if layout.mode === 'sketch'}
            Positions are packed from the widths and lengths you entered, not surveyed.
          {/if}
          The <a href="/settings/farm/map">fields & blocks editor</a> in Settings is where you draw and
          resize them.
        </p>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <a class="ghost" href="/settings/farm/map" onclick={onClose}>
      Open fields & blocks editor <ArrowRight size={13} />
    </a>
  {/snippet}
</Modal>

<style>
  .map-shell {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 24px;
    color: var(--color-ink-muted);
    text-align: center;
  }
  .empty p {
    margin: 0;
    font-size: 13px;
  }
  .map-canvas {
    position: relative;
    aspect-ratio: 16 / 10;
    max-height: 60vh;
    width: 100%;
    background: linear-gradient(180deg, #e6e1cb 0%, #dad3b5 100%);
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    overflow: hidden;
  }
  .compass {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 2;
    background: var(--color-paper);
    padding: 4px 9px;
    border-radius: 4px;
    font-size: 10px;
    color: var(--color-ink-soft);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--color-divider);
  }
  .map-canvas svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .field {
    fill: rgba(255, 255, 255, 0.35);
    stroke: var(--color-ink-soft);
    stroke-width: 1.5;
    stroke-dasharray: 5 3;
    vector-effect: non-scaling-stroke;
  }
  .block {
    cursor: pointer;
    outline: none;
  }
  .block path {
    opacity: 0.7;
    stroke: rgba(0, 0, 0, 0.35);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    transition: opacity 80ms ease;
  }
  .block:hover path,
  .block:focus-visible path {
    opacity: 0.95;
  }
  .block:focus-visible path {
    stroke: var(--color-forest-deep);
    stroke-width: 3;
  }
  .block.selected path {
    opacity: 1;
    stroke: var(--color-ink);
    stroke-width: 3;
  }
  .mo-block-label,
  .mo-field-label {
    pointer-events: none;
    font-family: inherit;
    paint-order: stroke;
    stroke-linejoin: round;
  }
  .mo-block-label {
    fill: white;
    font-weight: 700;
    stroke: rgba(0, 0, 0, 0.45);
    stroke-width: 0.12em;
  }
  .mo-field-label {
    fill: var(--color-ink-soft);
    font-weight: 600;
    stroke: var(--color-paper);
    stroke-width: 0.2em;
  }
  .undrawn {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--color-ink-muted);
  }
  .chip {
    min-height: 32px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .chip.selected {
    border-color: var(--color-ink);
  }
  .empty a {
    color: var(--color-forest);
    font-weight: 600;
  }
  .footer-hint {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    border-top: 1px dashed var(--color-divider-soft, var(--color-divider));
    padding-top: 10px;
    font-size: 12.5px;
    color: var(--color-ink-muted);
  }
  .footer-hint :global(svg) {
    margin-top: 2px;
    flex-shrink: 0;
  }
  .footer-hint p {
    margin: 0;
    line-height: 1.45;
  }
  .footer-hint a {
    color: var(--color-forest);
    text-decoration: none;
    font-weight: 600;
  }
  .footer-hint a:hover {
    text-decoration: underline;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: transparent;
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
</style>
