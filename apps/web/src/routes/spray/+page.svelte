<script lang="ts">
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';

  let { data } = $props();

  // Preselect from query params so deep-links from /today and /scout land on
  // a partially-filled form instead of a blank one.
  const preselectedBlock =
    data.preselect.blockId && data.blocks.find((b) => b.id === data.preselect.blockId)
      ? data.preselect.blockId
      : (data.blocks[0]?.id ?? '');

  let selectedBlockId = $state(preselectedBlock);
  let selectedHerbicideIds = $state<string[]>(
    data.preselect.productPluginIds.filter((id) =>
      data.allHerbicides.some((h) => h.pluginId === id)
    )
  );
  let selectedSprayerId = $state(data.sprayers[0]?.id ?? '');
  let windMph = $state(5);
  let tempF = $state(70);
  let rainMm = $state(0);
  let cornHeightIn = $state<number | undefined>(6);
  let tankSizeGallons = $state(50);
  let showAllHerbicides = $state(data.preselect.windowStage === null);

  let evaluating = $state(false);
  let result = $state<EvaluateResult | null>(null);
  let lastError = $state<string | null>(null);

  let recording = $state(false);
  let recordedId = $state<string | null>(null);
  let queuedOffline = $state(false);

  type Violation = { code: string; message: string; detail?: Record<string, unknown> };
  type Dilution = {
    pluginId: string;
    displayName: string;
    productAmount: number;
    unit: string;
    display: string;
    acresCovered: number;
    gpaUsed: number;
    customRateApplied: boolean;
  };
  type TankMixStep = { order: number; instruction: string; productPluginId?: string };
  type EvaluateResult = {
    ok: boolean;
    violations: Violation[];
    requiresDecon: boolean;
    dilutions?: Dilution[];
    tankMixOrder?: TankMixStep[];
    ruleVersion: string;
    pluginHashes: Record<string, string>;
    sprayerState?: { id: string; lastChemistryClass?: string };
  };

  const block = $derived(data.blocks.find((b) => b.id === selectedBlockId));
  const sprayer = $derived(data.sprayers.find((s) => s.id === selectedSprayerId));
  const isCornBlock = $derived(block?.crops.some((c) => c.cropFamily === 'corn') ?? false);

  function toggleHerbicide(id: string) {
    if (selectedHerbicideIds.includes(id)) {
      selectedHerbicideIds = selectedHerbicideIds.filter((x) => x !== id);
    } else {
      selectedHerbicideIds = [...selectedHerbicideIds, id];
    }
  }

  async function evaluate() {
    if (!block || selectedHerbicideIds.length === 0 || !sprayer) return;
    evaluating = true;
    lastError = null;
    result = null;
    try {
      const [primary, ...coPlanted] = block.crops;
      const body = {
        blockCrops: {
          primary: {
            cropPluginId: primary.pluginId,
            cropFamily: primary.cropFamily,
            heightInches: isCornBlock ? cornHeightIn : undefined
          },
          coPlanted: coPlanted.map((c) => ({
            cropPluginId: c.pluginId,
            cropFamily: c.cropFamily
          }))
        },
        productPluginIds: selectedHerbicideIds,
        sprayer: { id: sprayer.id },
        tankSizeGallons,
        conditions: {
          windMph,
          tempF,
          rainForecastMmNext24h: rainMm
        }
      };
      const res = await fetch('/api/spray/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok && res.status !== 200) {
        const err = await res.json();
        lastError = err.error ?? `HTTP ${res.status}`;
        return;
      }
      result = (await res.json()) as EvaluateResult;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      evaluating = false;
    }
    if (result || lastError) {
      await tick();
      document
        .querySelector('.result, .error')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function goToDecon() {
    if (sprayer) goto(`/spray/decon?sprayer=${encodeURIComponent(sprayer.id)}`);
  }

  function buildRecordBody() {
    if (!block || !sprayer) return null;
    const [primary, ...coPlanted] = block.crops;
    return {
      blockId: block.id,
      blockCrops: {
        primary: {
          cropPluginId: primary.pluginId,
          cropFamily: primary.cropFamily,
          heightInches: isCornBlock ? cornHeightIn : undefined
        },
        coPlanted: coPlanted.map((c) => ({
          cropPluginId: c.pluginId,
          cropFamily: c.cropFamily
        }))
      },
      productPluginIds: selectedHerbicideIds,
      sprayer: { id: sprayer.id },
      tankSizeGallons,
      conditions: { windMph, tempF, rainForecastMmNext24h: rainMm }
    };
  }

  async function recordSpray() {
    if (!block || !sprayer || !result?.ok) return;
    const body = buildRecordBody();
    if (!body) return;
    recording = true;
    lastError = null;
    queuedOffline = false;

    // Already known offline → queue directly without trying the network.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      try {
        const { enqueueSprayRecord } = await import('$lib/client/syncQueue');
        const queueId = await enqueueSprayRecord(body);
        recordedId = queueId;
        queuedOffline = true;
      } catch (e) {
        lastError = `offline queue failed: ${e instanceof Error ? e.message : e}`;
      } finally {
        recording = false;
      }
      return;
    }

    try {
      const res = await fetch('/api/spray/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        lastError = data.error ?? `HTTP ${res.status}`;
        return;
      }
      recordedId = data.event.id;
    } catch (e) {
      // Network/fetch failure → queue for later. Server-side validation
      // failures throw with a status, not a network error, so they don't fall here.
      const msg = e instanceof Error ? e.message : String(e);
      const isNetworkErr = e instanceof TypeError && /(fetch|network|failed)/i.test(msg);
      if (isNetworkErr) {
        try {
          const { enqueueSprayRecord } = await import('$lib/client/syncQueue');
          const queueId = await enqueueSprayRecord(body);
          recordedId = queueId;
          queuedOffline = true;
          return;
        } catch (queueErr) {
          lastError = `offline queue failed: ${queueErr instanceof Error ? queueErr.message : queueErr}`;
          return;
        }
      }
      lastError = msg;
    } finally {
      recording = false;
    }
  }
</script>

<h1>Plan a spray</h1>
<p class="lede">
  Pick a block, herbicide(s), sprayer, and conditions. The safety kernel decides whether the
  dilution table renders or you get a STOP card.
</p>

{#if data.preselect.fromScout || data.preselect.blockId}
  <div class="prefill-banner" role="status">
    {#if data.preselect.fromScout}
      ↳ Continuing from scout — block pre-selected.
    {:else}
      ↳ Pre-filled from <a href="/today">today's calendar</a>.
    {/if}
  </div>
{/if}

{#if data.blocks.length === 0}
  <section class="step empty-state">
    <h2>No blocks with plantings yet</h2>
    <p>
      Add a block + planting on <a href="/plan">/plan</a> first. The spray flow operates on real plantings
      so the kernel knows what crops are in the block.
    </p>
  </section>
{:else}
  <section class="step">
    <h2>1. Block</h2>
    <div class="cards">
      {#each data.blocks as b (b.id)}
        <button
          type="button"
          class="card"
          class:selected={selectedBlockId === b.id}
          onclick={() => (selectedBlockId = b.id)}
        >
          <strong>{b.label}</strong>
          <small>{b.description}</small>
          <ul>
            {#each b.crops as c}
              <li>{c.displayName} <em>({c.cropFamily})</em></li>
            {/each}
          </ul>
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>2. Herbicide(s)</h2>
    {#if data.preselect.windowStage && !showAllHerbicides}
      <p class="filter-hint">
        Filtered to <strong>{data.preselect.windowStage}</strong> window from today's calendar.
        <button class="link-button" onclick={() => (showAllHerbicides = true)}>
          Show all herbicides
        </button>
      </p>
    {/if}
    <div class="cards">
      {#each showAllHerbicides ? data.allHerbicides : data.herbicides as h (h.pluginId)}
        <button
          type="button"
          class="card"
          class:selected={selectedHerbicideIds.includes(h.pluginId)}
          onclick={() => toggleHerbicide(h.pluginId)}
        >
          <strong>{h.displayName}</strong>
          <small
            >{h.applicationTiming ?? 'unspecified timing'} • {h.chemistryClasses.join(', ')}</small
          >
          <small>
            {h.ratePerAcre.amount}
            {h.ratePerAcre.unit}/A @ {h.gpaCalibration} GPA
            {#if h.requiresAMS}• AMS{/if}
            {#if h.deconRequired}• decon{/if}
          </small>
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>3. Sprayer</h2>
    <div class="cards">
      {#each data.sprayers as s (s.id)}
        <button
          type="button"
          class="card"
          class:selected={selectedSprayerId === s.id}
          onclick={() => (selectedSprayerId = s.id)}
        >
          <strong>{s.label}</strong>
          <small>id: {s.id} • {s.calibratedGpa} GPA</small>
          {#if s.lastChemistryClass}
            <small class="warn">last load: {s.lastChemistryClass}</small>
          {:else}
            <small class="ok">clean</small>
          {/if}
          {#if s.lastDeconAt}
            <small>last decon: {new Date(s.lastDeconAt).toLocaleString()}</small>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>4. Tank size</h2>
    <p class="hint">
      Pick the tank you're loading. Per spec §4.2, supported sizes are 10/25/50/75/100 gal.
    </p>
    <div class="quick-picks" role="radiogroup" aria-label="Tank size in gallons">
      {#each [10, 25, 50, 75, 100] as size (size)}
        <button
          type="button"
          role="radio"
          aria-checked={tankSizeGallons === size}
          class="pick"
          class:selected={tankSizeGallons === size}
          onclick={() => (tankSizeGallons = size)}
        >
          {size} <span>gal</span>
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>5. Conditions</h2>
    <div class="conditions">
      <div class="stepper">
        <span class="stepper-label">Wind</span>
        <button
          type="button"
          aria-label="Decrease wind"
          onclick={() => (windMph = Math.max(0, windMph - 1))}>−</button
        >
        <output>{windMph}<small> mph</small></output>
        <button type="button" aria-label="Increase wind" onclick={() => (windMph = windMph + 1)}
          >+</button
        >
      </div>
      <div class="stepper">
        <span class="stepper-label">Temp</span>
        <button type="button" aria-label="Decrease temp" onclick={() => (tempF = tempF - 1)}
          >−</button
        >
        <output>{tempF}<small>°F</small></output>
        <button type="button" aria-label="Increase temp" onclick={() => (tempF = tempF + 1)}
          >+</button
        >
      </div>
      <div class="stepper">
        <span class="stepper-label">Rain (24h)</span>
        <button
          type="button"
          aria-label="Decrease rain"
          onclick={() => (rainMm = Math.max(0, rainMm - 1))}>−</button
        >
        <output>{rainMm}<small> mm</small></output>
        <button type="button" aria-label="Increase rain" onclick={() => (rainMm = rainMm + 1)}
          >+</button
        >
      </div>
      {#if isCornBlock}
        <div class="stepper">
          <span class="stepper-label">Corn ht</span>
          <button
            type="button"
            aria-label="Decrease corn height"
            onclick={() => (cornHeightIn = Math.max(0, (cornHeightIn ?? 0) - 1))}>−</button
          >
          <output>{cornHeightIn ?? 0}<small> in</small></output>
          <button
            type="button"
            aria-label="Increase corn height"
            onclick={() => (cornHeightIn = (cornHeightIn ?? 0) + 1)}>+</button
          >
        </div>
      {/if}
    </div>
  </section>

  <div class="sticky-cta">
    <button
      type="button"
      class="primary"
      onclick={evaluate}
      disabled={evaluating || selectedHerbicideIds.length === 0}
    >
      {evaluating ? 'Checking…' : 'Check safety'}
    </button>
  </div>
{/if}

{#if lastError}
  <p class="error" role="alert">Error: {lastError}</p>
{/if}

{#if result}
  <section
    class="result"
    class:ok={result.ok}
    class:stop={!result.ok}
    aria-live="polite"
    aria-atomic="true"
  >
    {#if result.ok}
      <h2>✓ Safe to spray</h2>

      {#if result.tankMixOrder}
        <h3>Tank-mix order</h3>
        <ol class="mix-order">
          {#each result.tankMixOrder as step (step.order)}
            <li>{step.instruction}</li>
          {/each}
        </ol>
      {/if}

      {#if result.dilutions}
        <h3>Dilution (per {tankSizeGallons}-gal tank)</h3>
        <table class="dilution">
          <thead>
            <tr>
              <th>Product</th>
              <th>Amount</th>
              <th>Acres</th>
              <th>GPA</th>
            </tr>
          </thead>
          <tbody>
            {#each result.dilutions as d (d.pluginId)}
              <tr>
                <td>{d.displayName}</td>
                <td><strong>{d.display}</strong></td>
                <td>{d.acresCovered.toFixed(2)}</td>
                <td>{d.gpaUsed}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <p class="audit">
        Rule version: {result.ruleVersion} • Plugin hashes:
        {#each Object.entries(result.pluginHashes) as [id, h] (id)}
          <code>{id}@{h.slice(0, 8)}</code>
        {/each}
      </p>

      {#if !recordedId}
        <button type="button" class="primary" onclick={recordSpray} disabled={recording}>
          {recording ? 'Recording…' : 'Confirm — record this spray'}
        </button>
      {:else if queuedOffline}
        <p class="recorded queued">
          ☁ Offline — queued as <code>{recordedId}</code>. Will sync to the server when connection
          returns.
        </p>
        <div class="next-actions" aria-label="What's next">
          <a href="/records/pending" class="secondary">View queue</a>
          <a href="/today" class="secondary">Back to today</a>
        </div>
      {:else}
        <p class="recorded">
          ✓ Spray event recorded as <code>{recordedId.slice(0, 8)}…</code>
        </p>
        <div class="next-actions" aria-label="What's next">
          <a href="/today" class="secondary">Back to today</a>
          <a href="/records" class="secondary">View records</a>
          <a href="/spray" class="secondary">Plan another spray</a>
        </div>
      {/if}
    {:else}
      <h2>⛔ STOP — do not spray</h2>
      {#if result.requiresDecon}
        <p>
          The selected sprayer last carried a different chemistry. Run the decontamination wizard
          before this spray will be allowed.
        </p>
        <button type="button" class="primary" onclick={goToDecon}> Open decon wizard → </button>
      {/if}
      <ul class="violations">
        {#each result.violations as v (v.code + JSON.stringify(v.detail))}
          <li>
            <strong>{v.code}</strong>
            <p>{v.message}</p>
            {#if v.detail}
              <details>
                <summary>detail</summary>
                <pre>{JSON.stringify(v.detail, null, 2)}</pre>
              </details>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .prefill-banner {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.6rem 0.9rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    border-left: 4px solid #1f5e3a;
  }
  .prefill-banner a {
    color: #1f5e3a;
    text-decoration: underline;
  }
  .empty-state {
    text-align: center;
    padding: 2rem;
  }
  .empty-state a {
    color: #1f5e3a;
    font-weight: 600;
  }
  .filter-hint {
    background: #fff8ec;
    color: #b35900;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
  }
  .link-button {
    background: none;
    border: none;
    color: #1f5e3a;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    padding: 0;
    min-height: auto;
    min-width: auto;
  }
  .step {
    background: white;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .step h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.5rem;
  }
  .card {
    text-align: left;
    padding: 0.75rem;
    border: 2px solid #d0d7d0;
    border-radius: 6px;
    background: white;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 64px;
    color: inherit;
    font: inherit;
  }
  .card:hover {
    border-color: #1f5e3a;
  }
  .card.selected {
    border-color: #1f5e3a;
    background: #e7f1ea;
  }
  .card small {
    color: #666;
    font-size: 0.8rem;
  }
  .card .warn {
    color: #b35900;
    font-weight: 600;
  }
  .card .ok {
    color: #1f5e3a;
    font-weight: 600;
  }
  .card ul {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    font-size: 0.85rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.75rem;
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .grid input {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1.1rem;
    min-height: 48px;
  }
  .quick-picks {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .pick {
    flex: 1 1 calc(20% - 0.4rem);
    min-width: 70px;
    min-height: 64px;
    background: white;
    color: #1f5e3a;
    border: 2px solid #d0d7d0;
    border-radius: 6px;
    font-weight: 700;
    font-size: 1.4rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .pick span {
    font-size: 0.7rem;
    color: #666;
    font-weight: 500;
    margin-top: 0.1rem;
  }
  .pick.selected {
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }
  .pick.selected span {
    color: rgba(255, 255, 255, 0.85);
  }
  .conditions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
  .stepper {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem;
    background: #f8fbf9;
    border-radius: 6px;
  }
  .stepper-label {
    font-weight: 600;
    color: #1f5e3a;
    font-size: 0.95rem;
  }
  .stepper button {
    width: 56px;
    height: 56px;
    border: 2px solid #1f5e3a;
    background: white;
    color: #1f5e3a;
    border-radius: 6px;
    font-size: 1.6rem;
    font-weight: 700;
    cursor: pointer;
    line-height: 1;
  }
  .stepper button:active {
    background: #1f5e3a;
    color: white;
  }
  .stepper output {
    text-align: center;
    font-family: monospace;
    font-size: 1.6rem;
    font-weight: 700;
    color: #1f5e3a;
    padding: 0.4rem;
  }
  .stepper output small {
    font-size: 0.8rem;
    color: #666;
    font-family: inherit;
    font-weight: 500;
    margin-left: 0.2rem;
  }
  .sticky-cta {
    position: sticky;
    bottom: 0;
    background: linear-gradient(180deg, transparent, #f5f7f4 30%);
    padding: 1rem 0 0.5rem;
    margin: 0 -0.25rem;
    z-index: 50;
  }
  .next-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }
  .next-actions .secondary {
    flex: 1 1 calc(33% - 0.5rem);
    min-width: 120px;
    background: white;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
    border-radius: 6px;
    text-decoration: none;
    text-align: center;
    padding: 0.75rem;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.4;
  }
  .next-actions .secondary:hover {
    background: #f0f8f3;
  }
  .hint {
    color: #555;
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 1rem 1.5rem;
    font-size: 1.1rem;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    margin-top: 0.5rem;
    min-height: 60px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .error {
    color: #b00020;
  }
  .result {
    margin-top: 1.5rem;
    padding: 1.25rem;
    border-radius: 8px;
  }
  .result.ok {
    background: #e7f1ea;
    border: 2px solid #1f5e3a;
  }
  .result.stop {
    background: #fff;
    border: 3px solid #b71c1c;
    padding: 0;
  }
  .result h2 {
    margin: 0 0 1rem;
  }
  .result.stop h2 {
    background: #b71c1c;
    color: #fff;
    margin: 0 0 1rem;
    padding: 1rem 1.25rem;
    font-size: 1.5rem;
    border-radius: 5px 5px 0 0;
  }
  .result.stop > :not(h2) {
    margin-left: 1.25rem;
    margin-right: 1.25rem;
  }
  .result.stop > :last-child {
    margin-bottom: 1.25rem;
  }
  .mix-order {
    padding-left: 1.25rem;
    line-height: 1.6;
  }
  .dilution {
    width: 100%;
    border-collapse: collapse;
    font-size: 1rem;
  }
  .dilution th,
  .dilution td {
    text-align: left;
    padding: 0.5rem;
    border-bottom: 1px solid #ccc;
  }
  .dilution td strong {
    font-size: 1.75rem;
    color: #1f5e3a;
    font-family: monospace;
  }
  .audit {
    color: #666;
    font-size: 0.8rem;
    margin-top: 1rem;
  }
  .audit code {
    background: #fff;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    margin: 0 0.25rem;
    font-size: 0.75rem;
  }
  .recorded {
    background: white;
    padding: 0.75rem;
    border-radius: 4px;
    margin-top: 1rem;
    font-weight: 600;
  }
  .recorded code {
    background: #f5f5f5;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-family: monospace;
  }
  .recorded a {
    color: #1f5e3a;
    text-decoration: underline;
    margin-left: 0.5rem;
  }
  .recorded.queued {
    background: #fff3cd;
    color: #b35900;
    border-left: 4px solid #b35900;
    padding-left: 0.75rem;
  }
  .violations {
    list-style: none;
    padding: 0;
  }
  .violations li {
    background: white;
    padding: 0.75rem;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border-left: 4px solid #b00020;
  }
  .violations li strong {
    color: #b00020;
  }
  .violations p {
    margin: 0.25rem 0;
  }
  details {
    margin-top: 0.5rem;
    font-size: 0.85rem;
  }
  pre {
    background: #f5f5f5;
    padding: 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
  }
</style>
