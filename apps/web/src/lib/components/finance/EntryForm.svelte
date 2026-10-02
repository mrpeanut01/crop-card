<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import '$lib/components/finance/finance.css';
  import {
    categoriesFor,
    categoryLabel,
    isCategoryFor,
    type LedgerKind
  } from '$lib/finance/categories';
  import { centsToInput, formatMoney, parseMoneyInput } from '$lib/finance/money';
  import { zonedDayStartMs } from '$lib/exports/dateRange';
  import { ymdInZone } from '$lib/prefs';
  import type { EntryFormOptions, EntryFormValue } from '$lib/finance/formTypes';

  interface Props {
    initial: EntryFormValue;
    options: EntryFormOptions;
    /** Plain-English note about a prefilled stock lot or harvest. */
    linkNote?: string | null;
    backHref: string;
  }

  const { initial, options, linkNote = null, backHref }: Props = $props();

  type LinkKind = 'none' | 'crop' | 'area' | 'group' | 'animal';

  function linkOf(v: EntryFormValue): { kind: LinkKind; id: string } {
    if (v.cropId) return { kind: 'crop', id: v.cropId };
    if (v.animalGroupId) return { kind: 'group', id: v.animalGroupId };
    if (v.animalId) return { kind: 'animal', id: v.animalId };
    if (v.fieldId) return { kind: 'area', id: v.fieldId };
    return { kind: 'none', id: '' };
  }

  const start = untrack(() => initial);
  let kind = $state<LedgerKind>(start.kind);
  const zone = untrack(() => options.timeZone);
  let date = $state(ymdInZone(start.occurredAt, zone));
  let amount = $state(centsToInput(start.amountCents));
  let category = $state(start.category);
  let description = $state(start.description ?? '');
  const startLink = linkOf(start);
  let link = $state(startLink.kind === 'none' ? '' : `${startLink.kind}:${startLink.id}`);
  let blockId = $state(start.blockId ?? '');
  let enterprise = $state(start.enterprise ?? '');
  let quantity = $state(start.quantity === null ? '' : String(start.quantity));
  let unit = $state(start.unit ?? '');
  let error = $state<string | null>(null);
  let saving = $state(false);

  const categories = $derived(categoriesFor(kind));
  const linkKind = $derived((link.split(':')[0] || 'none') as LinkKind);
  const linkId = $derived(link.slice(link.indexOf(':') + 1));
  const bedsHere = $derived(
    linkKind === 'area' ? options.beds.filter((b) => b.fieldId === linkId) : []
  );
  const animalLinked = $derived(linkKind === 'animal' || linkKind === 'group');
  const tagUsed = $derived(linkKind === 'none' || linkKind === 'area');
  const hasLot = $derived(!!start.stockLotId && kind === 'expense');
  const hasHarvest = $derived(!!start.harvestEventId && kind === 'income');
  const preview = $derived(parseMoneyInput(amount));

  function setKind(k: LedgerKind) {
    kind = k;
    if (!isCategoryFor(k, category)) category = categoriesFor(k)[0];
  }

  function dayMs(ymd: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return null;
    return (
      zonedDayStartMs(Number(m[1]), Number(m[2]), Number(m[3]), options.timeZone) + 12 * 3_600_000
    );
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const amountCents = parseMoneyInput(amount);
    if (amountCents === null) {
      error = 'Type the amount in dollars, like 12.50.';
      return;
    }
    const occurredAt = dayMs(date);
    if (occurredAt === null) {
      error = 'Pick the date.';
      return;
    }
    const qty = quantity.trim() === '' ? null : Number(quantity);
    if (qty !== null && !(qty > 0)) {
      error = 'Quantity must be a number above zero, or empty.';
      return;
    }
    const body = {
      kind,
      occurredAt,
      amountCents,
      category,
      description: description.trim() || null,
      cropId: linkKind === 'crop' ? linkId : null,
      fieldId: linkKind === 'area' ? linkId : null,
      blockId: linkKind === 'area' && blockId ? blockId : null,
      animalId: linkKind === 'animal' ? linkId : null,
      animalGroupId: linkKind === 'group' ? linkId : null,
      stockLotId: kind === 'expense' ? start.stockLotId : null,
      harvestEventId: kind === 'income' ? start.harvestEventId : null,
      ...(!start.id && kind === 'income' && start.harvestEventId && start.dispositionId
        ? { dispositionId: start.dispositionId }
        : {}),
      enterprise: tagUsed ? enterprise.trim() || null : null,
      quantity: qty,
      unit: unit.trim() || null
    };
    saving = true;
    const res = await fetch(
      start.id ? `/api/finance/entries/${encodeURIComponent(start.id)}` : '/api/finance/entries',
      {
        method: start.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }
    ).catch(() => null);
    saving = false;
    if (!res) {
      error = 'No signal. Save this when you are back online.';
      return;
    }
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      error = out.error ?? 'That did not save. Try again.';
      return;
    }
    await goto(backHref, { invalidateAll: true });
  }
</script>

<form class="entry-form" onsubmit={submit}>
  <div class="fin-segment" role="group" aria-label="Money in or out">
    <button
      type="button"
      class="fin-ghost"
      class:on={kind === 'expense'}
      aria-pressed={kind === 'expense'}
      onclick={() => setKind('expense')}>Expense</button
    >
    <button
      type="button"
      class="fin-ghost"
      class:on={kind === 'income'}
      aria-pressed={kind === 'income'}
      onclick={() => setKind('income')}>Income</button
    >
  </div>

  {#if linkNote}<p class="fin-note">{linkNote}</p>{/if}

  <div class="fin-row">
    <label class="fin-label">
      Amount in dollars
      <input
        class="fin-input"
        name="amount"
        inputmode="decimal"
        autocomplete="off"
        required
        bind:value={amount}
      />
      {#if preview !== null}<span class="fin-help">{formatMoney(preview)}</span>{/if}
    </label>
    <label class="fin-label">
      Date
      <input class="fin-input" name="date" type="date" required bind:value={date} />
    </label>
  </div>

  <label class="fin-label">
    Category
    <select class="fin-input" name="category" bind:value={category}>
      {#each categories as c (c)}
        <option value={c}>{categoryLabel(c)}</option>
      {/each}
    </select>
  </label>

  <label class="fin-label">
    What was it? <span class="optional">(optional)</span>
    <input class="fin-input" name="description" maxlength="200" bind:value={description} />
  </label>

  <label class="fin-label">
    Linked to <span class="optional">(optional)</span>
    <select class="fin-input" name="link" bind:value={link}>
      <option value="">Nothing in particular</option>
      {#if options.plantings.length}
        <optgroup label="Crops">
          {#each options.plantings as p (p.id)}<option value="crop:{p.id}">{p.label}</option>{/each}
        </optgroup>
      {/if}
      {#if options.groups.length}
        <optgroup label="Animal groups">
          {#each options.groups as g (g.id)}<option value="group:{g.id}">{g.label}</option>{/each}
        </optgroup>
      {/if}
      {#if options.animals.length}
        <optgroup label="Animals">
          {#each options.animals as a (a.id)}<option value="animal:{a.id}">{a.label}</option>{/each}
        </optgroup>
      {/if}
      {#if options.areas.length}
        <optgroup label="Areas">
          {#each options.areas as a (a.id)}<option value="area:{a.id}">{a.label}</option>{/each}
        </optgroup>
      {/if}
    </select>
  </label>

  {#if bedsHere.length}
    <label class="fin-label">
      Bed <span class="optional">(optional)</span>
      <select class="fin-input" name="blockId" bind:value={blockId}>
        <option value="">The whole Area</option>
        {#each bedsHere as b (b.id)}<option value={b.id}>{b.label}</option>{/each}
      </select>
    </label>
  {/if}

  {#if animalLinked}
    <p class="fin-note">
      This records money only. Log where eggs, milk or meat went on the animal's page.
    </p>
  {/if}

  {#if tagUsed}
    <label class="fin-label">
      Enterprise tag <span class="optional">(optional)</span>
      <input
        class="fin-input"
        name="enterprise"
        maxlength="60"
        placeholder="Farm stand, CSA, markets"
        bind:value={enterprise}
      />
      <span class="fin-help">Groups entries that are not tied to one crop or animal.</span>
    </label>
  {/if}

  <div class="fin-row">
    <label class="fin-label">
      Quantity <span class="optional">(optional)</span>
      <input class="fin-input" name="quantity" inputmode="decimal" bind:value={quantity} />
    </label>
    <label class="fin-label">
      Unit <span class="optional">(optional)</span>
      <input
        class="fin-input"
        name="unit"
        maxlength="30"
        placeholder="lb, dozen, bale"
        bind:value={unit}
      />
    </label>
  </div>

  {#if hasLot}
    <p class="fin-help">
      Linked to a stock lot. This counts as cash spent, and each crop or animal is charged only for
      what it used.
    </p>
  {/if}
  {#if hasHarvest}
    <p class="fin-help">Linked to a harvest record. The harvest record itself is not changed.</p>
  {/if}

  {#if error}<p class="fin-error" role="alert">{error}</p>{/if}

  <div class="fin-actions">
    <button class="fin-primary" type="submit" disabled={saving}>
      {saving
        ? 'Saving'
        : start.id
          ? 'Save changes'
          : kind === 'income'
            ? 'Save income'
            : 'Save expense'}
    </button>
    <a class="fin-ghost" href={backHref}>Cancel</a>
  </div>
</form>

<style>
  .entry-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 640px;
    min-width: 0;
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
</style>
