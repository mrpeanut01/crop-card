<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import SprayDecisionPage from '$lib/components/spray/SprayDecisionPage.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';

  let { data } = $props();

  // v2 addendum (#89): sourced from `user.ai_enabled` via
  // getUserAiEnabled() in the loader. $derived so the variant
  // re-paints on loader re-run.
  const aiEnabled = $derived(data.aiEnabled);

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

<SprayDecisionPage
  chemistry="fungicide"
  blocks={data.blocks}
  activeREI={data.activeREI}
  bind:blockId={selectedBlockId}
  bind:windMph
  bind:tempF
  bind:rainPct
  bind:tankSize
  {busy}
  {result}
  {error}
  {violations}
  {warnings}
  {aiEnabled}
  canSubmit={!!selectedBlockId && selectedPluginIds.length > 0}
  submitLabel="Record fungicide application"
  onSubmit={recordSpray}
>
  {#snippet productSection()}
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
          ⚠ FRAC {tankFracOverlap} is on two products in this tank. Consider rotating to a different
          mode of action for resistance management.
        </p>
      {/if}
    {/if}
  {/snippet}

  {#snippet observation()}
    <label for="disease-name">Disease</label>
    <input
      id="disease-name"
      type="text"
      bind:value={diseaseName}
      placeholder="e.g. early blight"
    />
    <label for="disease-metric">Metric</label>
    <select id="disease-metric" bind:value={diseaseMetric}>
      <option value="pct-leaf-area">% leaf area affected</option>
      <option value="lesion-count-per-leaf">lesions per leaf</option>
      <option value="plants-infected-pct">% plants infected</option>
    </select>
    <label for="disease-value">Value</label>
    <input id="disease-value" type="number" min="0" step="any" bind:value={diseaseValue} />
  {/snippet}

  <!-- ─── v2 addendum (#90) ────────────────────────────────────────── -->

  {#snippet legendStrip()}
    <ProvenanceLegend
      shown={aiEnabled
        ? ['plugin', 'data', 'ai', 'manual']
        : ['plugin', 'data', 'fallback', 'manual']}
      note={aiEnabled
        ? 'FRAC groups + rates pre-populated · all editable'
        : 'AI off · FRAC groups from plugins · all editable'}
    />
  {/snippet}

  {#snippet tankMixProvenance()}
    <!-- FRAC groups come from plugin JSON (activeIngredients[].fracCode) —
         always a `plugin` badge. If the operator added a second product
         the AI tier could propose a rotation-safe pairing; until #89
         lands that, the second-product badge defaults to fallback. -->
    {#if selectedFungicides.length > 0}
      <Provenance source="plugin" detail="FRAC kernel" compact />
      {#if selectedFungicides.length > 1}
        {#if aiEnabled}
          <Provenance source="ai" confidence={0.84} compact />
        {:else}
          <Provenance source="fallback" detail="deterministic rotation hint" compact />
        {/if}
      {/if}
    {/if}
  {/snippet}

  {#snippet recentEvents()}
    {#if data.recentEvents.length > 0}
      <section class="card recent">
        <h2>Recent fungicide events</h2>
        <ul class="recent-list">
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
  {/snippet}
</SprayDecisionPage>

<style>
  /* Snippet-scoped styles for productSection / observation form controls
     and the recent-events list. The shell can't reach into snippet
     content (scoped to this component), so re-declare what's needed. */
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
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper, #fff);
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
    color: var(--color-ink-muted);
    font-size: 0.85rem;
    margin-left: auto;
  }
  .warn-inline {
    margin: 0.75rem 0 0;
    padding: 0.6rem;
    background: var(--pill-wheat-bg);
    border-left: 4px solid var(--color-wheat);
    border-radius: 4px;
  }
  .empty {
    color: var(--color-ink-muted);
    font-style: italic;
  }
  .card {
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 1rem 1.25rem;
    margin: 0 0 1rem;
  }
  .recent h2 {
    margin: 0 0 0.5rem;
  }
  .recent-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .recent-list li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--color-divider-soft);
  }
  .recent-list li:last-child {
    border-bottom: none;
  }
  .phi {
    color: var(--color-rust);
    margin-left: 0.5rem;
  }
</style>
