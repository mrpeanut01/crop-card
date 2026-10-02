<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import DocumentAttach from '$lib/components/documents/DocumentAttach.svelte';
  import { currentPrefs } from '$lib/prefsState.svelte';
  import { todayYmd } from '$lib/prefs';
  import {
    FORAGE_LAB_MAX,
    FORAGE_NITRATE_UNITS,
    FORAGE_RATING_MAX,
    NITRATE_UNIT_LABELS,
    RATING_BASES,
    ratingBasisLabel
  } from '$lib/forage/model';
  import {
    buildForageTestBody,
    emptyForageDraft,
    type ForageTestDraft,
    type ForageTestTarget
  } from '$lib/forage/form';

  interface Props {
    /** A fixed target, or a list of blocks to pick from. */
    target?: ForageTestTarget | null;
    blocks?: Array<{ id: string; name: string }>;
    /** Owner only: attach the lab report (M-60). */
    canAttach: boolean;
    onSaved: (test: { id: string }) => void;
    onCancel?: () => void;
  }

  const { target = null, blocks = [], canAttach, onSaved, onCancel }: Props = $props();
  const uid = $props.id();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));

  let draft = $state<ForageTestDraft>(emptyForageDraft(todayYmd(currentPrefs())));
  let blockId = $state(untrack(() => blocks[0]?.id ?? ''));
  let saving = $state(false);
  let error = $state<string | null>(null);
  const today = $derived(todayYmd(currentPrefs()));

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const t: ForageTestTarget | null = target ?? (blockId ? { blockId } : null);
    if (!t) {
      error = tr('forage.form.err.where');
      return;
    }
    const built = buildForageTestBody(t, draft, locale);
    if (!built.ok) {
      error = built.error;
      return;
    }
    saving = true;
    try {
      const res = await fetch('/api/forage/tests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(built.body)
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        error =
          out.message ??
          out.issues?.[0]?.message ??
          out.error ??
          tr('forage.form.err.http', { status: res.status });
        return;
      }
      draft = emptyForageDraft(today);
      onSaved(out.test);
    } catch {
      error = tr('forage.form.err.offline');
    } finally {
      saving = false;
    }
  }
</script>

<form class="forage-form" onsubmit={save} data-testid="forage-test-form">
  <p class="help">{tr('forage.form.help')}</p>

  {#if !target}
    <label for="{uid}-block">{tr('forage.form.from')}</label>
    <select id="{uid}-block" bind:value={blockId}>
      {#each blocks as b (b.id)}
        <option value={b.id}>{b.name}</option>
      {/each}
    </select>
  {/if}

  <div class="pair">
    <label>
      {tr('forage.form.day')}
      <input type="date" max={today} bind:value={draft.sampledOn} required />
    </label>
    <label>
      {tr('forage.form.lab')} <span class="optional">{tr('forage.form.optional')}</span>
      <input type="text" maxlength={FORAGE_LAB_MAX} bind:value={draft.lab} />
    </label>
  </div>

  <fieldset>
    <legend>{tr('forage.form.nitrate')}</legend>
    <div class="pair">
      <label>
        {tr('forage.form.value')}
        <input
          type="number"
          min="0"
          step="any"
          inputmode="decimal"
          bind:value={draft.nitrateValue}
        />
      </label>
      <label>
        {tr('forage.form.units')}
        <select bind:value={draft.nitrateUnits}>
          <option value="">{tr('forage.form.pickUnits')}</option>
          {#each FORAGE_NITRATE_UNITS as u (u)}
            <option value={u}>{NITRATE_UNIT_LABELS[u]}</option>
          {/each}
        </select>
      </label>
    </div>
    <label>
      {tr('forage.form.nitrateRating')} <span class="optional">{tr('forage.form.asPrinted')}</span>
      <input type="text" maxlength={FORAGE_RATING_MAX} bind:value={draft.ratingNitrate} />
    </label>
  </fieldset>

  <fieldset>
    <legend
      >{tr('forage.form.hcn')} <span class="optional">{tr('forage.form.optional')}</span></legend
    >
    <div class="pair">
      <label>
        {tr('forage.form.valuePpm')}
        <input type="number" min="0" step="any" inputmode="decimal" bind:value={draft.hcnPpm} />
      </label>
      <label>
        {tr('forage.form.labRating')} <span class="optional">{tr('forage.form.asPrinted')}</span>
        <input type="text" maxlength={FORAGE_RATING_MAX} bind:value={draft.ratingHcn} />
      </label>
    </div>
  </fieldset>

  <label>
    {tr('forage.form.basis')}
    <select bind:value={draft.basis}>
      <option value="">{tr('forage.form.notEntered')}</option>
      {#each RATING_BASES as b (b)}
        <option value={b}>{ratingBasisLabel(b, locale)}</option>
      {/each}
    </select>
  </label>

  {#if canAttach}
    <fieldset>
      <legend
        >{tr('forage.form.report')}
        <span class="optional">{tr('forage.form.optional')}</span></legend
      >
      <DocumentAttach
        documentId={draft.documentId}
        kind="forage-test"
        canEdit
        onchange={(id) => {
          draft.documentId = id;
        }}
        ondelete={(id) => {
          if (draft.documentId === id) draft.documentId = null;
        }}
      />
    </fieldset>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <div class="actions">
    <button class="primary" type="submit" disabled={saving}>
      {saving ? tr('forage.form.saving') : tr('forage.form.save')}
    </button>
    {#if onCancel}
      <button class="secondary" type="button" onclick={onCancel}>{tr('forage.form.cancel')}</button>
    {/if}
  </div>
</form>

<style>
  .forage-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .help {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  label,
  legend {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-weight: 600;
    color: var(--color-ink);
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
  input,
  select {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    color: var(--color-ink);
    width: 100%;
    box-sizing: border-box;
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-2);
  }
  @media (max-width: 420px) {
    .pair {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .primary,
  .secondary {
    min-height: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    border: none;
    background: var(--color-forest);
    color: var(--color-cream);
  }
  .secondary {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    margin: 0;
    color: var(--color-rust);
  }
</style>
