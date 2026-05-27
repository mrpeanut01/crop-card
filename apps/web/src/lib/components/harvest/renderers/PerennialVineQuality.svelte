<script lang="ts">
  import { Grape } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';
  import type { RendererData } from '../HarvestRouter.svelte';

  /**
   * Sprint 9 / Phase 27E (#180) — perennial vine quality renderer.
   *
   * Grape (wine, table, juice), hops, kiwi. Quality-anchored single
   * harvest window — for wine grapes that means Brix + pH + TA at the
   * cultivar target. Hops harvest at aroma-cone shatter test.
   *
   * The plugin schema does not yet carry vine-quality targets as a
   * first-class field (`qualityTargets: { brixMin, phRange, taRange }`
   * lands in Phase 28). For Sprint 9 we expose three structured input
   * slots (Brix, pH, TA) that the operator fills against their own
   * tasting / lab notes; the values are persisted into the harvest
   * event's `lotNumber` slot as a packed quality tag so vintage tracking
   * has the agronomic context now. When the schema field lands, the
   * inputs will be pre-populated and the field-label badges will go
   * `from-plugin` instead of `manual`.
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

  let brix = $state('');
  let phReading = $state('');
  let ta = $state('');

  async function handleCommit(input: { quantity?: string; lotNumber?: string }) {
    const qualityBits: string[] = [];
    if (brix.trim()) qualityBits.push(`Brix=${brix.trim()}`);
    if (phReading.trim()) qualityBits.push(`pH=${phReading.trim()}`);
    if (ta.trim()) qualityBits.push(`TA=${ta.trim()}`);
    const lot = [input.lotNumber, qualityBits.join(' / ')].filter(Boolean).join(' · ').trim();
    return props.onCommit({
      quantity: input.quantity,
      lotNumber: lot || undefined
    });
  }
</script>

<div class="vine-renderer">
  <header class="archetype-head">
    <Grape size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Perennial-vine quality harvest</span>
      <span class="archetype-sub">
        Quality-anchored single window. Record Brix / pH / TA — vintage tracking + buyer payments
        rely on it.
      </span>
    </div>
  </header>

  <div class="quality-block">
    <span class="block-title">Quality at pick (logged into harvest record)</span>
    <div class="quality-grid">
      <label class="qfield">
        <span>Brix</span>
        <input
          type="text"
          inputmode="decimal"
          placeholder="22.5°"
          bind:value={brix}
          aria-label="Brix reading at harvest"
        />
      </label>
      <label class="qfield">
        <span>pH</span>
        <input
          type="text"
          inputmode="decimal"
          placeholder="3.45"
          bind:value={phReading}
          aria-label="pH reading at harvest"
        />
      </label>
      <label class="qfield">
        <span>TA (g/L)</span>
        <input
          type="text"
          inputmode="decimal"
          placeholder="6.5"
          bind:value={ta}
          aria-label="Titratable acidity reading at harvest"
        />
      </label>
    </div>
    <p class="hint">
      Wine grapes target: Brix 22–25, pH 3.2–3.6, TA 6–9 g/L. Tune to varietal + style. Hops: log
      dry-matter %.
    </p>
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
    onCommit={handleCommit}
    error={props.error}
    onCancel={props.onCancel}
  />
</div>

<style>
  .vine-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(126, 78, 138, 0.14);
    border-left: 3px solid #6a3f7d;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #6a3f7d;
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
  .quality-block {
    background: var(--color-cream, #fff8e1);
    border: 1px solid rgba(126, 78, 138, 0.35);
    border-radius: 4px;
    padding: 10px 12px;
  }
  .block-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--color-ink);
  }
  .quality-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 8px 0;
  }
  .qfield {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .qfield input {
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 3px;
    padding: 6px 8px;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 13px;
  }
  .qfield input:focus {
    outline: 2px solid #6a3f7d;
    outline-offset: 1px;
  }
  .hint {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--color-ink-soft);
    font-style: italic;
    line-height: 1.3;
  }
  @media (max-width: 480px) {
    .quality-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
