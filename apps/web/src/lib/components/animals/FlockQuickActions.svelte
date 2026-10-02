<script lang="ts">
  import './animalForms.css';
  import type { FarmSnapshot } from '$lib/cards/snapshot';
  import { holdLine, holdTimeZone } from '$lib/cards/build/animalHolds';
  import { checkFoodLog, precheckMove } from '$lib/client/animalHold';
  import { submitProduction, submitHealth, submitFeedUse } from '$lib/animals/recordClient';
  import type { RecordOutcome } from '$lib/animals/recordClient';
  import { submitMove } from '$lib/animals/moveClient';
  import { ROUTE_CHOICES } from '$lib/animals/healthCopy';
  import { isHousingAreaKind } from '$lib/animals/model';
  import { formatInstant, type Prefs } from '$lib/prefs';
  import type { Food, ProductionUse } from '$lib/safety/animalWithdrawal';
  import { createT } from '$lib/i18n';
  import { useLabel } from './labels';
  import { page } from '$app/state';

  interface Props {
    snapshot: FarmSnapshot;
    groupId: string;
    role: string | null;
    prefs: Prefs;
    now: number;
    unsynced: ReadonlySet<string>;
    /** Something was saved or queued; the page re-reads the queue. */
    onChange?: () => void;
  }

  const { snapshot, groupId, role, prefs, now, unsynced, onChange }: Props = $props();
  const uid = $props.id();
  const tr = $derived(createT(page.data?.locale));

  type Action = 'log' | 'treat' | 'move' | 'feed';
  const USE_TILES = ['food', 'sale', 'discard'] as const;
  const group = $derived(snapshot.animalGroups?.find((g) => g.id === groupId) ?? null);
  const species = $derived(group ? snapshot.species?.[group.speciesId] : undefined);
  const food = $derived.by((): Extract<Food, 'eggs' | 'milk'> | null => {
    const products = species?.products ?? [];
    if (products.includes('eggs')) return 'eggs';
    if (products.includes('milk')) return 'milk';
    return null;
  });
  const unit = $derived(food === 'milk' ? 'qt' : 'eggs');
  const unitLabel = $derived(food === 'milk' ? 'quarts' : 'eggs');
  const unitName = $derived(
    food === 'milk' ? tr('animals.quick.quarts') : tr('animals.unit.eggs').toLowerCase()
  );
  const feedItems = $derived(
    (snapshot.stock ?? []).filter(
      (s) => (s.category as string) === 'feed' || (s.category as string) === 'bedding'
    )
  );
  const areas = $derived(
    (snapshot.areas ?? []).filter(
      (a) => isHousingAreaKind(a.kind) && a.id !== group?.housingFieldId
    )
  );
  const subject = $derived(`group:${groupId}`);
  const tz = $derived(holdTimeZone(snapshot, prefs));
  const asOf = $derived(formatInstant(snapshot.generatedAt, prefs, 'datetime'));

  let open = $state<Action | null>(null);
  let count = $state(0);
  let typing = $state(false);
  let use = $state<ProductionUse>('food');
  let productName = $state('');
  let route = $state('');
  let fieldId = $state('');
  let feedItemId = $state('');
  let feedLb = $state<number | null>(null);
  let saving = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let stopText = $state<string | null>(null);

  const check = $derived(checkFoodLog({ snapshot, subject, food, use, now, unsynced }));
  const foodHeld = $derived(checkFoodLog({ snapshot, subject, food, use: 'food', now, unsynced }));
  const held = $derived(check.verdict === 'hold' || stopText !== null);
  const movePre = $derived(
    fieldId
      ? precheckMove({ snapshot, subjectType: 'group', subjectId: groupId, fieldId, role, now })
      : ({ verdict: 'ok' } as const)
  );

  function toggle(a: Action) {
    open = open === a ? null : a;
    message = null;
    error = null;
    stopText = null;
  }

  function step(delta: number) {
    count = Math.max(0, Math.min(100_000, (count || 0) + delta));
  }

  function outcomeText(out: RecordOutcome, what: string): string | null {
    if (out.status === 'queued') return tr('animals.quick.whatQueued', { what });
    if (out.status === 'saved') {
      return [tr('animals.quick.whatSaved', { what }), ...out.warnings].join(' ');
    }
    return null;
  }

  async function run(fn: () => Promise<RecordOutcome>, what: string, reset: () => void) {
    saving = true;
    error = null;
    message = null;
    try {
      const out = await fn();
      if (out.status === 'stopped') {
        stopText = out.stop.error;
        return;
      }
      if (out.status === 'error') {
        error = out.message;
        return;
      }
      message = outcomeText(out, what);
      stopText = null;
      reset();
      onChange?.();
    } catch {
      error = tr('animals.quick.saveFailed');
    } finally {
      saving = false;
    }
  }

  function logProduction(asUse: ProductionUse) {
    if (!food || !(count > 0)) {
      error = tr('animals.quick.enterHowMany', { unit: unitName });
      return;
    }
    void run(
      () =>
        submitProduction(
          {
            subjectType: 'group',
            subjectId: groupId,
            kind: food,
            quantity: count,
            unit,
            use: asUse,
            occurredAt: Date.now()
          },
          undefined,
          undefined,
          page.data?.locale
        ),
      asUse === 'discard'
        ? tr('animals.quick.thrownOut', { count, unit: unitName })
        : `${count} ${unitName}:`,
      () => {
        count = 0;
        use = 'food';
      }
    );
  }

  function logTreatment(e: SubmitEvent) {
    e.preventDefault();
    const name = productName.trim();
    if (!name) {
      error = tr('animals.quick.enterGiven');
      return;
    }
    void run(
      () =>
        submitHealth(
          {
            subjectType: 'group',
            subjectId: groupId,
            kind: 'treatment',
            productName: name,
            route: (route || null) as never,
            administeredAt: Date.now(),
            labelUse: 'unknown'
          },
          undefined,
          undefined,
          page.data?.locale
        ),
      tr('animals.quick.whatTreatment'),
      () => {
        productName = '';
        route = '';
      }
    );
  }

  async function move(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    message = null;
    if (!fieldId) {
      error = tr('animals.quick.pickWhere');
      return;
    }
    if (movePre.verdict === 'stop') {
      error = movePre.message;
      return;
    }
    saving = true;
    try {
      const out = await submitMove(
        { subjectType: 'group', subjectId: groupId, fieldId },
        undefined,
        undefined,
        page.data?.locale
      );
      if (out.status === 'error') error = out.message;
      else {
        message =
          out.status === 'queued'
            ? tr('animals.quick.moveQueued')
            : [tr('animals.quick.moved'), ...(out.warnings ?? [])].join(' ');
        fieldId = '';
        onChange?.();
      }
    } catch {
      error = tr('animals.quick.saveFailed');
    } finally {
      saving = false;
    }
  }

  function logFeed(e: SubmitEvent) {
    e.preventDefault();
    if (!feedItemId || !(feedLb && feedLb > 0)) {
      error = tr('animals.quick.pickFeed');
      return;
    }
    const lb = feedLb;
    void run(
      () =>
        submitFeedUse(
          feedItemId,
          { lb, subjectType: 'group', subjectId: groupId },
          undefined,
          undefined,
          page.data?.locale
        ),
      tr('animals.quick.whatFeed', { lb }),
      () => (feedLb = null)
    );
  }
</script>

{#if group}
  <section class="qa" aria-labelledby="{uid}-h" data-testid="flock-quick-actions">
    <h2 id="{uid}-h">{tr('animals.quick.title')}</h2>
    {#if food}
      <p
        class="chip"
        class:hold={foodHeld.verdict === 'hold'}
        class:unsure={foodHeld.verdict === 'unconfirmed'}
        data-testid="offline-hold-chip"
        role="status"
      >
        {#if foodHeld.verdict === 'hold' && foodHeld.reading}
          {#each foodHeld.reading.holds as h (h.food)}{holdLine(h, tz)}.
          {/each}As of {asOf}.
        {:else if foodHeld.verdict === 'unconfirmed'}
          {#if foodHeld.reading?.unconfirmedReason === 'unsynced'}
            A treatment, move or spray on this phone has not synced yet, so holds can't be
            confirmed.
          {:else}
            Hold status not checked since {asOf}, can't confirm.
          {/if}
        {:else}
          No holds on file as of {asOf}.
        {/if}
      </p>
    {/if}

    <div class="bar">
      {#if food}
        <button
          type="button"
          class="af-ghost"
          aria-expanded={open === 'log'}
          onclick={() => toggle('log')}
        >
          {tr('animals.quick.log', { unit: unitName })}
        </button>
      {/if}
      <button
        type="button"
        class="af-ghost"
        aria-expanded={open === 'treat'}
        onclick={() => toggle('treat')}
      >
        {tr('animals.quick.logTreatment')}
      </button>
      <button
        type="button"
        class="af-ghost"
        aria-expanded={open === 'move'}
        onclick={() => toggle('move')}
      >
        {tr('animals.moveAction')}
      </button>
      {#if feedItems.length}
        <button
          type="button"
          class="af-ghost"
          aria-expanded={open === 'feed'}
          onclick={() => toggle('feed')}
        >
          {tr('animals.quick.feed')}
        </button>
      {/if}
    </div>

    {#if open === 'log' && food}
      <div class="af-form" role="group" aria-label={tr('animals.quick.log', { unit: unitName })}>
        <span class="af-label" id="{uid}-count"
          >{tr('animals.quick.howMany', { unit: unitName })}</span
        >
        <div class="stepper" aria-labelledby="{uid}-count">
          <button
            type="button"
            class="af-ghost sq"
            aria-label={tr('animals.quick.oneFewer')}
            onclick={() => step(-1)}>−</button
          >
          {#if typing}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="af-input num"
              type="number"
              min="0"
              inputmode="numeric"
              aria-label={tr('animals.quick.howMany', { unit: unitName })}
              autofocus
              bind:value={count}
              onblur={() => (typing = false)}
            />
          {:else}
            <button
              type="button"
              class="af-ghost num"
              aria-label={tr('animals.quick.tapToType', { count, unit: unitName })}
              onclick={() => (typing = true)}>{count} <small>{unitName}</small></button
            >
          {/if}
          <button
            type="button"
            class="af-ghost sq"
            aria-label={tr('animals.quick.oneMore')}
            onclick={() => step(1)}>+</button
          >
        </div>
        <fieldset class="af-fieldset">
          <legend class="af-legend">{tr('animals.use.whereGoingMany')}</legend>
          <div class="af-tiles">
            {#each USE_TILES as v (v)}
              <label class="af-tile" class:on={use === v}>
                <input type="radio" name="{uid}-use" value={v} bind:group={use} />
                <span>{useLabel(tr, v)}</span>
              </label>
            {/each}
          </div>
        </fieldset>
        {#if held}
          <p class="af-note" role="alert" data-testid="hold-stop">
            {stopText ??
              `These ${unitLabel} are on hold, so they can't be kept for the table or sold.`}
            The only way to save them is as thrown out.
          </p>
          <button
            type="button"
            class="af-primary wide"
            disabled={saving}
            onclick={() => logProduction('discard')}>Save as discard</button
          >
        {:else}
          {#if check.verdict === 'unconfirmed'}
            <p class="af-help">The server checks holds again when this syncs.</p>
          {/if}
          <button
            type="button"
            class="af-primary wide"
            disabled={saving}
            onclick={() => logProduction(use)}
          >
            {saving ? tr('animals.saving') : tr('animals.save')}
          </button>
        {/if}
      </div>
    {:else if open === 'treat'}
      <form
        class="af-form"
        onsubmit={logTreatment}
        aria-label={tr('animals.quick.logTreatmentAria')}
        novalidate
      >
        <label class="af-label" for="{uid}-prod">{tr('animals.quick.whatGiven')}</label>
        <input id="{uid}-prod" class="af-input" bind:value={productName} maxlength="200" />
        <label class="af-label" for="{uid}-route"
          >{tr('animals.quick.howGiven')}
          <span class="af-optional">{tr('animals.optional')}</span></label
        >
        <select id="{uid}-route" class="af-input" bind:value={route}>
          <option value="">{tr('animals.quick.notSure')}</option>
          {#each ROUTE_CHOICES as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
        </select>
        <p class="af-help">
          Its eggs, milk and meat go on hold until the owner adds the withdrawal time from the label
          or the vet. The owner can add this when online.
        </p>
        <button class="af-primary wide" type="submit" disabled={saving}
          >{saving ? tr('animals.saving') : tr('animals.save')}</button
        >
      </form>
    {:else if open === 'move'}
      <form class="af-form" onsubmit={move} aria-label={tr('animals.quick.moveFlock')} novalidate>
        <label class="af-label" for="{uid}-area">{tr('animals.quick.moveThemTo')}</label>
        <select id="{uid}-area" class="af-input" bind:value={fieldId}>
          <option value="">{tr('animals.quick.pickArea')}</option>
          {#each areas as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
        {#if movePre.verdict === 'stop'}
          <p class="af-note" role="alert" data-testid="move-stop">{movePre.message}</p>
        {:else if movePre.verdict === 'warn'}
          <p class="af-note">{movePre.message}</p>
        {/if}
        <button
          class="af-primary wide"
          type="submit"
          disabled={saving || movePre.verdict === 'stop'}
        >
          {saving ? tr('animals.saving') : tr('animals.moveAction')}
        </button>
      </form>
    {:else if open === 'feed'}
      <form
        class="af-form"
        onsubmit={logFeed}
        aria-label={tr('animals.quick.logFeedAria')}
        novalidate
      >
        <label class="af-label" for="{uid}-feed">{tr('animals.quick.feed')}</label>
        <select id="{uid}-feed" class="af-input" bind:value={feedItemId}>
          <option value="">{tr('animals.quick.pickTheFeed')}</option>
          {#each feedItems as f (f.id)}<option value={f.id}>{f.displayName}</option>{/each}
        </select>
        <label class="af-label" for="{uid}-lb">{tr('animals.quick.poundsUsed')}</label>
        <input
          id="{uid}-lb"
          class="af-input"
          type="number"
          min="0"
          step="any"
          inputmode="decimal"
          bind:value={feedLb}
        />
        <button class="af-primary wide" type="submit" disabled={saving}
          >{saving ? tr('animals.saving') : tr('animals.save')}</button
        >
      </form>
    {/if}

    {#if error}<p class="af-error" role="alert">{error}</p>{/if}
    {#if message}<p class="af-ok" role="status" data-testid="quick-action-result">{message}</p>{/if}
  </section>
{/if}

<style>
  .qa {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: var(--space-4) 0;
    max-width: 640px;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-h3, 1.15rem);
  }
  .chip {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-card);
    background: var(--pill-forest-bg);
    color: var(--pill-forest-fg);
    font-weight: 600;
  }
  .chip.hold {
    background: var(--pill-rust-bg, #fce8e8);
    color: var(--pill-rust-fg, #7a0016);
  }
  .chip.unsure {
    background: var(--pill-wheat-bg);
    color: var(--color-ink);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .stepper {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
  }
  .sq {
    min-width: 56px;
    font-size: 1.5rem;
  }
  .num {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-size: 1.25rem;
  }
  .wide {
    width: 100%;
  }
</style>
