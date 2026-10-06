<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT, type MessageKey } from '$lib/i18n';
  import { cropDisplayNameByEnglish } from '$lib/i18n/cropName';
  import {
    orchardStageDescription,
    orchardStageName,
    orchardTargetLabel,
    orchardWindowNote
  } from '$lib/i18n/orchardCalendarText';
  import { fmt } from '$lib/prefsState.svelte';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);
  const view = $derived(data.view);
  const calendar = $derived(data.calendar);

  let busy = $state(false);
  let message = $state<string | null>(null);
  let failure = $state<string | null>(null);
  let choice = $derived<'auto' | 'home' | 'commercial'>(
    data.view.audience.reason === 'override' ? data.view.audience.audience : 'auto'
  );
  let confirmOpen = $state(false);

  const markedStage = $derived(
    calendar && view.mark
      ? (calendar.stages.find((s) => s.id === view.mark!.stageId) ?? null)
      : null
  );

  function stageLabel(s: { id: string; name: string }): string {
    return calendar ? orchardStageName(calendar.pluginId, s, locale) : s.name;
  }

  async function send(url: string, method: string, body: unknown): Promise<Response | null> {
    busy = true;
    message = null;
    failure = null;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        failure = j.error ?? tr('orchardui.err.save');
        return null;
      }
      return res;
    } catch {
      failure = tr('orchardui.offline');
      return null;
    } finally {
      busy = false;
    }
  }

  async function mark(stageId: string | null) {
    const res = await send(
      `/api/orchard/plantings/${encodeURIComponent(view.cropId)}/stage`,
      'PUT',
      { stageId }
    );
    if (res) await invalidateAll();
  }

  async function schedule(windowId: string) {
    const res = await send(
      `/api/orchard/plantings/${encodeURIComponent(view.cropId)}/scout-task`,
      'POST',
      { windowId }
    );
    if (!res) return;
    const j = (await res.json()) as { alreadyScheduled?: boolean };
    message = j.alreadyScheduled ? tr('orchardui.alreadyScheduled') : tr('orchardui.scheduled');
  }

  async function saveChoice(confirmed = false) {
    if (!view.area) return;
    if (choice === 'commercial' && !confirmed) {
      confirmOpen = true;
      return;
    }
    confirmOpen = false;
    const res = await send(
      `/api/orchard/areas/${encodeURIComponent(view.area.id)}/audience`,
      'PUT',
      {
        audience: choice === 'auto' ? null : choice,
        ...(choice === 'commercial' ? { confirmCommercial: true } : {})
      }
    );
    if (res) {
      message = tr('orchardui.choice.saved');
      await invalidateAll();
    }
  }
</script>

<svelte:head
  ><title
    >{tr('orchardui.docTitle', { crop: cropDisplayNameByEnglish(view.cropName, locale) })} · CropCard</title
  ></svelte:head
>

<div class="orchard" data-testid="orchard-calendar">
  <header>
    <Kicker>{tr('orchardui.kicker')}</Kicker>
    <h1 class="serif">{tr('orchardui.title')}</h1>
    <p class="sub">
      {cropDisplayNameByEnglish(view.cropName, locale)} · {view.blockName}{#if view.area}
        · {view.area.name}{/if}
    </p>
    <p class="lede">{tr('orchardui.lede')}</p>
  </header>

  {#if message}<p class="status" role="status" data-testid="orchard-status">{message}</p>{/if}
  {#if failure}<p class="error" role="alert">{failure}</p>{/if}

  <section class="card" data-testid="orchard-guide">
    <h2>{tr(`orchardui.audience.${view.audience.audience}` as MessageKey)}</h2>
    {#if calendar}
      <p>
        {tr('orchardui.guide', {
          title: calendar.guide.title,
          publisher: calendar.guide.publisher,
          id: calendar.guide.publicationId,
          edition: calendar.edition
        })}
        <a href={calendar.guide.url} target="_blank" rel="noopener noreferrer nofollow"
          >{tr('orchardui.guideLink')}</a
        >
      </p>
    {/if}
    <p class="why" data-testid="orchard-why">
      <Provenance source={view.audience.provenance} compact />
      {tr(`orchardui.why.${view.audience.reason}` as MessageKey)}
    </p>
    {#if data.canChooseGuide}
      <form
        class="choice"
        onsubmit={(e) => {
          e.preventDefault();
          void saveChoice();
        }}
      >
        <fieldset>
          <legend>{tr('orchardui.choice.legend')}</legend>
          {#each ['auto', 'home', 'commercial'] as const as c (c)}
            <label class="radio">
              <input type="radio" name="guide" value={c} bind:group={choice} />
              {tr(`orchardui.choice.${c}`)}
            </label>
          {/each}
        </fieldset>
        <button type="submit" class="btn" disabled={busy}>{tr('orchardui.choice.save')}</button>
      </form>
    {:else if !data.isOwner}
      <p class="hint">{tr('orchardui.askOwner')}</p>
    {:else if !view.area}
      <p class="hint">{tr('orchardui.choice.noArea')}</p>
    {/if}
  </section>

  {#if view.status === 'out-of-date'}
    <p class="card notice" data-testid="orchard-out-of-date">{tr('orchardui.outOfDate')}</p>
  {:else if !calendar}
    <p class="card notice" data-testid="orchard-none">{tr('orchardui.none')}</p>
  {:else}
    {#if view.lowInput}
      <p class="card notice" data-testid="orchard-low-input">{tr('orchardui.lowInput')}</p>
    {/if}

    <section class="card" data-testid="orchard-mark">
      {#if view.mark && markedStage}
        <p>
          <Provenance source="manual" compact />
          {view.mark.markedByName
            ? tr('orchardui.marked', {
                stage: stageLabel(markedStage),
                date: fmt.instant(view.mark.markedAt, 'month-day'),
                name: view.mark.markedByName
              })
            : tr('orchardui.markedNoName', {
                stage: stageLabel(markedStage),
                date: fmt.instant(view.mark.markedAt, 'month-day')
              })}
        </p>
        {#if data.canMark}
          <button type="button" class="btn ghost" disabled={busy} onclick={() => mark(null)}
            >{tr('orchardui.clearMark')}</button
          >
        {/if}
      {:else}
        <p>{tr('orchardui.markPrompt')}</p>
      {/if}
      <p class="hint">{tr('orchardui.markYear', { year: view.year })}</p>
    </section>

    <ol class="stages">
      {#each calendar.stages as s (s.id)}
        {@const isMarked = view.mark?.stageId === s.id}
        <li class="stage" class:marked={isMarked} data-stage={s.id}>
          <div class="stage-head">
            <span class="stage-name">{stageLabel(s)}</span>
            {#if isMarked}<span class="pill">{tr('orchardui.markedHere')}</span>{/if}
          </div>
          <p class="desc">
            <strong>{tr('orchardui.recognise')}:</strong>
            {orchardStageDescription(calendar.pluginId, { id: s.id, recognise: s }, locale)}
          </p>
          {#if data.canMark && !isMarked}
            <button
              type="button"
              class="btn mark"
              disabled={busy}
              data-testid="mark-{s.id}"
              onclick={() => mark(s.id)}>{tr('orchardui.markHere')}</button
            >
          {/if}
          <details open={isMarked}>
            <summary>{tr('orchardui.watch')}</summary>
            {#if s.windows.length === 0}
              <p class="hint">{tr('orchardui.noWindows')}</p>
            {:else}
              <ul class="windows">
                {#each s.windows as w (w.id)}
                  <li class="window" data-window={w.id} data-purpose={w.purpose}>
                    <span class="purpose">{tr(`orchardui.purpose.${w.purpose}` as MessageKey)}</span
                    >
                    {#if w.targets.length}
                      <p class="targets">
                        {tr('orchardui.targets')}:
                        {w.targets.map((x) => orchardTargetLabel(x.id, locale)).join(', ')}
                      </p>
                    {/if}
                    {#if w.note}
                      <p class="note">{orchardWindowNote(calendar.pluginId, w, locale)}</p>
                    {/if}
                    {#if w.pollinatorSensitive}
                      <p class="bee" lang="en" data-english-only="safety" data-testid="bee-line">
                        {calendar.beeLine}
                      </p>
                    {/if}
                    {#if w.labelLine}
                      <p class="label-line" data-testid="label-line">
                        {tr('orchardui.checkLabel')}
                      </p>
                    {/if}
                    {#if data.canMark}
                      <button
                        type="button"
                        class="btn ghost"
                        disabled={busy}
                        data-testid="schedule-{w.id}"
                        onclick={() => schedule(w.id)}>{tr('orchardui.schedule')}</button
                      >
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </details>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<Modal
  open={confirmOpen}
  onClose={() => (confirmOpen = false)}
  title={tr('orchardui.confirm.title')}
>
  <p>{tr('orchardui.confirm.body')}</p>
  {#snippet footer()}
    <button type="button" class="btn ghost" onclick={() => (confirmOpen = false)}
      >{tr('orchardui.confirm.no')}</button
    >
    <button
      type="button"
      class="btn"
      data-testid="confirm-commercial"
      onclick={() => saveChoice(true)}>{tr('orchardui.confirm.yes')}</button
    >
  {/snippet}
</Modal>

<style>
  .orchard {
    max-width: 720px;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  h1 {
    margin: 0;
  }
  .sub,
  .hint {
    color: var(--color-ink-soft);
    margin: 0;
  }
  .lede {
    margin: var(--space-1) 0 0;
  }
  .card {
    background: var(--color-surface, var(--color-cream));
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
    padding: var(--space-3);
    margin: 0;
  }
  .card h2 {
    margin: 0 0 var(--space-2);
    font-size: 1.1rem;
  }
  .why {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .choice fieldset {
    border: 0;
    padding: 0;
    margin: var(--space-2) 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .radio {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
  }
  .btn {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-forest);
    background: var(--color-forest);
    color: var(--color-paper, #fff);
    font-weight: 600;
  }
  .btn.ghost {
    background: transparent;
    color: var(--color-forest);
  }
  .stages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .stage {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
    padding: var(--space-2) var(--space-3);
  }
  .stage.marked {
    border-color: var(--color-forest);
    border-width: 2px;
  }
  .stage-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    font-weight: 700;
  }
  summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-weight: 600;
    color: var(--color-forest);
  }
  .pill {
    font-size: var(--font-size-meta);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: var(--pill-forest-bg, var(--color-forest));
    color: var(--pill-forest-fg, #fff);
  }
  .windows {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .window {
    border-top: 1px solid var(--color-rule);
    padding-top: var(--space-2);
  }
  .purpose {
    font-size: var(--font-size-meta);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .window p {
    margin: var(--space-1) 0;
  }
  .bee {
    font-weight: 700;
    color: var(--pill-rust-fg, var(--color-ink));
  }
  .label-line {
    font-weight: 600;
  }
  .status {
    color: var(--color-forest);
    font-weight: 600;
  }
  .error {
    color: var(--pill-rust-fg, #a33);
    font-weight: 600;
  }
</style>
