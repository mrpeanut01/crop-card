<script lang="ts">
  import { Package } from 'lucide-svelte';
  import FallbackHarvestRenderer from './FallbackHarvestRenderer.svelte';

  /**
   * Phase 25c (#88) — winter-squash cure-then-store renderer.
   *
   * Pumpkin (sugar pie, jack-o-lantern, butterkin, queensland blue),
   * butternut, acorn, kabocha, delicata, hubbard, spaghetti, sweet
   * dumpling, luffa. Field-cure 10-14 days at 80-85°F to harden the
   * rind, then store at 50-55°F / 50-70% RH. The kicker reminds the
   * operator that bin yield is the cured weight after cull — record
   * field-pick weight here, log cull separately.
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
  }

  const props: Props = $props();
</script>

<div class="cure-renderer">
  <header class="archetype-head">
    <Package size={18} strokeWidth={1.75} />
    <div>
      <span class="archetype-name">Cure-then-store harvest</span>
      <span class="archetype-sub">
        Field-cure 10-14 days at 80-85°F before storing at 50-55°F. Record field-pick weight here;
        log cull + cured weight separately.
      </span>
    </div>
  </header>

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
  .cure-renderer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .archetype-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(186, 130, 60, 0.14);
    border-left: 3px solid #b86d2e;
    border-radius: 4px;
    color: var(--color-ink);
  }
  .archetype-head :global(svg) {
    color: #b86d2e;
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
</style>
