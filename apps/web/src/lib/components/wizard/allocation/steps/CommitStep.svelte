<script lang="ts">
  import { getWizardContext } from '../wizardState.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const w = getWizardContext();
  const tr = $derived(createT(page.data?.locale));
</script>

<p class="aw-loading">
  {tr('wizard.commit.progress', { done: w.commitProgress.done, total: w.commitProgress.total })}
</p>
<progress value={w.commitProgress.done} max={w.commitProgress.total}></progress>
{#if w.inputsCommitError}
  <p class="aw-error">{tr('wizard.commit.inputsFailed', { error: w.inputsCommitError })}</p>
{/if}
{#if w.commitProgress.failed.length > 0 && !w.commitRetrying}
  <div class="commit-failed" data-testid="commit-failed" role="alert">
    <p class="aw-error">{tr('wizard.commit.failed', { n: w.commitProgress.failed.length })}</p>
    <p>{tr('wizard.commit.retryHead')}</p>
    <ul>
      {#each w.commitProgress.failed as f, idx (idx)}
        <li data-testid="commit-failed-row">{f}</li>
      {/each}
    </ul>
    <button
      type="button"
      class="retry"
      data-testid="commit-retry"
      onclick={() => void w.retryFailedCommits()}
    >
      {tr('wizard.commit.retry')}
    </button>
  </div>
{:else if w.commitRetrying}
  <p class="aw-loading" aria-live="polite">{tr('wizard.commit.retrying')}</p>
{/if}

<style>
  .aw-error {
    color: #b22222;
    font-weight: 600;
  }
  .aw-loading {
    color: var(--color-forest);
    font-size: 1rem;
  }
  .retry {
    min-height: 48px;
    padding: 0 1.1rem;
    border: none;
    border-radius: 8px;
    background: var(--color-forest);
    color: #fff;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  progress {
    width: 100%;
    height: 14px;
    margin-top: 0.5rem;
  }
</style>
