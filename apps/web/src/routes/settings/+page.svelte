<script lang="ts">
  let { data } = $props();

  let confirmText = $state('');
  let keepEquipment = $state(false);
  let keepWeatherCache = $state(true);
  let busy = $state(false);
  let result = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function wipe() {
    busy = true;
    error = null;
    result = null;
    try {
      const res = await fetch('/api/admin/wipe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirm: confirmText,
          keepEquipment,
          keepWeatherCache
        })
      });
      const out = await res.json();
      if (!res.ok) {
        error = out.error ?? 'wipe failed';
        return;
      }
      const summary = Object.entries(out.removed)
        .filter(([, n]) => (n as number) > 0)
        .map(([k, n]) => `${k}: ${n}`)
        .join(', ');
      result = `Wiped — ${summary || 'nothing to remove'}`;
      confirmText = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<h1>Settings</h1>

<section class="card">
  <h2>Current state</h2>
  <dl>
    <dt>Blocks</dt>
    <dd>{data.counts.blocks}</dd>
    <dt>Crops (all statuses)</dt>
    <dd>{data.counts.crops}</dd>
    <dt>Equipment</dt>
    <dd>{data.counts.equipment}</dd>
    <dt>Stock SKUs</dt>
    <dd>{data.counts.stockItems}</dd>
  </dl>
</section>

{#if !data.isOwner}
  <section class="card warn">
    <p>The wipe affordance is owner-only. Sign in as an owner role to use it.</p>
  </section>
{:else}
  <section class="card danger">
    <h2>Danger zone — wipe all farm data</h2>
    <p class="lede">
      Deletes every block, crop, event (spray / harvest / insecticide / hay / fertility), task, soil
      test, fertility credit, stock SKU + lot + movement, and (by default) every equipment row +
      sprayer. Plugins on disk and your user account are preserved.
    </p>
    <p class="lede">
      Type <code>WIPE-EVERYTHING</code> below to enable the button.
    </p>
    <label>
      Confirmation
      <input type="text" bind:value={confirmText} placeholder="WIPE-EVERYTHING" />
    </label>
    <label class="checkbox">
      <input type="checkbox" bind:checked={keepEquipment} />
      Keep equipment + sprayers (only data resets — calibration setup stays)
    </label>
    <label class="checkbox">
      <input type="checkbox" bind:checked={keepWeatherCache} />
      Keep NOAA forecast cache (saves a refetch round-trip)
    </label>
    <button
      class="primary danger"
      on:click={wipe}
      disabled={busy || confirmText !== 'WIPE-EVERYTHING'}
    >
      {busy ? 'Wiping…' : '🗑 Wipe all farm data'}
    </button>
    {#if result}<p class="success">{result}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </section>
{/if}

<style>
  .card {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card.warn {
    background: #fff8e1;
    border-left: 4px solid #b35900;
  }
  .card.danger {
    background: #fff5f5;
    border-left: 4px solid #b00020;
  }
  .lede {
    color: #555;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
  }
  dt {
    color: #666;
    font-size: 0.85rem;
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }
  label.checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
  input[type='text'] {
    padding: 0.55rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    font-family: ui-monospace, Menlo, Monaco, monospace;
  }
  .primary.danger {
    background: #b00020;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.9rem 1.5rem;
    font-weight: 700;
    cursor: pointer;
    min-height: 56px;
    font-size: 1rem;
  }
  .primary.danger:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .success {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.7rem;
    border-radius: 4px;
    margin-top: 0.75rem;
  }
  .error {
    background: #fce4e4;
    color: #b00020;
    padding: 0.7rem;
    border-radius: 4px;
    margin-top: 0.75rem;
  }
  code {
    background: #f5f7f4;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-family: ui-monospace, Menlo, Monaco, monospace;
  }
</style>
