<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import {
    recordCloseMessageKey,
    recordMatchesTask,
    type RecordTaskClose,
    type TaskContext,
    type TaskRecordTarget
  } from '$lib/tasks/recordClose';

  interface Props {
    /** The task the page was opened from; nothing renders without one. */
    task: TaskContext | null | undefined;
    /** The block and crop the record is for right now. */
    record: TaskRecordTarget;
    /** The server's answer after an online save. */
    outcome?: RecordTaskClose | null;
    /** True once the record went to the offline queue. */
    queued?: boolean;
  }
  const { task, record, outcome = null, queued = false }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const matches = $derived(task ? recordMatchesTask(task, record) : true);
  const savedKey = $derived(recordCloseMessageKey(outcome));
  const line = $derived.by(() => {
    if (!task) return null;
    if (outcome) return savedKey ? tr(savedKey) : null;
    if (queued) return matches ? tr('tasks.recordClose.queued') : null;
    if (!matches) return tr('tasks.recordClose.willStayOpen');
    return tr('tasks.recordClose.fromTask', { title: task.title });
  });
  const warn = $derived(
    !!task && ((!outcome && !queued && !matches) || outcome?.status === 'mismatch')
  );
</script>

{#if line}
  <p class="task-close-note" class:warn data-testid="task-close-note" role="status">{line}</p>
{/if}

<style>
  .task-close-note {
    margin: 8px 0 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .task-close-note.warn {
    color: var(--color-rust);
    font-weight: 600;
  }
</style>
