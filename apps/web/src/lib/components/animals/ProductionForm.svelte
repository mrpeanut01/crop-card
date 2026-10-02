<script lang="ts">
  import './animalForms.css';
  import FoodStopModal from './FoodStopModal.svelte';
  import HoldGuardNotice from './HoldGuardNotice.svelte';
  import { holdRefusalOf, type HoldShortenBody } from '$lib/animals/holdGuardCopy';
  import { localInputToMs, msToLocalInput } from '$lib/animals/display';
  import { errorText, unitLabel, useLabel } from './labels';
  import { USE_CHOICES } from '$lib/animals/healthCopy';
  import { isFoodStop, type FoodStop } from '$lib/animals/holdCopy';
  import type { ProductionRecordInput, ProductionKind } from '$lib/animals/recordApiSchemas';
  import type { ProductionUse } from '$lib/safety/animalWithdrawal';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    subjectType: 'animal' | 'group';
    subjectId: string;
    defaultKind: ProductionKind;
    isOwner: boolean;
    onStopped: (stop: FoodStop) => void;
    onDone: (text: string, warnings: string[]) => void;
  }

  const { subjectType, subjectId, defaultKind, isOwner, onStopped, onDone }: Props = $props();
  const uid = $props.id();
  const tr = $derived(createT(page.data?.locale));

  const UNITS: Record<ProductionKind, { value: ProductionRecordInput['unit'] }[]> = {
    eggs: [{ value: 'eggs' }, { value: 'dozen' }],
    milk: [{ value: 'gal' }, { value: 'qt' }, { value: 'l' }, { value: 'lb' }],
    weight: [{ value: 'lb' }, { value: 'kg' }]
  };

  // svelte-ignore state_referenced_locally
  let kind = $state<ProductionKind>(defaultKind);
  let quantity = $state<number | null>(null);
  // svelte-ignore state_referenced_locally
  let unit = $state<ProductionRecordInput['unit']>(UNITS[defaultKind][0].value);
  let use = $state<ProductionUse>('food');
  let at = $state(msToLocalInput(Date.now()));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let stop = $state<FoodStop | null>(null);
  let pending = $state<ProductionRecordInput | null>(null);
  let refusal = $state<HoldShortenBody | null>(null);
  let refused = $state<ProductionRecordInput | null>(null);

  function pickKind(k: ProductionKind) {
    kind = k;
    unit = UNITS[k][0].value;
  }

  async function post(body: ProductionRecordInput): Promise<void> {
    saving = true;
    error = null;
    refusal = null;
    try {
      const res = await fetch('/api/animals/production/record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 422) {
        const out = (await res.json().catch(() => null)) as unknown;
        if (isFoodStop(out)) {
          pending = body;
          stop = out;
          onStopped(out);
          return;
        }
        const msg = (out as { error?: unknown } | null)?.error;
        error = typeof msg === 'string' ? msg : tr('animals.prod.couldNotSave');
        return;
      }
      if (!res.ok) {
        refusal = await holdRefusalOf(res);
        refused = refusal ? body : null;
        error = refusal ? null : await errorText(res, tr);
        return;
      }
      const out = (await res.json()) as { warnings?: { message: string }[] };
      stop = null;
      pending = null;
      quantity = null;
      onDone(
        body.use === 'discard' ? tr('animals.prod.savedThrownOut') : tr('animals.saved'),
        (out.warnings ?? []).map((w) => w.message)
      );
    } catch {
      error = tr('animals.offline');
    } finally {
      saving = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const occurredAt = localInputToMs(at);
    if (occurredAt === null) {
      error = tr('animals.prod.pickWhen');
      return;
    }
    if (quantity === null || !(quantity >= 0)) {
      error = tr('animals.prod.enterHowMuch');
      return;
    }
    await post({
      subjectType,
      subjectId,
      kind,
      quantity,
      unit,
      use: kind === 'weight' ? 'unknown' : use,
      occurredAt: Math.min(occurredAt, Date.now())
    });
  }

  function saveToday() {
    if (!refused) return;
    at = msToLocalInput(Date.now());
    void post({ ...refused, occurredAt: Date.now() });
  }

  function discard() {
    if (pending) void post({ ...pending, use: 'discard' });
  }
</script>

<form class="af-form" onsubmit={submit} novalidate aria-label={tr('animals.prod.logAria')}>
  <div class="af-segment three">
    {#each ['eggs', 'milk', 'weight'] as const as k (k)}
      <label class="af-tile" class:on={kind === k}>
        <input
          type="radio"
          name="{uid}-kind"
          value={k}
          checked={kind === k}
          onchange={() => pickKind(k)}
        />
        <span
          >{k === 'eggs'
            ? tr('animals.unit.eggs')
            : k === 'milk'
              ? tr('animals.prod.milk')
              : tr('animals.prod.weight')}</span
        >
      </label>
    {/each}
  </div>

  <div class="af-row">
    <label>
      {tr('animals.prod.howMuch')}
      <input
        class="af-input"
        type="number"
        min="0"
        step="any"
        inputmode="decimal"
        bind:value={quantity}
      />
    </label>
    <label>
      {tr('animals.prod.unit')}
      <select class="af-input" bind:value={unit}>
        {#each UNITS[kind] as u (u.value)}<option value={u.value}>{unitLabel(tr, u.value)}</option
          >{/each}
      </select>
    </label>
  </div>

  {#if kind !== 'weight'}
    <fieldset class="af-fieldset">
      <legend class="af-legend">{tr('animals.use.whereGoing')}</legend>
      <div class="af-tiles">
        {#each USE_CHOICES as c (c.value)}
          <label class="af-tile" class:on={use === c.value}>
            <input type="radio" name="{uid}-use" value={c.value} bind:group={use} />
            <span>{useLabel(tr, c.value)}</span>
          </label>
        {/each}
      </div>
    </fieldset>
  {/if}

  <label class="af-label" for="{uid}-at">{tr('animals.prod.collected')}</label>
  <input id="{uid}-at" class="af-input" type="datetime-local" bind:value={at} />

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  <HoldGuardNotice {refusal} {saving} onToday={saveToday} />
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? tr('animals.saving') : tr('animals.save')}
  </button>
</form>

<FoodStopModal
  {stop}
  {isOwner}
  {saving}
  onDiscard={discard}
  onClose={() => {
    stop = null;
    pending = null;
  }}
/>

<style>
  .three {
    grid-template-columns: repeat(3, 1fr);
  }
</style>
