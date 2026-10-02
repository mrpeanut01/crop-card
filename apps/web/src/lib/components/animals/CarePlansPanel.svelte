<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import './animalForms.css';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import CareTaskCard from './CareTaskCard.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { careKindLabel, errorText } from './labels';
  import {
    CARE_KIND_CHOICES,
    defaultLeadDays,
    type CareCardView,
    type CarePlanKind,
    type CarePlanView as PlanView
  } from '$lib/animals/carePlans';

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
  const tr = $derived(createT(page.data?.locale));

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
        error = await errorText(res, tr);
        return;
      }
      adding = false;
      editing = null;
      onChanged(done);
    } catch {
      error = tr('animals.offline');
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
      error = tr('animals.care.giveName');
      return;
    }
    if (!repeats && !dueOn) {
      error = tr('animals.care.pickDay');
      return;
    }
    if (lastOn && !(everyDays && everyDays > 0)) {
      error = tr('animals.care.sayOften');
      return;
    }
    void (plan
      ? send(`${base}/${plan.id}`, 'PATCH', formBody(true), tr('animals.care.planSaved'))
      : send(base, 'POST', formBody(false), tr('animals.care.planAdded')));
  }

  function whenText(p: PlanView): string {
    if (!p.active) return tr('animals.care.turnedOff');
    if (!p.nextDueOn) return tr('animals.care.noDueDate');
    return tr('animals.care.nextDue', { date: fmt.day(p.nextDueOn, 'date') });
  }

  function everyText(p: PlanView): string | null {
    if (p.onceOn) return tr('animals.care.once');
    if (!p.intervalDays) return null;
    const d = p.intervalDays;
    if (d % 365 === 0) {
      return d === 365
        ? tr('animals.care.everyYear')
        : tr('animals.care.everyYears', { n: d / 365 });
    }
    if (d % 7 === 0) {
      return d === 7 ? tr('animals.care.everyWeek') : tr('animals.care.everyWeeks', { n: d / 7 });
    }
    return d === 1 ? tr('animals.care.everyDay') : tr('animals.care.everyDays', { n: d });
  }
</script>

<section class="care" aria-labelledby="{uid}-h" data-testid="care-plans">
  <h2 id="{uid}-h" class="section-title">{tr('animals.care.title')}</h2>

  {#if plans.length === 0}
    <p class="af-help">{tr('animals.care.none')}</p>
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
            label={p.provenance === 'plugin' ? tr('animals.care.suggested') : undefined}
          />
        </div>
        <p class="plan-meta">
          {careKindLabel(tr, p.kind)}{everyText(p) ? ` · ${everyText(p)}` : ''} · {whenText(p)}
        </p>
        {#if !p.nextDueOn && p.active}
          <p class="af-note">
            {tr('animals.care.undated', { subject: subjectName, title: p.title.toLowerCase() })}
            {p.note ?? ''}
          </p>
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
                {p.nextDueOn ? tr('animals.edit') : tr('animals.care.setDate')}
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
                    p.active ? tr('animals.care.turnedOffDone') : tr('animals.care.turnedOnDone')
                  )}
              >
                {p.active ? tr('animals.care.turnOff') : tr('animals.care.turnOn')}
              </button>
              <button
                type="button"
                class="af-danger"
                disabled={busy}
                onclick={() => {
                  if (confirm(tr('animals.care.confirmDelete', { title: p.title }))) {
                    void send(
                      `${base}/${p.id}`,
                      'DELETE',
                      undefined,
                      tr('animals.care.planDeleted')
                    );
                  }
                }}
              >
                {tr('animals.delete')}
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
          {tr('animals.care.add')}
        </button>
        <button
          type="button"
          class="af-ghost"
          disabled={busy}
          onclick={() =>
            send(`${base}/defaults`, 'POST', undefined, tr('animals.care.suggestionsChecked'))}
        >
          {tr('animals.care.addSuggested')}
        </button>
      </div>
    {/if}
  {:else if !isOwner && plans.length > 0}
    <p class="af-help">{tr('animals.care.ownerSets')}</p>
  {/if}

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
</section>

{#snippet planForm(plan?: PlanView)}
  <form
    class="af-form"
    onsubmit={(e) => save(e, plan)}
    novalidate
    aria-label={tr('animals.care.planAria')}
  >
    <label class="af-label" for="{uid}-kind">{tr('animals.care.whatKind')}</label>
    <select
      id="{uid}-kind"
      class="af-input"
      bind:value={kind}
      onchange={() => {
        if (!plan) leadDays = defaultLeadDays(kind);
      }}
    >
      {#each CARE_KIND_CHOICES as c (c.value)}<option value={c.value}
          >{careKindLabel(tr, c.value)}</option
        >{/each}
    </select>
    <label class="af-label" for="{uid}-title">{tr('animals.name')}</label>
    <input
      id="{uid}-title"
      class="af-input"
      type="text"
      maxlength="120"
      placeholder={tr('animals.care.phTitle')}
      bind:value={title}
    />
    <fieldset class="af-fieldset">
      <legend class="af-legend">{tr('animals.care.howOften')}</legend>
      <div class="af-tiles">
        <label class="af-tile" class:on={repeats}>
          <input type="radio" name="{uid}-rep" value={true} bind:group={repeats} />
          <span>{tr('animals.care.repeats')}</span>
        </label>
        <label class="af-tile" class:on={!repeats}>
          <input type="radio" name="{uid}-rep" value={false} bind:group={repeats} />
          <span>{tr('animals.care.once')}</span>
        </label>
      </div>
    </fieldset>
    {#if repeats}
      <label class="af-label" for="{uid}-every">
        {tr('animals.care.everyHowMany')}
        <span class="af-optional">{tr('animals.care.askVet')}</span>
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
        {tr('animals.care.lastDone')}
        <span class="af-optional">{tr('animals.care.ifKnown')}</span>
      </label>
      <input id="{uid}-last" class="af-input" type="date" bind:value={lastOn} />
      <label class="af-label" for="{uid}-due">
        {tr('animals.care.orNextDue')} <span class="af-optional">{tr('animals.optional')}</span>
      </label>
      <input id="{uid}-due" class="af-input" type="date" bind:value={dueOn} />
    {:else}
      <label class="af-label" for="{uid}-due">{tr('animals.care.on')}</label>
      <input id="{uid}-due" class="af-input" type="date" bind:value={dueOn} />
    {/if}
    <label class="af-label" for="{uid}-lead">{tr('animals.care.leadDays')}</label>
    <input
      id="{uid}-lead"
      class="af-input"
      type="number"
      min="0"
      max="90"
      inputmode="numeric"
      bind:value={leadDays}
    />
    <p class="af-help">{tr('animals.care.noDateHelp')}</p>
    <div class="row">
      <button class="af-primary" type="submit" disabled={busy}>
        {busy ? tr('animals.saving') : tr('animals.save')}
      </button>
      <button
        type="button"
        class="af-ghost"
        onclick={() => {
          adding = false;
          editing = null;
        }}
      >
        {tr('animals.cancel')}
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
