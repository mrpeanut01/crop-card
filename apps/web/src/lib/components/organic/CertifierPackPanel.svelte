<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  const { from, to }: { from: string; to: string } = $props();
  const tr = $derived(createT(page.data?.locale));

  let packFrom = $state('');
  let packTo = $state('');
  let withDocuments = $state(false);
  let errorText = $state<string | null>(null);

  $effect(() => {
    if (!packFrom) packFrom = from;
    if (!packTo) packTo = to;
  });

  const query = $derived(`from=${encodeURIComponent(packFrom)}&to=${encodeURIComponent(packTo)}`);
  const packHref = $derived(`/api/organic/pack.zip?${query}${withDocuments ? '&documents=1' : ''}`);

  const YMD = /^\d{4}-\d{2}-\d{2}$/;

  /** The pack streams straight to a file (it can hold every linked file),
   *  so it is a plain download link. Only what the browser can tell
   *  before the request is checked here; the server names anything else. */
  function check(e: MouseEvent) {
    errorText = null;
    if (!YMD.test(packFrom) || !YMD.test(packTo)) {
      errorText = tr('organic.pack.errDates');
    } else if (packTo < packFrom) {
      errorText = tr('organic.pack.errOrder');
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      errorText = tr('organic.pack.errOffline');
    }
    if (errorText) e.preventDefault();
  }
</script>

<section aria-labelledby="pack-h" class="pack">
  <h2 id="pack-h" class="serif">{tr('organic.pack.title')}</h2>
  <p class="help">{tr('organic.pack.help')}</p>
  <div class="dates">
    <label>
      <span>{tr('organic.pack.from')}</span>
      <input type="date" bind:value={packFrom} data-testid="pack-from" />
    </label>
    <label>
      <span>{tr('organic.pack.to')}</span>
      <input type="date" bind:value={packTo} data-testid="pack-to" />
    </label>
  </div>
  <label class="check">
    <input type="checkbox" bind:checked={withDocuments} />
    <span>{tr('organic.pack.withFiles')}</span>
  </label>
  <div class="actions">
    <a class="primary" href={packHref} download onclick={check} data-testid="pack-download"
      >{tr('organic.pack.download')}</a
    >
    <a class="ghost" href="/api/animals/treatments.csv?{query}" download data-testid="pack-log-csv"
      >{tr('recui.year.logCsv')}</a
    >
    <a class="ghost" href="/api/animals/treatments.pdf?{query}" download data-testid="pack-log-pdf"
      >{tr('recui.year.logPdf')}</a
    >
  </div>
  {#if errorText}<p class="error" role="alert">{errorText}</p>{/if}
</section>

<style>
  .pack {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    padding: 14px 16px;
    background: var(--color-paper);
    margin-top: 14px;
    min-width: 0;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 18px;
  }
  .help {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--color-ink-soft, #4a4f46);
  }
  .dates {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .dates label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    font-weight: 600;
    min-width: 0;
  }
  .dates input {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    font: inherit;
    max-width: 100%;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    font-size: 14px;
  }
  .check input {
    width: 22px;
    height: 22px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .primary,
  .ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 8px);
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest, #2d5a3d);
    color: #fff;
    border: 1px solid var(--color-forest, #2d5a3d);
  }
  .ghost {
    background: var(--color-paper, #fff);
    color: var(--color-forest-deep, #1f3a28);
    border: 1px solid var(--color-forest, #2d5a3d);
  }
  .error {
    color: var(--color-rust, #9a3b1f);
    font-size: 13px;
    margin: 8px 0 0;
  }
</style>
