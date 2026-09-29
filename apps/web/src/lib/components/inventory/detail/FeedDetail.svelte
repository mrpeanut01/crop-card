<script lang="ts">
  /**
   * Phase 32D (D4): feed and bedding detail. Anyone who can record work
   * takes feed off stock in pounds, by scoop chip or keypad (D0-12, D0-13);
   * the movement is `animal-feed`. Owners set the bag size and scoop on the
   * edit page.
   */
  import { invalidateAll } from '$app/navigation';
  import InvSection from '../InvSection.svelte';
  import InvKVP from '../InvKVP.svelte';
  import LotQuantities from '../LotQuantities.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { formatStockQuantity } from '$lib/stock/units';
  import {
    MAX_FEED_USE_LB,
    movementLabel,
    parseFeedUseNote,
    scoopChoices
  } from '$lib/stock/animalStock';
  import type { FeedDetailPayload } from '../../../../routes/inventory/[type]/[id]/+page.server';

  type Props = Omit<FeedDetailPayload, 'type'>;
  const { item, lots, movements, feed, onHand, onHandLb, subjects, canUse, canEdit }: Props =
    $props();

  const qty = (v: number) =>
    formatStockQuantity(v, item.defaultUnit, currentPrefs(), {
      digits: 2,
      category: item.category
    });
  const lbText = (v: number) => `${Math.round(v * 10) / 10} lb`;
  const kicker = $derived(item.category === 'bedding' ? 'Bedding' : 'Feed');
  const scoops = $derived(scoopChoices(feed.scoopLb));
  const subjectLabel = (note?: string) => {
    const s = parseFeedUseNote(note);
    return s ? (subjects.find((x) => x.type === s.type && x.id === s.id)?.label ?? null) : null;
  };

  let lb = $state<number | null>(null);
  let subject = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  function newRecordId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `feed_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async function recordUse(amountLb: number | null): Promise<void> {
    error = null;
    notice = null;
    if (amountLb == null || !Number.isFinite(amountLb) || amountLb <= 0) {
      error = 'Type how many pounds were used.';
      return;
    }
    if (amountLb > MAX_FEED_USE_LB) {
      error = `That is more than ${MAX_FEED_USE_LB} lb. Check the number.`;
      return;
    }
    const [subjectType, subjectId] = subject ? subject.split(':') : [];
    busy = true;
    try {
      const res = await fetch(`/api/stock/${item.id}/use`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: newRecordId() },
        body: JSON.stringify({
          lb: amountLb,
          ...(subjectType ? { subjectType, subjectId } : {})
        })
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        error = body?.error ?? `Could not save (HTTP ${res.status}).`;
        return;
      }
      notice = body?.warnings?.[0]?.message ?? `Used ${lbText(amountLb)}.`;
      lb = null;
      await invalidateAll();
    } catch {
      error = 'Could not reach the server. Try again when you have signal.';
    } finally {
      busy = false;
    }
  }
</script>

<header class="detail-header">
  <div>
    <span class="kicker">{kicker}</span>
    <h1 class="serif">{item.displayName}</h1>
    <p class="sub" data-testid="feed-on-hand">
      {qty(onHand)}{#if onHandLb !== null && item.defaultUnit !== 'lb'}
        ({lbText(onHandLb)}){/if} on hand
    </p>
  </div>
  {#if canEdit}
    <a class="edit-cta" href="/inventory/feed/{item.id}/edit">Edit</a>
  {/if}
</header>

<div class="detail-grid">
  <div class="col">
    {#if canUse}
      <InvSection title="Use" kicker="Take off stock">
        {#if item.defaultUnit === 'bag' && !feed.lbPerBag}
          <p class="empty" role="note">
            {canEdit
              ? 'Set how many pounds are in one bag on the edit page first.'
              : 'Ask the owner to set how many pounds are in one bag first.'}
          </p>
        {:else}
          {#if subjects.length > 0}
            <label class="field">
              <span>Who ate it (optional)</span>
              <select bind:value={subject} data-testid="feed-subject">
                <option value="">Not saying</option>
                {#each subjects as s (s.type + s.id)}
                  <option value="{s.type}:{s.id}">{s.label}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if scoops.length > 0}
            <div class="scoops" role="group" aria-label="Scoops">
              {#each scoops as c (c.scoops)}
                <button type="button" class="scoop" disabled={busy} onclick={() => recordUse(c.lb)}>
                  {c.scoops}
                  {c.scoops === 1 ? 'scoop' : 'scoops'}
                  <span class="muted">{lbText(c.lb)}</span>
                </button>
              {/each}
            </div>
          {/if}
          <form
            class="use-form"
            onsubmit={(e) => {
              e.preventDefault();
              void recordUse(lb);
            }}
          >
            <label class="field">
              <span>Pounds used</span>
              <input
                type="number"
                inputmode="decimal"
                step="any"
                min="0"
                bind:value={lb}
                data-testid="feed-use-lb"
              />
            </label>
            <button type="submit" class="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Record use'}
            </button>
          </form>
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      </InvSection>
    {/if}

    <InvSection title="History" kicker="Last 12">
      {#if movements.length === 0}
        <p class="empty">Nothing recorded yet.</p>
      {:else}
        <ul class="movement-list">
          {#each movements.slice(0, 12) as m (m.id)}
            <li>
              <span class="muted small">{fmt.instant(m.occurredAt, 'date')}</span>
              <span>{movementLabel(m.reason)}</span>
              {#if subjectLabel(m.notes)}<span class="muted">{subjectLabel(m.notes)}</span>{/if}
              <span class={m.delta < 0 ? 'rust' : 'forest'}>
                {m.delta > 0 ? '+' : ''}{qty(m.delta)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </InvSection>
  </div>

  <div class="col">
    <InvSection title="Quantity" kicker="On hand, ordered, planned">
      <LotQuantities itemId={item.id} unit={item.defaultUnit} category={item.category} {lots} />
    </InvSection>

    <InvSection title="Bag and scoop">
      <InvKVP
        label="One bag"
        value={feed.lbPerBag ? lbText(feed.lbPerBag) : item.defaultUnit === 'bag' ? 'Not set' : '—'}
      />
      <div class="kvp-prov">
        <InvKVP label="One scoop" value={feed.scoopLb ? lbText(feed.scoopLb) : 'Not set'} />
        {#if feed.scoopLb}<Provenance source="manual" compact />{/if}
      </div>
      <InvKVP label="Notes" value={item.notes ?? '—'} />
    </InvSection>
  </div>
</div>

<style>
  .detail-header {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 12px;
  }
  .edit-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    box-sizing: border-box;
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
    padding: 8px 14px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .kicker {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-ink-muted, #6a6f63);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 2px 0 4px;
    font-size: 1.5rem;
    color: var(--color-forest-deep, #1f3522);
    overflow-wrap: anywhere;
  }
  .sub {
    margin: 0;
    color: var(--color-ink-muted, #6a6f63);
    font-size: 0.9rem;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 14px;
  }
  @media (max-width: 768px) {
    .detail-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
  }
  .field select,
  .field input {
    min-height: 48px;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
    font: inherit;
    font-weight: 400;
    background: var(--color-paper, #fff);
    width: 100%;
  }
  .scoops {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 10px 0;
  }
  .scoop {
    min-height: 56px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: 1px solid var(--color-forest, #1f5e3a);
    border-radius: 8px;
    background: var(--color-paper, #fff);
    color: var(--color-forest-deep, #1f3522);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .scoop .muted {
    font-weight: 400;
    font-size: 0.8rem;
  }
  .use-form {
    display: flex;
    gap: 8px;
    align-items: end;
    margin-top: 10px;
  }
  .use-form .field {
    flex: 1;
    min-width: 0;
  }
  .primary {
    min-height: 48px;
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .primary:disabled,
  .scoop:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    margin: 8px 0 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--color-rust-tint, #fce8e8);
    color: var(--color-rust, #a23a3a);
  }
  .notice {
    margin: 8px 0 0;
    color: var(--color-forest-deep, #1f3522);
  }
  .kvp-prov {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kvp-prov :global(> :first-child) {
    flex: 1;
  }
  .empty {
    color: var(--color-ink-muted, #6a6f63);
    margin: 0;
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.8rem;
  }
  .movement-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .movement-list li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: 0.85rem;
  }
  .muted {
    color: var(--color-ink-muted, #6a6f63);
  }
  .rust {
    color: var(--color-rust, #a23a3a);
  }
  .forest {
    color: var(--color-forest-deep, #1f3522);
  }
</style>
