<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PlantingHarvestStatus } from './+page.server';

  let { data } = $props();

  let recordingFor = $state<string | null>(data.focusPlantingId ?? null);
  let quantity = $state('');
  let lotNumber = $state('');
  let recordError = $state<string | null>(null);

  onMount(async () => {
    if (data.focusPlantingId) {
      await tick();
      const el = document.getElementById(`planting-${data.focusPlantingId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  function startRecord(plantingId: string) {
    recordingFor = plantingId;
    quantity = '';
    lotNumber = '';
    recordError = null;
  }

  function cancelRecord() {
    recordingFor = null;
  }

  async function submitRecord(planting: PlantingHarvestStatus) {
    recordError = null;
    try {
      const res = await fetch('/api/harvest/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockId: planting.blockId,
          cropPluginId: planting.cropPluginId,
          quantity: quantity || undefined,
          lotNumber: lotNumber || undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        recordError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      recordingFor = null;
      await invalidateAll();
    } catch (e) {
      recordError = e instanceof Error ? e.message : String(e);
    }
  }

  function fmtRange(startMs?: number, endMs?: number) {
    if (!startMs || !endMs) return 'unknown';
    const a = new Date(startMs).toLocaleDateString();
    const b = new Date(endMs).toLocaleDateString();
    return `${a} – ${b}`;
  }
</script>

<h1>Harvest</h1>
<p class="lede">
  Each planting's harvest window is computed from the crop plugin's
  days-to-maturity. Walk the block, check readiness against the indicators,
  and record the harvest with optional lot number for traceability.
</p>

{#if data.plantings.length === 0}
  <section class="card empty">
    <h2>No plantings yet</h2>
    <p>Add a planting on <a href="/plan">/plan</a> first.</p>
  </section>
{:else}
  <section class="card">
    <h2>Plantings</h2>
    <ul class="plantings">
      {#each data.plantings as p (p.plantingId)}
        <li
          id="planting-{p.plantingId}"
          class="planting status-{p.status}"
          class:harvested={p.alreadyHarvested}
          class:focused={data.focusPlantingId === p.plantingId}
        >
          <header>
            <strong>{p.varietyDisplayName}</strong>
            <span class="block">{p.blockName}</span>
            {#if p.cropFamily}
              <span class="family">{p.cropFamily}</span>
            {/if}
            {#if p.alreadyHarvested}
              <span class="badge harvested">✓ harvested</span>
            {:else if p.status === 'in-window'}
              <span class="badge in-window">⛏ ready now</span>
            {:else if p.status === 'past'}
              <span class="badge past">⚠ past window</span>
            {:else if p.status === 'too-early'}
              <span class="badge too-early">⏳ too early</span>
            {/if}
          </header>
          <div class="meta">
            Planted {new Date(p.plantingDate).toLocaleDateString()} ·
            Window {fmtRange(p.windowStartMs, p.windowEndMs)}
            {#if p.status === 'too-early'}· {p.daysUntilWindow}d until window{/if}
            {#if p.status === 'in-window'}· {p.daysIntoWindow}d into window{/if}
            {#if p.status === 'past'}· {p.daysPastWindow}d past{/if}
          </div>

          {#if p.harvestIndicators.length > 0}
            <details>
              <summary>Readiness indicators</summary>
              <ul class="indicators">
                {#each p.harvestIndicators as ind}<li>{ind}</li>{/each}
              </ul>
            </details>
          {/if}

          {#if recordingFor === p.plantingId}
            <form class="record-form" onsubmit={(e) => { e.preventDefault(); submitRecord(p); }}>
              <label>
                Quantity
                <input type="text" placeholder="e.g. 14 bushels" bind:value={quantity} />
              </label>
              <label>
                Lot number
                <input type="text" placeholder="e.g. 2026-A-7" bind:value={lotNumber} />
              </label>
              <div class="actions">
                <button type="submit" class="primary">Record harvest</button>
                <button type="button" onclick={cancelRecord}>Cancel</button>
              </div>
              {#if recordError}<p class="error">{recordError}</p>{/if}
            </form>
          {:else if !p.alreadyHarvested}
            <button class="primary" onclick={() => startRecord(p.plantingId)}>
              Record harvest
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if data.recordedHarvests.length > 0}
  <section class="card">
    <h2>Recorded harvests</h2>
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Block</th>
          <th>Variety</th>
          <th>Quantity</th>
          <th>Lot</th>
        </tr>
      </thead>
      <tbody>
        {#each data.recordedHarvests as h (h.id)}
          <tr>
            <td>{new Date(h.occurredAt).toLocaleDateString()}</td>
            <td><code>{h.blockId.slice(0, 8)}…</code></td>
            <td><code>{h.cropPluginId}</code></td>
            <td>{h.quantity ?? '—'}</td>
            <td>{h.lotNumber ?? '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  h1 { margin: 0 0 0.25rem; }
  .lede { color: #555; margin: 0 0 1.5rem; }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .empty { text-align: center; padding: 2rem; }
  .plantings { list-style: none; padding: 0; margin: 0; }
  .planting {
    border-left: 4px solid #ccc;
    background: #fafbfa;
    padding: 0.75rem 1rem;
    margin: 0.5rem 0;
    border-radius: 0 4px 4px 0;
  }
  .planting.status-in-window { border-left-color: #1f5e3a; background: #f0f8f3; }
  .planting.status-past { border-left-color: #b35900; background: #fff8ec; }
  .planting.status-too-early { border-left-color: #6b6b6b; }
  .planting.harvested { opacity: 0.7; }
  .planting.focused {
    outline: 3px solid #ffd400;
    outline-offset: 2px;
  }
  .planting header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .block { color: #555; font-size: 0.9rem; }
  .family {
    font-size: 0.75rem;
    color: #1f5e3a;
    background: #e7f1ea;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }
  .badge {
    margin-left: auto;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .badge.in-window { background: #e7f1ea; color: #1f5e3a; }
  .badge.past { background: #fff3cd; color: #b35900; }
  .badge.too-early { background: #eaeaea; color: #555; }
  .badge.harvested { background: #ddd; color: #555; }
  .meta { color: #555; font-size: 0.85rem; margin: 0.4rem 0; font-family: monospace; }
  details { margin-top: 0.5rem; }
  .indicators { margin: 0.4rem 0 0 1.25rem; padding: 0; }
  .record-form {
    margin-top: 0.75rem;
    display: grid;
    gap: 0.5rem;
    grid-template-columns: 1fr 1fr;
  }
  .record-form .actions { grid-column: 1 / -1; display: flex; gap: 0.5rem; }
  .record-form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
  .record-form input {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
    margin-top: 0.5rem;
  }
  button {
    background: white;
    border: 2px solid #1f5e3a;
    color: #1f5e3a;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  button.primary { background: #1f5e3a; color: white; border-color: #1f5e3a; }
  .error { color: #b00020; grid-column: 1 / -1; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
  th { background: #f5f7f4; color: #1f5e3a; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px; }
  code { background: #f5f5f5; padding: 0.05rem 0.3rem; border-radius: 3px; font-size: 0.8rem; }
</style>
