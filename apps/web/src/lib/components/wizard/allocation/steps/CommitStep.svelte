<script lang="ts">
  import { getWizardContext } from '../wizardState.svelte';

  const w = getWizardContext();
</script>

<p class="aw-loading">
  Committing… {w.commitProgress.done} / {w.commitProgress.total}
</p>
<progress value={w.commitProgress.done} max={w.commitProgress.total}></progress>
{#if w.inputsCommitError}
  <p class="aw-error">Inputs plan tasks failed to commit: {w.inputsCommitError}</p>
{/if}
{#if w.commitProgress.failed.length > 0}
  <p class="aw-error">Failed: {w.commitProgress.failed.length}</p>
  <ul>
    {#each w.commitProgress.failed as f, idx (idx)}
      <li>{f}</li>
    {/each}
  </ul>
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
  progress {
    width: 100%;
    height: 14px;
    margin-top: 0.5rem;
  }
</style>
