<script lang="ts">
  import { untrack } from 'svelte';
  import {
    EXTRACTION_METHODS,
    EXTRACTION_METHOD_LABEL,
    LAB_RATINGS,
    LAB_RATING_LABEL,
    UNITS_BASIS_LABEL,
    UNITS_BASES,
    type ExtractionMethod,
    type LabRating,
    type RatedNutrient,
    type UnitsBasis
  } from '$lib/fertility/soilInterpret';
  import {
    buildSoilTestBody,
    type SetupSoilTestResult,
    type SoilTestPlace
  } from '$lib/fertility/soilTestForm';
  import DocumentAttach from '$lib/components/documents/DocumentAttach.svelte';

  interface Props {
    places: SoilTestPlace[];
    canEdit: boolean;
    initialBlockId?: string;
    onDone: (result: SetupSoilTestResult) => void;
  }

  const { places, canEdit, initialBlockId, onDone }: Props = $props();
  const uid = $props.id();

  const NUTRIENTS: Array<{ id: RatedNutrient; label: string }> = [
    { id: 'p', label: 'Phosphorus (P)' },
    { id: 'k', label: 'Potassium (K)' },
    { id: 'ca', label: 'Calcium (Ca)' },
    { id: 'mg', label: 'Magnesium (Mg)' }
  ];

  function todayLocal(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  let blockId = $state(
    untrack(() =>
      places.some((p) => p.id === initialBlockId) ? (initialBlockId ?? '') : (places[0]?.id ?? '')
    )
  );
  let sampledOn = $state(todayLocal());
  let lab = $state('');
  let extractionMethod = $state<ExtractionMethod | ''>('');
  let unitsBasis = $state<UnitsBasis>('ppm');
  let ph = $state<number | null>(null);
  let bufferPh = $state<number | null>(null);
  let organicMatterPct = $state<number | null>(null);
  let nitrate = $state<number | null>(null);
  let nutrients = $state<Record<RatedNutrient, number | null>>({
    p: null,
    k: null,
    ca: null,
    mg: null
  });
  let ratings = $state<Record<RatedNutrient, LabRating | ''>>({ p: '', k: '', ca: '', mg: '' });
  let documentId = $state<string | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const built = buildSoilTestBody({
      blockId,
      sampledOn,
      lab,
      extractionMethod,
      unitsBasis,
      ph,
      bufferPh,
      organicMatterPct,
      nitrate,
      nutrients,
      ratings
    });
    if (!built.ok) {
      error = built.error;
      return;
    }
    saving = true;
    try {
      const res = await fetch('/api/fertility/soil-tests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(documentId ? { ...built.body, documentId } : built.body)
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        error =
          res.status === 403
            ? 'Only the owner can add a soil test.'
            : res.status === 409 && body.error
              ? body.error
              : "We couldn't save this soil test. Check the numbers and try again.";
        return;
      }
      const out = (await res.json()) as { soilTest: { id: string; blockId: string } };
      onDone({ soilTestId: out.soilTest.id, blockId: out.soilTest.blockId });
    } catch {
      error = "We couldn't reach CropCard. Soil tests save online, so try again with signal.";
    } finally {
      saving = false;
    }
  }
</script>

{#if !canEdit}
  <p class="ask-owner" role="note">
    Ask the owner to add the soil test. Once it's saved it shows up on the Cards page.
  </p>
{:else if places.length === 0}
  <p class="ask-owner" role="note">
    Add a bed or block first, so the soil test has somewhere to go.
  </p>
{:else}
  <form class="setup-soil" onsubmit={submit} data-testid="setup-soil-test">
    <p class="lede">
      Copy the numbers from your lab report. Leave anything blank that your report doesn't show.
    </p>

    <label for="{uid}-place">Where was the sample taken?</label>
    <select id="{uid}-place" bind:value={blockId} data-autofocus>
      {#each places as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>

    <div class="pair">
      <label>
        <span>Date sampled</span>
        <input type="date" bind:value={sampledOn} required />
      </label>
      <label>
        <span>Lab <span class="optional">(optional)</span></span>
        <input type="text" maxlength="120" autocomplete="off" bind:value={lab} />
      </label>
    </div>

    <fieldset>
      <legend>How does your report list nutrients?</legend>
      <p class="help">Look at the column heading next to phosphorus and potassium.</p>
      <div class="units">
        {#each UNITS_BASES as u (u)}
          <label class="unit" class:on={unitsBasis === u}>
            <input type="radio" name="{uid}-units" value={u} bind:group={unitsBasis} />
            <span>{UNITS_BASIS_LABEL[u]}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <label for="{uid}-method">Test method <span class="optional">(optional)</span></label>
    <select id="{uid}-method" bind:value={extractionMethod}>
      <option value="">Not listed</option>
      {#each EXTRACTION_METHODS as m (m)}
        <option value={m}>{EXTRACTION_METHOD_LABEL[m]}</option>
      {/each}
    </select>

    <div class="pair">
      <label>
        <span>Soil pH</span>
        <input type="number" min="0" max="14" step="0.01" inputmode="decimal" bind:value={ph} />
      </label>
      <label>
        <span>Buffer pH <span class="optional">(optional)</span></span>
        <input
          type="number"
          min="0"
          max="14"
          step="0.01"
          inputmode="decimal"
          bind:value={bufferPh}
        />
      </label>
    </div>

    <fieldset>
      <legend>Nutrients</legend>
      <p class="help">If the lab rated a nutrient low, medium or high, pick that rating too.</p>
      {#each NUTRIENTS as n (n.id)}
        <div class="nutrient">
          <label>
            <span>{n.label} ({unitsBasis === 'ppm' ? 'ppm' : 'lb/A'})</span>
            <input
              type="number"
              min="0"
              step="any"
              inputmode="decimal"
              bind:value={nutrients[n.id]}
            />
          </label>
          <label>
            <span>Lab's rating</span>
            <select bind:value={ratings[n.id]}>
              <option value="">None</option>
              {#each LAB_RATINGS as r (r)}
                <option value={r}>{LAB_RATING_LABEL[r]}</option>
              {/each}
            </select>
          </label>
        </div>
      {/each}
      <label class="nitrate">
        <span>
          Nitrate (NO₃-N, {unitsBasis === 'ppm' ? 'ppm' : 'lb/A'})
          <span class="optional">(optional)</span>
        </span>
        <input type="number" min="0" step="any" inputmode="decimal" bind:value={nitrate} />
      </label>
    </fieldset>

    <label>
      <span>Organic matter (%) <span class="optional">(optional)</span></span>
      <input
        type="number"
        min="0"
        max="100"
        step="0.1"
        inputmode="decimal"
        bind:value={organicMatterPct}
      />
    </label>

    <fieldset>
      <legend>Lab report <span class="optional">(optional)</span></legend>
      <p class="help">Attach the PDF or a photo of the report so you can find it later.</p>
      <DocumentAttach
        {documentId}
        kind="lab-report"
        {canEdit}
        onchange={(id) => {
          documentId = id;
        }}
        ondelete={(id) => {
          if (documentId === id) documentId = null;
        }}
      />
    </fieldset>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <button class="primary" type="submit" disabled={saving}>
      {saving ? 'Saving…' : 'Save soil test'}
    </button>
  </form>
{/if}

<style>
  .setup-soil {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .lede {
    margin: 0 0 var(--space-2);
    color: var(--color-ink-soft);
  }
  label,
  legend {
    font-weight: 600;
    font-size: var(--font-size-body);
    color: var(--color-ink);
  }
  .pair label,
  .nutrient label,
  .nitrate,
  .setup-soil > label:has(input) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .pair label span,
  .nutrient label span,
  .nitrate span {
    font-weight: 500;
  }
  input,
  select {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    color: var(--color-ink);
    width: 100%;
    box-sizing: border-box;
  }
  input[type='radio'] {
    min-height: 0;
  }
  .pair,
  .nutrient {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0 0 var(--space-2);
    min-width: 0;
  }
  legend {
    margin-bottom: var(--space-1);
  }
  .units {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .unit {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    cursor: pointer;
    font-weight: 500;
  }
  .unit input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .unit:focus-within {
    box-shadow: var(--focus-ring);
  }
  .unit.on {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .help {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
  .primary {
    min-height: 48px;
    margin-top: var(--space-2);
    border: none;
    border-radius: var(--radius-input);
    background: var(--color-forest);
    color: var(--color-cream);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    margin: 0;
    color: var(--color-rust);
  }
  .ask-owner {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-wheat-bg);
    color: var(--color-ink);
  }
</style>
