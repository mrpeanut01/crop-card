<script lang="ts">
  import {
    ImagePlus,
    RotateCcw,
    Trash2,
    CircleCheck,
    CircleAlert,
    Loader,
    Clock
  } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { BatchRow, BatchStatus, LabelBatch } from '$lib/stock/labelBatch.svelte';

  interface Props {
    batch: LabelBatch;
    notice?: string | null;
    onReview: (row: BatchRow) => void;
    onSwitchToManual?: () => void;
  }

  const { batch, notice = null, onReview, onSwitchToManual }: Props = $props();

  const STATUS_LABEL: Record<BatchStatus, string> = {
    queued: 'Queued',
    reading: 'Reading…',
    done: 'Ready to review',
    failed: 'Failed',
    saved: 'Saved'
  };

  const counts = $derived(batch.counts);
  const total = $derived(batch.rows.length);
  const next = $derived(batch.nextReviewable());
  const finished = $derived(counts.done + counts.failed + counts.saved);

  const summary = $derived(
    `${finished} of ${total} read · ${counts.saved} saved` +
      (counts.failed ? ` · ${counts.failed} failed` : '') +
      (counts.done ? ` · ${counts.done} to review` : '')
  );

  function onAddMore(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (files.length === 0) return;
    batch.add(files);
    void batch.run();
  }
</script>

<section class="batch" aria-label="Label batch queue" data-testid="label-batch">
  <header class="batch-head">
    <div>
      <h2 class="batch-title">Batch unboxing · {total} photo{total === 1 ? '' : 's'}</h2>
      <p class="batch-sum" aria-live="polite" data-testid="batch-summary">{summary}</p>
    </div>
    {#if next}
      <button
        type="button"
        class="btn btn-primary"
        onclick={() => onReview(next)}
        data-action="review-next"
      >
        Review next draft →
      </button>
    {/if}
  </header>

  <p class="batch-lede">
    Photos are read one at a time — each one is a separate Claude call, metered against your AI
    budget. Review and save each draft; nothing is recorded until you do.
  </p>

  {#if notice}
    <p class="notice" role="status">{notice}</p>
  {/if}

  {#if batch.stopMessage}
    <div class="stop" role="alert" data-testid="batch-stop">
      <strong>Queue stopped.</strong>
      {batch.stopMessage}
      {#if counts.queued}
        {counts.queued} photo{counts.queued === 1 ? ' was' : 's were'} not sent.
      {/if}
      <div class="stop-actions">
        {#if batch.stoppedOnNoKey}
          <a class="btn btn-primary" href="/settings/ai" target="_blank" rel="noopener"
            >Add Claude key ↗</a
          >
          {#if onSwitchToManual}
            <button type="button" class="btn" onclick={onSwitchToManual}
              >Use Manual entry instead →</button
            >
          {/if}
        {:else if counts.queued}
          <button
            type="button"
            class="btn"
            onclick={() => void batch.run()}
            disabled={batch.running}
            data-action="resume">Resume queue</button
          >
        {/if}
      </div>
    </div>
  {/if}

  {#if batch.overflow}
    <p class="notice">
      Only the first {total} photos were queued — a batch holds at most 30. Add the rest after this batch.
    </p>
  {/if}

  <ul class="rows">
    {#each batch.rows as row (row.id)}
      <li class="row" data-status={row.status} data-testid="batch-row">
        <div class="thumb" aria-hidden="true">
          {#if row.thumbUrl}
            <img src={row.thumbUrl} alt="" />
          {:else}
            <ImagePlus size={20} strokeWidth={1.5} />
          {/if}
        </div>
        <div class="row-body">
          <span class="row-name">{row.draft?.displayName ?? row.name}</span>
          <span class="row-status status-{row.status}">
            {#if row.status === 'queued'}<Clock size={13} aria-hidden="true" />
            {:else if row.status === 'reading'}<Loader size={13} aria-hidden="true" />
            {:else if row.status === 'failed'}<CircleAlert size={13} aria-hidden="true" />
            {:else}<CircleCheck size={13} aria-hidden="true" />{/if}
            {STATUS_LABEL[row.status]}
            {#if row.status === 'done' || row.status === 'saved'}
              <Provenance source="ai" compact />
            {/if}
          </span>
          {#if row.error}
            <span class="row-error">{row.error}</span>
          {/if}
        </div>
        <div class="row-actions">
          {#if row.status === 'done'}
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => onReview(row)}
              aria-label="Review {row.draft?.displayName ?? row.name}"
            >
              Review
            </button>
          {/if}
          {#if row.status === 'failed' && !batch.stoppedOnNoKey}
            <button
              type="button"
              class="btn icon-btn"
              onclick={() => void batch.retry(row.id)}
              disabled={batch.running}
              aria-label="Retry {row.name}"
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          {/if}
          {#if row.status !== 'reading' && row.status !== 'saved'}
            <button
              type="button"
              class="btn icon-btn"
              onclick={() => batch.discard(row.id)}
              aria-label="Discard {row.name}"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <footer class="batch-foot">
    <label class="btn add-more" class:disabled={batch.running}>
      <ImagePlus size={16} aria-hidden="true" />
      Add more photos
      <input
        type="file"
        accept="image/*"
        multiple
        onchange={onAddMore}
        disabled={batch.running}
        data-testid="batch-add-more"
      />
    </label>
    <button
      type="button"
      class="btn"
      onclick={() => batch.clear()}
      disabled={batch.running}
      data-action="clear-batch"
    >
      {counts.done ? 'Discard remaining drafts' : 'Done with batch'}
    </button>
  </footer>
</section>

<style>
  .batch {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .batch-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .batch-title {
    margin: 0;
    font-size: 1.05rem;
    color: var(--color-forest-deep, #1f3522);
  }
  .batch-sum {
    margin: 2px 0 0;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 12px;
    color: var(--color-ink-muted, #6a6f63);
  }
  .batch-lede {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft, #4a4f43);
    line-height: 1.45;
  }
  .notice {
    margin: 0;
    padding: 8px 12px;
    background: var(--color-cream, #fff8e1);
    border-radius: 6px;
    font-size: 13px;
  }
  .stop {
    padding: 10px 14px;
    background: rgba(186, 75, 56, 0.08);
    border-left: 3px solid var(--color-rust, #ba4b38);
    border-radius: 4px;
    font-size: 13px;
    color: var(--color-ink, #2b2f27);
  }
  .stop-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 8px;
    background: var(--color-paper, #fff);
  }
  .row[data-status='saved'] {
    opacity: 0.7;
  }
  .thumb {
    width: 56px;
    height: 56px;
    border-radius: 6px;
    background: var(--color-cream, #fff8e1);
    display: grid;
    place-items: center;
    overflow: hidden;
    color: var(--color-ink-muted, #6a6f63);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .row-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .row-name {
    font-weight: 600;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--color-ink-soft, #4a4f43);
  }
  .status-done,
  .status-saved {
    color: var(--color-forest, #1f5e3a);
  }
  .status-failed {
    color: var(--color-rust, #a23a3a);
  }
  .row-error {
    font-size: 12px;
    color: var(--color-rust, #a23a3a);
    overflow-wrap: anywhere;
  }
  .row-actions {
    display: flex;
    gap: 6px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 48px;
    min-width: 48px;
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid var(--color-divider, #e5e7e0);
    background: var(--color-paper, #fff);
    color: var(--color-forest-deep, #1f3522);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .btn:disabled,
  .btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--color-forest, #1f5e3a);
    border-color: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
  }
  .icon-btn {
    padding: 0;
  }
  .batch-foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .add-more {
    position: relative;
  }
  .add-more input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
  .add-more:focus-within {
    outline: 2px solid var(--color-forest, #1f5e3a);
    outline-offset: 2px;
  }
  @media (max-width: 520px) {
    .row {
      grid-template-columns: 48px 1fr;
    }
    .thumb {
      width: 48px;
      height: 48px;
    }
    .row-actions {
      grid-column: 1 / -1;
      justify-content: flex-end;
    }
  }
</style>
