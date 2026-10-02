<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import '$lib/components/animals/animalForms.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import BioassayGuide from '$lib/components/amendments/BioassayGuide.svelte';
  import BioassayForm from '$lib/components/amendments/BioassayForm.svelte';
  import { offlineText, responseMessage } from '$lib/amendments/responseMessage';
  import { formatCalendarDate } from '$lib/prefs';
  import { createT } from '$lib/i18n';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  const reasons = $state<Record<string, string>>({});
  let busy = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const day = (ymd: string) => formatCalendarDate(ymd, 'date', {}, data.locale);

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
        error = await responseMessage(res, data.locale);
        return false;
      }
      status = done;
      await invalidateAll();
      return true;
    } catch {
      error = offlineText(data.locale);
      return false;
    } finally {
      busy = false;
    }
  }

  async function dismiss(applicationId: string) {
    const reason = (reasons[applicationId] ?? '').trim();
    if (reason.length < 3) {
      error = tr('carry.page.errReason');
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
      tr('carry.page.dismissedOk')
    );
    if (ok) reasons[applicationId] = '';
  }

  function restore(id: string) {
    return send(
      `/api/amendments/dismissals/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      tr('carry.page.restored')
    );
  }

  function deleteTest(id: string) {
    return send(
      `/api/amendments/bioassays/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      tr('carry.page.testRemoved')
    );
  }
</script>

<svelte:head>
  <title>{tr('carry.page.title', { block: data.block.name })}</title>
</svelte:head>

<div class="carry-page">
  <nav class="crumbs" aria-label={tr('carry.page.crumbAria')}>
    <a href="/plan?block={encodeURIComponent(data.block.id)}"
      >{data.area?.name ?? tr('carry.page.plan')}</a
    >
  </nav>

  <header>
    <Kicker>{tr('carry.page.kicker', { block: data.block.name })}</Kicker>
    <h1 class="serif">{tr('carry.section.title')}</h1>
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
    <h2 id="lines-h">{tr('carry.page.nowTitle')} <Provenance source="data" compact /></h2>
    {#if data.lines.length === 0}
      <p class="af-help" data-testid="carryover-none">
        {tr('carry.page.none')}
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
      <h2 id="spreads-h">{tr('carry.page.spreadTitle')}</h2>
      <ul class="rows">
        {#each data.spreads as s (s.applicationId)}
          <li class="row" data-testid="carryover-spread">
            <strong>{s.batchName}</strong>
            <p class="meta">
              {tr('carry.page.spreadNow', { date: day(s.spreadOn), state: s.stateText })}
            </p>
            {#if s.ack}
              <p class="meta">
                {tr('carry.page.ack', {
                  by: s.ack.by,
                  date: day(s.ack.on),
                  state: s.ack.stateText
                })}
              </p>
            {/if}
            {#if s.dismissal}
              <p class="meta">
                {tr('carry.page.dismissed', {
                  by: s.dismissal.by,
                  date: day(s.dismissal.on),
                  reason: s.dismissal.reason
                })}
              </p>
              {#if data.isOwner}
                <button
                  class="af-ghost"
                  type="button"
                  disabled={busy}
                  onclick={() => s.dismissal && restore(s.dismissal.id)}
                >
                  {tr('carry.page.restore')}
                </button>
              {/if}
            {:else if s.state !== 'none-on-file'}
              {#if data.isOwner}
                <label class="af-label" for="reason-{s.applicationId}"
                  >{tr('carry.page.reasonLabel')}</label
                >
                <input
                  id="reason-{s.applicationId}"
                  class="af-input"
                  type="text"
                  maxlength="500"
                  placeholder={tr('carry.page.reasonPh')}
                  bind:value={reasons[s.applicationId]}
                />
                <button
                  class="af-ghost"
                  type="button"
                  disabled={busy}
                  onclick={() => dismiss(s.applicationId)}
                >
                  {tr('carry.page.dismiss')}
                </button>
              {:else}
                <p class="af-help">{tr('carry.page.ownerOnly')}</p>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="tests-h">
    <h2 id="tests-h">{tr('carry.page.testsTitle')}</h2>
    {#if data.bioassays.length === 0}
      <p class="af-help">{tr('carry.page.testsNone')}</p>
    {:else}
      <ul class="rows">
        {#each data.bioassays as b (b.id)}
          <li class="row" data-testid="carryover-test">
            <span>
              <Provenance source="manual" detail={tr('carry.page.youReported')} compact />
              {day(b.testedOn)}: {b.result === 'no-damage'
                ? tr('carry.test.noDamageSeen')
                : tr('carry.test.damageSeen')}{b.by ? tr('carry.page.testBy', { by: b.by }) : ''}
            </span>
            {#if b.note}<p class="meta">{b.note}</p>{/if}
            {#if data.isOwner}
              <button
                class="af-ghost"
                type="button"
                disabled={busy}
                onclick={() => deleteTest(b.id)}
              >
                {tr('amend.tests.remove')}
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
          status = tr('carry.page.testSaved');
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
