<script lang="ts">
  import './animalForms.css';
  import {
    OFFLINE_MESSAGE,
    errorFromResponse,
    localInputToMs,
    msToLocalInput
  } from '$lib/animals/display';
  import type { WithdrawalEntryInput } from '$lib/animals/recordApiSchemas';
  import { FOODS, type Food } from '$lib/safety/animalWithdrawal';

  interface Props {
    recordId: string;
    courseOpen: boolean;
    /** Foods this animal gives; the choice is limited to them. */
    foods?: readonly Food[];
    products: { id: string; name: string }[];
    onDone: (text: string) => void;
  }

  const { recordId, courseOpen, foods = FOODS, products, onDone }: Props = $props();
  const FOOD_LABEL: Record<Food, string> = { eggs: 'Eggs', milk: 'Milk', meat: 'Meat' };
  const choices = $derived(foods.length > 0 ? foods : FOODS);
  const uid = $props.id();

  type Source = 'label' | 'vet' | 'course-end' | 'product';
  let source = $state<Source>('label');
  // svelte-ignore state_referenced_locally
  let food = $state<Food>(foods[0] ?? 'meat');
  let amount = $state<number | null>(null);
  let unit = $state<'days' | 'hours'>('days');
  let labelNames = $state(false);
  let saysNone = $state(false);
  let vetName = $state('');
  let endedAt = $state(msToLocalInput(Date.now()));
  let pluginId = $state('');
  let onLabel = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  const sources = $derived([
    { value: 'label' as const, label: 'From the label' },
    { value: 'vet' as const, label: 'From my vet' },
    ...(courseOpen ? [{ value: 'course-end' as const, label: 'Last dose given' }] : []),
    ...(products.length > 0 ? [{ value: 'product' as const, label: 'Pick the product' }] : [])
  ] satisfies { value: Source; label: string }[]);

  function build(): WithdrawalEntryInput | string {
    if (source === 'course-end') {
      const ms = localInputToMs(endedAt);
      return ms === null
        ? 'Pick when the last dose was given.'
        : { kind: 'course-end', endedAt: ms };
    }
    if (source === 'product') {
      return pluginId ? { kind: 'product', pluginId, onLabel } : 'Pick the product.';
    }
    const n = saysNone ? 0 : amount;
    if (n === null || !Number.isInteger(n) || n < 0) return 'Enter a whole number.';
    if (n === 0 && !saysNone) {
      return source === 'label'
        ? 'To record no withdrawal, tick "The label says no withdrawal".'
        : 'To record no withdrawal, tick "My vet said no withdrawal".';
    }
    if (source === 'label') {
      return {
        kind: 'label',
        food,
        amount: n,
        unit,
        labelNamesSpeciesAndClass: labelNames,
        ...(saysNone ? { labelSaysNone: true } : {})
      };
    }
    if (!vetName.trim()) return "Add the vet's name.";
    return {
      kind: 'vet',
      food,
      amount: n,
      unit,
      vetName: vetName.trim(),
      ...(saysNone ? { vetSaysNone: true } : {})
    };
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const body = build();
    if (typeof body === 'string') {
      error = body;
      return;
    }
    saving = true;
    try {
      const res = await fetch(`/api/animals/health/${recordId}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      onDone('Withdrawal added.');
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      saving = false;
    }
  }
</script>

<form class="af-form" onsubmit={submit} novalidate aria-label="Add a withdrawal">
  <fieldset class="af-fieldset">
    <legend class="af-legend">What are you adding?</legend>
    <div class="af-tiles">
      {#each sources as s (s.value)}
        <label class="af-tile" class:on={source === s.value}>
          <input type="radio" name="{uid}-source" value={s.value} bind:group={source} />
          <span>{s.label}</span>
        </label>
      {/each}
    </div>
  </fieldset>

  {#if source === 'label' || source === 'vet'}
    <label class="af-label" for="{uid}-food">Which food</label>
    <select id="{uid}-food" class="af-input" bind:value={food}>
      {#each choices as f (f)}<option value={f}>{FOOD_LABEL[f]}</option>{/each}
    </select>
    <div class="af-row">
      <label>
        How long
        <input
          class="af-input"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          disabled={saysNone}
          bind:value={amount}
        />
      </label>
      <label>
        Unit
        <select class="af-input" bind:value={unit}>
          <option value="days">Days</option>
          <option value="hours">Hours</option>
        </select>
      </label>
    </div>
    {#if source === 'label'}
      <label class="af-check">
        <input type="checkbox" bind:checked={labelNames} />
        The label names this animal and this use (for example laying hens or dairy cows)
      </label>
      <label class="af-check">
        <input type="checkbox" bind:checked={saysNone} />
        The label says no withdrawal
      </label>
    {:else}
      <label class="af-label" for="{uid}-vet">Vet</label>
      <input id="{uid}-vet" class="af-input" type="text" maxlength="120" bind:value={vetName} />
      <label class="af-check">
        <input type="checkbox" bind:checked={saysNone} />
        My vet said no withdrawal
      </label>
    {/if}
    <p class="af-help">
      Type the number yourself from the label or the vet. It cannot be changed later, only added to.
    </p>
  {:else if source === 'course-end'}
    <label class="af-label" for="{uid}-end">Last dose given</label>
    <input id="{uid}-end" class="af-input" type="datetime-local" bind:value={endedAt} />
  {:else}
    <label class="af-label" for="{uid}-plugin">Product</label>
    <select id="{uid}-plugin" class="af-input" bind:value={pluginId}>
      <option value="">Pick one</option>
      {#each products as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    <label class="af-check">
      <input type="checkbox" bind:checked={onLabel} />
      Used as the label says
    </label>
  {/if}

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? 'Saving…' : 'Add'}
  </button>
</form>
