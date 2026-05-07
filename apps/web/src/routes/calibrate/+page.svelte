<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { calibrationDistance, computeCalibratedGpa } from '$lib/dilution/calibration';

  let { data } = $props();

  let selectedSprayerId = $state(data.sprayers[0]?.id ?? '');
  let spreadInches = $state<number | undefined>(20);
  let strideFeet = $state(2.5);
  let ouncesCollected = $state<number | undefined>(undefined);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saveOk = $state(false);

  const sprayer = $derived(data.sprayers.find((s) => s.id === selectedSprayerId));

  const distance = $derived.by(() => {
    if (!spreadInches || spreadInches <= 0) return null;
    try {
      return calibrationDistance(spreadInches, strideFeet);
    } catch {
      return null;
    }
  });

  const gpaResult = $derived.by(() => {
    if (!spreadInches || spreadInches <= 0) return null;
    if (ouncesCollected === undefined || ouncesCollected < 0) return null;
    try {
      return computeCalibratedGpa(spreadInches, ouncesCollected);
    } catch {
      return null;
    }
  });

  async function save() {
    if (!sprayer || !gpaResult) return;
    saving = true;
    saveError = null;
    saveOk = false;
    try {
      const res = await fetch(`/api/sprayers/${encodeURIComponent(sprayer.id)}/calibration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calibratedGpa: gpaResult.gpa,
          spreadInches,
          ouncesCollected
        })
      });
      const out = await res.json();
      if (!res.ok) {
        saveError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      saveOk = true;
      await invalidateAll();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<h1>Sprayer calibration</h1>
<p class="lede">
  1/128-acre method (UC-10, FR-12). Walk the calibration distance at your normal spray speed,
  collect output in a jug, and the fluid ounces you collect equals your gallons-per-acre. The
  dilution calculator uses this GPA to scale every product rate.
</p>

<section class="card" aria-labelledby="step-1">
  <h2 id="step-1">1. Sprayer</h2>
  <label for="sprayer-select"> Choose sprayer </label>
  <select id="sprayer-select" bind:value={selectedSprayerId}>
    {#each data.sprayers as s (s.id)}
      <option value={s.id}>
        {s.label} (current: {s.calibratedGpa} GPA)
      </option>
    {/each}
  </select>
  {#if sprayer?.calibrationDate}
    <p class="meta">
      Last calibrated {new Date(sprayer.calibrationDate).toLocaleDateString()}
    </p>
  {/if}
</section>

<section class="card" aria-labelledby="step-2">
  <h2 id="step-2">2. Spray width</h2>
  <p class="hint">
    For a single-nozzle handheld: the effective spray fan width on the ground at your normal walking
    height. For a boom: the per-nozzle spacing.
  </p>
  <div class="grid">
    <label>
      Spray width (in)
      <input type="number" min="1" step="1" bind:value={spreadInches} />
    </label>
    <label>
      Your stride (ft)
      <input type="number" min="0.5" step="0.1" bind:value={strideFeet} />
    </label>
  </div>
</section>

{#if distance}
  <section class="card distance-card" aria-labelledby="step-3">
    <h2 id="step-3">3. Walk this distance</h2>
    <p class="big-distance">
      <strong>{distance.distanceFeet}</strong> ft
      <span>≈ {distance.steps} steps at {distance.strideFeet} ft</span>
    </p>
    <p class="hint">
      Mark a start and end point this far apart. Walk at normal spray speed with the sprayer
      running, collecting all output in a graduated jug. Pour off and read the volume in fluid
      ounces.
    </p>
  </section>
{/if}

<section class="card" aria-labelledby="step-4">
  <h2 id="step-4">4. Ounces collected</h2>
  <label>
    Fluid ounces in the jug
    <input type="number" min="0" step="0.1" bind:value={ouncesCollected} />
  </label>
</section>

{#if gpaResult}
  <section
    class="card result-card {gpaResult.outsideSanityBand ? 'warn' : 'ok'}"
    aria-labelledby="result-title"
    aria-live="polite"
  >
    <h2 id="result-title">Result</h2>
    {#if gpaResult.outsideSanityBand}
      <p class="warn-msg">
        ⚠ {gpaResult.gpa} GPA is outside the 5–60 sanity band. Check your spread-width measurement and
        re-run before saving.
      </p>
    {/if}
    <p class="big-gpa">
      <strong>{gpaResult.gpa}</strong> <span>GPA</span>
    </p>
    {#if data.canSave}
      <button class="primary" onclick={save} disabled={saving || !sprayer}>
        {saving ? 'Saving…' : `Save to ${sprayer?.label ?? '…'}`}
      </button>
      {#if saveError}<p class="error">{saveError}</p>{/if}
      {#if saveOk}<p class="ok-msg">✓ Saved. Future spray dilutions will use this GPA.</p>{/if}
    {:else}
      <p class="lock-msg">Owner role required to save calibration.</p>
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
  .hint {
    color: #555;
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }
  .meta {
    color: #777;
    font-size: 0.85rem;
    margin: 0.4rem 0 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    margin-bottom: 0.4rem;
  }
  input[type='number'],
  select {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .distance-card {
    background: #f8fbf9;
    border-left: 4px solid #1f5e3a;
  }
  .big-distance {
    font-size: 1.5rem;
    margin: 0.5rem 0;
  }
  .big-distance strong {
    font-size: 2.4rem;
    color: #1f5e3a;
    font-family: monospace;
  }
  .big-distance span {
    color: #555;
    font-size: 1rem;
    margin-left: 0.5rem;
  }
  .result-card.ok {
    border-left: 4px solid #1f5e3a;
    background: #f0f8f3;
  }
  .result-card.warn {
    border-left: 4px solid #b35900;
    background: #fff8ec;
  }
  .big-gpa {
    margin: 0.5rem 0 1rem;
    font-size: 1.3rem;
  }
  .big-gpa strong {
    font-size: 3rem;
    color: #1f5e3a;
    font-family: monospace;
  }
  .big-gpa span {
    color: #555;
    margin-left: 0.5rem;
  }
  .warn-msg {
    background: #fff3cd;
    color: #b35900;
    padding: 0.75rem;
    border-radius: 4px;
    margin: 0 0 1rem;
    font-weight: 600;
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
    min-height: 60px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .error {
    color: #b00020;
    margin: 0.5rem 0 0;
  }
  .ok-msg {
    color: #1f5e3a;
    font-weight: 600;
    margin: 0.5rem 0 0;
  }
  .lock-msg {
    color: #b35900;
    background: #fff3cd;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
  }
</style>
