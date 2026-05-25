<script lang="ts">
  /**
   * Phase 25b (#85) — herbicide /spray context strip.
   *
   * 1:1 port of the context strip in ASprayScreen at
   * [`direction-almanac-rest.jsx`](../../../../docs/design/almanac/direction-almanac-rest.jsx)
   * (lines 264–342). Single A_Card with a 4-column header
   * (Blocks · Crop · Stage · Target weeds) and a green compatibility
   * banner below indicating whether the kernel approves the
   * combination.
   *
   * Read-only: this is a summary derived from selections elsewhere
   * on the page. The "+ Add block" button on the Blocks cell emits
   * `onAddBlock` so the parent can scroll to its block selector.
   */
  import { Sprout, Layers, Compass, CheckCircle2, AlertTriangle, Map as MapIcon, Plus } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';

  export type CompatibilityTone = 'forest' | 'wheat' | 'rust';
  export interface CompatibilityState {
    label: string;
    /** Reason copy on hover ("Why is this allowed?"). */
    reason?: string;
    tone: CompatibilityTone;
  }
  export interface SprayContextBlock {
    id: string;
    /** Short label that renders inside the chip ("A" not "Block A"). */
    label: string;
    acres: number;
    /** Hex/CSS color for the leading dot. */
    color?: string;
  }
  export interface SprayContextTarget {
    name: string;
    /** "light" | "heavy" — drives the chip tone. */
    pressure?: 'light' | 'heavy';
  }

  interface Props {
    blocks: SprayContextBlock[];
    cropLabel: string;
    cropSubtitle?: string;
    stageLabel?: string;
    stageHint?: string;
    targets?: SprayContextTarget[];
    compatibility?: CompatibilityState;
    onAddBlock?: () => void;
    onChangeSelection?: () => void;
  }
  const {
    blocks,
    cropLabel,
    cropSubtitle,
    stageLabel,
    stageHint,
    targets = [],
    compatibility,
    onAddBlock,
    onChangeSelection
  }: Props = $props();

  const totalAc = $derived(blocks.reduce((sum, b) => sum + (b.acres ?? 0), 0));
  const primaryTargets = $derived(targets.filter((t) => t.pressure === 'heavy'));
  const otherTargets = $derived(targets.filter((t) => t.pressure !== 'heavy'));
</script>

<Card padded={false}>
  <div class="cs-grid">
    <div class="cs-cell">
      <div class="cs-k">
        <MapIcon size={12} strokeWidth={1.75} />
        {blocks.length === 1 ? 'Block' : `Blocks · ${blocks.length}`}
      </div>
      {#if blocks.length === 0}
        <div class="cs-empty">No block selected yet</div>
      {:else if blocks.length === 1}
        <div class="cs-line">
          {blocks[0].label} · <span class="mono">{totalAc.toFixed(1)} ac</span>
        </div>
      {:else}
        <div class="cs-line strong">
          <span class="mono">{totalAc.toFixed(1)} ac</span> combined
        </div>
        <div class="cs-chips">
          {#each blocks as b (b.id)}
            <span class="chip" title="{b.label} — {b.acres} ac">
              {#if b.color}
                <span class="dot" style:background={b.color}></span>
              {/if}
              {b.label.replace(/^Block /, '')}
              <span class="chip-acres mono">{b.acres}ac</span>
            </span>
          {/each}
          {#if onAddBlock}
            <button class="chip dashed" onclick={onAddBlock} type="button">
              <Plus size={9} strokeWidth={2.5} />
              Add block
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="cs-cell">
      <div class="cs-k">
        <Sprout size={12} strokeWidth={1.75} />
        Crop
      </div>
      <div class="cs-line">{cropLabel || '—'}</div>
      {#if cropSubtitle}
        <div class="cs-sub">{cropSubtitle}</div>
      {/if}
    </div>

    <div class="cs-cell">
      <div class="cs-k">
        <Layers size={12} strokeWidth={1.75} />
        Stage
      </div>
      <div class="cs-line">{stageLabel || '—'}</div>
      {#if stageHint}
        <div class="cs-sub">{stageHint}</div>
      {/if}
    </div>

    <div class="cs-cell">
      <div class="cs-k">
        <Compass size={12} strokeWidth={1.75} />
        Target weeds{#if targets.length > 0} · {targets.length}{/if}
      </div>
      {#if targets.length === 0}
        <div class="cs-empty">—</div>
      {:else}
        <div class="cs-chips">
          {#each primaryTargets as t (t.name)}
            <span class="chip warn">{t.name.split(' ')[0]}</span>
          {/each}
          {#each otherTargets.slice(0, 2) as t (t.name)}
            <span class="chip wheat">{t.name.split(' ')[0]}</span>
          {/each}
          {#if otherTargets.length > 2}
            <span class="chip dashed">+ {otherTargets.length - 2} more</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if compatibility}
    <div class="cs-banner tone-{compatibility.tone}">
      {#if compatibility.tone === 'forest'}
        <CheckCircle2 size={15} strokeWidth={1.75} />
      {:else}
        <AlertTriangle size={15} strokeWidth={1.75} />
      {/if}
      <span>
        <strong>{compatibility.label}.</strong>
        {#if compatibility.reason}
          <span class="why" title={compatibility.reason}>Why?</span>
        {/if}
      </span>
      {#if onChangeSelection}
        <button class="change" onclick={onChangeSelection} type="button">
          Change selection →
        </button>
      {/if}
    </div>
  {/if}
</Card>

<style>
  .cs-grid {
    display: grid;
    grid-template-columns: 1.3fr 1fr 1fr 1.3fr;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .cs-cell {
    padding: 16px 18px;
    border-right: 1px solid var(--color-divider-soft, var(--color-divider));
    min-width: 0;
  }
  .cs-cell:last-child {
    border-right: none;
  }
  .cs-k {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-ink-muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .cs-line {
    font-size: 14px;
    color: var(--color-ink);
    margin-top: 4px;
  }
  .cs-line.strong {
    font-weight: 500;
  }
  .cs-sub {
    font-size: 11.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }
  .cs-empty {
    font-size: 13px;
    color: var(--color-ink-muted);
    margin-top: 4px;
    font-style: italic;
  }
  .cs-chips {
    margin-top: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 99px;
    font-size: 11px;
    color: var(--color-ink);
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    font-family: inherit;
    cursor: default;
  }
  .chip button {
    cursor: pointer;
  }
  .chip.warn {
    background: #f1d9ce;
    border-color: #e2b69e;
    color: #8a341b;
    font-weight: 500;
  }
  .chip.wheat {
    background: var(--color-wheat-soft, #e8d9b5);
    border-color: #d9c18f;
    color: #8a6722;
    font-weight: 500;
  }
  .chip.dashed {
    border-style: dashed;
    color: var(--color-forest);
    font-weight: 600;
    cursor: pointer;
    background: transparent;
  }
  .chip-acres {
    color: var(--color-ink-muted);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 10px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 2px;
  }
  .cs-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    font-size: 12.5px;
  }
  .cs-banner.tone-forest {
    background: #eff6e9;
    color: var(--color-forest-deep);
  }
  .cs-banner.tone-wheat {
    background: var(--color-wheat-soft, #e8d9b5);
    color: var(--color-wheat-deep, #8a6722);
  }
  .cs-banner.tone-rust {
    background: #f1d9ce;
    color: #8a341b;
  }
  .why {
    color: var(--color-ink-soft);
    text-decoration: underline dotted;
    cursor: help;
    margin-left: 6px;
  }
  .change {
    margin-left: auto;
    color: var(--color-forest);
    background: transparent;
    border: none;
    font-weight: 600;
    cursor: pointer;
    font-size: 12.5px;
    font-family: inherit;
  }
  @media (max-width: 760px) {
    .cs-grid {
      grid-template-columns: 1fr 1fr;
    }
    .cs-cell {
      border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
    }
  }
</style>
