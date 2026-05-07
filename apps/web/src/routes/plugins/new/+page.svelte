<script lang="ts">
  import { goto } from '$app/navigation';
  import { CHEMISTRY_CLASSES, type ChemistryClass } from '$lib/safety/types';
  import { CROP_FAMILIES, type CropFamily } from '$lib/safety/cropFamilyLethality';

  let { data } = $props();

  let mode = $state<'crop' | 'herbicide'>('crop');

  // Crop form
  let cropPluginId = $state('');
  let cropDisplayName = $state('');
  let cropFamily = $state<CropFamily>('corn');
  let cropDtmMin = $state<number | undefined>(undefined);
  let cropDtmMax = $state<number | undefined>(undefined);
  let cropRowSpacing = $state<number | undefined>(undefined);
  let cropPHI = $state<number | undefined>(undefined);
  let cropIndicators = $state(''); // newline-separated
  let cropNotes = $state('');

  // Herbicide form
  let hPluginId = $state('');
  let hDisplayName = $state('');
  let hChemistryClass = $state<ChemistryClass>('synthetic-auxin');
  let hActiveName = $state('');
  let hRateAmount = $state<number | undefined>(undefined);
  let hRateUnit = $state<'oz' | 'fl-oz' | 'lb' | 'pt' | 'qt'>('fl-oz');
  let hGpa = $state(15);
  let hRequiresAMS = $state(false);
  let hDeconRequired = $state(false);
  let hSafeForCropIds = $state(''); // comma-separated
  let hNotes = $state('');

  let submitting = $state(false);
  let submitError = $state<string | null>(null);

  function buildCropPayload() {
    const indicators = cropIndicators
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      pluginId: cropPluginId.trim(),
      type: 'crop' as const,
      displayName: cropDisplayName.trim(),
      version: '1.0.0',
      cropFamily,
      ...(cropDtmMin && cropDtmMax ? { daysToMaturity: { min: cropDtmMin, max: cropDtmMax } } : {}),
      ...(cropRowSpacing ? { defaultRowSpacingInches: cropRowSpacing } : {}),
      ...(cropPHI != null ? { preHarvestIntervalDays: cropPHI } : {}),
      ...(indicators.length > 0 ? { harvestIndicators: indicators } : {}),
      ...(cropNotes.trim() ? { notes: cropNotes.trim() } : {})
    };
  }

  function buildHerbicidePayload() {
    const safeFor = hSafeForCropIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      pluginId: hPluginId.trim(),
      type: 'herbicide' as const,
      displayName: hDisplayName.trim(),
      version: '1.0.0',
      activeIngredients: [{ name: hActiveName.trim(), chemistryClass: hChemistryClass }],
      ratePerAcre: { amount: hRateAmount ?? 0, unit: hRateUnit },
      gpaCalibration: hGpa,
      requiresAMS: hRequiresAMS,
      deconRequired: hDeconRequired,
      ...(safeFor.length > 0 ? { labelClaims: { safeForCropPluginIds: safeFor } } : {}),
      ...(hNotes.trim() ? { notes: hNotes.trim() } : {})
    };
  }

  const preview = $derived(mode === 'crop' ? buildCropPayload() : buildHerbicidePayload());

  async function submit() {
    submitError = null;
    submitting = true;
    try {
      const res = await fetch('/api/plugins/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preview)
      });
      const out = await res.json();
      if (!res.ok) {
        submitError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      goto('/plugins');
    } catch (e) {
      submitError = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }
</script>

<h1>Author a new plugin</h1>

{#if !data.canEdit}
  <section class="card role-locked">
    <h2>Owner role required</h2>
    <p>
      Authoring plugins changes the safety knowledge base for the whole farm. Sign in as Owner to
      use this wizard. Helpers can browse the existing catalog at <a href="/plugins">/plugins</a>.
    </p>
    <a class="primary" href="/signin">Sign in</a>
  </section>
{:else}
  <p class="lede">
    Fill in the guided form. The kernel validates against the schema + bypass-attempt matrix at
    registration. Plugins claiming herbicide safety on a crop family the chemistry kills are
    rejected.
  </p>

  <section class="card">
    <h2>Type</h2>
    <div class="modes">
      <button class="mode" class:active={mode === 'crop'} onclick={() => (mode = 'crop')}
        >Crop variety</button
      >
      <button class="mode" class:active={mode === 'herbicide'} onclick={() => (mode = 'herbicide')}
        >Herbicide</button
      >
    </div>
  </section>

  {#if mode === 'crop'}
    <section class="card">
      <h2>Crop fields</h2>
      <div class="grid">
        <label>
          Plugin ID (kebab-case, ≤64 chars)
          <input type="text" bind:value={cropPluginId} placeholder="e.g. corn-bantam-sweet" />
        </label>
        <label>
          Display name
          <input type="text" bind:value={cropDisplayName} placeholder="e.g. Bantam Sweet Corn" />
        </label>
        <label>
          Crop family
          <select bind:value={cropFamily}>
            {#each CROP_FAMILIES as f}<option value={f}>{f}</option>{/each}
          </select>
        </label>
        <label>
          Days to maturity (min)
          <input type="number" min="1" bind:value={cropDtmMin} />
        </label>
        <label>
          Days to maturity (max)
          <input type="number" min="1" bind:value={cropDtmMax} />
        </label>
        <label>
          Default row spacing (in)
          <input type="number" min="1" bind:value={cropRowSpacing} />
        </label>
        <label>
          Pre-harvest interval (days)
          <input type="number" min="0" bind:value={cropPHI} />
        </label>
      </div>
      <label class="full">
        Harvest indicators (one per line)
        <textarea
          rows="4"
          bind:value={cropIndicators}
          placeholder="e.g.
Husks fully dry and papery
Black layer at kernel tip"
        ></textarea>
      </label>
      <label class="full">
        Notes
        <textarea rows="3" bind:value={cropNotes}></textarea>
      </label>
    </section>
  {:else}
    <section class="card">
      <h2>Herbicide fields</h2>
      <div class="grid">
        <label>
          Plugin ID
          <input type="text" bind:value={hPluginId} placeholder="e.g. atrazine-4l" />
        </label>
        <label>
          Display name
          <input type="text" bind:value={hDisplayName} placeholder="e.g. Atrazine 4L" />
        </label>
        <label>
          Chemistry class
          <select bind:value={hChemistryClass}>
            {#each CHEMISTRY_CLASSES as c}<option value={c}>{c}</option>{/each}
          </select>
        </label>
        <label>
          Active ingredient name
          <input type="text" bind:value={hActiveName} placeholder="e.g. atrazine" />
        </label>
        <label>
          Rate / acre (amount)
          <input type="number" step="0.01" min="0" bind:value={hRateAmount} />
        </label>
        <label>
          Unit
          <select bind:value={hRateUnit}>
            <option value="fl-oz">fl-oz</option>
            <option value="oz">oz</option>
            <option value="pt">pt</option>
            <option value="qt">qt</option>
            <option value="lb">lb</option>
          </select>
        </label>
        <label>
          GPA calibration
          <input type="number" min="1" bind:value={hGpa} />
        </label>
        <label>
          Safe for crop plugin IDs (comma-separated)
          <input
            type="text"
            bind:value={hSafeForCropIds}
            placeholder="e.g. corn-bantam-sweet, corn-bloody-butcher"
          />
        </label>
        <label class="checkbox">
          <input type="checkbox" bind:checked={hRequiresAMS} />
          Requires AMS
        </label>
        <label class="checkbox">
          <input type="checkbox" bind:checked={hDeconRequired} />
          Decon required after use
        </label>
      </div>
      <label class="full">
        Notes
        <textarea rows="3" bind:value={hNotes}></textarea>
      </label>
    </section>
  {/if}

  <section class="card">
    <h2>JSON preview</h2>
    <pre>{JSON.stringify(preview, null, 2)}</pre>
  </section>

  <button class="primary" onclick={submit} disabled={submitting}>
    {submitting ? 'Saving…' : 'Save plugin'}
  </button>
  {#if submitError}<p class="error">{submitError}</p>{/if}
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
  .modes {
    display: flex;
    gap: 0.5rem;
  }
  .mode {
    flex: 1;
    padding: 0.75rem;
    border: 2px solid #d0d7d0;
    border-radius: 6px;
    background: white;
    color: #1f5e3a;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    min-height: 56px;
  }
  .mode.active {
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  label.full {
    display: block;
    margin-top: 0.75rem;
  }
  label.checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
  input[type='text'],
  input[type='number'],
  select,
  textarea {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    font-family: inherit;
  }
  textarea {
    font-family: monospace;
    min-height: auto;
  }
  pre {
    background: #f5f5f5;
    padding: 0.75rem;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85rem;
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
    min-height: 56px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .error {
    color: #b00020;
    margin-top: 0.5rem;
  }
  .role-locked {
    border-left: 4px solid #b35900;
    background: #fff8ec;
    padding: 1.5rem;
    text-align: center;
  }
  .role-locked h2 {
    color: #b35900;
  }
  .role-locked .primary {
    display: inline-block;
    margin-top: 1rem;
    text-decoration: none;
    width: auto;
    padding: 0.9rem 2rem;
  }
</style>
