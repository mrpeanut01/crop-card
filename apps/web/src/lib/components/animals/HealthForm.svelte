<script lang="ts">
  import { noteHoldWrite } from '$lib/animals/recordClient';
  import { untrack } from 'svelte';
  import './animalForms.css';
  import {
    OFFLINE_MESSAGE,
    errorFromResponse,
    localInputToMs,
    msToLocalInput
  } from '$lib/animals/display';
  import {
    HEALTH_KIND_CHOICES,
    ROUTE_CHOICES,
    locksWhenSaved,
    namesProduct
  } from '$lib/animals/healthCopy';
  import type { HealthRecordInput } from '$lib/animals/recordApiSchemas';
  import type { HealthEventKind } from '$lib/safety/animalWithdrawal';

  interface Props {
    subjectType: 'animal' | 'group';
    subjectId: string;
    foodProducing: boolean;
    /** False for a household pet: no withdrawal questions. */
    showHolds?: boolean;
    /** Only the owner can say a product was used as the label says (C-10, C-19). */
    isOwner?: boolean;
    products: { id: string; name: string }[];
    stock: { id: string; name: string; unit: string }[];
    onDone: (result: { warnings?: { message: string }[] }, text: string) => void;
    /** A care task (32D) fixes what was given and posts elsewhere. */
    lockedKind?: HealthEventKind;
    initialProductPluginId?: string | null;
    submit?: (body: HealthRecordInput) => Promise<Response>;
    submitLabel?: string;
  }

  const {
    subjectType,
    subjectId,
    foodProducing,
    showHolds = true,
    isOwner = true,
    products,
    stock,
    onDone,
    lockedKind,
    initialProductPluginId = null,
    submit: submitTo,
    submitLabel = 'Save'
  }: Props = $props();
  const uid = $props.id();

  let kind = $state<HealthEventKind>(untrack(() => lockedKind ?? 'treatment'));
  let productName = $state('');
  let productPluginId = $state(untrack(() => initialProductPluginId ?? ''));
  let stockItemId = $state('');
  let dose = $state<number | null>(null);
  let doseUnit = $state('');
  let route = $state('');
  let at = $state(msToLocalInput(Date.now()));
  let moreDoses = $state(false);
  let lastDose = $state('');
  let labelUse = $state<'label' | 'extra-label-vet' | 'unknown'>('unknown');
  let vetName = $state('');
  let lotNumber = $state('');
  let notes = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  const hasProduct = $derived(
    namesProduct({ productName, productPluginId, stockItemId }) && kind !== 'note'
  );
  const atMs = $derived(localInputToMs(at));
  const lockNote = $derived(
    foodProducing && atMs !== null && locksWhenSaved(kind, hasProduct, atMs, Date.now())
  );
  const askUse = $derived(hasProduct && showHolds);
  const showVet = $derived(kind === 'vet-visit' || (askUse && labelUse === 'extra-label-vet'));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (atMs === null) {
      error = 'Pick when it was given.';
      return;
    }
    const body: HealthRecordInput = {
      subjectType,
      subjectId,
      kind,
      administeredAt: Math.min(atMs, Date.now())
    };
    if (kind !== 'note') {
      if (productName.trim()) body.productName = productName.trim();
      if (productPluginId) body.productPluginId = productPluginId;
      if (stockItemId) body.stockItemId = stockItemId;
      if (dose !== null && dose > 0) body.dose = dose;
      if (doseUnit.trim()) body.doseUnit = doseUnit.trim();
      if (route) body.route = route as HealthRecordInput['route'];
      if (lotNumber.trim()) body.lotNumber = lotNumber.trim();
    }
    if (hasProduct) {
      if (askUse) body.labelUse = labelUse;
      if (moreDoses) body.courseOpen = true;
      else if (lastDose) {
        const end = localInputToMs(lastDose);
        if (end === null || end < body.administeredAt) {
          error = 'The last dose cannot be before the first dose.';
          return;
        }
        body.courseEndAt = end;
      }
    }
    if (showVet && vetName.trim()) body.vetName = vetName.trim();
    if (askUse && labelUse === 'extra-label-vet' && !vetName.trim()) {
      error = 'Add the name of the vet who directed it.';
      return;
    }
    if (notes.trim()) body.notes = notes.trim();
    saving = true;
    try {
      const res = submitTo
        ? await submitTo(body)
        : await fetch('/api/animals/health/record', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      const out = (await res.json()) as { warnings?: { message: string }[] };
      if (!submitTo) await noteHoldWrite('animal-health', body);
      onDone(out, 'Saved.');
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      saving = false;
    }
  }
</script>

<form class="af-form" onsubmit={submit} novalidate aria-label="Record health">
  <fieldset class="af-fieldset" hidden={!!lockedKind}>
    <legend class="af-legend">What was it?</legend>
    <div class="af-tiles">
      {#each HEALTH_KIND_CHOICES as c (c.value)}
        <label class="af-tile" class:on={kind === c.value}>
          <input type="radio" name="{uid}-kind" value={c.value} bind:group={kind} />
          <span>{c.label}</span>
        </label>
      {/each}
    </div>
  </fieldset>

  {#if kind !== 'note'}
    <label class="af-label" for="{uid}-product">
      {kind === 'vet-visit' || kind === 'injury' ? 'Medicine given' : 'Product'}
      <span class="af-optional">(optional)</span>
    </label>
    <input
      id="{uid}-product"
      class="af-input"
      type="text"
      maxlength="200"
      autocomplete="off"
      placeholder="Name on the bottle"
      bind:value={productName}
    />
    {#if products.length > 0}
      <label class="af-label" for="{uid}-plugin">From the product library</label>
      <select id="{uid}-plugin" class="af-input" bind:value={productPluginId}>
        <option value="">Not in the library</option>
        {#each products as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    {/if}
    {#if stock.length > 0}
      <label class="af-label" for="{uid}-stock">
        Taken from stock <span class="af-optional">(optional)</span>
      </label>
      <select id="{uid}-stock" class="af-input" bind:value={stockItemId}>
        <option value="">Not from stock</option>
        {#each stock as s (s.id)}<option value={s.id}>{s.name} ({s.unit})</option>{/each}
      </select>
    {/if}
    <div class="af-row">
      <label>
        Dose <span class="af-optional">(optional)</span>
        <input class="af-input" type="number" min="0" step="any" bind:value={dose} />
      </label>
      <label>
        Unit
        <input
          class="af-input"
          type="text"
          maxlength="20"
          list="{uid}-units"
          placeholder="mL"
          bind:value={doseUnit}
        />
      </label>
    </div>
    <datalist id="{uid}-units">
      <option value="mL"></option>
      <option value="fl-oz"></option>
      <option value="oz"></option>
      <option value="g"></option>
      <option value="count"></option>
    </datalist>
    <label class="af-label" for="{uid}-route">How it was given</label>
    <select id="{uid}-route" class="af-input" bind:value={route}>
      <option value="">Not recorded</option>
      {#each ROUTE_CHOICES as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
    </select>
  {/if}

  <label class="af-label" for="{uid}-at">{hasProduct ? 'First dose' : 'When?'}</label>
  <input id="{uid}-at" class="af-input" type="datetime-local" bind:value={at} />

  {#if hasProduct}
    <label class="af-check">
      <input type="checkbox" bind:checked={moreDoses} />
      More doses to come (last dose not known yet)
    </label>
    {#if !moreDoses}
      <label class="af-label" for="{uid}-last">
        Last dose <span class="af-optional">(if more than one)</span>
      </label>
      <input id="{uid}-last" class="af-input" type="datetime-local" bind:value={lastDose} />
    {/if}
    {#if askUse}
      <fieldset class="af-fieldset">
        <legend class="af-legend">Used how?</legend>
        <div class="af-tiles">
          {#if isOwner}
            <label class="af-tile" class:on={labelUse === 'label'}>
              <input type="radio" name="{uid}-use" value="label" bind:group={labelUse} />
              <span>As the label says</span>
            </label>
          {/if}
          <label class="af-tile" class:on={labelUse === 'extra-label-vet'}>
            <input type="radio" name="{uid}-use" value="extra-label-vet" bind:group={labelUse} />
            <span>My vet directed it</span>
          </label>
          <label class="af-tile" class:on={labelUse === 'unknown'}>
            <input type="radio" name="{uid}-use" value="unknown" bind:group={labelUse} />
            <span>Not sure</span>
          </label>
        </div>
        {#if !isOwner}
          <p class="af-help">The owner confirms when a product was used as the label says.</p>
        {/if}
      </fieldset>
    {/if}
  {/if}

  {#if showVet}
    <label class="af-label" for="{uid}-vet">
      Vet <span class="af-optional">{kind === 'vet-visit' ? '(optional)' : ''}</span>
    </label>
    <input id="{uid}-vet" class="af-input" type="text" maxlength="120" bind:value={vetName} />
  {/if}

  {#if hasProduct}
    <label class="af-label" for="{uid}-lot"
      >Lot number <span class="af-optional">(optional)</span></label
    >
    <input id="{uid}-lot" class="af-input" type="text" maxlength="80" bind:value={lotNumber} />
  {/if}

  <label class="af-label" for="{uid}-notes">Notes <span class="af-optional">(optional)</span></label
  >
  <textarea id="{uid}-notes" class="af-input" maxlength="2000" bind:value={notes}></textarea>

  {#if lockNote}
    <p class="af-note">Locks when saved: this dose was given more than 48 hours ago.</p>
  {/if}
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? 'Saving…' : submitLabel}
  </button>
</form>
