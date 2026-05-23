<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';

  let { data } = $props();

  let selectedBlockId = $state<string>(untrack(() => data.preselectedBlockId ?? data.blocks[0]?.id ?? ''));
  let selectedPluginId = $state<string>(untrack(() => data.insecticides[0]?.pluginId ?? ''));
  let scoutPest = $state('');
  let scoutMetric = $state<'count-per-plant' | 'pct-defoliation' | 'pct-infested-plants'>(
    'count-per-plant'
  );
  let scoutValue = $state<number | null>(null);
  let windMph = $state(5);
  let tempF = $state(72);
  let rainPct = $state(10);
  let tankSize = $state<number | null>(25);
  let result = $state<string | null>(null);
  let error = $state<string | null>(null);
  let violations = $state<Array<{ code: string; message: string; detail?: Record<string, unknown> }>>([]);
  let busy = $state(false);

  async function recordSpray(ev: Event) {
    ev.preventDefault();
    busy = true;
    error = null;
    result = null;
    violations = [];
    try {
      const body: Record<string, unknown> = {
        blockId: selectedBlockId,
        productPluginIds: [selectedPluginId],
        conditions: {
          windMph,
          tempF,
          rainForecastMmNext24h: (rainPct / 100) * 25.4
        }
      };
      if (scoutPest && scoutValue !== null) {
        body.scout = { pest: scoutPest, metric: scoutMetric, value: scoutValue };
      }
      if (tankSize) body.tankSizeGallons = tankSize;
      // Phase 21b follow-up — close the swim-lane pip when deep-linked.
      if (data.preselectedCropId) body.cropId = data.preselectedCropId;
      if (data.taskId) body.taskId = data.taskId;
      const res = await fetch('/api/insecticide/record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const respData = await res.json();
      if (!res.ok) {
        error = respData.error ?? 'failed to record';
        if (Array.isArray(respData.violations)) violations = respData.violations;
        return;
      }
      result = `Recorded — re-entry clear ${new Date(respData.event.reEntryClearAt).toLocaleString()}.`;
      if (data.taskId) {
        goto('/plan?tab=schedule&view=swimlane');
        return;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<h1>Insecticides</h1>
<p class="lede">
  IRAC-grouped insecticide library. The kernel enforces environmental gates + REI / PHI; safety
  rules for crop tolerance live in the herbicide kill matrix and don't apply to insecticides.
</p>

{#if data.activeREI.length > 0}
  <section class="card warn">
    <h2>Active re-entry intervals</h2>
    <ul>
      {#each data.activeREI as e (e.id)}
        <li>
          <strong>Block {e.blockId}</strong> — re-entry clear {new Date(
            e.reEntryClearAt ?? 0
          ).toLocaleString()}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card">
  <h2>Library</h2>
  {#if data.insecticides.length === 0}
    <p>
      No insecticide plugins installed. Add JSON files under <code>plugins/insecticides/</code>.
    </p>
  {:else}
    <ul class="library">
      {#each data.insecticides as p (p.pluginId)}
        <li>
          <strong>{p.displayName}</strong>
          {#each p.iracGroups as g}
            <GroupCodeBadge kind="IRAC" group={g} />
          {/each}
          {#if p.targetPests.length}
            <span class="pests">— {p.targetPests.join(', ')}</span>
          {/if}
          <div class="meta">
            REI {p.reEntryIntervalHours}h
            {#if p.preHarvestIntervalDays !== undefined}
              · PHI {p.preHarvestIntervalDays}d
            {/if}
            · Pollinator risk {p.pollinatorRisk}
            {#if p.epaRegistrationNumber}· EPA {p.epaRegistrationNumber}{/if}
          </div>
          {#if p.scoutingThresholds.length}
            <details>
              <summary>Scouting thresholds</summary>
              <ul>
                {#each p.scoutingThresholds as t (t.pest + t.metric)}
                  <li>{t.pest}: spray at {t.threshold} {t.metric}</li>
                {/each}
              </ul>
            </details>
          {/if}
          {#if p.applicationProtocol.length}
            <details>
              <summary>Application protocol</summary>
              <ol>
                {#each p.applicationProtocol as s, i (i)}
                  <li>{s.step}{s.detail ? ` — ${s.detail}` : ''}</li>
                {/each}
              </ol>
            </details>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <h2>Record an insecticide application</h2>
  <form onsubmit={recordSpray}>
    <label>
      Block
      <select bind:value={selectedBlockId}>
        {#each data.blocks as b (b.id)}
          <option value={b.id}>{b.name}</option>
        {/each}
      </select>
    </label>
    <label>
      Insecticide
      <select bind:value={selectedPluginId}>
        {#each data.insecticides as p (p.pluginId)}
          <option value={p.pluginId}>{p.displayName}</option>
        {/each}
      </select>
    </label>

    <fieldset>
      <legend>Scout observation (optional)</legend>
      <label>
        Pest
        <input type="text" bind:value={scoutPest} placeholder="e.g. squash bug, ECB" />
      </label>
      <label>
        Metric
        <select bind:value={scoutMetric}>
          <option value="count-per-plant">count per plant</option>
          <option value="pct-defoliation">% defoliation</option>
          <option value="pct-infested-plants">% infested plants</option>
        </select>
      </label>
      <label>
        Value
        <input type="number" min="0" step="any" bind:value={scoutValue} />
      </label>
    </fieldset>

    <fieldset>
      <legend>Conditions</legend>
      <label>Wind (mph) <input type="number" min="0" bind:value={windMph} /></label>
      <label>Temp (°F) <input type="number" bind:value={tempF} /></label>
      <label>Rain forecast (%) <input type="number" min="0" max="100" bind:value={rainPct} /></label
      >
      <label>Tank size (gal) <input type="number" min="1" bind:value={tankSize} /></label>
    </fieldset>

    <button type="submit" class="primary" disabled={busy || !selectedBlockId || !selectedPluginId}>
      {busy ? 'Recording…' : 'Record application'}
    </button>
  </form>
  {#if error}
    <div class="error" aria-live="polite">
      <p>{error}</p>
      {#if violations.length > 0}
        <ul>
          {#each violations as v (v.message)}
            <li>
              <strong>{v.code}</strong> — {v.message}
              {#if v.detail?.source === 'user-added'}
                <span class="badge">stock label</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  {#if result}<p class="success">{result}</p>{/if}
</section>

<section class="card">
  <h2>Recent applications</h2>
  {#if data.recentEvents.length === 0}
    <p>No insecticide events yet.</p>
  {:else}
    <ul>
      {#each data.recentEvents as e (e.id)}
        <li>
          {new Date(e.occurredAt).toLocaleDateString()} —
          {e.products.map((p) => p.displayName).join(', ')}
          on block {e.blockId}
          {#if e.scoutObservation}
            (triggered by {e.scoutObservation.pest} {e.scoutObservation.value})
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .card {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card.warn {
    background: #fff3cd;
    border-left: 4px solid #b35900;
  }
  .lede {
    color: #555;
  }
  fieldset {
    border: 1px solid #d0d7d0;
    border-radius: 6px;
    padding: 0.75rem;
    margin: 0 0 1rem;
  }
  legend {
    padding: 0 0.5rem;
    color: #1f5e3a;
    font-weight: 600;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    margin-bottom: 0.6rem;
  }
  input,
  select {
    padding: 0.55rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  .library li {
    padding: 0.5rem 0;
    border-bottom: 1px solid #eee;
  }
  .library .pests {
    color: #555;
    font-size: 0.9rem;
  }
  .library .meta {
    color: #666;
    font-size: 0.8rem;
    margin-top: 0.25rem;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.9rem 1.5rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 56px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .error {
    color: #b00020;
    background: #fce4e4;
    padding: 0.75rem;
    border-radius: 4px;
  }
  .error ul {
    margin: 0.5rem 0 0;
    padding-left: 1.25rem;
  }
  .badge {
    display: inline-block;
    background: #b00020;
    color: white;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    margin-left: 0.25rem;
  }
  .success {
    color: #1f5e3a;
    background: #e7f1ea;
    padding: 0.75rem;
    border-radius: 4px;
  }
</style>
