<script lang="ts">
  import './animalForms.css';
  import {
    MEAT_CHOICE_VALUES,
    OUTCOME_CHOICES,
    localInputToMs,
    msToLocalInput
  } from '$lib/animals/display';
  import type { AnimalStatusInput } from '$lib/animals/apiSchemas';
  import { errorText, groupNoun, outcomeLabel, statusLabel } from './labels';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

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
  const tr = $derived(createT(page.data?.locale));

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
    const occurredAt = localInputToMs(at, Date.now());
    if (occurredAt === null) {
      error = tr('animals.status.pickWhen');
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
        error = tr('animals.status.enterHowMany');
        return;
      }
      if (kind === 'left' && n > headCount) {
        error = tr('animals.status.onlyUnnamed', {
          headCount,
          noun: groupNoun(tr, noun)
        });
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
        error = await errorText(res, tr);
        return;
      }
      const out = (await res.json()) as { emptied?: boolean };
      const text =
        subjectType === 'group'
          ? kind === 'added'
            ? tr('animals.status.added', { count: count ?? 0 })
            : tr('animals.status.recordedCount', {
                count: count ?? 0,
                status: statusLabel(tr, status).toLowerCase()
              })
          : tr('animals.status.recordedAs', { status: statusLabel(tr, status).toLowerCase() });
      onDone({ emptied: out.emptied === true }, text);
    } catch {
      error = tr('animals.offline');
    } finally {
      saving = false;
    }
  }
</script>

<form class="af-form" onsubmit={submit} novalidate aria-label={tr('animals.recordChange')}>
  {#if subjectType === 'group'}
    <div class="af-segment">
      <label class="af-tile" class:on={kind === 'left'}>
        <input type="radio" name="{uid}-kind" value="left" bind:group={kind} />
        <span>{tr('animals.status.someGone')}</span>
      </label>
      <label class="af-tile" class:on={kind === 'added'}>
        <input type="radio" name="{uid}-kind" value="added" bind:group={kind} />
        <span>{tr('animals.status.moreArrived')}</span>
      </label>
    </div>
  {/if}

  {#if subjectType === 'animal' || kind === 'left'}
    <fieldset class="af-fieldset">
      <legend class="af-legend">{tr('animals.status.whatHappened')}</legend>
      <div class="af-tiles">
        {#each choices as o (o.value)}
          <label class="af-tile" class:on={status === o.value}>
            <input type="radio" name="{uid}-status" value={o.value} bind:group={status} />
            <span>{outcomeLabel(tr, o.value)}</span>
          </label>
        {/each}
      </div>
    </fieldset>
  {/if}

  {#if subjectType === 'group'}
    <label class="af-label" for="{uid}-count">{tr('animals.howMany')}</label>
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

  <label class="af-label" for="{uid}-at">{tr('animals.when')}</label>
  <input id="{uid}-at" class="af-input" type="datetime-local" bind:value={at} />

  <label class="af-label" for="{uid}-reason">
    {subjectType === 'group' && kind === 'added'
      ? tr('animals.status.whereFrom')
      : tr('animals.why')}
    <span class="af-optional">{tr('animals.optional')}</span>
  </label>
  <input
    id="{uid}-reason"
    class="af-input"
    type="text"
    maxlength="500"
    placeholder={subjectType === 'group' && kind === 'added'
      ? tr('animals.status.phHatched')
      : tr('animals.status.phFox')}
    bind:value={reason}
  />

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
  {#if canCullInstead}
    <button
      class="af-ghost"
      type="button"
      onclick={cullInstead}
      lang="en"
      data-english-only="safety"
    >
      Record as culled, meat not used
    </button>
  {/if}
  <button class="af-primary" type="submit" disabled={saving}>
    {saving ? tr('animals.saving') : tr('animals.save')}
  </button>
</form>
