<script lang="ts">
  import '$lib/components/finance/finance.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import EntryForm from '$lib/components/finance/EntryForm.svelte';
  import { formatMoney } from '$lib/finance/money';
  import { formatInstant } from '$lib/prefs';
  import { currentPrefs } from '$lib/prefsState.svelte';

  const { data } = $props();

  const ACTION: Record<string, string> = {
    create: 'Added',
    update: 'Changed',
    delete: 'Deleted',
    restore: 'Restored'
  };

  function amountChange(before: number | null, after: number | null): string {
    if (before !== null && after !== null && before !== after) {
      return `, ${formatMoney(before)} to ${formatMoney(after)}`;
    }
    return '';
  }
</script>

<svelte:head><title>Money entry · CropCard</title></svelte:head>

<div class="fin-page">
  <header>
    <Kicker>Money · owner only</Kicker>
    <h1 class="serif">{data.value.kind === 'income' ? 'Income entry.' : 'Expense entry.'}</h1>
  </header>

  {#if data.deleted}
    <p class="fin-note">This entry is deleted. Restore it from the Deleted list on Money.</p>
    <a class="fin-ghost back" href="{data.backHref}&show=deleted">Back to deleted entries</a>
  {:else if data.canWrite}
    <EntryForm initial={data.value} options={data.options} backHref={data.backHref} />
  {:else}
    <p class="fin-note">Money cannot be changed while impersonating.</p>
  {/if}

  <section class="fin-panel" aria-labelledby="hist-title">
    <h2 id="hist-title">History</h2>
    <ol class="history">
      {#each data.history as h (h.id)}
        <li>
          {ACTION[h.action] ?? h.action}
          {formatInstant(h.at, currentPrefs())}{h.by ? ` by ${h.by}` : ''}{amountChange(
            h.beforeCents,
            h.afterCents
          )}
        </li>
      {/each}
    </ol>
  </section>
</div>

<style>
  .history {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .back {
    align-self: flex-start;
  }
</style>
