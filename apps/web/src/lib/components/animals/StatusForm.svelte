<script lang="ts">
  import './animalForms.css';
  import {
    MEAT_CHOICE_VALUES,
    OFFLINE_MESSAGE,
    OUTCOME_CHOICES,
    STATUS_LABEL,
    errorFromResponse,
    localInputToMs,
    msToLocalInput
  } from '$lib/animals/display';
  import type { AnimalStatusInput } from '$lib/animals/apiSchemas';

  interface Props {
    subjectType: 'animal' | 'group';
    subjectId: string;
    /** Group only: the unnamed count and the group word ("flock"). */
    headCount?: number;
    noun?: string;
    /** Offer slaughter and sale for meat (food animals only). */
    meatChoices?: boolean;
    onDone: (result: { emptied: boolean }, text: string) => void;
  }

  const {
    subjectType,
    subjectId,
    headCount = 0,
    noun = 'group',
    meatChoices = false,
    onDone
  }: Props = $props();
  const uid = $props.id();

  type Outcome = (typeof OUTCOME_CHOICES)[number]['value'];
  const choices = $derived(
    OUTCOME_CHOICES.filter((o) => meatChoices || !MEAT_CHOICE_VALUES.includes(o.value))
  );
  let kind = $state<'left' | 'added'>('left');
  let status = $state<Outcome>('died');
  let count = $state<number | null>(1);
  let reason = $state('');
  let at = $state(msToLocalInput(Date.now()));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let canCullInstead = $state(false);

  function cullInstead() {
    status = 'culled';
    canCullInstead = false;
    error = null;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    canCullInstead = false;
    const occurredAt = localInputToMs(at);
    if (occurredAt === null) {
      error = 'Pick when it happened.';
      return;
    }
    const body: AnimalStatusInput = {
      subjectType,
      subjectId,
      status: subjectType === 'group' && kind === 'added' ? 'active' : status,
      occurredAt: Math.min(occurredAt, Date.now())
    };
    if (reason.trim()) body.reason = reason.trim();
    if (subjectType === 'group') {
      const n = count ?? 0;
      if (!Number.isInteger(n) || n < 1) {
        error = 'Enter how many, as a whole number.';
        return;
      }
      if (kind === 'left' && n > headCount) {
        error = `Only ${headCount} unnamed are in this ${noun}. Record a named animal on its own page.`;
        return;
      }
      body.headCountDelta = kind === 'left' ? -n : n;
    }
    saving = true;
    try {
      const res = await fetch('/api/animals/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        canCullInstead = res.status === 422 && MEAT_CHOICE_VALUES.includes(body.status);
        error = await errorFromResponse(res);
        return;
      }
      const out = (await res.json()) as { emptied?: boolean };
      const text =
        subjectType === 'group'
          ? kind === 'added'
            ? `Added ${count}.`
            : `Recorded ${count} ${STATUS_LABEL[status].toLowerCase()}.`
          : `Recorded as ${STATUS_LABEL[status].toLowerCase()}.`;
      onDone({ emptied: out.emptied === true }, text);
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      saving = false;
    }
  }
</script>

<form class="af-form" onsubmit={submit} novalidate aria-label="Record a change">
  {#if subjectType === 'group'}
    <div class="af-segment">
      <label class="af-tile" class:on={kind === 'left'}>
        <input type="radio" name="{uid}-kind" value="left" bind:group={kind} />
        <span>Some are gone</span>
      </label>
      <label class="af-tile" class:on={kind === 'added'}>
        <input type="radio" name="{uid}-kind" value="added" bind:group={kind} />
        <span>More arrived</span>
      </label>
    </div>
  {/if}

  {#if subjectType === 'animal' || kind === 'left'}
    <fieldset class="af-fieldset">
      <legend class="af-legend">What happened?</legend>
      <div class="af-tiles">
        {#each choices as o (o.value)}
          <label class="af-tile" class:on={status === o.value}>
            <input type="radio" name="{uid}-status" value={o.value} bind:group={status} />
            <span>{o.label}</span>
          </label>
        {/each}
      </div>
    </fieldset>
  {/if}

  {#if subjectType === 'group'}
    <label class="af-label" for="{uid}-count">How many?</label>
    <input
      id="{uid}-count"
      class="af-input"
      type="number"
      min="1"
      step="1"
      inputmode="numeric"
      bind:value={count}
    />
  {/if}

  <label class="af-label" for="{uid}-at">When?</label>
  <input id="{uid}-at" class="af-input" type="datetime-local" bind:value={at} />

  <label class="af-label" for="{uid}-reason">
    {subjectType === 'group' && kind === 'added' ? 'Where from?' : 'Why?'}
    <span class="af-optional">(optional)</span>
  </label>
  <input
    id="{uid}-reason"
    class="af-input"
    type="text"
    maxlength="500"
    placeholder={subjectType === 'group' && kind === 'added' ? 'e.g. Hatched' : 'e.g. Fox'}
    bind:value={reason}
  />

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  {#if canCullInstead}
    <button class="af-ghost" type="button" onclick={cullInstead}>
      Record as culled, meat not used
    </button>
  {/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? 'Saving…' : 'Save'}
  </button>
</form>
