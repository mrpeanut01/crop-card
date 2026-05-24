<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import SprayDecisionPage from '$lib/components/spray/SprayDecisionPage.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';

  let { data } = $props();

  // v2 addendum (#90 / #89): drives AI-on vs AI-off variant of the
  // SprayDecisionPage shell. Hard-coded false until #89 lands the
  // `user.ai_enabled` column + loader threading; the AI-off variant is
  // the safe baseline per the v2 spec (see AI_PROVENANCE_ADDENDUM.md
  // "AI assists, never gates").
  const aiEnabled = false;

  let selectedBlockId = $state<string>(
    untrack(() => data.preselectedBlockId ?? data.blocks[0]?.id ?? '')
  );
  let selectedPluginId = $state<string>(untrack(() => data.insecticides[0]?.pluginId ?? ''));

  // v2 addendum (#90): selected product drives the IPM-gate slot copy.
  // Picks the first scouting threshold the plugin declares (if any) for
  // the panel's "this week vs threshold" display. Real wiring (scout-log
  // count, evaluator verdict) lands in #89.
  const selectedInsecticide = $derived(
    data.insecticides.find((p) => p.pluginId === selectedPluginId) ?? null
  );
  const primaryThreshold = $derived(selectedInsecticide?.scoutingThresholds[0] ?? null);
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
  let violations = $state<
    Array<{ code: string; message: string; detail?: Record<string, unknown> }>
  >([]);
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

<section class="card library">
  <h2>Library</h2>
  {#if data.insecticides.length === 0}
    <p>
      No insecticide plugins installed. Add JSON files under <code>plugins/insecticides/</code>.
    </p>
  {:else}
    <ul class="library-list">
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

<SprayDecisionPage
  chemistry="insecticide"
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
  {aiEnabled}
  canSubmit={!!selectedBlockId && !!selectedPluginId}
  submitLabel="Record application"
  onSubmit={recordSpray}
>
  {#snippet productSection()}
    <label for="insecticide-product">Insecticide</label>
    <select id="insecticide-product" bind:value={selectedPluginId} required>
      {#each data.insecticides as p (p.pluginId)}
        <option value={p.pluginId}>{p.displayName}</option>
      {/each}
    </select>
  {/snippet}

  {#snippet observation()}
    <label for="scout-pest">Pest</label>
    <input
      id="scout-pest"
      type="text"
      bind:value={scoutPest}
      placeholder="e.g. squash bug, ECB"
    />
    <label for="scout-metric">Metric</label>
    <select id="scout-metric" bind:value={scoutMetric}>
      <option value="count-per-plant">count per plant</option>
      <option value="pct-defoliation">% defoliation</option>
      <option value="pct-infested-plants">% infested plants</option>
    </select>
    <label for="scout-value">Value</label>
    <input id="scout-value" type="number" min="0" step="any" bind:value={scoutValue} />
  {/snippet}

  {#snippet recentEvents()}
    <section class="card recent">
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
  {/snippet}

  <!-- ─── v2 addendum (#90) ────────────────────────────────────────── -->

  {#snippet legendStrip()}
    <ProvenanceLegend
      shown={aiEnabled
        ? ['plugin', 'data', 'ai', 'manual']
        : ['plugin', 'data', 'fallback', 'manual']}
      note={aiEnabled
        ? 'Mix and rates pre-populated · all editable'
        : 'AI off · plugin defaults filled · all editable'}
    />
  {/snippet}

  {#snippet tankMixProvenance()}
    <!-- Stub badges per the v2 spec: row-1 product is always plugin
         (safety-kernel rotation); subsequent products are ai/fallback.
         Single-product UI today renders just the plugin badge; real
         per-row wiring lands when the tank-mix calculator is on this
         shell (deferred to a follow-up). -->
    <Provenance source="plugin" detail="rotation kernel" compact />
    {#if aiEnabled}
      <Provenance source="ai" confidence={0.84} compact />
    {:else}
      <Provenance source="fallback" detail="deterministic default" compact />
    {/if}
  {/snippet}

  {#snippet ipmGate()}
    <header class="gate-header">
      <h2>IPM threshold gate</h2>
      <Provenance source="data" detail="your scout log" compact />
      {#if primaryThreshold}
        <Provenance
          source="plugin"
          detail={`${selectedInsecticide?.pluginId} · ${primaryThreshold.threshold} ${primaryThreshold.metric}`}
          compact
        />
      {:else}
        <Provenance source="plugin" detail="no threshold declared" compact />
      {/if}
    </header>
    <p class="gate-body">
      Insecticide sprays require a scout count that exceeds the action threshold for
      <strong>{primaryThreshold?.pest ?? 'the target pest'}</strong>. Full evaluator + this-week
      sparkline land with the IPM gate kernel in Phase 25d.
    </p>
  {/snippet}

  {#snippet pollinatorGate()}
    <header class="gate-header">
      <h2>Pollinator-protection gate</h2>
      <Provenance source="plugin" detail="bloom-window" compact />
      <Provenance source="data" detail="local weather feed" compact />
    </header>
    <p class="gate-body">
      Blocks bee-toxic applications when any selected block is in its declared bloom window AND the
      product carries a bee-toxicity flag. Full evaluator lands in Phase 25d.
    </p>
  {/snippet}
</SprayDecisionPage>

<style>
  .card {
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 1rem 1.25rem;
    margin: 0 0 1rem;
  }
  .library h2,
  .recent h2 {
    margin: 0 0 0.5rem;
  }
  .library-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .library-list li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--color-divider-soft);
  }
  .library-list li:last-child {
    border-bottom: none;
  }
  .pests {
    color: var(--color-ink-soft);
    font-size: 0.9rem;
  }
  .meta {
    color: var(--color-ink-muted);
    font-size: 0.8rem;
    margin-top: 0.25rem;
  }
  /* Snippets defined here are part of THIS component's template, so
     they get this component's scoping class — the shell's form-control
     styles don't reach them. Re-declare here so productSection /
     observation inputs match the shell's block selector + conditions. */
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
  .gate-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 0.5rem;
  }
  .gate-header h2 {
    margin: 0;
    margin-right: 0.25rem;
  }
  .gate-body {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 0.875rem;
    line-height: 1.5;
  }
</style>
