<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import '$lib/components/animals/animalForms.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { OFFLINE_MESSAGE, errorFromResponse } from '$lib/animals/display';
  import { formatClearDate } from '$lib/safety/animalWithdrawal';

  const { data } = $props();

  let graze = $state<Record<string, number | null | undefined>>({});
  let hay = $state<Record<string, number | null | undefined>>({});
  let milking = $state<Record<string, number | null | undefined>>({});
  let meat = $state<Record<string, number | null | undefined>>({});
  let reason = $state('');
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const editable = $derived(data.rows.filter((r) => !r.forbidden));

  function days(n: number | null | undefined): number | null | 'bad' {
    if (n === null || n === undefined) return null;
    return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : 'bad';
  }

  function dayText(n: number | null): string {
    if (n === null) return 'not given';
    return n === 1 ? '1 day' : `${n} days`;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    status = null;
    const items: {
      sprayEventRef: string;
      productPluginId: string | null;
      grazeDays?: number;
      hayDays?: number;
      lactatingGrazeDays?: number;
      meatRemovalDays?: number;
    }[] = [];
    for (const r of editable) {
      const g = days(graze[r.key]);
      const h = days(hay[r.key]);
      const l = days(milking[r.key]);
      const mt = days(meat[r.key]);
      if (g === 'bad' || h === 'bad' || l === 'bad' || mt === 'bad') {
        error = `Enter whole days for ${r.productName}, or leave the box empty.`;
        return;
      }
      if (g !== null && l !== null && l < g) {
        error = `For ${r.productName}, the wait for milking animals can't be shorter than the grazing wait.`;
        return;
      }
      if (g === null && h === null && l === null && mt === null) continue;
      items.push({
        sprayEventRef: r.ref,
        productPluginId: r.productPluginId,
        ...(g !== null ? { grazeDays: g } : {}),
        ...(l !== null ? { lactatingGrazeDays: l } : {}),
        ...(h !== null ? { hayDays: h } : {}),
        ...(mt !== null ? { meatRemovalDays: mt } : {})
      });
    }
    if (items.length === 0) {
      error = 'Type at least one time from a label.';
      return;
    }
    if (!reason.trim()) {
      error = 'Say where you read the times, for example "label on the jug".';
      return;
    }
    saving = true;
    try {
      const res = await fetch('/api/animals/grazing-attestations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fieldId: data.field.id, reason: reason.trim(), items })
      });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      graze = {};
      hay = {};
      milking = {};
      meat = {};
      reason = '';
      status = items.length === 1 ? 'Saved the label time.' : `Saved ${items.length} label times.`;
      await invalidateAll();
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Grazing times · {data.field.name} · CropCard</title>
</svelte:head>

<div class="grazing-page">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/plan?area={encodeURIComponent(data.field.id)}">{data.field.name}</a>
  </nav>

  <header>
    <Kicker>{data.field.name} · Grazing and haying</Kicker>
    <h1 class="serif">Grazing and haying times</h1>
  </header>

  <p class="lede">
    Every product sprayed here in the last year is listed. Food animals can't graze here, and hay
    can't be cut, while a product's waiting time is not on file. Read each time off the product's
    label and type it in. Labels often give separate times for grazing, for milking animals, for
    cutting hay and for taking meat animals off before slaughter; fill in each one the label gives.
    A box left empty stays not on file. Type 0 only if the label says there is no wait.
  </p>

  <div class="live" aria-live="polite" role="status">
    {#if status}<p class="af-ok">{status}</p>{/if}
  </div>

  {#if data.rows.length === 0}
    <p class="af-help">Nothing has been sprayed here in the last year.</p>
  {:else}
    <form class="af-form" onsubmit={save} novalidate aria-label="Grazing and haying times">
      <ul class="rows">
        {#each data.rows as r (r.key)}
          <li class="row" data-testid="grazing-row">
            <div class="row-head">
              <strong>{r.productName}</strong>
              {#if r.needsLabel}<span class="flag">Time not on file</span>{/if}
            </div>
            <p class="meta">
              Sprayed {formatClearDate(r.appliedAtMs, data.timeZone)} on {r.blockName}
            </p>
            <p class="meta">
              Grazing: {r.grazing}. Milking animals: {r.milking}. Hay: {r.haying}.
            </p>
            {#each r.attested as t, i (i)}
              <p class="meta">
                <Provenance source="manual" detail="from the label" compact />
                You entered grazing {dayText(t.grazeDays)}, milking animals {dayText(
                  t.lactatingGrazeDays
                )}, hay {dayText(t.hayDays)}, meat animals off before slaughter {dayText(
                  t.meatRemovalDays
                )}.
              </p>
            {/each}
            {#if r.forbidden}
              <p class="af-help">The label forbids grazing or haying where it was sprayed.</p>
            {:else if data.isOwner}
              <div class="af-row">
                <label>
                  Days before grazing
                  <input
                    class="af-input"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    aria-label="Days before grazing, {r.productName}"
                    bind:value={graze[r.key]}
                  />
                </label>
                <label>
                  Days before milking animals graze
                  <input
                    class="af-input"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    aria-label="Days before milking animals graze, {r.productName}"
                    bind:value={milking[r.key]}
                  />
                </label>
                <label>
                  Days before cutting hay
                  <input
                    class="af-input"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    aria-label="Days before cutting hay, {r.productName}"
                    bind:value={hay[r.key]}
                  />
                </label>
                <label>
                  Days meat animals stay off before slaughter
                  <input
                    class="af-input"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    step="1"
                    aria-label="Days meat animals stay off before slaughter, {r.productName}"
                    bind:value={meat[r.key]}
                  />
                </label>
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if data.isOwner && editable.length > 0}
        <label class="af-label" for="grazing-reason">Where you read it</label>
        <input
          id="grazing-reason"
          class="af-input"
          type="text"
          maxlength="500"
          placeholder="Label on the jug"
          bind:value={reason}
        />
        <p class="af-help">
          A time you type can only make a hold longer than the label data on file, never shorter.
        </p>
        {#if error}<p class="af-error" role="alert">{error}</p>{/if}
        <button class="af-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save label times'}
        </button>
      {:else if !data.isOwner}
        <p class="af-help">Only the owner can add a grazing or haying time. Ask the owner.</p>
      {/if}
    </form>
  {/if}
</div>

<style>
  .grazing-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 720px;
    min-width: 0;
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-size: var(--font-size-caption);
  }
  h1 {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .lede {
    margin: 0;
  }
  .live:empty {
    display: none;
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
  .flag {
    font-size: var(--font-size-caption);
    font-weight: 700;
    color: var(--color-rust);
  }
  .meta {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
</style>
