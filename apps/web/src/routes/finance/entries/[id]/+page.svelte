<script lang="ts">
  import { createT } from '$lib/i18n';
  import '$lib/components/finance/finance.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import EntryForm from '$lib/components/finance/EntryForm.svelte';
  import { formatMoney } from '$lib/finance/money';
  import { formatInstant } from '$lib/prefs';
  import { currentPrefs } from '$lib/prefsState.svelte';

  const { data } = $props();
  const tr = $derived(createT(data.locale));

  const ACTION = $derived<Record<string, string>>({
    create: tr('finance.action.create'),
    update: tr('finance.action.update'),
    delete: tr('finance.action.delete'),
    restore: tr('finance.action.restore')
  });

  function amountChange(before: number | null, after: number | null): string {
    if (before !== null && after !== null && before !== after) {
      return `, ${tr('finance.entry.amountChange', { before: formatMoney(before), after: formatMoney(after) })}`;
    }
    return '';
  }
</script>

<svelte:head><title>{tr('finance.pageTitleEntry')}</title></svelte:head>

<div class="fin-page">
  <header>
    <Kicker>{tr('finance.kicker')}</Kicker>
    <h1 class="serif">
      {data.value.kind === 'income' ? tr('finance.entry.income') : tr('finance.entry.expense')}
    </h1>
  </header>

  {#if data.deleted}
    <p class="fin-note">{tr('finance.entry.deletedNote')}</p>
    <a class="fin-ghost back" href="{data.backHref}&show=deleted"
      >{tr('finance.entry.backDeleted')}</a
    >
  {:else if data.canWrite}
    <EntryForm initial={data.value} options={data.options} backHref={data.backHref} />
  {:else}
    <p class="fin-note">{tr('finance.entry.impersonating')}</p>
  {/if}

  <section class="fin-panel" aria-labelledby="hist-title">
    <h2 id="hist-title">{tr('finance.entry.history')}</h2>
    <ol class="history">
      {#each data.history as h (h.id)}
        <li>
          {ACTION[h.action] ?? h.action}
          {formatInstant(h.at, currentPrefs())}{h.by
            ? ` ${tr('finance.entry.by', { name: h.by })}`
            : ''}{amountChange(h.beforeCents, h.afterCents)}
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
