<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import {
    DISPOSITION_FORCE_REASON_MIN,
    dispositionKindLabel,
    DISPOSITION_UNIT_SUGGESTIONS,
    HARVEST_DISPOSITION_KINDS,
    type DispositionCreate,
    type HarvestDispositionKind
  } from '$lib/harvest/apiSchemas';
  import { dispositionLine, type DispositionView } from '$lib/harvest/dispositions';
  import { submitDisposition } from '$lib/harvest/dispositionClient';
  import { parseHarvestQuantity, recordSaleHref } from '$lib/finance/harvestSale';
  import { zonedDayStartMs } from '$lib/exports/dateRange';
  import { ymdInZone } from '$lib/prefs';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';

  interface Props {
    harvest: {
      id: string;
      cropId: string | null;
      occurredAt: number;
      quantity: string | null;
    };
    dispositions: DispositionView[];
    /** Owner or helper; inspectors only read. */
    canWrite: boolean;
    isOwner: boolean;
    /** Owner on a farm that keeps money: "Also record the money". */
    canRecordSale: boolean;
    /** The farm has an organic status on file (B-15 `full`). */
    askSoldAsOrganic: boolean;
    online: boolean;
    onChanged: () => void | Promise<void>;
  }

  const {
    harvest,
    dispositions,
    canWrite,
    isOwner,
    canRecordSale,
    askSoldAsOrganic,
    online,
    onChanged
  }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const zone = $derived(currentPrefs().timeZone);
  const parsedHarvest = untrack(() => parseHarvestQuantity(harvest.quantity));

  let editingId = $state<string | null>(null);
  let editingOccurredAt = $state<number | null>(null);
  let kind = $state<HarvestDispositionKind>('sold');
  let quantity = $state(untrack(() => (parsedHarvest ? String(parsedHarvest.quantity) : '')));
  let unit = $state(untrack(() => parsedHarvest?.unit ?? 'lb'));
  let date = $state(untrack(() => ymdInZone(Date.now(), currentPrefs().timeZone)));
  let recipient = $state('');
  let soldAsOrganic = $state<'yes' | 'no' | ''>('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let notices = $state<string[]>([]);
  let deletingId = $state<string | null>(null);
  let deleteReason = $state('');

  const minDate = $derived(ymdInZone(harvest.occurredAt, zone));
  const maxDate = $derived(ymdInZone(Date.now(), zone));
  const hasRecipient = $derived(kind === 'sold' || kind === 'donated');

  function resetForm() {
    editingId = null;
    editingOccurredAt = null;
    kind = 'sold';
    quantity = '';
    unit = parsedHarvest?.unit ?? 'lb';
    date = ymdInZone(Date.now(), zone);
    recipient = '';
    soldAsOrganic = '';
  }

  function startEdit(d: DispositionView) {
    editingId = d.id;
    editingOccurredAt = d.occurredAt;
    kind = d.kind;
    quantity = String(d.quantity);
    unit = d.unit;
    date = ymdInZone(d.occurredAt, zone);
    recipient = d.recipient ?? '';
    soldAsOrganic = d.soldAsOrganic === true ? 'yes' : d.soldAsOrganic === false ? 'no' : '';
    error = null;
    notices = [];
  }

  function dayToMs(ymd: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return null;
    if (ymd === ymdInZone(Date.now(), zone)) return Date.now();
    return zonedDayStartMs(Number(m[1]), Number(m[2]), Number(m[3]), zone) + 12 * 3_600_000;
  }

  function body(): DispositionCreate | null {
    const qty = Number(quantity);
    if (!(qty > 0)) {
      error = tr('harvestui.disp.err.qty');
      return null;
    }
    if (!unit.trim()) {
      error = tr('harvestui.disp.err.unit');
      return null;
    }
    const occurredAt = dayToMs(date);
    if (occurredAt === null) {
      error = tr('harvestui.disp.err.date');
      return null;
    }
    return {
      kind,
      quantity: qty,
      unit: unit.trim(),
      occurredAt,
      recipient: hasRecipient ? recipient.trim() || null : null,
      soldAsOrganic:
        kind === 'sold' && askSoldAsOrganic && soldAsOrganic !== '' ? soldAsOrganic === 'yes' : null
    };
  }

  function noticesFrom(out: { organicNotice?: string | null; quantityNotice?: string | null }) {
    return [out.organicNotice, out.quantityNotice].filter((n): n is string => !!n);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    notices = [];
    const b = body();
    if (!b) return;
    saving = true;
    try {
      if (editingId) {
        const sameDay = editingOccurredAt !== null && date === ymdInZone(editingOccurredAt, zone);
        const { occurredAt, ...rest } = b;
        const patch = sameDay ? rest : { ...rest, occurredAt };
        const res = await fetch(`/api/harvest/dispositions/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch)
        }).catch(() => null);
        if (!res) {
          error = tr('harvestui.disp.err.offlineChange');
          return;
        }
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          error = out.message ?? tr('harvestui.disp.err.notSaved');
          return;
        }
        notices = noticesFrom(out);
      } else {
        const out = await submitDisposition(harvest.id, b);
        if (out.status === 'error') {
          error = out.message;
          return;
        }
        if (out.status === 'queued') {
          notices = [tr('harvestui.disp.queued')];
          resetForm();
          // Nothing new on the server yet, and reloading the page data
          // offline would make SvelteKit fall back to a full navigation.
          return;
        }
        notices = noticesFrom(out.body);
      }
      resetForm();
      await onChanged();
    } finally {
      saving = false;
    }
  }

  async function remove(d: DispositionView) {
    error = null;
    const params = new URLSearchParams();
    if (d.locked) {
      if (deleteReason.trim().length < DISPOSITION_FORCE_REASON_MIN) {
        error = 'Say why this locked record is being deleted.';
        return;
      }
      params.set('force', 'true');
      params.set('reason', deleteReason.trim());
    }
    const q = params.toString();
    const res = await fetch(
      `/api/harvest/dispositions/${encodeURIComponent(d.id)}${q ? `?${q}` : ''}`,
      { method: 'DELETE' }
    ).catch(() => null);
    if (!res) {
      error = tr('harvestui.disp.err.offlineDelete');
      return;
    }
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      error = out.message ?? tr('harvestui.disp.err.notDeleted');
      return;
    }
    deletingId = null;
    deleteReason = '';
    await onChanged();
  }
</script>

<div class="disp" data-testid="disposition-panel">
  {#if dispositions.length === 0}
    <p class="empty">{tr('harvestui.disp.empty')}</p>
  {:else}
    <ul class="list">
      {#each dispositions as d (d.id)}
        <li data-testid="disposition-row">
          <p class="line">
            {dispositionLine(d, fmt.instant(d.occurredAt, 'date'), page.data?.locale)}
          </p>
          <p class="meta">
            {#if d.locked}<span class="pill">Locked</span>{/if}
            {#if isOwner && d.sale === 'live'}<span class="pill"
                >{tr('harvestui.disp.saleRecorded')}</span
              >{/if}
            {#if isOwner && d.sale === 'deleted'}<span class="pill warn"
                >{tr('harvestui.disp.saleDeleted')}</span
              >{/if}
          </p>
          <div class="row-actions">
            {#if canWrite && !d.locked}
              <button type="button" class="ghost" onclick={() => startEdit(d)}
                >{tr('harvestui.disp.edit')}</button
              >
            {/if}
            {#if canWrite && (!d.locked || isOwner)}
              <button
                type="button"
                class="ghost"
                onclick={() => {
                  deletingId = deletingId === d.id ? null : d.id;
                  deleteReason = '';
                }}>{tr('harvestui.disp.delete')}</button
              >
            {/if}
            {#if isOwner && canRecordSale && d.kind === 'sold' && !d.ledgerEntryId}
              {#if online}
                <a
                  class="ghost"
                  href={recordSaleHref({
                    harvestEventId: harvest.id,
                    cropId: harvest.cropId ?? '',
                    dispositionId: d.id
                  })}>{tr('harvestui.disp.alsoMoney')}</a
                >
              {:else}
                <span class="muted">{tr('harvestui.disp.moneyOffline')}</span>
              {/if}
            {/if}
          </div>
          {#if deletingId === d.id}
            <div class="confirm">
              {#if d.locked}
                <label>
                  Why delete a locked record?
                  <input type="text" bind:value={deleteReason} maxlength="500" />
                </label>
              {/if}
              <button type="button" class="danger" onclick={() => remove(d)}>
                {d.locked ? 'Delete with this reason' : tr('harvestui.disp.deleteThis')}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if canWrite}
    <form class="form" onsubmit={save} data-testid="disposition-form">
      <h3>{editingId ? tr('harvestui.disp.changeEntry') : tr('harvestui.disp.addEntry')}</h3>
      <div class="kinds" role="group" aria-label={tr('harvestui.disp.whereItWent')}>
        {#each HARVEST_DISPOSITION_KINDS as k (k)}
          <button
            type="button"
            class="kind"
            class:on={kind === k}
            aria-pressed={kind === k}
            onclick={() => (kind = k)}>{dispositionKindLabel(k, page.data?.locale)}</button
          >
        {/each}
      </div>
      <div class="pair">
        <label>
          {tr('harvestui.disp.howMuch')}
          <input type="number" inputmode="decimal" min="0.01" step="any" bind:value={quantity} />
        </label>
        <label>
          {tr('harvestui.disp.unit')}
          <input type="text" list="disposition-units" maxlength="20" bind:value={unit} />
        </label>
      </div>
      <datalist id="disposition-units">
        {#each DISPOSITION_UNIT_SUGGESTIONS as u (u)}<option value={u}></option>{/each}
      </datalist>
      <label>
        {tr('harvestui.disp.date')}
        <input type="date" min={minDate} max={maxDate} bind:value={date} />
      </label>
      {#if hasRecipient}
        <label>
          {kind === 'sold' ? tr('harvestui.disp.soldTo') : tr('harvestui.disp.givenTo')}
          <input type="text" maxlength="120" bind:value={recipient} />
        </label>
      {/if}
      {#if kind === 'sold' && askSoldAsOrganic}
        <fieldset class="organic">
          <legend>{tr('harvestui.disp.soldAsOrganicQ')}</legend>
          <label class="radio"
            ><input type="radio" value="yes" bind:group={soldAsOrganic} />
            {tr('harvestui.disp.yes')}</label
          >
          <label class="radio"
            ><input type="radio" value="no" bind:group={soldAsOrganic} />
            {tr('harvestui.disp.no')}</label
          >
        </fieldset>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="form-actions">
        <button type="submit" class="primary" disabled={saving}>
          {editingId ? tr('harvestui.disp.saveChange') : tr('harvestui.disp.save')}
        </button>
        {#if editingId}
          <button type="button" class="ghost" onclick={resetForm}
            >{tr('harvestui.disp.cancel')}</button
          >
        {/if}
      </div>
    </form>
  {:else if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if notices.length > 0}
    <div class="notices" role="status">
      {#each notices as n, i (i)}<p>{n}</p>{/each}
    </div>
  {/if}
</div>

<style>
  .disp {
    display: grid;
    gap: var(--space-3, 12px);
  }
  .empty,
  .muted {
    color: var(--color-ink-soft);
    margin: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2, 8px);
  }
  .list li {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 10px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    background: var(--color-paper);
  }
  .line {
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .meta:empty {
    display: none;
  }
  .pill {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: var(--radius-pill, 999px);
    border: 1px solid var(--color-divider);
    color: var(--color-ink-soft);
  }
  .pill.warn {
    color: var(--color-rust);
    border-color: var(--color-rust);
  }
  .row-actions,
  .form-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
  .ghost,
  .primary,
  .danger,
  .kind {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 8px);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: white;
  }
  .danger {
    color: var(--color-rust);
    border-color: var(--color-rust);
  }
  .confirm {
    display: grid;
    gap: 8px;
    margin-top: 8px;
  }
  .form {
    display: grid;
    gap: var(--space-2, 8px);
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
    padding-top: var(--space-3, 12px);
  }
  .form h3 {
    margin: 0;
    font-size: 1rem;
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .kind.on {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: white;
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 14px;
    color: var(--color-ink-soft);
  }
  input[type='text'],
  input[type='number'],
  input[type='date'] {
    min-height: 48px;
    width: 100%;
    box-sizing: border-box;
    padding: 0 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    font: inherit;
    color: var(--color-ink);
    background: var(--color-paper);
  }
  .organic {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin: 0;
    padding: 8px 12px;
  }
  .radio {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    color: var(--color-ink);
  }
  .radio input {
    width: 24px;
    height: 24px;
  }
  .error {
    color: var(--color-rust);
    margin: 0;
  }
  .notices {
    border: 1px solid var(--color-wheat, var(--color-divider));
    border-radius: var(--radius-card, 10px);
    padding: 8px 12px;
    background: var(--color-cream, var(--color-paper));
  }
  .notices p {
    margin: 0;
  }
</style>
