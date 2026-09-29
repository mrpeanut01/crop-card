<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import '$lib/components/animals/animalForms.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import HoldChips from '$lib/components/animals/HoldChips.svelte';
  import HealthForm from '$lib/components/animals/HealthForm.svelte';
  import WithdrawalEntryForm from '$lib/components/animals/WithdrawalEntryForm.svelte';
  import { OFFLINE_MESSAGE, errorFromResponse } from '$lib/animals/display';
  import { HEALTH_KIND_LABEL, ROUTE_CHOICES } from '$lib/animals/healthCopy';
  import { holdLine } from '$lib/animals/holdCopy';
  import { formatInstant } from '$lib/prefs';
  import { holdRefusalOf, shorteningLine, type HoldShortenBody } from '$lib/animals/holdGuardCopy';

  const { data } = $props();

  const subject = $derived(data.subject);
  const showHolds = $derived(data.foods.length > 0);
  const prefs = $derived({ timeZone: data.timeZone, units: 'us' as const });
  const routeLabel = new Map<string, string>(ROUTE_CHOICES.map((r) => [r.value, r.label]));

  let adding = $state(false);
  let entryFor = $state<string | null>(null);
  let removeFor = $state<string | null>(null);
  let removeReason = $state('');
  let status = $state<string | null>(null);
  let alertText = $state<string | null>(null);
  let busy = $state(false);
  let voidOffer = $state<{ id: string; refusal: HoldShortenBody; locked: boolean } | null>(null);

  function announce(text: string) {
    alertText = null;
    status = text;
  }

  async function saved(out: { warnings?: { message: string }[] }, text: string) {
    adding = false;
    const extra = (out.warnings ?? []).map((w) => w.message).join(' ');
    announce(extra ? `${text} ${extra}` : text);
    await invalidateAll();
  }

  async function remove(
    id: string,
    opts: { neverGiven?: boolean; locked: boolean; confirmShorten?: string }
  ) {
    const q = new URLSearchParams();
    if (opts.locked) q.set('force', 'true');
    if (opts.neverGiven) q.set('neverGiven', 'true');
    if (opts.confirmShorten) q.set('confirmShorten', opts.confirmShorten);
    if (removeReason.trim()) q.set('reason', removeReason.trim());
    if (opts.locked && !removeReason.trim()) {
      alertText = 'Say why this locked record is being removed.';
      return;
    }
    busy = true;
    try {
      const res = await fetch(`/api/animals/health/${id}?${q}`, { method: 'DELETE' });
      const refusal = await holdRefusalOf(res);
      if (refusal?.canVoid) {
        voidOffer = { id, refusal, locked: opts.locked };
        return;
      }
      voidOffer = null;
      if (!res.ok) {
        alertText = await errorFromResponse(res);
        return;
      }
      const out = (await res.json()) as { holdKept?: boolean };
      removeFor = null;
      removeReason = '';
      announce(
        out.holdKept
          ? 'Removed. Its withdrawal hold stays, because the dose was given.'
          : 'Removed.'
      );
      await invalidateAll();
    } catch {
      alertText = OFFLINE_MESSAGE;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Health · {subject.name} · CropCard</title>
</svelte:head>

<div class="record-page">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href={subject.detailHref}>{subject.name}</a>
    <a href="/animals/{subject.id}/log">Eggs, milk and weights</a>
  </nav>

  <header>
    <Kicker>{subject.speciesName} · Health</Kicker>
    <h1 class="serif">{subject.name}</h1>
  </header>

  <HoldChips
    holds={data.holds}
    foods={data.foods}
    timeZone={data.timeZone}
    isOwner={data.isOwner}
  />

  {#if data.corrections.length}
    <section class="panel" aria-label="Owner-corrected holds">
      <p><Pill tone="wheat">Owner-corrected</Pill></p>
      <ul>
        {#each data.corrections as c (c.id)}
          <li>
            {formatInstant(c.createdAt, prefs)}: an entry was voided and its holds shortened.
            Reason: {c.reason}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="live" aria-live="polite" role="status">
    {#if status}<p class="af-ok">{status}</p>{/if}
  </div>
  {#if alertText}<p class="af-error" role="alert">{alertText}</p>{/if}

  {#if data.canLog}
    {#if adding}
      <section aria-label="Record health" class="panel">
        <HealthForm
          subjectType={subject.type}
          subjectId={subject.id}
          foodProducing={subject.foodProducing}
          {showHolds}
          isOwner={data.isOwner}
          products={data.products}
          stock={data.stock}
          onDone={saved}
        />
        <button type="button" class="af-ghost" onclick={() => (adding = false)}>Cancel</button>
      </section>
    {:else}
      <button type="button" class="af-primary" onclick={() => (adding = true)}>
        Record a treatment or visit
      </button>
    {/if}
  {/if}

  <section aria-labelledby="records-h">
    <h2 id="records-h" class="section-title">Records</h2>
    {#if data.events.length === 0}
      <p class="af-help">Nothing recorded yet.</p>
    {:else}
      <ul class="rows">
        {#each data.events as e (e.id)}
          <li class="row" data-testid="health-row">
            <div class="row-head">
              <strong>{HEALTH_KIND_LABEL[e.kind]}{e.product ? `: ${e.product}` : ''}</strong>
              {#if e.carriesHold && e.locked}<Pill tone="neutral">Locked</Pill>{/if}
              {#if e.daysLate !== null}<Pill tone="wheat">Entered {e.daysLate} days late</Pill>{/if}
            </div>
            <p class="meta">
              {formatInstant(e.administeredAt, prefs)}
              {#if e.courseEndAt}to {formatInstant(e.courseEndAt, prefs)}{/if}
              {#if e.courseOpen}· more doses to come{/if}
              {#if e.dose}· {e.dose} {e.doseUnit ?? ''}{/if}
              {#if e.route}· {routeLabel.get(e.route) ?? e.route}{/if}
              {#if e.vetName}· Vet: {e.vetName}{/if}
              {#if e.lotNumber}· Lot {e.lotNumber}{/if}
            </p>
            {#if e.carriesHold && showHolds}
              <ul class="hold-lines">
                {#each e.foods as f (f.food)}
                  {@const line = holdLine(f.food, f.hold, data.timeZone)}
                  {#if line}<li>{line}</li>{/if}
                {/each}
              </ul>
            {/if}
            {#if e.notes}<p class="notes">{e.notes}</p>{/if}

            <div class="action-row">
              {#if e.carriesHold && showHolds && data.isOwner}
                <button
                  type="button"
                  class="af-ghost"
                  aria-expanded={entryFor === e.id}
                  onclick={() => (entryFor = entryFor === e.id ? null : e.id)}
                >
                  Add withdrawal
                </button>
              {/if}
              {#if e.carriesHold ? data.isOwner : data.canLog}
                <button
                  type="button"
                  class="af-ghost"
                  aria-expanded={removeFor === e.id}
                  onclick={() => (removeFor = removeFor === e.id ? null : e.id)}
                >
                  Remove
                </button>
              {/if}
            </div>
            {#if e.carriesHold && !data.isOwner}
              <p class="af-help">
                {showHolds
                  ? 'Only the owner can add a withdrawal or remove this. Ask the owner.'
                  : 'Only the owner can remove this. Ask the owner.'}
              </p>
            {/if}

            {#if entryFor === e.id}
              <WithdrawalEntryForm
                recordId={e.id}
                foods={data.foods}
                courseOpen={e.courseOpen}
                products={data.products}
                onDone={async (text) => {
                  entryFor = null;
                  announce(text);
                  await invalidateAll();
                }}
              />
            {/if}
            {#if removeFor === e.id}
              <div class="remove">
                <label class="af-label" for="reason-{e.id}">
                  Why? <span class="af-optional">{e.locked ? '' : '(optional)'}</span>
                </label>
                <input
                  id="reason-{e.id}"
                  class="af-input"
                  type="text"
                  maxlength="500"
                  bind:value={removeReason}
                />
                {#if e.carriesHold && showHolds}
                  <div class="action-row">
                    <button
                      type="button"
                      class="af-danger"
                      disabled={busy}
                      onclick={() => remove(e.id, { locked: e.locked })}
                    >
                      Remove, the dose was given
                    </button>
                    <button
                      type="button"
                      class="af-danger"
                      disabled={busy}
                      onclick={() => remove(e.id, { locked: e.locked, neverGiven: true })}
                    >
                      Void this entry…
                    </button>
                  </div>
                  <p class="af-help">
                    A dose that was given keeps its hold. The owner can void an entry that was a
                    mistake within 48 hours of entering it; holds from an unknown label or a
                    prohibited drug can't be voided.
                  </p>
                  {#if voidOffer?.id === e.id}
                    <div class="remove" role="alert">
                      <p><strong>Voiding this entry would shorten holds:</strong></p>
                      <ul>
                        {#each voidOffer.refusal.holds.slice(0, 3) as h, i (i)}
                          <li>{shorteningLine(h, data.timeZone, { dated: false })}</li>
                        {/each}
                        {#if voidOffer.refusal.holds.length > 3}
                          <li>+{voidOffer.refusal.holds.length - 3} more</li>
                        {/if}
                      </ul>
                      <button
                        type="button"
                        class="af-danger"
                        disabled={busy}
                        onclick={() =>
                          voidOffer &&
                          remove(e.id, {
                            locked: voidOffer.locked,
                            neverGiven: true,
                            confirmShorten: voidOffer.refusal.diffHash
                          })}
                      >
                        Void it and shorten these holds
                      </button>
                    </div>
                  {/if}
                {:else}
                  <button
                    type="button"
                    class="af-danger"
                    disabled={busy}
                    onclick={() => remove(e.id, { locked: e.locked })}
                  >
                    Remove
                  </button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .record-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 720px;
    min-width: 0;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: var(--font-size-caption);
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  h1 {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .live:empty {
    display: none;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .section-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--card-padding);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  .row-head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    overflow-wrap: anywhere;
  }
  .meta,
  .notes {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .hold-lines {
    margin: 0;
    padding-left: 1.2em;
  }
  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .remove {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
