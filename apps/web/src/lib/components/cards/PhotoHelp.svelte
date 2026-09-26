<script lang="ts">
  import AiUsageChip from '$lib/components/billing/AiUsageChip.svelte';
  import AiLimitNudge from '$lib/components/billing/AiLimitNudge.svelte';
  import type { AiLimit } from '$lib/billing/aiLimit';
  import { onMount } from 'svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import QueuedBadge from '$lib/components/ui/QueuedBadge.svelte';
  import {
    PHOTO_QUESTION_LABEL,
    journalPhotoUrl,
    questionText,
    type JournalAnswer,
    type JournalAnswerSection,
    type JournalEntry,
    type PhotoQuestion
  } from '$lib/journal/model';
  import {
    SPRAY_REDIRECT,
    asksForSprayAdvice,
    careSectionsFor,
    filterSprayAdviceItems,
    topicFor
  } from '$lib/journal/photoHelp';
  import type { PhotoHelpTarget } from '$lib/journal/targets';
  import { resizePhoto } from '$lib/client/photoResize';
  import type { QueuedJournalRow } from '$lib/client/journalQueue';
  import { DEFAULT_PREFS, formatInstant, type Prefs } from '$lib/prefs';

  interface Props {
    targets: PhotoHelpTarget[];
    role?: string | null;
    prefs?: Prefs;
    sprayTerms?: readonly string[];
  }

  const { targets, role = null, prefs = DEFAULT_PREFS, sprayTerms = [] }: Props = $props();

  const CHIPS = Object.entries(PHOTO_QUESTION_LABEL) as Array<
    [Exclude<PhotoQuestion, 'other'>, string]
  >;

  let chosenId = $state<string | null>(null);
  const cropId = $derived(chosenId ?? targets[0]?.cropId ?? null);
  const target = $derived(targets.find((t) => t.cropId === cropId) ?? null);
  const canWrite = $derived(role !== 'inspector');
  const isOwner = $derived(role === 'owner');

  let chip = $state<Exclude<PhotoQuestion, 'other'> | null>(null);
  let typed = $state('');
  let photo = $state<string | null>(null);
  let photoBusy = $state(false);
  let photoError = $state<string | null>(null);
  let asking = $state(false);
  let askError = $state<string | null>(null);

  interface Shown {
    answer: JournalAnswer;
    provenance: 'ai' | 'fallback';
    message: string | null;
    queued: boolean;
    aiLimit?: AiLimit | null;
  }
  let shown = $state<Shown | null>(null);

  let entries = $state<JournalEntry[]>([]);
  let journalState = $state<'idle' | 'loading' | 'ready' | 'offline' | 'error'>('idle');
  let queuedNotes = $state<QueuedJournalRow[]>([]);
  let confirmDelete = $state<string | null>(null);
  let note = $state('');
  let noteBusy = $state(false);
  let noteMessage = $state<string | null>(null);

  const question = $derived<PhotoQuestion | null>(chip ?? (typed.trim() ? 'other' : null));
  const canAsk = $derived(!!cropId && !!question && !asking && !photoBusy);

  function online(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  async function loadJournal(): Promise<void> {
    if (!cropId) return;
    if (!online()) {
      journalState = 'offline';
      return;
    }
    journalState = 'loading';
    try {
      const res = await fetch(`/api/plantings/${encodeURIComponent(cropId)}/journal`);
      if (!res.ok) throw new Error(String(res.status));
      entries = ((await res.json()) as { entries: JournalEntry[] }).entries;
      journalState = 'ready';
    } catch {
      journalState = online() ? 'error' : 'offline';
    }
  }

  async function refreshQueued(): Promise<void> {
    const id = cropId;
    if (!id) return;
    try {
      const { listQueuedJournal } = await import('$lib/client/journalQueue');
      const next = await listQueuedJournal(id);
      if (id !== cropId) return;
      const waiting = (rows: QueuedJournalRow[]) => rows.filter((r) => !r.rejected).length;
      const drained = waiting(next) < waiting(queuedNotes);
      queuedNotes = next;
      if (drained && online()) await loadJournal();
    } catch {
      queuedNotes = [];
    }
  }

  onMount(() => {
    void loadJournal();
    void refreshQueued();
    const back = () => {
      void loadJournal();
      void refreshQueued();
    };
    window.addEventListener('online', back);
    const timer = setInterval(refreshQueued, 4000);
    return () => {
      window.removeEventListener('online', back);
      clearInterval(timer);
    };
  });

  function pickTarget(id: string) {
    chosenId = id;
    shown = null;
    queuedNotes = [];
    confirmDelete = null;
    void loadJournal();
    void refreshQueued();
  }

  async function onPhoto(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    photoError = null;
    photoBusy = true;
    try {
      photo = await resizePhoto(file);
    } catch (err) {
      photo = null;
      photoError = err instanceof Error ? err.message : 'That photo could not be read.';
    } finally {
      photoBusy = false;
    }
  }

  function careFallback(q: PhotoQuestion, text: string): JournalAnswerSection[] {
    const sections = (target?.careGuide?.sections ?? []).map((s) => ({
      title: s.title,
      items: filterSprayAdviceItems(s.items, sprayTerms),
      provenance: s.provenance === 'plugin' ? ('plugin' as const) : ('fallback' as const)
    }));
    return careSectionsFor(sections, topicFor(q, text));
  }

  async function queueEntry(kind: 'note' | 'photo_help', text: string, withPhoto: string | null) {
    if (!cropId) return;
    const { queueJournalEntry } = await import('$lib/client/journalQueue');
    await queueJournalEntry({ cropId, kind, text, photo: withPhoto });
    await refreshQueued();
  }

  async function answerOffline(q: PhotoQuestion, text: string) {
    const asked = questionText(q, text);
    const hadPhoto = !!photo;
    await queueEntry('photo_help', asked, photo);
    photo = null;
    chip = null;
    typed = '';
    const spray = asksForSprayAdvice(asked, sprayTerms);
    const saved = hadPhoto
      ? 'Your photo and question will save when you are back online.'
      : 'Your question will save when you are back online.';
    shown = {
      answer: {
        question: q,
        text: '',
        source: 'fallback',
        sections: careFallback(q, text),
        sprayRedirect: spray
      },
      provenance: 'fallback',
      message: `${spray ? `${SPRAY_REDIRECT} ` : ''}No signal right now, so here is what the Care Guide says. ${saved}`,
      queued: true
    };
  }

  async function ask() {
    if (!canAsk || !cropId || !question) return;
    asking = true;
    askError = null;
    shown = null;
    const q = question;
    const text = chip ? typed : typed.trim();
    try {
      if (!online()) {
        await answerOffline(q, text);
        return;
      }
      let res: Response;
      try {
        res = await fetch(`/api/plantings/${encodeURIComponent(cropId)}/photo-help`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: q, text, photo })
        });
      } catch {
        await answerOffline(q, text);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        answer?: JournalAnswer;
        provenance?: 'ai' | 'fallback';
        message?: string | null;
        entry?: JournalEntry;
        aiLimit?: AiLimit | null;
      };
      if (!res.ok || !body.answer || !body.provenance) {
        askError = body.error ?? 'That did not go through. Try again.';
        return;
      }
      shown = {
        answer: body.answer,
        provenance: body.provenance,
        message: body.message ?? null,
        queued: false,
        aiLimit: body.aiLimit ?? null
      };
      if (body.entry) entries = [body.entry, ...entries];
      photo = null;
      chip = null;
      typed = '';
    } finally {
      asking = false;
    }
  }

  async function saveNote() {
    const text = note.trim();
    if (!cropId || !text || noteBusy) return;
    noteBusy = true;
    noteMessage = null;
    try {
      if (online()) {
        try {
          const res = await fetch(`/api/plantings/${encodeURIComponent(cropId)}/journal`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'note', text })
          });
          const body = (await res.json().catch(() => ({}))) as {
            entry?: JournalEntry;
            error?: string;
          };
          if (res.ok && body.entry) {
            entries = [body.entry, ...entries];
            note = '';
            noteMessage = 'Note saved.';
            return;
          }
          noteMessage = body.error ?? 'That note did not save. Try again.';
          return;
        } catch {
          /* no signal after all: queue it below */
        }
      }
      await queueEntry('note', text, null);
      note = '';
      noteMessage = 'Saved on this phone. It will upload when you are back online.';
    } finally {
      noteBusy = false;
    }
  }

  async function remove(entry: JournalEntry) {
    if (!cropId) return;
    confirmDelete = null;
    const res = await fetch(
      `/api/plantings/${encodeURIComponent(cropId)}/journal/${encodeURIComponent(entry.id)}`,
      { method: 'DELETE' }
    ).catch(() => null);
    if (res?.ok) {
      entries = entries.filter((e) => e.id !== entry.id);
    } else {
      noteMessage =
        res?.status === 403
          ? 'Only the owner can delete journal entries.'
          : 'That did not delete. Try again with signal.';
    }
  }

  const PROV_BY_ENTRY: Record<JournalEntry['provenance'], 'ai' | 'manual' | 'fallback'> = {
    ai: 'ai',
    manual: 'manual',
    fallback: 'fallback'
  };
</script>

{#if targets.length}
  <section class="photo-help" aria-labelledby="photo-help-heading" data-testid="photo-help">
    <h2 id="photo-help-heading" class="serif">Ask about a photo</h2>

    {#if targets.length > 1}
      <label class="field">
        <span>Which planting?</span>
        <select value={cropId} onchange={(e) => pickTarget(e.currentTarget.value)}>
          {#each targets as t (t.cropId)}
            <option value={t.cropId}>{t.label}</option>
          {/each}
        </select>
      </label>
    {:else if target}
      <p class="about">About {target.label}</p>
    {/if}

    {#if canWrite}
      <AiUsageChip onlyWhenOut />
      <div class="photo-row">
        <label class="btn ghost file">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            class="visually-hidden"
            onchange={onPhoto}
            data-testid="photo-input"
          />
          {photo ? 'Retake photo' : 'Take or choose a photo'}
        </label>
        {#if photo}
          <img class="preview" src={photo} alt="What you are asking about" />
          <button type="button" class="btn ghost" onclick={() => (photo = null)}>
            Remove photo
          </button>
        {/if}
      </div>
      {#if photoBusy}<p class="hint" role="status">Making the photo smaller…</p>{/if}
      {#if photoError}<p class="error" role="alert">{photoError}</p>{/if}

      <div class="chips" role="group" aria-label="Pick a question">
        {#each CHIPS as [id, label] (id)}
          <button
            type="button"
            class="chip"
            aria-pressed={chip === id}
            onclick={() => (chip = chip === id ? null : id)}>{label}</button
          >
        {/each}
      </div>
      <label class="field">
        <span>{chip ? 'Anything to add?' : 'Or ask in your own words'}</span>
        <textarea rows="2" maxlength="500" bind:value={typed}></textarea>
      </label>
      <button type="button" class="btn primary" disabled={!canAsk} onclick={ask}>
        {asking ? 'Asking…' : 'Ask'}
      </button>
      <p class="hint">
        Answers are about growing only. For anything you would spray, use the Spray flow and the
        product label.
      </p>
      {#if askError}<p class="error" role="alert">{askError}</p>{/if}
    {/if}

    <div aria-live="polite">
      {#if shown}
        <div class="answer" data-testid="photo-answer" data-provenance={shown.provenance}>
          {#if shown.message}<p class="message">{shown.message}</p>{/if}
          <AiLimitNudge limit={shown.aiLimit} {isOwner} />
          {#if shown.queued}<QueuedBadge />{/if}
          {#if shown.answer.text}
            <p class="ai-text">{shown.answer.text}</p>
            <Provenance source="ai" />
          {/if}
          {#each shown.answer.sections as s (s.title)}
            <section class="care-section">
              <h3>
                {s.title}
                <Provenance
                  source={s.provenance ?? 'fallback'}
                  label={s.provenance === 'plugin' ? undefined : 'Care guide'}
                  compact
                />
              </h3>
              <ul>
                {#each s.items as item, i (i)}<li>{item}</li>{/each}
              </ul>
            </section>
          {/each}
          {#if shown.answer.sprayRedirect}
            <a class="btn ghost" href="/spray">Open the Spray flow</a>
          {/if}
        </div>
      {/if}
    </div>

    <section class="journal" aria-labelledby="journal-heading">
      <h3 id="journal-heading">Journal</h3>
      {#if canWrite}
        <label class="field">
          <span>Add a note</span>
          <textarea rows="2" maxlength="2000" bind:value={note}></textarea>
        </label>
        <button
          type="button"
          class="btn ghost"
          disabled={!note.trim() || noteBusy}
          onclick={saveNote}>Save note</button
        >
      {/if}
      {#if noteMessage}<p class="hint" role="status">{noteMessage}</p>{/if}

      {#if queuedNotes.length}
        <ul class="entries">
          {#each queuedNotes as q (q.rowId)}
            <li class="entry" data-testid="journal-queued">
              {#if q.rejected}
                <p class="error">This did not save. Open Records to try it again.</p>
              {:else}
                <QueuedBadge />
              {/if}
              <p>{q.text || 'Photo'}{q.hasPhoto && q.text ? ' (with photo)' : ''}</p>
            </li>
          {/each}
        </ul>
      {/if}

      {#if journalState === 'offline'}
        <p class="hint">The journal loads when you have signal. New notes save on this phone.</p>
      {:else if journalState === 'error'}
        <p class="hint">The journal did not load. Try again in a moment.</p>
      {:else if journalState === 'ready' && entries.length === 0 && !queuedNotes.length}
        <p class="hint">Nothing here yet. Notes and photo questions show up here.</p>
      {/if}
      {#if entries.length}
        <ul class="entries" data-testid="journal-entries">
          {#each entries as e (e.id)}
            <li class="entry" data-kind={e.kind}>
              <div class="entry-head">
                <span class="when">{formatInstant(e.createdAt, prefs, 'datetime')}</span>
                <Provenance source={PROV_BY_ENTRY[e.provenance]} compact />
              </div>
              {#if e.hasPhoto && cropId}
                <img
                  class="thumb"
                  src={journalPhotoUrl(cropId, e.id)}
                  alt="Taken {formatInstant(e.createdAt, prefs, 'month-day')}"
                  loading="lazy"
                />
              {/if}
              {#if e.text}<p>{e.text}</p>{/if}
              {#if e.answer?.text}
                <p class="ai-text">{e.answer.text}</p>
              {:else if e.answer?.sections.length}
                <p class="hint">Answered from the Care Guide: {e.answer.sections[0].title}.</p>
              {/if}
              {#if isOwner}
                {#if confirmDelete === e.id}
                  <div class="confirm" role="group" aria-label="Delete this entry?">
                    <span class="confirm-q">Delete this entry?</span>
                    <button
                      type="button"
                      class="btn ghost small"
                      onclick={() => (confirmDelete = null)}>Cancel</button
                    >
                    <button type="button" class="btn danger small" onclick={() => remove(e)}
                      >Delete</button
                    >
                  </div>
                {:else}
                  <button
                    type="button"
                    class="btn ghost small"
                    onclick={() => (confirmDelete = e.id)}>Delete…</button
                  >
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </section>
{/if}

<style>
  .photo-help {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 640px;
    margin-top: var(--space-4);
    padding: var(--space-3);
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    min-width: 0;
  }
  h2 {
    font-size: var(--font-size-card-title);
    margin: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--font-size-body);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .about {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-weight: 600;
  }
  select,
  textarea {
    min-height: 48px;
    font: inherit;
    font-weight: 400;
    padding: var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-cream, #fff);
    color: var(--color-ink);
    width: 100%;
    box-sizing: border-box;
  }
  .photo-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .preview {
    width: 96px;
    height: 96px;
    object-fit: cover;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    min-height: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    border: 1px solid var(--pill-neutral-bd);
    background: var(--pill-neutral-bg);
    color: var(--pill-neutral-fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--pill-forest-bg);
    border-color: var(--pill-forest-bd);
    color: var(--pill-forest-fg);
  }
  .btn {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: flex-start;
    text-decoration: none;
  }
  .btn.primary {
    background: var(--color-forest);
    color: #fff;
  }
  .btn.primary:disabled,
  .btn.ghost:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn.ghost {
    background: var(--color-paper);
    border-color: var(--color-divider);
    color: var(--color-ink);
  }
  .btn.small {
    min-height: 48px;
    padding: 0 var(--space-3);
  }
  .btn.danger {
    background: var(--pill-rust-bg);
    border-color: var(--pill-rust-bd);
    color: var(--pill-rust-fg);
  }
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .confirm-q {
    font-weight: 600;
  }
  .btn:focus-visible,
  .chip:focus-visible,
  .file:focus-within {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .file {
    position: relative;
  }
  .hint {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
  .error {
    margin: 0;
    color: var(--pill-rust-fg);
    font-weight: 600;
  }
  .answer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-input);
    background: var(--color-cream, var(--color-paper));
    border: 1px solid var(--color-divider);
  }
  .message {
    margin: 0;
    font-weight: 600;
  }
  .ai-text {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .care-section ul,
  .entries {
    margin: 0;
    padding-left: var(--space-4);
  }
  .entries {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: var(--radius-input);
    min-width: 0;
  }
  .entry p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .entry-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .thumb {
    width: 100%;
    max-width: 240px;
    border-radius: var(--radius-input);
  }
  .journal {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
