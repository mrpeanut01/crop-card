<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import DocumentAttach from '$lib/components/documents/DocumentAttach.svelte';
  import CertifierPackPanel from '$lib/components/organic/CertifierPackPanel.svelte';
  import { ORGANIC_REVIEW_OUTCOME_LABEL, ORGANIC_REVIEW_OUTCOMES } from '$lib/organic/apiSchemas';
  import { ORGANIC_STATUSES, ORGANIC_STATUS_LABEL } from '$lib/organic/status';

  const { data } = $props();

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
      return body.message ?? body.issues?.[0]?.message ?? body.error ?? 'Could not save.';
    } catch {
      return 'Could not save.';
    }
  }

  async function saveStatus(e: SubmitEvent) {
    e.preventDefault();
    errorText = null;
    message = null;
    const [subjectType, subjectId] = subject.split(':');
    if (!subjectType || !subjectId) {
      errorText = 'Pick what this status is for.';
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
      message = 'Status saved.';
      subject = '';
      certifier = '';
      note = '';
      documentId = null;
      await invalidateAll();
    } catch {
      errorText = 'You are offline. Organic statuses save only when online.';
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
      errorText = 'Pick an answer.';
      return;
    }
    if (reason.length < 3) {
      errorText = 'Say why, in a few words.';
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
      message = 'Answer saved.';
      await invalidateAll();
    } catch {
      errorText = 'You are offline. Answers save only when online.';
    } finally {
      reviewBusy = null;
    }
  }
</script>

<svelte:head><title>Organic records · CropCard</title></svelte:head>

<div class="organic-page">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/records">Records</a></nav>
  <header>
    <Kicker>Records · Organic</Kicker>
    <h1 class="serif">Organic records.</h1>
    <p class="lede">
      What your records show for the Areas, blocks and animals you manage as organic. Every status
      here is one the owner entered. CropCard reports the records and never decides a status.
    </p>
  </header>

  <div class="live" role="status" aria-live="polite">
    {#if message}<p class="ok">{message}</p>{/if}
  </div>
  {#if errorText}<p class="error" role="alert">{errorText}</p>{/if}

  <section aria-labelledby="now-h" class="panel">
    <h2 id="now-h" class="serif">Statuses today</h2>
    {#if !data.areaLines.length && !data.blockRows.length && !data.animalLines.length}
      <p class="help" data-testid="organic-empty">
        No organic status on file.{data.canEdit
          ? ' Add one below for each Area, block, animal or group you manage as organic.'
          : ''}
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
      <h2 id="add-h" class="serif">Add a status entry</h2>
      <p class="help">
        Entries are never edited. To correct one, add a new entry; the latest entry for a date is
        the one in force, and the history keeps both.
      </p>
      <form class="form" onsubmit={saveStatus}>
        <label>
          <span>For</span>
          <select bind:value={subject} required data-testid="organic-subject">
            <option value="" disabled>Pick an Area, block, animal or group</option>
            {#if data.subjects.areas.length}
              <optgroup label="Areas">
                {#each data.subjects.areas as a (a.id)}
                  <option value="field:{a.id}">{a.name}</option>
                {/each}
              </optgroup>
            {/if}
            {#if data.subjects.blocks.length}
              <optgroup label="Blocks and beds">
                {#each data.subjects.blocks as b (b.id)}
                  <option value="block:{b.id}">{b.name}</option>
                {/each}
              </optgroup>
            {/if}
            {#if data.subjects.groups.length}
              <optgroup label="Herds and flocks">
                {#each data.subjects.groups as g (g.id)}
                  <option value="group:{g.id}">{g.name}</option>
                {/each}
              </optgroup>
            {/if}
            {#if data.subjects.animals.length}
              <optgroup label="Animals">
                {#each data.subjects.animals as a (a.id)}
                  <option value="animal:{a.id}">{a.name}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select bind:value={status} data-testid="organic-status">
            {#each ORGANIC_STATUSES as s (s)}
              <option value={s}>{ORGANIC_STATUS_LABEL[s]}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Effective from</span>
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
          <span>Certifier <span class="optional">(optional)</span></span>
          <input type="text" maxlength="120" bind:value={certifier} />
        </label>
        <label class="wide">
          <span>Note <span class="optional">(optional)</span></span>
          <textarea maxlength="1000" rows="2" bind:value={note}></textarea>
        </label>
        <fieldset class="wide">
          <legend>Certificate <span class="optional">(optional)</span></legend>
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
          {saving ? 'Saving…' : 'Save status'}
        </button>
      </form>
    </section>
  {:else if data.isHelper}
    <p class="help">Only the owner enters organic statuses. Ask the owner.</p>
  {/if}

  <section aria-labelledby="facts-h" class="panel">
    <h2 id="facts-h" class="serif">What the records show</h2>
    <form class="window" method="GET">
      <label>
        <span>From</span>
        <input type="date" name="from" value={data.window.from} />
      </label>
      <label>
        <span>To</span>
        <input type="date" name="to" value={data.window.to} />
      </label>
      <button class="btn-secondary" type="submit">Show</button>
    </form>
    <p class="help">Showing records from {data.window.from} to {data.window.to}.</p>
    {#if !data.blockRows.length}
      <p class="help">No block has an organic status yet, so there is nothing to list here.</p>
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
                  ? ' · Record deleted, still counted as applied'
                  : ''}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="help">
            No input on file in this window that the library leaves unmarked or marks not allowed.
          </p>
        {/if}
        {#each b.treatedSeed as p (p.key)}
          <p class="fact">{p.date} · {p.crop}: planted from a seed lot recorded as treated</p>
        {/each}
        <p class="fact">
          {b.lastNonAllowed
            ? `Last input on file that the library does not mark as allowed: ${b.lastNonAllowed}.`
            : 'No input on file that the library does not mark as allowed.'}
        </p>
        <p class="fact">{b.transitionLine ?? data.askCertifier}</p>
      </article>
    {/each}
  </section>

  {#if data.treatments.length || data.animalLines.length}
    <section aria-labelledby="treat-h" class="panel">
      <h2 id="treat-h" class="serif">Animal treatments</h2>
      {#if data.welfareLine}<p class="welfare">{data.welfareLine}</p>{/if}
      {#if !data.treatments.length}
        <p class="help">No treatment in this window reached an animal with an organic status.</p>
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
                Owner answered "{ORGANIC_REVIEW_OUTCOME_LABEL[t.review.outcome]}" on {t.review.at}{t
                  .review.by
                  ? ` (${t.review.by})`
                  : ''}: {t.review.reason}
              </p>
            {/if}
            {#if t.canAnswer}
              <fieldset class="review">
                <legend>Does this treatment end organic status?</legend>
                {#each ORGANIC_REVIEW_OUTCOMES as o (o)}
                  <label class="radio">
                    <input
                      type="radio"
                      name="outcome-{t.id}"
                      value={o}
                      checked={reviewOutcome[t.id] === o}
                      onchange={() => (reviewOutcome = { ...reviewOutcome, [t.id]: o })}
                    />
                    {ORGANIC_REVIEW_OUTCOME_LABEL[o]}
                  </label>
                {/each}
                <label>
                  <span>Why</span>
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
                  Save answer
                </button>
                <p class="help">You can change an answer for 48 hours after you first give it.</p>
              </fieldset>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="hist-h" class="panel">
    <h2 id="hist-h" class="serif">Status history</h2>
    {#if !data.history.length}
      <p class="help">No entries yet.</p>
    {:else}
      <ul class="history">
        {#each data.history as h (h.id)}
          <li data-testid="organic-history-row">
            <strong>{h.subject}</strong>: {h.status} (owner-entered, {h.effective}{h.certifier
              ? `, certifier ${h.certifier}`
              : ''})
            <span class="help">Saved {h.savedAt}{h.by ? ` by ${h.by}` : ''}.</span>
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
