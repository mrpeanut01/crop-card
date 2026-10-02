<script lang="ts">
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { invalidateAll } from '$app/navigation';
  import { createT } from '$lib/i18n';

  let { data } = $props();
  const tr = $derived(createT(data.locale));
  const eq = $derived(data.equipment);

  let logKind = $state<'maintenance' | 'inspection' | 'note'>('maintenance');
  let logNotes = $state('');
  let logging = $state(false);
  let logError = $state<string | null>(null);

  let editingNotes = $state(false);
  let notesDraft = $state('');
  let savingNotes = $state(false);
  let notesError = $state<string | null>(null);

  const spec = $derived((eq.spec ?? {}) as { tankGal?: number; nozzle?: string });

  function startEditNotes() {
    notesDraft = eq.notes ?? '';
    notesError = null;
    editingNotes = true;
  }

  async function saveNotes() {
    savingNotes = true;
    notesError = null;
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(eq.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesDraft.trim() })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        notesError = out.error ?? tr('stockui.httpStatus', { status: res.status });
        return;
      }
      editingNotes = false;
      await invalidateAll();
    } catch (e) {
      notesError = e instanceof Error ? e.message : String(e);
    } finally {
      savingNotes = false;
    }
  }

  let editingSpec = $state(false);
  let tankDraft = $state<number | null>(null);
  let nozzleDraft = $state('');
  let savingSpec = $state(false);
  let specError = $state<string | null>(null);
  let recalibrateNotice = $state(false);
  const nozzleWillChange = $derived(
    editingSpec && nozzleDraft.trim() !== (spec.nozzle ?? '').trim()
  );

  function startEditSpec() {
    tankDraft = spec.tankGal ?? null;
    nozzleDraft = spec.nozzle ?? '';
    specError = null;
    editingSpec = true;
  }

  async function saveSpec() {
    if (tankDraft != null && !(tankDraft > 0)) {
      specError = tr('equip.d.err.tank');
      return;
    }
    savingSpec = true;
    specError = null;
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(eq.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: {
            tankGal: tankDraft == null || Number.isNaN(tankDraft) ? null : tankDraft,
            nozzle: nozzleDraft.trim() || null
          }
        })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        specError = out.error ?? tr('stockui.httpStatus', { status: res.status });
        return;
      }
      editingSpec = false;
      recalibrateNotice = out.calibrationCleared === true;
      await invalidateAll();
    } catch (e) {
      specError = e instanceof Error ? e.message : String(e);
    } finally {
      savingSpec = false;
    }
  }

  let editingLabel = $state(false);
  let labelDraft = $state('');
  let savingLabel = $state(false);
  let labelError = $state<string | null>(null);

  function startEditLabel() {
    labelDraft = eq.label;
    labelError = null;
    editingLabel = true;
  }

  function cancelEditLabel() {
    editingLabel = false;
    labelError = null;
  }

  async function saveLabel() {
    const next = labelDraft.trim();
    if (!next) {
      labelError = tr('equip.d.err.name');
      return;
    }
    if (next === eq.label) {
      editingLabel = false;
      return;
    }
    savingLabel = true;
    labelError = null;
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(eq.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: next })
      });
      const out = await res.json();
      if (!res.ok) {
        labelError = out.error ?? tr('stockui.httpStatus', { status: res.status });
        return;
      }
      editingLabel = false;
      await invalidateAll();
    } catch (e) {
      labelError = e instanceof Error ? e.message : String(e);
    } finally {
      savingLabel = false;
    }
  }

  function onLabelKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLabel();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditLabel();
    }
  }

  async function appendLog() {
    if (!logNotes.trim()) return;
    logging = true;
    logError = null;
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(eq.id)}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: logKind, notes: logNotes.trim() })
      });
      const out = await res.json();
      if (!res.ok) {
        logError = out.error ?? tr('stockui.httpStatus', { status: res.status });
        return;
      }
      logNotes = '';
      await invalidateAll();
    } catch (e) {
      logError = e instanceof Error ? e.message : String(e);
    } finally {
      logging = false;
    }
  }

  function fmtTs(ts?: number | null) {
    return ts ? fmt.instant(ts, 'datetime') : '—';
  }

  function metricGpa(gpa: number): string {
    return currentPrefs().units === 'metric' ? ` (${fmt.qty(gpa, 'volumePerArea')})` : '';
  }
</script>

<header class="head">
  <a href="/equipment" class="back">{tr('equip.d.allEquipment')}</a>
  {#if editingLabel}
    <div class="label-edit">
      <input
        type="text"
        bind:value={labelDraft}
        onkeydown={onLabelKey}
        disabled={savingLabel}
        maxlength="120"
        aria-label={tr('equip.d.nameAria')}
      />
      <button class="primary" onclick={saveLabel} disabled={savingLabel || !labelDraft.trim()}>
        {savingLabel ? '…' : tr('equip.d.save')}
      </button>
      <button class="btn" onclick={cancelEditLabel} disabled={savingLabel}
        >{tr('inv.cancel')}</button
      >
    </div>
    {#if labelError}<p class="error">{labelError}</p>{/if}
  {:else}
    <div class="label-row">
      <h1>{eq.label}</h1>
      {#if data.canRename}
        <button class="rename-btn" onclick={startEditLabel} aria-label={tr('equip.d.renameAria')}>
          {tr('equip.d.rename')}
        </button>
      {/if}
    </div>
  {/if}
  <p class="meta">
    <span class="type-badge">{eq.type}</span>
    <code>{eq.id}</code>
  </p>
</header>

<section class="card">
  <h2>{tr('equip.d.state')}</h2>
  <dl>
    {#if eq.type === 'sprayer'}
      <dt>{tr('equip.d.calGpa')}</dt>
      <dd>
        {#if eq.state.calibratedGpa == null}
          <span class="warn">{tr('equip.d.uncalibrated')}</span>
        {:else}
          {eq.state.calibratedGpa}{metricGpa(eq.state.calibratedGpa)}
          {#if eq.state.calibrationDate}
            <small>({fmtTs(eq.state.calibrationDate)})</small>
          {/if}
        {/if}
      </dd>
      <dt>{tr('equip.d.lastChemistry')}</dt>
      <dd>
        {#if eq.state.lastChemistryClass}
          <span class="warn">{eq.state.lastChemistryClass}</span>
          <small>{tr('equip.d.at', { time: fmtTs(eq.state.lastUsedAt) })}</small>
        {:else}
          <span class="ok">{tr('equip.clean')}</span>
        {/if}
      </dd>
      <dt>Last decon</dt>
      <dd>{fmtTs(eq.state.lastDeconAt)}</dd>
      <dt>{tr('equip.d.tank')}</dt>
      <dd>{spec.tankGal != null ? fmt.label(spec.tankGal, 'volume') : '—'}</dd>
      <dt>{tr('equip.d.nozzle')}</dt>
      <dd>{spec.nozzle ?? '—'}</dd>
      {#if eq.state.winterizedAt}
        <dt>{tr('equip.d.winterized')}</dt>
        <dd>
          <span class="ok">{fmtTs(eq.state.winterizedAt)}</span>
          <small>· {tr('equip.d.recalSpring')}</small>
        </dd>
      {/if}
    {:else}
      <dt>{tr('equip.hourMeter')}</dt>
      <dd>{eq.state.hourMeter ?? '—'}</dd>
      <dt>{tr('equip.lastUsed')}</dt>
      <dd>{fmtTs(eq.state.lastUsedAt)}</dd>
    {/if}
  </dl>
  {#if editingSpec}
    <div class="spec-edit" data-testid="sprayer-spec-edit">
      <label>
        <span>{tr('equip.d.tankGal')}</span>
        <input
          type="number"
          min="0"
          step="any"
          inputmode="decimal"
          bind:value={tankDraft}
          disabled={savingSpec}
        />
      </label>
      <label>
        <span>{tr('equip.d.nozzle')}</span>
        <input
          type="text"
          maxlength="80"
          placeholder={tr('equip.d.nozzlePh')}
          bind:value={nozzleDraft}
          disabled={savingSpec}
        />
      </label>
    </div>
    <div class="actions">
      <button class="primary" onclick={saveSpec} disabled={savingSpec}>
        {savingSpec ? tr('inv.feed.saving') : tr('equip.d.saveSpec')}
      </button>
      <button class="btn" onclick={() => (editingSpec = false)} disabled={savingSpec}>
        {tr('inv.cancel')}
      </button>
    </div>
    {#if nozzleWillChange && eq.state.calibratedGpa != null}
      <p class="warn-note" data-testid="nozzle-recalibrate-warning">
        {tr('equip.d.nozzleWarn', { gpa: eq.state.calibratedGpa })}
      </p>
    {/if}
    {#if specError}<p class="error" role="alert">{specError}</p>{/if}
  {/if}
  {#if recalibrateNotice}
    <p class="warn-note" role="status" data-testid="nozzle-recalibrate-notice">
      {tr('equip.d.nozzleChanged')}
      <a href="/calibrate?sprayer={encodeURIComponent(eq.id)}">{tr('equip.d.calibrateNow')}</a>
    </p>
  {/if}
  {#if editingNotes}
    <label class="notes-edit">
      <span>{tr('equip.d.notes')}</span>
      <textarea rows="3" maxlength="500" bind:value={notesDraft} disabled={savingNotes}></textarea>
    </label>
    <div class="actions">
      <button class="primary" onclick={saveNotes} disabled={savingNotes}>
        {savingNotes ? tr('inv.feed.saving') : tr('equip.d.saveNotes')}
      </button>
      <button class="btn" onclick={() => (editingNotes = false)} disabled={savingNotes}>
        {tr('inv.cancel')}
      </button>
    </div>
    {#if notesError}<p class="error">{notesError}</p>{/if}
  {:else if eq.notes}
    <p class="notes">{eq.notes}</p>
  {/if}

  <div class="actions">
    {#if data.canRename && !editingNotes}
      <button class="btn" onclick={startEditNotes}
        >{eq.notes ? tr('equip.d.editNotes') : tr('equip.d.addNotes')}</button
      >
    {/if}
    {#if eq.type === 'sprayer' && data.canRename && !editingSpec}
      <button class="btn" onclick={startEditSpec}>{tr('equip.d.editSpec')}</button>
    {/if}
    {#if eq.type === 'sprayer'}
      <a class="btn" href="/calibrate?sprayer={encodeURIComponent(eq.id)}"
        >{tr('equip.d.calibrate')}</a
      >
      <a class="btn" href="/spray/decon?sprayer={encodeURIComponent(eq.id)}">Decon wizard</a>
      <a class="btn" href="/equipment/{encodeURIComponent(eq.id)}/winterize"
        >{tr('equip.d.winterize')}</a
      >
    {/if}
  </div>
</section>

{#if data.canEdit}
  <section class="card">
    <h2>{tr('equip.d.appendLog')}</h2>
    <div class="row">
      <select bind:value={logKind}>
        <option value="maintenance">{tr('equip.d.kind.maintenance')}</option>
        <option value="inspection">{tr('equip.d.kind.inspection')}</option>
        <option value="note">{tr('equip.d.kind.note')}</option>
      </select>
      <input type="text" placeholder={tr('equip.d.logPh')} bind:value={logNotes} />
      <button class="primary" onclick={appendLog} disabled={logging || !logNotes.trim()}>
        {logging ? '…' : tr('equip.d.append')}
      </button>
    </div>
    {#if logError}<p class="error">{logError}</p>{/if}
  </section>
{/if}

<section class="card">
  <h2>{tr('equip.d.log', { count: data.log.length })}</h2>
  {#if data.log.length === 0}
    <p class="empty">{tr('equip.d.noLog')}</p>
  {:else}
    <ul class="log">
      {#each data.log as entry (entry.id)}
        <li class="log-entry kind-{entry.kind}">
          <header>
            <span class="kind">{entry.kind}</span>
            <time>{fmtTs(entry.occurredAt)}</time>
          </header>
          {#if entry.notes}<p>{entry.notes}</p>{/if}
          {#if entry.payload}
            <details>
              <summary>{tr('equip.d.payload')}</summary>
              <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
            </details>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .head .back {
    display: inline-block;
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
  .head h1 {
    margin: 0 0 0.25rem;
  }
  .label-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .label-row h1 {
    margin: 0;
  }
  .rename-btn {
    background: white;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
    font-size: 0.85rem;
  }
  .spec-edit {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin: 0.75rem 0 0.5rem;
  }
  .spec-edit label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-weight: 600;
    min-width: 0;
  }
  .spec-edit input {
    min-height: 48px;
    font: inherit;
    padding: 0 0.5rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    box-sizing: border-box;
    width: 100%;
  }
  .label-edit {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
    margin: 0 0 0.25rem;
  }
  .label-edit input {
    flex: 1 1 240px;
    padding: 0.5rem 0.75rem;
    border: 2px solid #1f5e3a;
    border-radius: 6px;
    font-size: 1.4rem;
    font-weight: 600;
    min-height: 48px;
  }
  .meta {
    margin: 0 0 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .type-badge {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .meta code {
    background: #f5f5f5;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    color: #555;
    font-size: 0.8rem;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 1rem;
    margin: 0;
  }
  dt {
    color: #666;
  }
  dd {
    margin: 0;
  }
  dd small {
    color: #888;
    margin-left: 0.4rem;
  }
  .warn {
    background: #fff3cd;
    color: #b35900;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .ok {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .notes {
    background: #f8fbf9;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    margin: 0.75rem 0 0;
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
  }
  .btn {
    background: white;
    color: #1f5e3a;
    border: 2px solid #1f5e3a;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    text-decoration: none;
    font: inherit;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.4;
    cursor: pointer;
  }
  .notes-edit {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.75rem;
    font-weight: 600;
  }
  .notes-edit textarea {
    font: inherit;
    font-weight: 400;
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    min-height: 72px;
    box-sizing: border-box;
    width: 100%;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .row select,
  .row input {
    flex: 1 1 120px;
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .error {
    color: #b00020;
  }
  .empty {
    color: #555;
    font-style: italic;
  }
  .log {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .log-entry {
    background: #f8fbf9;
    border-left: 4px solid #1f5e3a;
    padding: 0.6rem 0.9rem;
    margin: 0.4rem 0;
    border-radius: 0 4px 4px 0;
  }
  .log-entry.kind-decon {
    border-left-color: #b00020;
    background: #fef0f0;
  }
  .warn-note {
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--color-wheat-soft);
    color: var(--color-ink);
    font-size: 0.9rem;
  }
  .warn-note a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
  }
  .log-entry.kind-calibration {
    border-left-color: #b35900;
    background: #fff8ec;
  }
  .log-entry.kind-maintenance {
    border-left-color: #6b3fa0;
    background: #f5f0fa;
  }
  .log-entry header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .kind {
    text-transform: uppercase;
    font-size: 0.75rem;
    font-weight: 700;
    color: #1f5e3a;
    background: white;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }
  time {
    color: #666;
    font-size: 0.85rem;
    font-family: monospace;
  }
  .log-entry p {
    margin: 0.4rem 0 0;
  }
  details {
    margin-top: 0.4rem;
  }
  pre {
    background: white;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    overflow-x: auto;
  }
</style>
