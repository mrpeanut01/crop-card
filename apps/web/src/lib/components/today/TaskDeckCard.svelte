<script lang="ts" module>
  import type { TaskStatus } from '$lib/tasks/status';

  export interface LinkedTaskItem {
    id: string;
    title: string;
    kind: 'pre-task' | 'post-task';
    status: TaskStatus;
    queued: boolean;
    /** The linked task's due day, already formatted. */
    due?: string | null;
    body?: string | null;
  }
</script>

<script lang="ts">
  import CardView from '$lib/components/cards/CardView.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import QueuedBadge from '$lib/components/ui/QueuedBadge.svelte';
  import SkipReasonForm from './SkipReasonForm.svelte';
  import type { CardModel } from '$lib/cards/model';
  import type { Prefs } from '$lib/prefs';
  import type { TaskStart } from '$lib/tasks/start';
  import { TASK_STATUS_LABEL, TASK_STATUS_TONE } from '$lib/tasks/status';

  interface Props {
    card: CardModel;
    taskId: string;
    status: TaskStatus;
    start: TaskStart | null;
    canAct: boolean;
    queued: boolean;
    rejected?: boolean;
    linked?: LinkedTaskItem[];
    busy?: boolean;
    prefs?: Prefs;
    now?: number;
    onDone: (taskId: string) => void;
    onSkip: (taskId: string, reason: string) => void;
  }
  const {
    card,
    taskId,
    status,
    start,
    canAct,
    queued,
    rejected = false,
    linked = [],
    busy = false,
    prefs,
    now,
    onDone,
    onSkip
  }: Props = $props();

  let skipOpen = $state(false);
  const open = $derived(status !== 'done' && status !== 'skipped');

  function saveSkip(reason: string) {
    skipOpen = false;
    onSkip(taskId, reason);
  }
</script>

<div class="deck-card" data-task-id={taskId} data-status={status}>
  <CardView
    {card}
    variant="compact"
    {prefs}
    {now}
    factLimit={card.facts.length}
    compactSections={['Notes']}
  >
    {#snippet badges()}
      {#if queued}<QueuedBadge />{/if}
      {#if rejected}
        <a class="rejected" href="/records/pending">Could not save. Open Pending records</a>
      {/if}
    {/snippet}
    {#snippet actions()}
      {#each card.links ?? [] as l (l.href)}
        <a class="card-link" href={l.href}>{l.label}</a>
      {/each}
      {#if linked.length}
        <ul class="linked" aria-label="Get ready and follow-up for {card.title}">
          {#each linked as l (l.id)}
            <li data-task-id={l.id} data-status={l.status}>
              <span class="linked-kind">{l.kind === 'pre-task' ? 'Get ready' : 'Follow-up'}</span>
              <span class="linked-title">{l.title}</span>
              {#if l.due}<span class="linked-due">{l.due}</span>{/if}
              <Pill tone={TASK_STATUS_TONE[l.status]}>{TASK_STATUS_LABEL[l.status]}</Pill>
              {#if l.body?.trim()}<p class="linked-body">{l.body.trim()}</p>{/if}
              {#if l.queued}<QueuedBadge />{/if}
              {#if canAct && l.status !== 'done' && l.status !== 'skipped'}
                <button
                  type="button"
                  class="btn ghost"
                  aria-label="Done: {l.title}"
                  disabled={busy}
                  onclick={() => onDone(l.id)}>Done</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if canAct && open}
        <div class="row">
          {#if start}
            <a class="btn primary" href={start.href} aria-label="{start.label}: {card.title}"
              >{start.label}</a
            >
          {/if}
          <button
            type="button"
            class="btn {start ? 'ghost' : 'primary'}"
            aria-label="Done: {card.title}"
            disabled={busy}
            onclick={() => onDone(taskId)}>Done</button
          >
          <button
            type="button"
            class="btn ghost"
            aria-label="Skip: {card.title}"
            aria-expanded={skipOpen}
            disabled={busy}
            onclick={() => (skipOpen = !skipOpen)}>Skip</button
          >
        </div>
        {#if skipOpen}
          <SkipReasonForm
            id="skip-reason-{taskId}"
            {busy}
            onSave={saveSkip}
            onCancel={() => (skipOpen = false)}
          />
        {/if}
      {/if}
    {/snippet}
  </CardView>
</div>

<style>
  .deck-card {
    min-width: 0;
  }
  .deck-card[data-status='late'] :global(.cardview) {
    --strip: var(--color-rust);
  }
  .deck-card[data-status='done'] :global(.cardview),
  .deck-card[data-status='skipped'] :global(.cardview) {
    --strip: var(--color-divider);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border: 1px solid var(--color-forest);
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .card-link {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    min-height: 48px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .btn:focus-visible,
  .card-link:focus-visible,
  .rejected:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .linked {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .linked li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    padding: var(--space-1) 0;
    border-top: 1px dashed var(--color-divider-soft);
  }
  .linked-kind {
    font-size: var(--font-size-meta);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }
  .linked-title {
    flex: 1 1 8rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .linked-due {
    font-size: var(--font-size-meta);
    color: var(--color-ink-soft);
  }
  .linked-body {
    flex: 1 0 100%;
    margin: 0;
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .rejected {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--pill-rust-fg);
    font-weight: 600;
  }
</style>
