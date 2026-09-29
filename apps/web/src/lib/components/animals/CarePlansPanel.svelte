<script lang="ts">
  import './animalForms.css';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import CareTaskCard from './CareTaskCard.svelte';
  import { OFFLINE_MESSAGE, errorFromResponse } from '$lib/animals/display';
  import {
    CARE_KIND_CHOICES,
    CARE_KIND_LABEL,
    defaultLeadDays,
    undatedPrompt,
    type CareCardView,
    type CarePlanKind,
    type CarePlanView as PlanView
  } from '$lib/animals/carePlans';
  import { formatCalendarDate } from '$lib/prefs';

  interface Props {
    /** The animal or group id in `/api/animals/:id/care-plans`. */
    subjectId: string;
    subjectName: string;
    plans: PlanView[];
    cards: CareCardView[];
    todayYmd: string;
    isOwner: boolean;
    canAct: boolean;
    active: boolean;
    products: { id: string; name: string }[];
    stock: { id: string; name: string; unit: string }[];
    onChanged: (text: string) => void;
  }

  const {
    subjectId,
    subjectName,
    plans,
    cards,
    todayYmd,
    isOwner,
    canAct,
    active,
    products,
    stock,
    onChanged
  }: Props = $props();
  const uid = $props.id();

  let adding = $state(false);
  let editing = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  let kind = $state<CarePlanKind>('vaccination');
  let title = $state('');
  let repeats = $state(true);
  let everyDays = $state<number | null>(null);
  let lastOn = $state('');
  let dueOn = $state('');
  let leadDays = $state<number>(14);

  const base = $derived(`/api/animals/${encodeURIComponent(subjectId)}/care-plans`);
  const cardByPlan = $derived(
    new Map(cards.flatMap((c) => c.items.map((i) => [i.planId, c] as const)))
  );

  function reset(plan?: PlanView) {
    error = null;
    kind = plan?.kind ?? 'vaccination';
    title = plan?.title ?? '';
    repeats = plan ? plan.onceOn === null : true;
    everyDays = plan?.intervalDays ?? null;
    lastOn = '';
    dueOn = plan?.nextDueOn ?? plan?.onceOn ?? '';
    leadDays = plan?.leadDays ?? defaultLeadDays(kind);
  }

  async function send(url: string, method: string, body: unknown, done: string) {
    busy = true;
    error = null;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      adding = false;
      editing = null;
      onChanged(done);
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      busy = false;
    }
  }

  function formBody(forEdit: boolean) {
    const out: Record<string, unknown> = { kind, title: title.trim(), leadDays };
    if (repeats) {
      out.intervalDays = everyDays && everyDays > 0 ? Math.round(everyDays) : null;
      if (forEdit) out.onceOn = null;
      if (lastOn && out.intervalDays) out.lastDoneOn = lastOn;
      else if (dueOn) out.nextDueOn = dueOn;
      else if (forEdit) out.nextDueOn = null;
    } else {
      out.intervalDays = null;
      out.onceOn = dueOn || null;
      if (forEdit) out.nextDueOn = dueOn || null;
    }
    return out;
  }

  function save(e: SubmitEvent, plan?: PlanView) {
    e.preventDefault();
    if (!title.trim()) {
      error = 'Give it a name, like "Rabies vaccine".';
      return;
    }
    if (!repeats && !dueOn) {
      error = 'Pick the day.';
      return;
    }
    if (lastOn && !(everyDays && everyDays > 0)) {
      error = 'Say how often it repeats, or give the next due date instead.';
      return;
    }
    void (plan
      ? send(`${base}/${plan.id}`, 'PATCH', formBody(true), 'Care plan saved.')
      : send(base, 'POST', formBody(false), 'Care plan added.'));
  }

  function whenText(p: PlanView): string {
    if (!p.active) return 'Turned off';
    if (!p.nextDueOn) return 'Due date not set, ask your vet';
    return `Next due ${formatCalendarDate(p.nextDueOn, 'date')}`;
  }

  function everyText(p: PlanView): string | null {
    if (p.onceOn) return 'Once';
    if (!p.intervalDays) return null;
    const d = p.intervalDays;
    if (d % 365 === 0) return d === 365 ? 'Every year' : `Every ${d / 365} years`;
    if (d % 7 === 0) return d === 7 ? 'Every week' : `Every ${d / 7} weeks`;
    return d === 1 ? 'Every day' : `Every ${d} days`;
  }
</script>

<section class="care" aria-labelledby="{uid}-h" data-testid="care-plans">
  <h2 id="{uid}-h" class="section-title">Care</h2>

  {#if plans.length === 0}
    <p class="af-help">No care plans yet.</p>
  {/if}

  <ul class="plans">
    {#each plans as p (p.id)}
      {@const card = cardByPlan.get(p.id)}
      <li class="plan" class:off={!p.active} data-testid="care-plan">
        <div class="plan-head">
          <span class="plan-title">{p.title}</span>
          <Provenance
            source={p.provenance}
            compact
            label={p.provenance === 'plugin' ? 'Suggested' : undefined}
          />
        </div>
        <p class="plan-meta">
          {CARE_KIND_LABEL[p.kind]}{everyText(p) ? ` · ${everyText(p)}` : ''} · {whenText(p)}
        </p>
        {#if !p.nextDueOn && p.active}
          <p class="af-note">{undatedPrompt(p.title, subjectName)} {p.note ?? ''}</p>
        {/if}
        {#if card && card.items.length === 1}
          <CareTaskCard {card} {todayYmd} {isOwner} {canAct} {products} {stock} {onChanged} />
        {/if}
        {#if isOwner && active}
          {#if editing === p.id}
            {@render planForm(p)}
          {:else}
            <div class="row">
              <button
                type="button"
                class="af-ghost"
                onclick={() => {
                  reset(p);
                  adding = false;
                  editing = p.id;
                }}
              >
                {p.nextDueOn ? 'Edit' : 'Set the date'}
              </button>
              <button
                type="button"
                class="af-ghost"
                disabled={busy}
                onclick={() =>
                  send(
                    `${base}/${p.id}`,
                    'PATCH',
                    { active: !p.active },
                    p.active ? 'Turned off.' : 'Turned on.'
                  )}
              >
                {p.active ? 'Turn off' : 'Turn on'}
              </button>
              <button
                type="button"
                class="af-danger"
                disabled={busy}
                onclick={() => {
                  if (confirm(`Delete "${p.title}"? Records already saved stay.`)) {
                    void send(`${base}/${p.id}`, 'DELETE', undefined, 'Care plan deleted.');
                  }
                }}
              >
                Delete
              </button>
            </div>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>

  {#each cards.filter((c) => c.items.length > 1) as card (card.key)}
    <CareTaskCard {card} {todayYmd} {isOwner} {canAct} {products} {stock} {onChanged} />
  {/each}

  {#if isOwner && active}
    {#if adding}
      {@render planForm()}
    {:else}
      <div class="row">
        <button
          type="button"
          class="af-ghost"
          onclick={() => {
            reset();
            editing = null;
            adding = true;
          }}
        >
          Add a care plan
        </button>
        <button
          type="button"
          class="af-ghost"
          disabled={busy}
          onclick={() => send(`${base}/defaults`, 'POST', undefined, 'Suggestions checked.')}
        >
          Add suggested care
        </button>
      </div>
    {/if}
  {:else if !isOwner && plans.length > 0}
    <p class="af-help">The owner sets up care plans.</p>
  {/if}

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
</section>

{#snippet planForm(plan?: PlanView)}
  <form class="af-form" onsubmit={(e) => save(e, plan)} novalidate aria-label="Care plan">
    <label class="af-label" for="{uid}-kind">What kind of care</label>
    <select
      id="{uid}-kind"
      class="af-input"
      bind:value={kind}
      onchange={() => {
        if (!plan) leadDays = defaultLeadDays(kind);
      }}
    >
      {#each CARE_KIND_CHOICES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
    </select>
    <label class="af-label" for="{uid}-title">Name</label>
    <input
      id="{uid}-title"
      class="af-input"
      type="text"
      maxlength="120"
      placeholder="Rabies vaccine"
      bind:value={title}
    />
    <fieldset class="af-fieldset">
      <legend class="af-legend">How often</legend>
      <div class="af-tiles">
        <label class="af-tile" class:on={repeats}>
          <input type="radio" name="{uid}-rep" value={true} bind:group={repeats} />
          <span>Repeats</span>
        </label>
        <label class="af-tile" class:on={!repeats}>
          <input type="radio" name="{uid}-rep" value={false} bind:group={repeats} />
          <span>Once</span>
        </label>
      </div>
    </fieldset>
    {#if repeats}
      <label class="af-label" for="{uid}-every">
        Every how many days <span class="af-optional">(ask your vet)</span>
      </label>
      <input
        id="{uid}-every"
        class="af-input"
        type="number"
        min="1"
        max="3650"
        inputmode="numeric"
        bind:value={everyDays}
      />
      <label class="af-label" for="{uid}-last">
        Last done <span class="af-optional">(if you know it)</span>
      </label>
      <input id="{uid}-last" class="af-input" type="date" bind:value={lastOn} />
      <label class="af-label" for="{uid}-due">
        Or the next due date <span class="af-optional">(optional)</span>
      </label>
      <input id="{uid}-due" class="af-input" type="date" bind:value={dueOn} />
    {:else}
      <label class="af-label" for="{uid}-due">On</label>
      <input id="{uid}-due" class="af-input" type="date" bind:value={dueOn} />
    {/if}
    <label class="af-label" for="{uid}-lead">Show it this many days ahead</label>
    <input
      id="{uid}-lead"
      class="af-input"
      type="number"
      min="0"
      max="90"
      inputmode="numeric"
      bind:value={leadDays}
    />
    <p class="af-help">With no date, the plan waits here and never shows on Today.</p>
    <div class="row">
      <button class="af-primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        class="af-ghost"
        onclick={() => {
          adding = false;
          editing = null;
        }}
      >
        Cancel
      </button>
    </div>
  </form>
{/snippet}

<style>
  .care {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .section-title {
    margin: 0;
    font-size: var(--font-size-card-title);
  }
  .plans {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .plan {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  .plan.off {
    opacity: 0.75;
  }
  .plan-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .plan-title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .plan-meta {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
