<script lang="ts">
  import './animalForms.css';
  import HealthForm from './HealthForm.svelte';
  import { CareCloser, type CareCloseRun } from '$lib/animals/careClose';
  import {
    CARE_KIND_LABEL,
    CARE_TO_HEALTH_KIND,
    SNOOZE_DAYS,
    addDaysYmd,
    isHoldBearingCare,
    type CareCardView,
    type CareItemView
  } from '$lib/animals/carePlans';
  import type { HealthRecordInput } from '$lib/animals/recordApiSchemas';
  import { formatCalendarDate } from '$lib/prefs';
  import type { CareCloseExtra } from '$lib/client/taskQueue';

  interface Props {
    card: CareCardView;
    todayYmd: string;
    /** Owners may change the next due day (D0-3). */
    isOwner: boolean;
    canAct: boolean;
    products: { id: string; name: string }[];
    stock: { id: string; name: string; unit: string }[];
    onChanged: (text: string) => void;
  }

  const { card, todayYmd, isOwner, canAct, products, stock, onChanged }: Props = $props();
  const uid = $props.id();

  let mode = $state<'idle' | 'some' | 'done' | 'skip'>('idle');
  let picked = $state<string[]>([]);
  let nextDue = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const holdBearing = $derived(isHoldBearingCare(card.careKind));
  const first = $derived(card.items[0]);
  const many = $derived(card.items.length > 1);
  const chosen = $derived(
    (mode === 'idle' || picked.length === 0
      ? card.items
      : card.items.filter((i) => picked.includes(i.taskId))
    ).filter((i) => !settled.includes(i.taskId))
  );
  const status = $derived(
    card.items.some((i) => i.status === 'late')
      ? 'late'
      : card.items.some((i) => i.status === 'due')
        ? 'due'
        : 'soon'
  );
  const suggestedNext = $derived(
    first.intervalDays ? addDaysYmd(todayYmd, first.intervalDays) : null
  );

  function dueText(item: CareItemView): string {
    const day = formatCalendarDate(item.scheduledOn, 'month-day');
    if (item.status === 'late') return `Was due ${day}`;
    if (item.status === 'due') return 'Due today';
    return `Due ${day}`;
  }

  function openDone() {
    error = null;
    nextDue = suggestedNext ?? '';
    mode = 'done';
  }

  function toggle(taskId: string) {
    picked = picked.includes(taskId) ? picked.filter((p) => p !== taskId) : [...picked, taskId];
  }

  const closer = new CareCloser();
  let settled = $state<string[]>([]);

  async function closeAll(
    action: 'complete' | 'abort',
    extraFor: (item: CareItemView) => CareCloseExtra
  ): Promise<CareCloseRun> {
    const r = await closer.run(chosen, action, extraFor);
    settled = card.items.filter((i) => closer.has(i.taskId)).map((i) => i.taskId);
    return r;
  }

  function withWarnings(text: string, warnings: string[]): string {
    return [text, ...warnings].join(' ');
  }

  function partialError(r: CareCloseRun): string {
    const done = r.saved + r.queued;
    return done > 0
      ? `Saved for ${done} of them. ${r.error} Fix it and save again for the rest.`
      : (r.error ?? '');
  }

  function report(r: CareCloseRun, verb: string) {
    if (r.error) {
      error = partialError(r);
      return;
    }
    mode = 'idle';
    picked = [];
    onChanged(
      withWarnings(
        r.queued > 0
          ? 'Saved on this phone. It will upload when you have signal.'
          : `${verb} ${r.saved === 1 ? '' : `${r.saved} `}${r.saved === 1 ? CARE_KIND_LABEL[card.careKind].toLowerCase() : 'jobs'}.`,
        r.warnings
      )
    );
  }

  const nextDueExtra = (): CareCloseExtra =>
    isOwner && nextDue && nextDue !== suggestedNext ? { nextDueOn: nextDue } : {};

  async function quickDone() {
    busy = true;
    error = null;
    try {
      report(await closeAll('complete', () => nextDueExtra()), 'Marked done:');
    } finally {
      busy = false;
    }
  }

  async function submitHealth(body: HealthRecordInput): Promise<Response> {
    const r = await closeAll('complete', (item) => ({
      ...nextDueExtra(),
      healthEvent: {
        ...body,
        kind: CARE_TO_HEALTH_KIND[card.careKind] ?? body.kind,
        subjectType: item.subjectType,
        subjectId: item.subjectId
      }
    }));
    if (r.error) {
      return new Response(JSON.stringify({ error: partialError(r) }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }
    report(r, 'Recorded');
    return new Response(JSON.stringify({ warnings: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  async function skip(choice: 'skip-this' | 'snooze', days?: number) {
    busy = true;
    error = null;
    try {
      const r = await closeAll('abort', () =>
        choice === 'snooze' ? { careSkip: 'snooze', snoozeDays: days } : { careSkip: 'skip-this' }
      );
      if (r.error) {
        error = partialError(r);
        return;
      }
      mode = 'idle';
      picked = [];
      onChanged(
        withWarnings(
          r.queued > 0
            ? 'Saved on this phone. It will upload when you have signal.'
            : choice === 'snooze'
              ? `We will remind you in ${days === 1 ? '1 day' : `${days} days`}.`
              : 'Skipped this one.',
          r.warnings
        )
      );
    } finally {
      busy = false;
    }
  }
</script>

<article class="care-card" data-status={status} data-testid="care-card" aria-labelledby="{uid}-t">
  <header class="head">
    <span class="kind">{CARE_KIND_LABEL[card.careKind]}</span>
    <h3 id="{uid}-t" class="title">{card.title}</h3>
    <p class="when" class:late={status === 'late'}>{dueText(first)}</p>
  </header>

  {#if mode === 'some'}
    <fieldset class="af-fieldset">
      <legend class="af-legend">Which ones?</legend>
      {#each card.items as item (item.taskId)}
        <label class="af-check pick">
          <input
            type="checkbox"
            checked={picked.includes(item.taskId)}
            onchange={() => toggle(item.taskId)}
          />
          {item.subjectName}
        </label>
      {/each}
    </fieldset>
  {/if}

  {#if canAct && mode !== 'done' && mode !== 'skip'}
    <div class="actions">
      <button
        type="button"
        class="af-primary"
        disabled={busy || (mode === 'some' && picked.length === 0)}
        onclick={openDone}
      >
        {mode === 'some' ? `Done for ${picked.length}` : many ? 'Done for all' : 'Done'}
      </button>
      {#if many && mode !== 'some'}
        <button type="button" class="af-ghost" onclick={() => (mode = 'some')}>Some</button>
      {/if}
      <button
        type="button"
        class="af-ghost"
        disabled={busy}
        onclick={() => {
          error = null;
          mode = 'skip';
        }}
      >
        Skip
      </button>
    </div>
  {/if}

  {#if mode === 'skip'}
    <div class="sheet" role="group" aria-label="Skip">
      <button type="button" class="af-ghost wide" disabled={busy} onclick={() => skip('skip-this')}>
        Skip this one
      </button>
      <p class="af-help">Or remind me again in</p>
      <div class="actions">
        {#each SNOOZE_DAYS as d (d)}
          <button type="button" class="af-ghost" disabled={busy} onclick={() => skip('snooze', d)}>
            {d === 1 ? '1 day' : `${d} days`}
          </button>
        {/each}
      </div>
      <button type="button" class="af-ghost" onclick={() => (mode = 'idle')}>Back</button>
    </div>
  {/if}

  {#if mode === 'done'}
    <div class="sheet">
      {#if first.intervalDays || isOwner}
        <label class="af-label" for="{uid}-next">Next due</label>
        {#if isOwner}
          <input id="{uid}-next" class="af-input" type="date" bind:value={nextDue} />
          <p class="af-help">Set from the plan. Change it if your vet said otherwise.</p>
        {:else}
          <p id="{uid}-next" class="af-help">
            {suggestedNext ? formatCalendarDate(suggestedNext, 'date') : 'Not set'}. The owner can
            change it.
          </p>
        {/if}
      {/if}
      {#if holdBearing}
        <HealthForm
          subjectType={first.subjectType}
          subjectId={first.subjectId}
          foodProducing={first.foodProducing}
          showHolds={first.foodProducing}
          {isOwner}
          {products}
          {stock}
          lockedKind={CARE_TO_HEALTH_KIND[card.careKind] ?? undefined}
          initialProductPluginId={first.productPluginId}
          submit={submitHealth}
          submitLabel={chosen.length > 1 ? `Save for ${chosen.length}` : 'Save'}
          onDone={() => {}}
        />
      {:else}
        <button type="button" class="af-primary wide" disabled={busy} onclick={quickDone}>
          {busy ? 'Saving…' : 'Mark done'}
        </button>
      {/if}
      <button type="button" class="af-ghost" onclick={() => (mode = 'idle')}>Cancel</button>
    </div>
  {/if}

  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
</article>

<style>
  .care-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--card-padding);
    border: 1px solid var(--color-divider);
    border-left: 4px solid var(--color-forest);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  .care-card[data-status='late'] {
    border-left-color: var(--color-rust);
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .kind {
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-ink-muted);
  }
  .title {
    margin: 0;
    font-size: var(--font-size-card-title);
    overflow-wrap: anywhere;
  }
  .when {
    margin: 0;
    font-size: var(--font-size-caption);
  }
  .when.late {
    color: var(--color-rust);
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .wide {
    width: 100%;
  }
  .pick {
    min-height: 48px;
  }
</style>
