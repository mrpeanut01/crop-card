<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import { calibrationDistance, computeCalibratedGpa } from '$lib/dilution/calibration';
  import { calibrationRig, type CalibrationRig } from '$lib/dilution/calibrationRig';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import type { SetupCalibrationResult } from '$lib/setup/types';

  interface SprayerOption {
    id: string;
    label: string;
    calibratedGpa: number | null;
    calibrationDate?: number;
    templateId?: string;
    tankGal?: number;
  }

  interface Props {
    sprayers: SprayerOption[];
    canSave: boolean;
    initialSprayerId?: string;
    /** Hides the sprayer picker when the caller already chose one. */
    lockSprayer?: boolean;
    onSaved?: (result: SetupCalibrationResult) => void;
  }

  const { sprayers, canSave, initialSprayerId, lockSprayer = false, onSaved }: Props = $props();
  const uid = $props.id();

  let selectedSprayerId = $state(untrack(() => initialSprayerId ?? sprayers[0]?.id ?? ''));
  let spreadInches = $state<number | undefined>(20);
  let strideFeet = $state(2.5);
  let ouncesCollected = $state<number | undefined>(undefined);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saveOk = $state(false);
  let pendingSent = $state(false);

  const sprayer = $derived(sprayers.find((s) => s.id === selectedSprayerId));
  let rigOverride = $state<CalibrationRig | null>(null);
  const rig = $derived<CalibrationRig>(rigOverride ?? (sprayer ? calibrationRig(sprayer) : 'walk'));
  const metric = $derived(currentPrefs().units === 'metric');
  const gpaText = (gpa: number) =>
    `${gpa} GPA${metric ? ` (${fmt.qty(gpa, 'volumePerArea')})` : ''}`;

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
    pendingSent = false;
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
      const status = out.status === 'pending-owner-review' ? 'pending-owner-review' : 'applied';
      if (status === 'pending-owner-review') pendingSent = true;
      else saveOk = true;
      await invalidateAll();
      onSaved?.({ sprayerId: sprayer.id, calibratedGpa: gpaResult.gpa, status });
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<div class="calibration-wizard">
  {#if !lockSprayer}
    <section class="card" aria-labelledby="{uid}-step-1">
      <h2 id="{uid}-step-1">1. Sprayer</h2>
      <label for="{uid}-sprayer-select"> Choose sprayer </label>
      <select id="{uid}-sprayer-select" bind:value={selectedSprayerId}>
        {#each sprayers as s (s.id)}
          <option value={s.id}>
            {s.label} ({s.calibratedGpa == null
              ? 'Uncalibrated'
              : `current: ${gpaText(s.calibratedGpa)}`})
          </option>
        {/each}
      </select>
      {#if sprayer?.calibrationDate}
        <p class="meta">
          Last calibrated {fmt.instant(sprayer.calibrationDate, 'date')}
        </p>
      {/if}
    </section>
  {/if}

  <section class="card" aria-labelledby="{uid}-step-2">
    <h2 id="{uid}-step-2">{lockSprayer ? '1' : '2'}. Spray width</h2>
    <fieldset class="rig">
      <legend>How do you spray with it?</legend>
      <label class="rig-choice">
        <input
          type="radio"
          name="{uid}-rig"
          value="walk"
          checked={rig === 'walk'}
          onchange={() => (rigOverride = 'walk')}
        />
        Walk with it (backpack or handheld)
      </label>
      <label class="rig-choice">
        <input
          type="radio"
          name="{uid}-rig"
          value="drive"
          checked={rig === 'drive'}
          onchange={() => (rigOverride = 'drive')}
        />
        Drive it (boom, ATV or 3-point)
      </label>
    </fieldset>
    <p class="hint">
      {#if rig === 'walk'}
        The width of the spray on the ground at your normal walking height.
      {:else}
        The spacing between two nozzles on the boom. For a boomless nozzle, the width it covers.
      {/if}
    </p>
    <div class="grid">
      <label>
        {rig === 'walk' ? 'Spray width (in)' : 'Nozzle spacing (in)'}
        <input type="number" min="1" step="1" bind:value={spreadInches} />
      </label>
      {#if rig === 'walk'}
        <label>
          Your stride (ft)
          <input type="number" min="0.5" step="0.1" bind:value={strideFeet} />
        </label>
      {/if}
    </div>
  </section>

  {#if distance}
    <section class="card distance-card" aria-labelledby="{uid}-step-3">
      <h2 id="{uid}-step-3">
        {lockSprayer ? '2' : '3'}. {rig === 'walk' ? 'Walk this distance' : 'Drive this distance'}
      </h2>
      <p class="big-distance">
        <strong>{distance.distanceFeet}</strong> ft
        {#if rig === 'walk'}
          <span>≈ {distance.steps} steps at {distance.strideFeet} ft</span>
        {/if}
      </p>
      {#if rig === 'walk'}
        <p class="hint">
          Mark a start and end point this far apart. Walk at normal spray speed with the sprayer
          running, catching everything it puts out in a measuring jug. Read the jug in fluid ounces.
        </p>
      {:else}
        <p class="hint" data-testid="calibration-drive-steps">
          Mark a start and end point this far apart. Drive the course at your spraying speed and
          gear, and time it in seconds. Then, parked at the same engine speed and pressure, catch
          what ONE nozzle puts out for that many seconds. Read the jug in fluid ounces.
        </p>
      {/if}
    </section>
  {/if}

  <section class="card" aria-labelledby="{uid}-step-4">
    <h2 id="{uid}-step-4">{lockSprayer ? '3' : '4'}. Ounces collected</h2>
    <label>
      {rig === 'walk' ? 'Fluid ounces in the jug' : 'Fluid ounces from one nozzle'}
      <input type="number" min="0" step="0.1" bind:value={ouncesCollected} />
    </label>
  </section>

  {#if gpaResult}
    <section
      class="card result-card {gpaResult.outsideSanityBand ? 'warn' : 'ok'}"
      aria-labelledby="{uid}-result-title"
      aria-live="polite"
    >
      <h2 id="{uid}-result-title">Result</h2>
      {#if gpaResult.outsideSanityBand}
        <p class="warn-msg">
          ⚠ {gpaResult.gpa} GPA is outside the 5–60 sanity band. Check your spread-width measurement and
          re-run before saving.
        </p>
      {/if}
      <p class="big-gpa">
        <strong>{gpaResult.gpa}</strong> <span>GPA</span>
      </p>
      {#if metric}
        <p class="meta" data-testid="gpa-metric">≈ {fmt.qty(gpaResult.gpa, 'volumePerArea')}</p>
      {/if}
      {#if canSave}
        <button
          class="primary"
          onclick={save}
          disabled={saving || !sprayer || gpaResult.outsideSanityBand}
        >
          {saving ? 'Saving…' : `Save to ${sprayer?.label ?? '…'}`}
        </button>
        {#if gpaResult.outsideSanityBand}
          <p class="error">Cannot save — re-measure before recording (5–60 GPA expected range).</p>
        {/if}
        {#if saveError}<p class="error">{saveError}</p>{/if}
        {#if saveOk}<p class="ok-msg">✓ Saved. Future spray dilutions will use this GPA.</p>{/if}
      {:else}
        <p class="lock-msg">
          Owner role required to apply this calibration to {sprayer?.label ?? 'the sprayer'}. You
          can send the result to the owner for review.
        </p>
        <button
          class="primary"
          onclick={save}
          disabled={saving || !sprayer || pendingSent || gpaResult.outsideSanityBand}
        >
          {#if saving}
            Sending…
          {:else if pendingSent}
            ✓ Sent to owner
          {:else}
            Send {gpaResult.gpa} GPA to owner →
          {/if}
        </button>
        {#if saveError}<p class="error">{saveError}</p>{/if}
        {#if pendingSent}
          <p class="ok-msg">
            The owner will review and apply (or reject) this on their next visit to /calibrate.
          </p>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .rig {
    border: none;
    padding: 0;
    margin: 0 0 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rig legend {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .rig-choice {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    cursor: pointer;
  }
  .rig-choice input {
    width: 20px;
    height: 20px;
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
    color: #4a2900;
    background: #fff3cd;
    padding: 0.6rem 0.9rem;
    border-radius: 4px;
    margin: 0 0 0.75rem;
  }
</style>
