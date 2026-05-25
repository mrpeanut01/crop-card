<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';

  /**
   * Phase 25c (#88) — generic harvest renderer.
   *
   * The archetype-blind path. Renders the same quantity + lot # form
   * used by /harvest before the dispatch primitive existed. After the
   * Phase 25c.0 (#87) discriminator promotion every crop plugin carries
   * a `harvestStyle`, so this renderer is defensive — it only fires
   * for legacy data without a discriminator or for future archetypes
   * the router doesn't know yet.
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
  // Don't destructure `props` — Svelte 5 needs a $derived to keep
  // reactive references current across loader re-runs.
  const harvestIndicators = $derived(props.harvestIndicators);
  const error = $derived(props.error);

  let quantity = $state('');
  let lotNumber = $state('');
  let busy = $state(false);

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    busy = true;
    try {
      await props.onCommit({
        quantity: quantity || undefined,
        lotNumber: lotNumber || undefined
      });
    } finally {
      busy = false;
    }
  }
</script>

<form class="harvest-form" onsubmit={submit}>
  {#if harvestIndicators.length > 0}
    <section class="indicators">
      <h4>Look for…</h4>
      <ul>
        {#each harvestIndicators as ind, i (i)}
          <li>{ind}</li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="row">
    <label for="fb-qty">
      Quantity (optional)
      <Provenance source="manual" compact />
    </label>
    <input
      id="fb-qty"
      type="text"
      bind:value={quantity}
      disabled={busy}
      placeholder="e.g., 12 lb"
    />
  </div>

  <div class="row">
    <label for="fb-lot">
      Lot # (optional)
      <Provenance source="manual" compact />
    </label>
    <input id="fb-lot" type="text" bind:value={lotNumber} disabled={busy} maxlength="80" />
  </div>

  {#if error}
    <p class="error" aria-live="polite">{error}</p>
  {/if}

  <div class="actions">
    <button type="button" class="ghost" onclick={props.onCancel} disabled={busy}>Cancel</button>
    <button type="submit" class="primary" disabled={busy}>
      {busy ? 'Recording…' : 'Record harvest'}
    </button>
  </div>
</form>

<style>
  .harvest-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .indicators {
    background: var(--color-cream);
    border-left: 3px solid var(--color-wheat, #d4a75c);
    border-radius: 4px;
    padding: 10px 14px;
  }
  .indicators h4 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-muted);
  }
  .indicators ul {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    color: var(--color-ink);
    line-height: 1.4;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-ink);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input {
    font-family: inherit;
    font-size: 14px;
    padding: 9px 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    min-height: 40px;
  }
  input:focus {
    outline: 2px solid var(--color-forest-deep);
    outline-offset: 1px;
    border-color: var(--color-forest-deep);
  }
  .error {
    margin: 0;
    color: var(--color-rust, #ba4b38);
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 9px 16px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 13.5px;
    cursor: pointer;
    min-height: 40px;
  }
  .primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 10px 18px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    min-height: 40px;
  }
  .primary:disabled,
  .ghost:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
