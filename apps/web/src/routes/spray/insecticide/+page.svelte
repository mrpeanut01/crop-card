<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import SprayDecisionPage from '$lib/components/spray/SprayDecisionPage.svelte';
  import SprayStepper, { type StepState } from '$lib/components/spray/SprayStepper.svelte';
  import SprayContextStrip, {
    type CompatibilityState,
    type SprayContextBlock
  } from '$lib/components/spray/SprayContextStrip.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';

  let { data } = $props();

  // v2 addendum (#89): drives AI-on vs AI-off variant of the
  // SprayDecisionPage shell. Sourced from `user.ai_enabled` via
  // getUserAiEnabled() in the loader — flips true when the user
  // validates a Claude API key in Settings → AI. $derived so the
  // variant re-paints when the loader re-runs (e.g., on key save).
  const aiEnabled = $derived(data.aiEnabled);

  let selectedBlockId = $state<string>(
    untrack(() => data.preselectedBlockId ?? data.blocks[0]?.id ?? '')
  );
  let selectedPluginId = $state<string>(untrack(() => data.insecticides[0]?.pluginId ?? ''));

  // v2 addendum (#89): selected product + block drive the IPM-gate
  // slot — threshold from the plugin, scout history from the operator's
  // past insecticide events on the selected block (see
  // `scoutLogByBlock()` in the loader).
  const selectedInsecticide = $derived(
    data.insecticides.find((p) => p.pluginId === selectedPluginId) ?? null
  );
  const primaryThreshold = $derived(selectedInsecticide?.scoutingThresholds[0] ?? null);

  /** 5-week bucketed scout history for the selected (block, pest, metric).
   *  Each bucket sums all observations in the week ending at `now − N×7d`.
   *  Oldest-first so the bars left-to-right read chronologically. */
  const sparkline = $derived.by(() => {
    if (!primaryThreshold)
      return [] as Array<{ weekLabel: string; count: number; triggered: boolean }>;
    const obs = (data.scoutLogByBlock[selectedBlockId] ?? []).filter(
      (o) => o.pest === primaryThreshold.pest && o.metric === primaryThreshold.metric
    );
    const now = Date.now();
    const WEEK_MS = 7 * 86_400_000;
    const buckets: Array<{ weekLabel: string; count: number; triggered: boolean }> = [];
    for (let i = 4; i >= 0; i--) {
      const startMs = now - (i + 1) * WEEK_MS;
      const endMs = now - i * WEEK_MS;
      const inBucket = obs.filter((o) => o.occurredAt >= startMs && o.occurredAt < endMs);
      const sum = inBucket.reduce((acc, o) => acc + o.value, 0);
      buckets.push({
        weekLabel: i === 0 ? 'now' : `−${i}w`,
        count: sum,
        triggered: sum >= primaryThreshold.threshold
      });
    }
    return buckets;
  });

  const thisWeekCount = $derived(sparkline[sparkline.length - 1]?.count ?? 0);
  const overBy = $derived(
    primaryThreshold ? Math.max(0, thisWeekCount - primaryThreshold.threshold) : 0
  );
  const ipmTriggered = $derived(overBy > 0);
  const sparklineMax = $derived(
    Math.max(1, ...sparkline.map((b) => b.count), primaryThreshold?.threshold ?? 0)
  );
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

  // IPM gate: when the product declares a scout threshold, the operator
  // can only record once the recent observations cross it. The kernel
  // also enforces this server-side (HTTP 422 IPM_THRESHOLD_NOT_MET) — the
  // gate here is a glove-operability layer so the operator gets an
  // immediate blocker instead of a network round-trip on submit.
  const ipmBlocked = $derived(!!primaryThreshold && !ipmTriggered);
  const canSubmit = $derived(!!selectedBlockId && !!selectedPluginId && !ipmBlocked);

  const stepperData = $derived.by<Array<{ label: string; state: StepState }>>(() => {
    const hasBlock = !!selectedBlockId;
    const hasProduct = !!selectedPluginId;
    const ipmReady = !primaryThreshold || ipmTriggered;
    const hasObservation = !!scoutPest && scoutValue !== null;
    return [
      { label: 'Block', state: hasBlock ? 'done' : 'active' },
      { label: 'Product', state: !hasProduct ? (hasBlock ? 'active' : 'pending') : 'done' },
      {
        label: 'IPM gate',
        state: !ipmReady ? (hasProduct ? 'active' : 'pending') : 'done'
      },
      {
        label: 'Observation',
        state: hasObservation ? 'done' : ipmReady && hasProduct ? 'active' : 'pending'
      },
      {
        label: 'Conditions',
        state: canSubmit ? 'done' : ipmReady ? 'active' : 'pending'
      },
      { label: 'Record', state: canSubmit ? 'active' : 'pending' }
    ];
  });

  const selectedBlock = $derived(data.blocks.find((b) => b.id === selectedBlockId) ?? null);
  const ctxBlocks = $derived<SprayContextBlock[]>(
    selectedBlock ? [{ id: selectedBlock.id, label: selectedBlock.name, acres: 0 }] : []
  );
  const ctxCropLabel = $derived(
    selectedBlock?.cropPluginIds.length
      ? selectedBlock.cropPluginIds.length === 1
        ? selectedBlock.cropPluginIds[0]
        : `${selectedBlock.cropPluginIds.length} crops`
      : '—'
  );
  const ctxCompatibility = $derived<CompatibilityState | undefined>(
    !selectedPluginId
      ? undefined
      : ipmBlocked
        ? {
            label: `IPM threshold not met for ${primaryThreshold?.pest ?? 'target pest'}`,
            reason:
              'Action threshold has not been crossed in the 5-week scout window — kernel will block submit.',
            tone: 'wheat'
          }
        : {
            label: 'IPM threshold cleared',
            reason: 'Recent scout observations cross the product’s action threshold.',
            tone: 'forest'
          }
  );

  async function recordSpray(ev: Event) {
    ev.preventDefault();
    busy = true;
    error = null;
    result = null;
    violations = [];
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
    try {
      // #316 (NFR-02) — offline path. Mirror the herbicide flow: queue the
      // record locally and let the sync queue replay it against
      // /api/insecticide/record (server re-runs the kernel) on reconnect.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const { enqueueRecord } = await import('$lib/client/syncQueue');
        await enqueueRecord('insecticide', body);
        result = '☁ Offline — queued. Will sync to the server when the connection returns.';
        return;
      }
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
      // #316 — transient network failure while "online" (e.g. flaky
      // signal). Fall back to the offline queue rather than losing the
      // record. A non-network error surfaces to the operator as before.
      const msg = e instanceof Error ? e.message : String(e);
      const isNetworkErr = e instanceof TypeError && /(fetch|network|failed)/i.test(msg);
      if (isNetworkErr) {
        try {
          const { enqueueRecord } = await import('$lib/client/syncQueue');
          await enqueueRecord('insecticide', body);
          result = '☁ Offline — queued. Will sync to the server when the connection returns.';
        } catch (queueErr) {
          error = `offline queue failed: ${
            queueErr instanceof Error ? queueErr.message : queueErr
          }`;
        }
      } else {
        error = msg;
      }
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

<div class="spray-almanac-chrome">
  <SprayStepper steps={stepperData} />
  <SprayContextStrip blocks={ctxBlocks} cropLabel={ctxCropLabel} compatibility={ctxCompatibility} />
</div>

{#if ipmBlocked}
  <div class="ipm-block-banner" role="status">
    <strong>Below action threshold.</strong>
    Recent scout observations don't cross {primaryThreshold?.pest}
    ≥{primaryThreshold?.threshold}
    {primaryThreshold?.metric.replace(/-/g, ' ')}. Record an observation above to clear the gate, or
    pick a non-IPM product.
  </div>
{/if}

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
  {canSubmit}
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
    <input id="scout-pest" type="text" bind:value={scoutPest} placeholder="e.g. squash bug, ECB" />
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
      {#if ipmTriggered}
        <span class="pill-triggered">Triggered</span>
      {:else if primaryThreshold}
        <span class="pill-pending">Below threshold</span>
      {/if}
      <Provenance source="data" detail="your scout log" compact />
      {#if primaryThreshold}
        <Provenance
          source="plugin"
          detail={`${selectedInsecticide?.pluginId} · ≥${primaryThreshold.threshold} ${primaryThreshold.metric}`}
          compact
        />
      {:else}
        <Provenance source="plugin" detail="no threshold declared" compact />
      {/if}
    </header>

    {#if primaryThreshold}
      <div class="ipm-grid">
        <div class="ipm-dial">
          <div class="dial-kicker">This week</div>
          <div class="dial-row">
            <span class="dial-num serif" class:over={ipmTriggered}>{thisWeekCount}</span>
            <span class="dial-unit">{primaryThreshold.metric.replace(/-/g, ' ')}</span>
          </div>
          <div class="dial-sub">
            Action threshold <span class="mono">≥{primaryThreshold.threshold}</span>
            {#if ipmTriggered}
              · <span class="over">+{overBy} over</span>
            {:else}
              · {primaryThreshold.threshold - thisWeekCount} below
            {/if}
          </div>
        </div>
        <div class="ipm-sparkline">
          <div class="spark-kicker">5-week history</div>
          <div class="spark-bars">
            {#each sparkline as b (b.weekLabel)}
              <div class="spark-col" title={`${b.weekLabel}: ${b.count}`}>
                <div class="spark-bar-wrap">
                  <div
                    class="spark-bar"
                    class:triggered={b.triggered}
                    style:height={`${Math.max(8, (b.count / sparklineMax) * 100)}%`}
                  ></div>
                </div>
                <span class="spark-count mono" class:triggered={b.triggered}>{b.count}</span>
                <span class="spark-week mono">{b.weekLabel}</span>
              </div>
            {/each}
            <div class="spark-divider" aria-hidden="true"></div>
            <div class="spark-threshold">
              <span class="spark-threshold-label">threshold</span>
              <span class="mono spark-threshold-value">{primaryThreshold.threshold}</span>
            </div>
          </div>
        </div>
      </div>
    {:else}
      <p class="gate-body">
        Selected product declares no scouting thresholds. AI-assisted gap-fill (#87) brings this to
        ≥95% coverage before promotion.
      </p>
    {/if}
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
  .spray-almanac-chrome {
    margin-bottom: 22px;
  }
  .ipm-block-banner {
    background: var(--color-wheat-soft, #e8d9b5);
    border: 1px solid #d9c18f;
    color: #6b4d00;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin: 0 0 1rem;
    font-size: 0.95rem;
  }
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
  .pill-triggered {
    display: inline-flex;
    padding: 2px 8px;
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    border: 1px solid var(--pill-wheat-bd);
    border-radius: var(--radius-pill);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .pill-pending {
    display: inline-flex;
    padding: 2px 8px;
    background: var(--pill-neutral-bg);
    color: var(--pill-neutral-fg);
    border: 1px solid var(--pill-neutral-bd);
    border-radius: var(--radius-pill);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .ipm-grid {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) 2fr;
    gap: 20px;
    align-items: center;
    margin-top: 0.5rem;
  }
  .dial-kicker,
  .spark-kicker {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .dial-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .dial-num {
    font-size: 42px;
    color: var(--color-forest-deep);
    letter-spacing: -0.02em;
    font-weight: 600;
    line-height: 1;
  }
  .dial-num.over {
    color: var(--color-rust);
  }
  .dial-unit {
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .dial-sub {
    font-size: 12px;
    color: var(--color-ink-muted);
    margin-top: 4px;
  }
  .dial-sub .mono {
    color: var(--color-ink);
    font-weight: 600;
  }
  .dial-sub .over {
    color: var(--color-rust);
    font-weight: 600;
  }
  .spark-bars {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 80px;
    padding: 0 4px;
  }
  .spark-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .spark-bar-wrap {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
  }
  .spark-bar {
    width: 100%;
    background: var(--color-wheat);
    opacity: 0.55;
    border-radius: 3px 3px 0 0;
  }
  .spark-bar.triggered {
    background: var(--color-rust);
    opacity: 1;
  }
  .spark-count {
    font-size: 10px;
    color: var(--color-ink-muted);
    font-weight: 700;
  }
  .spark-count.triggered {
    color: var(--color-rust);
  }
  .spark-week {
    font-size: 9.5px;
    color: var(--color-ink-muted);
  }
  .spark-divider {
    width: 1px;
    align-self: stretch;
    border-left: 1px dashed var(--color-divider);
    margin: 0 4px;
  }
  .spark-threshold {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .spark-threshold-label {
    font-size: 9.5px;
    color: var(--color-ink-muted);
  }
  .spark-threshold-value {
    font-size: 13px;
    color: var(--color-ink);
    font-weight: 700;
  }
</style>
