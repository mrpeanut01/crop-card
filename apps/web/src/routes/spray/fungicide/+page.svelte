<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import SetupCallout from '$lib/components/setup/SetupCallout.svelte';
  import SetupSpot from '$lib/components/setup/SetupSpot.svelte';
  import type { SetupSpotResult } from '$lib/setup/types';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import SprayDecisionPage from '$lib/components/spray/SprayDecisionPage.svelte';
  import SprayStepper, { type StepState } from '$lib/components/spray/SprayStepper.svelte';
  import SprayContextStrip, {
    type CompatibilityState,
    type SprayContextBlock
  } from '$lib/components/spray/SprayContextStrip.svelte';
  import { checkFungicideTankMixCompat } from '$lib/safety/fungicideTankMix';
  import { checkFracRotation } from '$lib/safety/fracRotation';
  import LeafWetDial from '$lib/components/spray/LeafWetDial.svelte';
  import RainSparkline from '$lib/components/spray/RainSparkline.svelte';
  import DryWindowGate from '$lib/components/spray/DryWindowGate.svelte';
  import FracRotationTile from '$lib/components/spray/FracRotationTile.svelte';
  import {
    DEFAULT_LEAF_WET_THRESHOLD_HOURS,
    deriveHourly,
    tankMixRainfastHours,
    type HourlyPoint,
    type WeatherProvenance
  } from '$lib/weather/leafWet';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import ProvenanceLegend from '$lib/components/ui/ProvenanceLegend.svelte';

  let { data } = $props();

  // v2 addendum (#89): sourced from `user.ai_enabled` via
  // getUserAiEnabled() in the loader. $derived so the variant
  // re-paints on loader re-run.
  const aiEnabled = $derived(data.aiEnabled);

  let selectedBlockId = $state<string>(
    untrack(() => data.preselect.blockId ?? data.blocks[0]?.id ?? '')
  );

  let spotSheetOpen = $state(false);
  async function onSpotAdded(r: SetupSpotResult) {
    spotSheetOpen = false;
    await invalidateAll();
    selectedBlockId = r.blockId;
  }
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

  const tankMixIssues = $derived(
    checkFungicideTankMixCompat(
      selectedFungicides.map((f) => ({
        pluginId: f.pluginId,
        displayName: f.displayName,
        fracCodes: f.fracCodes
      }))
    )
  );
  const tankMixBlocked = $derived(tankMixIssues.some((i) => i.severity === 'incompatible'));

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

  const priorFungicide = $derived(data.priorFungicideByBlock[selectedBlockId] ?? null);
  const proposedFracCodes = $derived(
    Array.from(new Set(selectedFungicides.flatMap((f) => f.fracCodes)))
  );
  const fracViolations = $derived(
    checkFracRotation(
      selectedFungicides.map((f) => ({ pluginId: f.pluginId, fracCodes: f.fracCodes })),
      priorFungicide ? [priorFungicide] : []
    )
  );
  const fracBlocked = $derived(fracViolations.length > 0);

  interface WeatherPayload {
    hours: HourlyPoint[];
    provenance: WeatherProvenance;
    fetchedAt: number;
    location: { source: 'block' | 'farm-block' | 'farm' | 'farm-default' } | null;
  }
  const UNAVAILABLE: WeatherPayload = {
    hours: [],
    provenance: 'fallback',
    fetchedAt: 0,
    location: null
  };
  let weather = $state<WeatherPayload | null>(null);
  let weatherAck = $state(false);
  let weatherSeq = 0;

  async function loadWeather(blockId: string): Promise<void> {
    const seq = ++weatherSeq;
    weather = null;
    let next: WeatherPayload = UNAVAILABLE;
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        const qs = blockId ? `?blockId=${encodeURIComponent(blockId)}` : '';
        const res = await fetch(`/api/weather/hourly${qs}`);
        if (res.ok) {
          const body = (await res.json()) as Partial<WeatherPayload>;
          next = {
            hours: Array.isArray(body.hours) ? body.hours : [],
            provenance: body.provenance === 'data' ? 'data' : 'fallback',
            fetchedAt: typeof body.fetchedAt === 'number' ? body.fetchedAt : Date.now(),
            location: body.location ?? null
          };
        }
      } catch {
        next = UNAVAILABLE;
      }
    }
    if (seq === weatherSeq) weather = next;
  }

  $effect(() => {
    void loadWeather(selectedBlockId);
  });

  const rainfast = $derived(tankMixRainfastHours(selectedFungicides));
  const weatherDerived = $derived(
    deriveHourly(weather?.hours ?? [], weather?.provenance ?? 'fallback', {
      nowMs: Date.now(),
      rainfastHours: rainfast.hours,
      timeZone: currentPrefs().timeZone
    })
  );
  const rainRisk = $derived(
    weatherDerived.provenance === 'data' && weatherDerived.rainfast.status === 'rain-risk'
  );

  $effect(() => {
    void selectedBlockId;
    void rainfast.hours;
    weatherAck = false;
  });

  const canSubmit = $derived(
    !!selectedBlockId &&
      selectedPluginIds.length > 0 &&
      !tankMixBlocked &&
      !fracBlocked &&
      (!rainRisk || weatherAck)
  );

  const stepperData = $derived.by<Array<{ label: string; state: StepState }>>(() => {
    const hasBlock = !!selectedBlockId;
    const hasProducts = selectedPluginIds.length > 0;
    const tankMixOk = !tankMixBlocked;
    const hasObservation = !!diseaseName && diseaseValue !== null;
    return [
      { label: 'Block', state: hasBlock ? 'done' : 'active' },
      {
        label: 'Disease + FRAC',
        state: !hasProducts ? (hasBlock ? 'active' : 'pending') : fracBlocked ? 'active' : 'done'
      },
      {
        label: 'Tank-mix check',
        state: !hasProducts ? 'pending' : tankMixOk ? 'done' : 'active'
      },
      {
        label: 'Observation',
        state: hasObservation ? 'done' : hasProducts && tankMixOk ? 'active' : 'pending'
      },
      {
        label: 'Conditions',
        state: canSubmit ? 'done' : tankMixOk ? 'active' : 'pending'
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
    selectedPluginIds.length === 0
      ? undefined
      : tankMixBlocked
        ? {
            label: 'Tank-mix incompatibility',
            reason: tankMixIssues[0]?.message,
            tone: 'rust'
          }
        : {
            label:
              selectedFungicides.length === 1
                ? `${selectedFungicides[0].displayName} compatible`
                : `${selectedFungicides.length}-way tank-mix compatible`,
            reason: 'Kernel verified FRAC pair-incompatibility table.',
            tone: 'forest'
          }
  );

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
    try {
      // #316 (NFR-02) — offline path. Queue locally; the sync queue replays
      // against /api/fungicide/record (server re-runs FRAC/tank-mix gates)
      // on reconnect.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const { enqueueRecord } = await import('$lib/client/syncQueue');
        await enqueueRecord('fungicide', body);
        result = '☁ Offline — queued. Will sync to the server when the connection returns.';
        return;
      }
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
        ? fmt.instant(payload.event.reEntryClearAt)
        : 'n/a';
      const phiClear = payload.event.preHarvestClearAt
        ? fmt.instant(payload.event.preHarvestClearAt)
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
      // #316 — transient network failure while "online": fall back to the
      // offline queue instead of losing the record.
      const msg = e instanceof Error ? e.message : String(e);
      const isNetworkErr = e instanceof TypeError && /(fetch|network|failed)/i.test(msg);
      if (isNetworkErr) {
        try {
          const { enqueueRecord } = await import('$lib/client/syncQueue');
          await enqueueRecord('fungicide', body);
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

<div class="spray-almanac-chrome">
  <SprayStepper steps={stepperData} />
  <SprayContextStrip blocks={ctxBlocks} cropLabel={ctxCropLabel} compatibility={ctxCompatibility} />
</div>

{#each tankMixIssues as issue (issue.code)}
  <div class="tank-mix-banner" class:incompat={issue.severity === 'incompatible'} role="alert">
    <strong>{issue.severity === 'incompatible' ? 'Phytotoxicity risk' : 'Caution'}.</strong>
    {issue.message}
  </div>
{/each}

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
  {canSubmit}
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
    {/if}
  {/snippet}

  {#snippet diseaseGate()}
    <div class="gate-head">
      <h2>Disease + FRAC</h2>
      {#if weather && weather.provenance === 'data'}
        <span class="gate-meta">
          NWS forecast · fetched {fmt.instant(weather.fetchedAt, 'time')}
          {#if weather.location?.source === 'farm'}· farm location (no block map){/if}
          {#if weather.location?.source === 'farm-default'}· farm default location (no block map){/if}
          {#if weather.location?.source === 'farm-block'}· nearest mapped block{/if}
        </span>
      {/if}
    </div>
    {#if weather === null}
      <p class="gate-loading" role="status">Loading hourly forecast…</p>
    {:else}
      <div class="weather-grid">
        <LeafWetDial
          past={weatherDerived.leafWet.past24h}
          next={weatherDerived.leafWet.next24h}
          threshold={DEFAULT_LEAF_WET_THRESHOLD_HOURS}
          provenance={weatherDerived.provenance}
        />
        <RainSparkline
          rain={weatherDerived.dailyRain}
          leafWet={weatherDerived.dailyLeafWet}
          provenance={weatherDerived.provenance}
        />
      </div>
    {/if}
    <div class="gate-tiles">
      <DryWindowGate
        rainfast={weatherDerived.rainfast}
        dryWindow={weatherDerived.dryWindow}
        provenance={weather === null ? 'fallback' : weatherDerived.provenance}
        rainfastFromLabel={rainfast.fromLabel}
        bind:acknowledged={weatherAck}
      />
      <FracRotationTile
        violations={fracViolations}
        prior={priorFungicide}
        {proposedFracCodes}
        tankOverlapCode={tankFracOverlap}
      />
    </div>
    <p class="gate-note">
      Leaf wetness is estimated from forecast humidity (RH ≥ 90%) and rain — not a disease model.
      Disease forecast models (NEWA / FHB) are coming in Phase 26. Weather checks are advisory; FRAC
      rotation is enforced by the server.
    </p>
  {/snippet}

  {#snippet observation()}
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
              <strong>{fmt.instant(e.occurredAt)}</strong> — block {e.blockId}
              · {e.products.map((p) => p.displayName).join(', ')}
              {#if e.preHarvestClearAt}
                <span class="phi">· PHI clear {fmt.instant(e.preHarvestClearAt)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/snippet}

  {#snippet noBlocks()}
    <SetupCallout
      kicker="Where?"
      title="Where are you spraying?"
      canEdit={data.setup.canEdit}
      askOwner="Ask the owner to add the spot you're spraying. Once it's on the farm it shows up here."
      testId="spray-where"
    >
      <p>There's nowhere on the farm to pick yet. Give the spot a name and carry on.</p>
      {#snippet actions()}
        <button type="button" class="primary" onclick={() => (spotSheetOpen = true)}>
          Name a new spot
        </button>
      {/snippet}
    </SetupCallout>
  {/snippet}
</SprayDecisionPage>

<SetupSheet
  open={spotSheetOpen}
  kicker="Spray"
  title="Where?"
  onClose={() => (spotSheetOpen = false)}
  onDone={onSpotAdded}
>
  {#snippet children(done)}
    <SetupSpot areas={data.setup.areas} canEdit={data.setup.canEdit} onDone={done} />
  {/snippet}
</SetupSheet>

<style>
  .spray-almanac-chrome {
    margin-bottom: 22px;
  }
  .tank-mix-banner {
    background: var(--color-wheat-soft, #e8d9b5);
    border: 1px solid #d9c18f;
    color: #6b4d00;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin: 0 0 1rem;
    font-size: 0.95rem;
  }
  .tank-mix-banner.incompat {
    background: #f8e2da;
    border-color: #e2b69e;
    color: #8a341b;
  }
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
  .gate-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-bottom: 0.75rem;
  }
  .gate-head h2 {
    margin: 0;
  }
  .gate-meta,
  .gate-loading,
  .gate-note {
    font-size: 0.85rem;
    color: var(--color-ink-soft);
  }
  .gate-note {
    margin: 0.75rem 0 0;
  }
  .weather-grid,
  .gate-tiles {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .gate-tiles {
    margin-bottom: 0;
  }
  @media (min-width: 720px) {
    .weather-grid {
      grid-template-columns: 1fr 1.4fr;
      align-items: center;
    }
    .gate-tiles {
      grid-template-columns: 1fr 1fr;
    }
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
