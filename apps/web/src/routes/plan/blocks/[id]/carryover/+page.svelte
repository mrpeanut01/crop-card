<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import '$lib/components/animals/animalForms.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import BioassayGuide from '$lib/components/amendments/BioassayGuide.svelte';
  import BioassayForm from '$lib/components/amendments/BioassayForm.svelte';
  import { OFFLINE_TEXT, responseMessage } from '$lib/amendments/responseMessage';
  import { formatCalendarDate } from '$lib/prefs';

  const { data } = $props();

  const reasons = $state<Record<string, string>>({});
  let busy = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const day = (ymd: string) => formatCalendarDate(ymd, 'date');

  async function send(
    url: string,
    init: Parameters<typeof fetch>[1],
    done: string
  ): Promise<boolean> {
    busy = true;
    error = null;
    status = null;
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        error = await responseMessage(res);
        return false;
      }
      status = done;
      await invalidateAll();
      return true;
    } catch {
      error = OFFLINE_TEXT;
      return false;
    } finally {
      busy = false;
    }
  }

  async function dismiss(applicationId: string) {
    const reason = (reasons[applicationId] ?? '').trim();
    if (reason.length < 3) {
      error = 'Say why you are dismissing this line, in a few words.';
      return;
    }
    const ok = await send(
      '/api/amendments/dismissals',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fertilityApplicationId: applicationId,
          blockId: data.block.id,
          reason
        })
      },
      'Line dismissed. The facts stay on file.'
    );
    if (ok) reasons[applicationId] = '';
  }

  function restore(id: string) {
    return send(
      `/api/amendments/dismissals/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      'The line is back.'
    );
  }

  function deleteTest(id: string) {
    return send(
      `/api/amendments/bioassays/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      'Test removed.'
    );
  }
</script>

<svelte:head>
  <title>Carryover · {data.block.name} · CropCard</title>
</svelte:head>

<div class="carry-page">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/plan?block={encodeURIComponent(data.block.id)}">{data.area?.name ?? 'Plan'}</a>
  </nav>

  <header>
    <Kicker>{data.block.name} · Manure and compost</Kicker>
    <h1 class="serif">Weed killer carryover</h1>
  </header>

  <p class="lede">
    Some weed killers pass through animals and compost and can damage tomatoes, beans, peas and
    other broadleaf crops. These lines come from your records. A pea or bean test in pots is the
    usual way to check before planting.
  </p>

  <div class="live" aria-live="polite" role="status">
    {#if status}<p class="af-ok">{status}</p>{/if}
  </div>
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}

  <section aria-labelledby="lines-h">
    <h2 id="lines-h">On this block now <Provenance source="data" compact /></h2>
    {#if data.lines.length === 0}
      <p class="af-help" data-testid="carryover-none">
        No carryover weed killer on file for what was spread here.
      </p>
    {:else}
      <ul class="lines">
        {#each data.lines as l (l.applicationId)}
          <li class="line" class:warn={l.tone === 'warn'} data-testid="carryover-line">{l.text}</li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if data.spreads.length}
    <section aria-labelledby="spreads-h">
      <h2 id="spreads-h">Manure and compost spread here</h2>
      <ul class="rows">
        {#each data.spreads as s (s.applicationId)}
          <li class="row" data-testid="carryover-spread">
            <strong>{s.batchName}</strong>
            <p class="meta">Spread {day(s.spreadOn)}. Now: {s.stateText}.</p>
            {#if s.ack}
              <p class="meta">
                {s.ack.by} confirmed before spreading on {day(s.ack.on)}, when it read: {s.ack
                  .stateText}.
              </p>
            {/if}
            {#if s.dismissal}
              <p class="meta">
                Dismissed by {s.dismissal.by} on {day(s.dismissal.on)}: {s.dismissal.reason}
              </p>
              {#if data.isOwner}
                <button
                  class="af-ghost"
                  type="button"
                  disabled={busy}
                  onclick={() => s.dismissal && restore(s.dismissal.id)}
                >
                  Bring the line back
                </button>
              {/if}
            {:else if s.state !== 'none-on-file'}
              {#if data.isOwner}
                <label class="af-label" for="reason-{s.applicationId}">Why dismiss this line</label>
                <input
                  id="reason-{s.applicationId}"
                  class="af-input"
                  type="text"
                  maxlength="500"
                  placeholder="The supplier showed me the hay records"
                  bind:value={reasons[s.applicationId]}
                />
                <button
                  class="af-ghost"
                  type="button"
                  disabled={busy}
                  onclick={() => dismiss(s.applicationId)}
                >
                  Dismiss this line
                </button>
              {:else}
                <p class="af-help">Only the owner can dismiss a line. Ask the owner.</p>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="tests-h">
    <h2 id="tests-h">Pea or bean tests on this block</h2>
    {#if data.bioassays.length === 0}
      <p class="af-help">No tests recorded on this block.</p>
    {:else}
      <ul class="rows">
        {#each data.bioassays as b (b.id)}
          <li class="row" data-testid="carryover-test">
            <span>
              <Provenance source="manual" detail="you reported it" compact />
              {day(b.testedOn)}: {b.result === 'no-damage' ? 'no damage seen' : 'damage seen'}{b.by
                ? `, recorded by ${b.by}`
                : ''}
            </span>
            {#if b.note}<p class="meta">{b.note}</p>{/if}
            {#if data.isOwner}
              <button
                class="af-ghost"
                type="button"
                disabled={busy}
                onclick={() => deleteTest(b.id)}
              >
                Remove this test
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if data.canRecord}
      <BioassayForm
        target={{ blockId: data.block.id }}
        today={data.today}
        onsaved={async () => {
          status = 'Test saved.';
          await invalidateAll();
        }}
      />
    {/if}
  </section>

  <BioassayGuide />
</div>

<style>
  .carry-page {
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
  h2 {
    font-size: 1.05rem;
    margin: 0 0 var(--space-2);
  }
  .lede {
    margin: 0;
  }
  .live:empty {
    display: none;
  }
  .lines,
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .line {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .line.warn {
    background: var(--pill-rust-bg);
    border-color: var(--pill-rust-bd);
    color: var(--pill-rust-fg);
    font-weight: 600;
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
    overflow-wrap: anywhere;
  }
  .meta {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
</style>
