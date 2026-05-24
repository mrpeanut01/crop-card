<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();

  let selectedBlockId = $state<string>(
    untrack(() => data.preselect.blockId ?? data.blocks[0]?.id ?? '')
  );
  let selectedPluginIds = $state<string[]>(
    untrack(() =>
      data.preselect.productPluginIds.length > 0
        ? data.preselect.productPluginIds
        : data.fungicides[0]
          ? [data.fungicides[0].pluginId]
          : []
    )
  );

  let diseaseName = $state('');
  let diseaseMetric = $state<'pct-leaf-area' | 'lesion-count-per-leaf' | 'plants-infected-pct'>(
    'pct-leaf-area'
  );
  let diseaseValue = $state<number | null>(null);

  let windMph = $state(5);
  let tempF = $state(72);
  let rainPct = $state(10);
  let tankSize = $state<number | null>(25);

  let result = $state<string | null>(null);
  let warnings = $state<string[]>([]);
  let error = $state<string | null>(null);
  let violations = $state<
    Array<{ code: string; message: string; detail?: Record<string, unknown> }>
  >([]);
  let busy = $state(false);

  /** Group products by FRAC code so the operator sees rotation overlap
   *  before they pick a tank mix. Same-code consecutive sprays are the
   *  main resistance-management failure mode for fungicides. */
  const productsByFrac = $derived.by(() => {
    const map = new Map<string, typeof data.fungicides>();
    for (const f of data.fungicides) {
      for (const code of f.fracCodes) {
        const list = map.get(code) ?? [];
        list.push(f);
        map.set(code, list);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  const selectedFungicides = $derived(
    data.fungicides.filter((f) => selectedPluginIds.includes(f.pluginId))
  );

  /** True when the tank mix contains two plugins sharing a FRAC code —
   *  surfaces a resistance warning before persistence. */
  const tankFracOverlap = $derived.by(() => {
    const seen = new Set<string>();
    for (const f of selectedFungicides) {
      for (const code of f.fracCodes) {
        if (seen.has(code)) return code;
        seen.add(code);
      }
    }
    return null;
  });

  function toggleProduct(pluginId: string): void {
    if (selectedPluginIds.includes(pluginId)) {
      selectedPluginIds = selectedPluginIds.filter((id) => id !== pluginId);
    } else {
      selectedPluginIds = [...selectedPluginIds, pluginId];
    }
  }

  async function recordSpray(ev: Event): Promise<void> {
    ev.preventDefault();
    busy = true;
    error = null;
    result = null;
    warnings = [];
    violations = [];
    try {
      const body: Record<string, unknown> = {
        blockId: selectedBlockId,
        productPluginIds: selectedPluginIds,
        conditions: {
          windMph,
          tempF,
          rainForecastMmNext24h: (rainPct / 100) * 25.4
        }
      };
      if (diseaseName && diseaseValue !== null) {
        body.disease = { disease: diseaseName, metric: diseaseMetric, value: diseaseValue };
      }
      if (tankSize) body.tankSizeGallons = tankSize;
      if (data.preselect.taskId) body.taskId = data.preselect.taskId;

      const res = await fetch('/api/fungicide/record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await res.json();
      if (!res.ok) {
        error = payload.error ?? 'failed to record';
        if (Array.isArray(payload.violations)) violations = payload.violations;
        return;
      }
      const reiClear = payload.event.reEntryClearAt
        ? new Date(payload.event.reEntryClearAt).toLocaleString()
        : 'n/a';
      const phiClear = payload.event.preHarvestClearAt
        ? new Date(payload.event.preHarvestClearAt).toLocaleString()
        : 'n/a';
      result = `Recorded — REI clear ${reiClear} · PHI clear ${phiClear}.`;
      if (Array.isArray(payload.stockWarnings)) warnings = payload.stockWarnings;
      // Phase 21b follow-up — hop back to the swim-lane so the pip
      // flips to green (server set completedAt + relatedEventId).
      if (data.preselect.taskId) {
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

<header class="page-header">
  <Kicker>Spray · FRAC-rotated · Phase 25d gate stub</Kicker>
  <h1 class="serif">Fungicide application</h1>
  <p class="lede">
    Records an immutable fungicide event with REI / PHI lockouts. FRAC code rotation hints help
    prevent resistance — avoid two consecutive sprays sharing the same code on the same block.
  </p>
</header>

<div class="gate-slot">
  <Pill tone="sky">FRAC rotation evaluator — Phase 25d</Pill>
  <Pill tone="sky">Disease forecast (NEWA / FHB) — Phase 26</Pill>
  <Pill tone="sky">Rain/dew dry-hours gate — Phase 25d</Pill>
</div>

{#if data.activeREI.length > 0}
  <Banner tone="wheat">
    <strong>Active fungicide re-entry intervals:</strong>
    <ul class="rei-list">
      {#each data.activeREI as e (e.id)}
        <li>
          Block {e.blockId} — re-entry clear {new Date(e.reEntryClearAt ?? 0).toLocaleString()}
        </li>
      {/each}
    </ul>
  </Banner>
{/if}

<form onsubmit={recordSpray}>
  <section class="card">
    <h2>1 · Block + product</h2>

    <label for="block-select">Block</label>
    <select id="block-select" bind:value={selectedBlockId} required>
      <option value="">— pick a block —</option>
      {#each data.blocks as b (b.id)}
        <option value={b.id}>{b.name}{b.acres ? ` · ${b.acres.toFixed(2)} acres` : ''}</option>
      {/each}
    </select>

    {#if data.fungicides.length === 0}
      <p class="empty">
        No fungicide plugins installed. Add JSON files under <code>plugins/fungicides/</code>.
      </p>
    {:else}
      <fieldset class="product-grid">
        <legend>Tank-mix products</legend>
        {#each productsByFrac as [frac, items] (frac)}
          <div class="frac-row">
            <GroupCodeBadge kind="FRAC" group={frac} />
            <ul class="frac-items">
              {#each items as f (f.pluginId)}
                <li>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedPluginIds.includes(f.pluginId)}
                      onchange={() => toggleProduct(f.pluginId)}
                    />
                    <span class="prod-name">{f.displayName}</span>
                    <span class="prod-meta">
                      REI {f.reEntryIntervalHours}h · PHI {f.preHarvestIntervalDays}d
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </fieldset>

      {#if tankFracOverlap}
        <p class="warn-inline">
          ⚠ FRAC {tankFracOverlap} is on two products in this tank. Consider rotating to a different mode
          of action for resistance management.
        </p>
      {/if}
    {/if}
  </section>

  <section class="card">
    <h2>2 · Disease observation (optional)</h2>
    <label for="disease-name">Disease</label>
    <input id="disease-name" type="text" bind:value={diseaseName} placeholder="e.g. early blight" />
    <label for="disease-metric">Metric</label>
    <select id="disease-metric" bind:value={diseaseMetric}>
      <option value="pct-leaf-area">% leaf area affected</option>
      <option value="lesion-count-per-leaf">lesions per leaf</option>
      <option value="plants-infected-pct">% plants infected</option>
    </select>
    <label for="disease-value">Value</label>
    <input id="disease-value" type="number" min="0" step="any" bind:value={diseaseValue} />
  </section>

  <section class="card">
    <h2>3 · Conditions</h2>
    <label for="wind">Wind (mph)</label>
    <input id="wind" type="number" min="0" step="0.5" bind:value={windMph} required />

    <label for="temp">Temperature (°F)</label>
    <input id="temp" type="number" step="0.5" bind:value={tempF} required />

    <label for="rain">Rain forecast next 24h (%)</label>
    <input id="rain" type="number" min="0" max="100" step="1" bind:value={rainPct} required />

    <label for="tank">Tank size (gal, optional — enables stock decrement)</label>
    <input id="tank" type="number" min="0" step="0.5" bind:value={tankSize} />
  </section>

  <section class="card actions">
    <button type="submit" disabled={busy || selectedPluginIds.length === 0 || !selectedBlockId}>
      {busy ? 'Recording…' : 'Record fungicide application'}
    </button>
  </section>
</form>

{#if result}
  <Banner tone="forest">{result}</Banner>
{/if}
{#if error}
  <Banner tone="rust" urgent>
    <strong>Error:</strong> {error}
    {#if violations.length > 0}
      <ul class="violations">
        {#each violations as v (v.code)}
          <li><code>{v.code}</code> — {v.message}</li>
        {/each}
      </ul>
    {/if}
  </Banner>
{/if}
{#if warnings.length > 0}
  <Banner tone="wheat">
    <strong>Warnings:</strong>
    <ul class="violations">
      {#each warnings as w, i (i)}
        <li>{w}</li>
      {/each}
    </ul>
  </Banner>
{/if}

{#if data.recentEvents.length > 0}
  <section class="card">
    <h2>Recent fungicide events</h2>
    <ul class="recent">
      {#each data.recentEvents as e (e.id)}
        <li>
          <strong>{new Date(e.occurredAt).toLocaleString()}</strong> — block {e.blockId}
          · {e.products.map((p) => p.displayName).join(', ')}
          {#if e.preHarvestClearAt}
            <span class="phi">· PHI clear {new Date(e.preHarvestClearAt).toLocaleString()}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  h1 {
    margin: 0 0 0.5rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .card {
    background: #fff;
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin: 0 0 1rem;
  }
  .card.warn {
    background: var(--pill-wheat-bg);
    border-color: #f1c40f;
  }
  .card.err {
    background: var(--pill-rust-bg);
    border-color: var(--color-rust);
  }
  .card.ok {
    background: var(--pill-forest-bg);
    border-color: var(--color-forest);
  }
  label {
    display: block;
    margin: 0.75rem 0 0.25rem;
    font-weight: 500;
  }
  input,
  select {
    width: 100%;
    padding: 0.6rem;
    font-size: 1rem;
    min-height: 48px;
    border: 1px solid #aaa;
    border-radius: 6px;
    background: #fff;
  }
  button {
    min-height: 48px;
    padding: 0 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    background: var(--color-sky);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .actions {
    text-align: right;
  }
  .product-grid {
    border: none;
    padding: 0;
    margin-top: 1rem;
  }
  .product-grid legend {
    font-weight: 500;
  }
  .frac-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin: 0.5rem 0;
    padding: 0.5rem;
    border: 1px solid var(--color-divider-soft);
    border-radius: 6px;
  }
  .frac-items {
    list-style: none;
    padding: 0;
    margin: 0;
    flex: 1;
  }
  .frac-items li {
    margin: 0.25rem 0;
  }
  .frac-items label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-weight: normal;
  }
  .frac-items input[type='checkbox'] {
    width: auto;
    min-height: auto;
    margin: 0;
  }
  .prod-meta {
    color: #666;
    font-size: 0.85rem;
    margin-left: auto;
  }
  .warn-inline {
    margin: 0.75rem 0 0;
    padding: 0.6rem;
    background: var(--pill-wheat-bg);
    border-left: 4px solid #f1c40f;
    border-radius: 4px;
  }
  .empty {
    color: #777;
    font-style: italic;
  }
  .recent {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .recent li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--color-divider-soft);
  }
  .recent li:last-child {
    border-bottom: none;
  }
  .phi {
    color: var(--color-rust);
    margin-left: 0.5rem;
  }
</style>
