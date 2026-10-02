<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import DocumentAttach from '$lib/components/documents/DocumentAttach.svelte';
  import CertifierPackPanel from '$lib/components/organic/CertifierPackPanel.svelte';
  import { reviewOutcomeLabel, ORGANIC_REVIEW_OUTCOMES } from '$lib/organic/apiSchemas';
  import { ORGANIC_STATUSES, organicStatusLabel } from '$lib/organic/status';
  import { createT } from '$lib/i18n';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  let subject = $state('');
  let status = $state<(typeof ORGANIC_STATUSES)[number]>('transitioning');
  let effectiveOn = $state('');
  let certifier = $state('');
  let note = $state('');
  let documentId = $state<string | null>(null);
  let saving = $state(false);
  let message = $state<string | null>(null);
  let errorText = $state<string | null>(null);

  let reviewOutcome = $state<Record<string, string>>({});
  let reviewReason = $state<Record<string, string>>({});
  let reviewBusy = $state<string | null>(null);

  $effect(() => {
    if (!effectiveOn) effectiveOn = data.today;
  });

  async function errorOf(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
        issues?: { message: string }[];
      };
      return body.message ?? body.issues?.[0]?.message ?? body.error ?? tr('organic.err.notSaved');
    } catch {
      return tr('organic.err.notSaved');
    }
  }

  async function saveStatus(e: SubmitEvent) {
    e.preventDefault();
    errorText = null;
    message = null;
    const [subjectType, subjectId] = subject.split(':');
    if (!subjectType || !subjectId) {
      errorText = tr('organic.err.pickSubject');
      return;
    }
    saving = true;
    try {
      const res = await fetch('/api/organic/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subjectType,
          subjectId,
          status,
          effectiveOn,
          certifier: certifier.trim() || null,
          note: note.trim() || null,
          documentId
        })
      });
      if (!res.ok) {
        errorText = await errorOf(res);
        return;
      }
      message = tr('organic.statusSaved');
      subject = '';
      certifier = '';
      note = '';
      documentId = null;
      await invalidateAll();
    } catch {
      errorText = tr('organic.err.offlineStatus');
    } finally {
      saving = false;
    }
  }

  async function saveReview(id: string) {
    errorText = null;
    message = null;
    const outcome = reviewOutcome[id];
    const reason = (reviewReason[id] ?? '').trim();
    if (!outcome) {
      errorText = tr('organic.err.pickAnswer');
      return;
    }
    if (reason.length < 3) {
      errorText = tr('organic.err.sayWhy');
      return;
    }
    reviewBusy = id;
    try {
      const res = await fetch('/api/organic/treatment-reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ healthEventId: id, outcome, reason })
      });
      if (!res.ok) {
        errorText = await errorOf(res);
        return;
      }
      message = tr('organic.answerSaved');
      await invalidateAll();
    } catch {
      errorText = tr('organic.err.offlineAnswer');
    } finally {
      reviewBusy = null;
    }
  }
</script>

<svelte:head><title>{tr('organic.pageTitle')}</title></svelte:head>

<div class="organic-page">
  <nav class="crumbs" aria-label={tr('organic.crumbs')}>
    <a href="/records">{tr('organic.crumbRecords')}</a>
  </nav>
  <header>
    <Kicker>{tr('organic.kicker')}</Kicker>
    <h1 class="serif">{tr('organic.h1')}</h1>
    <p class="lede">{tr('organic.lede')}</p>
  </header>

  <div class="live" role="status" aria-live="polite">
    {#if message}<p class="ok">{message}</p>{/if}
  </div>
  {#if errorText}<p class="error" role="alert">{errorText}</p>{/if}

  <section aria-labelledby="now-h" class="panel">
    <h2 id="now-h" class="serif">{tr('organic.now')}</h2>
    {#if !data.areaLines.length && !data.blockRows.length && !data.animalLines.length}
      <p class="help" data-testid="organic-empty">
        {data.canEdit ? tr('organic.noneOwner') : tr('organic.none')}
      </p>
    {:else}
      <ul class="lines">
        {#each data.areaLines as a (a.id)}
          <li><strong>{a.name}</strong>: {a.line}</li>
        {/each}
        {#each data.blockRows as b (b.id)}
          <li data-testid="organic-block-line">
            <strong>{b.areaName ? `${b.areaName} · ${b.name}` : b.name}</strong>: {b.line}
          </li>
        {/each}
        {#each data.animalLines as a (a.key)}
          <li><a href={a.href}><strong>{a.name}</strong></a>: {a.line}</li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if data.canExportPack}
    <CertifierPackPanel from={data.window.from} to={data.window.to} />
  {/if}

  {#if data.canEdit}
    <section aria-labelledby="add-h" class="panel">
      <h2 id="add-h" class="serif">{tr('organic.add.title')}</h2>
      <p class="help">{tr('organic.add.help')}</p>
      <form class="form" onsubmit={saveStatus}>
        <label>
          <span>{tr('organic.add.for')}</span>
          <select bind:value={subject} required data-testid="organic-subject">
            <option value="" disabled>{tr('organic.add.pick')}</option>
            {#if data.subjects.areas.length}
              <optgroup label={tr('organic.add.areas')}>
                {#each data.subjects.areas as a (a.id)}
                  <option value="field:{a.id}">{a.name}</option>
                {/each}
              </optgroup>
            {/if}
            {#if data.subjects.blocks.length}
              <optgroup label={tr('organic.add.blocks')}>
                {#each data.subjects.blocks as b (b.id)}
                  <option value="block:{b.id}">{b.name}</option>
                {/each}
              </optgroup>
            {/if}
            {#if data.subjects.groups.length}
              <optgroup label={tr('organic.add.groups')}>
                {#each data.subjects.groups as g (g.id)}
                  <option value="group:{g.id}">{g.name}</option>
                {/each}
              </optgroup>
            {/if}
            {#if data.subjects.animals.length}
              <optgroup label={tr('organic.add.animals')}>
                {#each data.subjects.animals as a (a.id)}
                  <option value="animal:{a.id}">{a.name}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </label>
        <label>
          <span>{tr('organic.add.status')}</span>
          <select bind:value={status} data-testid="organic-status">
            {#each ORGANIC_STATUSES as s (s)}
              <option value={s}>{organicStatusLabel(s, data.locale)}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>{tr('organic.add.effective')}</span>
          <input
            type="date"
            min="1970-01-01"
            max={data.maxDay}
            bind:value={effectiveOn}
            required
            data-testid="organic-effective"
          />
        </label>
        <label>
          <span
            >{tr('organic.add.certifier')}
            <span class="optional">{tr('organic.optional')}</span></span
          >
          <input type="text" maxlength="120" bind:value={certifier} />
        </label>
        <label class="wide">
          <span
            >{tr('organic.add.note')} <span class="optional">{tr('organic.optional')}</span></span
          >
          <textarea maxlength="1000" rows="2" bind:value={note}></textarea>
        </label>
        <fieldset class="wide">
          <legend
            >{tr('organic.add.certificate')}
            <span class="optional">{tr('organic.optional')}</span></legend
          >
          <DocumentAttach
            {documentId}
            kind="certificate"
            canEdit={data.canEdit}
            onchange={(id) => {
              documentId = id;
            }}
            ondelete={(id) => {
              if (documentId === id) documentId = null;
            }}
          />
        </fieldset>
        <button class="btn-primary" type="submit" disabled={saving} data-testid="organic-save">
          {saving ? tr('organic.saving') : tr('organic.add.save')}
        </button>
      </form>
    </section>
  {:else if data.isHelper}
    <p class="help">{tr('organic.ownerOnly')}</p>
  {/if}

  <section aria-labelledby="facts-h" class="panel">
    <h2 id="facts-h" class="serif">{tr('organic.facts.title')}</h2>
    <form class="window" method="GET">
      <label>
        <span>{tr('organic.pack.from')}</span>
        <input type="date" name="from" value={data.window.from} />
      </label>
      <label>
        <span>{tr('organic.pack.to')}</span>
        <input type="date" name="to" value={data.window.to} />
      </label>
      <button class="btn-secondary" type="submit">{tr('organic.facts.show')}</button>
    </form>
    <p class="help">
      {tr('organic.facts.showing', { from: data.window.from, to: data.window.to })}
    </p>
    {#if !data.blockRows.length}
      <p class="help">{tr('organic.facts.noBlocks')}</p>
    {/if}
    {#each data.blockRows as b (b.id)}
      <article class="block" data-testid="organic-block-facts">
        <h3>{b.areaName ? `${b.areaName} · ${b.name}` : b.name}</h3>
        <p>{b.line}</p>
        {#if b.areaNotApplied}<p class="help">{b.areaNotApplied}</p>{/if}
        {#if b.applications.length}
          <ul class="facts">
            {#each b.applications as a (a.key)}
              <li data-testid="organic-fact">
                {a.date} · {a.kind}: {a.product} · {a.mark}{a.deleted
                  ? ` · ${tr('organic.facts.deleted')}`
                  : ''}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="help">{tr('organic.facts.noInputs')}</p>
        {/if}
        {#each b.treatedSeed as p (p.key)}
          <p class="fact">{p.date} · {p.crop}: {tr('organic.facts.treatedSeed')}</p>
        {/each}
        <p class="fact">
          {b.lastNonAllowed
            ? tr('organic.facts.lastNonAllowed', { date: b.lastNonAllowed })
            : tr('organic.facts.noNonAllowed')}
        </p>
        <p class="fact">{b.transitionLine ?? data.askCertifier}</p>
      </article>
    {/each}
  </section>

  {#if data.treatments.length || data.animalLines.length}
    <section aria-labelledby="treat-h" class="panel">
      <h2 id="treat-h" class="serif">{tr('organic.treat.title')}</h2>
      {#if data.welfareLine}<p class="welfare">{data.welfareLine}</p>{/if}
      {#if !data.treatments.length}
        <p class="help">{tr('organic.treat.none')}</p>
      {/if}
      <ul class="treatments">
        {#each data.treatments as t (t.id)}
          <li id="review-{t.id}" data-testid="organic-treatment">
            <p>
              <strong>{t.date} · {t.product}</strong> · {t.subjects.join(', ')}
            </p>
            <p data-testid="organic-treatment-outcome">{t.outcomeText}</p>
            {#if t.organicUseLine}
              <p class="help" data-testid="organic-use-fact">{t.organicUseLine}</p>
            {/if}
            {#if t.review}
              <p class="help">
                {t.review.by
                  ? tr('organic.treat.answeredBy', {
                      outcome: reviewOutcomeLabel(t.review.outcome, data.locale),
                      date: t.review.at,
                      by: t.review.by
                    })
                  : tr('organic.treat.answered', {
                      outcome: reviewOutcomeLabel(t.review.outcome, data.locale),
                      date: t.review.at
                    })}
                {t.review.reason}
              </p>
            {/if}
            {#if t.canAnswer}
              <fieldset class="review">
                <legend>{tr('organic.treat.question')}</legend>
                {#each ORGANIC_REVIEW_OUTCOMES as o (o)}
                  <label class="radio">
                    <input
                      type="radio"
                      name="outcome-{t.id}"
                      value={o}
                      checked={reviewOutcome[t.id] === o}
                      onchange={() => (reviewOutcome = { ...reviewOutcome, [t.id]: o })}
                    />
                    {reviewOutcomeLabel(o, data.locale)}
                  </label>
                {/each}
                <label>
                  <span>{tr('organic.treat.why')}</span>
                  <input
                    type="text"
                    maxlength="500"
                    value={reviewReason[t.id] ?? ''}
                    oninput={(e) =>
                      (reviewReason = {
                        ...reviewReason,
                        [t.id]: (e.target as HTMLInputElement).value
                      })}
                  />
                </label>
                <button
                  class="btn-primary"
                  type="button"
                  disabled={reviewBusy === t.id}
                  onclick={() => saveReview(t.id)}
                >
                  {tr('organic.treat.save')}
                </button>
                <p class="help">{tr('organic.treat.change48')}</p>
              </fieldset>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="hist-h" class="panel">
    <h2 id="hist-h" class="serif">{tr('organic.hist.title')}</h2>
    {#if !data.history.length}
      <p class="help">{tr('organic.hist.none')}</p>
    {:else}
      <ul class="history">
        {#each data.history as h (h.id)}
          <li data-testid="organic-history-row">
            <strong>{h.subject}</strong>: {h.status} ({tr('organic.line.ownerEntered')}, {h.effective}{h.certifier
              ? `, ${tr('organic.line.certifier', { name: h.certifier })}`
              : ''})
            <span class="help"
              >{h.by
                ? tr('organic.hist.savedBy', { date: h.savedAt, by: h.by })
                : tr('organic.hist.saved', { date: h.savedAt })}</span
            >
            {#if h.note}<p class="help">{h.note}</p>{/if}
            {#each h.documents as d (d.id)}
              <a class="doc" href="/api/documents/{d.id}/file">{d.title}</a>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .organic-page {
    max-width: 880px;
    margin: 0 auto;
    padding: 16px;
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest-deep, #1f3a28);
  }
  h1 {
    margin: 4px 0 8px;
  }
  .lede,
  .help {
    color: var(--color-ink-soft, #4a4a4a);
    overflow-wrap: anywhere;
  }
  .panel {
    border: 1px solid var(--color-divider, #ddd);
    border-radius: 8px;
    padding: 14px;
    background: var(--color-paper, #fff);
    min-width: 0;
  }
  .panel h2 {
    margin: 0 0 8px;
    font-size: 20px;
  }
  .lines,
  .facts,
  .treatments,
  .history {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .lines li,
  .facts li,
  .history li,
  .fact,
  .treatments p {
    overflow-wrap: anywhere;
  }
  .lines a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  .form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 12px;
  }
  .form label,
  .window label,
  .review label {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .form .wide {
    grid-column: 1 / -1;
  }
  input,
  select,
  textarea {
    min-height: 48px;
    font: inherit;
    padding: 8px;
    border: 1px solid var(--color-divider, #ccc);
    border-radius: 6px;
    background: var(--color-paper, #fff);
    color: inherit;
    min-width: 0;
    max-width: 100%;
  }
  textarea {
    min-height: 72px;
  }
  .radio {
    display: flex !important;
    align-items: center;
    gap: 8px;
    min-height: 48px;
  }
  .radio input {
    min-height: 24px;
    width: 24px;
  }
  .window {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: end;
  }
  .btn-primary,
  .btn-secondary {
    min-height: 48px;
    padding: 0 16px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--color-forest-deep, #1f3a28);
    color: #fff;
    border: none;
  }
  .btn-secondary {
    background: var(--color-paper, #fff);
    color: inherit;
    border: 1px solid var(--color-divider, #ccc);
  }
  .block {
    border-top: 1px solid var(--color-divider, #ddd);
    padding-top: 10px;
    margin-top: 10px;
  }
  .block h3 {
    margin: 0 0 4px;
    font-size: 16px;
  }
  .review {
    border: 1px solid var(--color-divider, #ddd);
    border-radius: 6px;
    display: grid;
    gap: 8px;
    padding: 10px;
    min-width: 0;
  }
  .welfare {
    font-weight: 600;
  }
  .doc {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    margin-right: 12px;
  }
  .ok {
    color: var(--color-forest-deep, #1f3a28);
  }
  .error {
    color: var(--color-rust, #9b2c1f);
  }
  .optional {
    font-weight: normal;
    color: var(--color-ink-soft, #666);
  }
  .live:empty {
    display: none;
  }
</style>
