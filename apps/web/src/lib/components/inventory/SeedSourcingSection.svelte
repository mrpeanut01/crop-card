<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import DocumentAttach from '$lib/components/documents/DocumentAttach.svelte';
  import { fileHref } from '$lib/documents/client';
  import { fmt } from '$lib/prefsState.svelte';
  import {
    MAX_SOURCES_CHECKED,
    RESULT_MAX,
    SEED_ORGANIC_STATUSES,
    SEED_ORGANIC_STATUS_LABEL,
    SEED_SEARCH_FLAG_LABEL,
    SOURCE_RESULT_SUGGESTIONS,
    SUPPLIER_MAX,
    UNAVAILABILITY_NOTE_MAX,
    seedSearchFlag,
    sortChecks,
    type LotSeedSourcing,
    type SeedOrganicStatus,
    type SeedSourceCheck
  } from '$lib/stock/seedSourcing';

  /**
   * 33B (B-37 to B-39). Organic seed sourcing for one seed lot: what the
   * owner says about the seed, which suppliers were checked, a commercial
   * unavailability note and search evidence from the vault. The app never
   * says whether a search was enough; that is the certifier's call.
   */
  interface Props {
    itemId: string;
    lot: { id: string; lotNumber?: string; receivedAt: number; supplier?: string };
    sourcing: LotSeedSourcing;
    canEdit: boolean;
  }

  const { itemId, lot, sourcing, canEdit }: Props = $props();
  const uid = $props.id();

  const flag = $derived(seedSearchFlag(sourcing));
  const checks = $derived(sortChecks(sourcing.sourcesChecked));
  const lotLabel = $derived(
    lot.lotNumber ? `Lot ${lot.lotNumber}` : `Lot received ${fmt.instant(lot.receivedAt, 'date')}`
  );

  let editing = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let draftStatus = $state<SeedOrganicStatus | ''>('');
  let draftChecks = $state<SeedSourceCheck[]>([]);
  let draftNote = $state('');
  let attachKey = $state(0);

  function startEdit() {
    draftStatus = sourcing.status ?? '';
    draftChecks = sourcing.sourcesChecked.map((c) => ({ ...c }));
    draftNote = sourcing.unavailabilityNote ?? '';
    error = null;
    saved = null;
    editing = true;
  }

  function addCheck() {
    if (draftChecks.length >= MAX_SOURCES_CHECKED) return;
    draftChecks = [...draftChecks, { supplier: '', checkedAt: fmt.today(), result: '' }];
  }

  function removeCheck(i: number) {
    draftChecks = draftChecks.filter((_, j) => j !== i);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const filled = draftChecks.filter((c) => c.supplier.trim() || c.result.trim());
    if (filled.some((c) => !c.supplier.trim() || !c.result.trim() || !c.checkedAt)) {
      error = 'Each supplier check needs a supplier, a date and what you found.';
      return;
    }
    busy = true;
    try {
      const res = await fetch(
        `/api/stock/${encodeURIComponent(itemId)}/lots/${encodeURIComponent(lot.id)}/seed-sourcing`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: draftStatus === '' ? null : draftStatus,
            sourcesChecked: filled.map((c) => ({
              supplier: c.supplier,
              checkedAt: c.checkedAt,
              result: c.result
            })),
            unavailabilityNote: draftNote.trim() ? draftNote : null
          })
        }
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        error = b?.message ?? `We couldn't save this (HTTP ${res.status}).`;
        return;
      }
      editing = false;
      saved = 'Seed sourcing saved.';
      await invalidateAll();
    } catch {
      error = 'Saving seed sourcing needs a connection.';
    } finally {
      busy = false;
    }
  }

  async function attachEvidence(documentId: string | null): Promise<boolean> {
    if (!documentId) return true;
    error = null;
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectType: 'stock-lot', subjectId: lot.id })
      });
      if (!res.ok) {
        error = "We couldn't attach this file to the lot. Try again.";
        return false;
      }
      attachKey += 1;
      await invalidateAll();
      return true;
    } catch {
      error = 'Attaching a file needs a connection.';
      return false;
    }
  }

  async function detach(documentId: string, linkId: string) {
    error = null;
    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(documentId)}/links/${encodeURIComponent(linkId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        error = "We couldn't remove this file from the lot. Try again.";
        return;
      }
      await invalidateAll();
    } catch {
      error = 'Removing a file needs a connection.';
    }
  }
</script>

<article class="seed-sourcing" data-testid="seed-sourcing" data-lot-id={lot.id}>
  <header>
    <h3>{lotLabel}</h3>
    {#if lot.supplier}<span class="muted small">from {lot.supplier}</span>{/if}
  </header>

  <dl>
    <div>
      <dt>Seed status (owner-entered)</dt>
      <dd data-testid="seed-status">
        {sourcing.status ? SEED_ORGANIC_STATUS_LABEL[sourcing.status] : 'Not recorded'}
      </dd>
    </div>
  </dl>
  {#if flag}
    <p class="flag" data-testid="seed-search-flag">{SEED_SEARCH_FLAG_LABEL[flag]}</p>
  {/if}

  {#if checks.length > 0}
    <h4>Suppliers checked</h4>
    <ul class="checks" data-testid="seed-checks">
      {#each checks as c, i (i)}
        <li>
          <span class="muted small">{fmt.day(c.checkedAt)}</span>
          <strong>{c.supplier}</strong>: {c.result}
        </li>
      {/each}
    </ul>
  {/if}

  {#if sourcing.unavailabilityNote}
    <h4>Why organic seed was not used</h4>
    <p class="note">{sourcing.unavailabilityNote}</p>
  {/if}

  {#if sourcing.documents.length > 0 || canEdit}
    <h4>Search evidence</h4>
    {#if sourcing.documents.length > 0}
      <ul class="docs">
        {#each sourcing.documents as d (d.linkId)}
          <li>
            <a class="doc-link" href={fileHref(d.id)} target="_blank" rel="noopener">{d.title}</a>
            {#if canEdit}
              <button type="button" class="btn ghost" onclick={() => detach(d.id, d.linkId)}>
                Remove from lot
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if canEdit}
      {#key attachKey}
        <DocumentAttach documentId={null} kind="seed-search" canEdit onchange={attachEvidence} />
      {/key}
    {/if}
  {/if}

  {#if saved}<p class="saved" role="status">{saved}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if canEdit && !editing}
    <button type="button" class="btn" onclick={startEdit}>Edit seed sourcing</button>
  {/if}

  {#if editing}
    <form class="edit" onsubmit={save}>
      <label for="{uid}-status">Seed status</label>
      <select id="{uid}-status" bind:value={draftStatus}>
        <option value="">Not recorded</option>
        {#each SEED_ORGANIC_STATUSES as s (s)}
          <option value={s}>{SEED_ORGANIC_STATUS_LABEL[s]}</option>
        {/each}
      </select>

      <fieldset>
        <legend>Suppliers checked</legend>
        {#if draftChecks.length === 0}
          <p class="muted small">No supplier checks yet.</p>
        {/if}
        {#each draftChecks as c, i (i)}
          <div class="check-row">
            <label>
              <span>Supplier</span>
              <input type="text" maxlength={SUPPLIER_MAX} bind:value={c.supplier} />
            </label>
            <label>
              <span>Date checked</span>
              <input type="date" max={fmt.today()} bind:value={c.checkedAt} />
            </label>
            <label class="wide">
              <span>What you found</span>
              <input
                type="text"
                maxlength={RESULT_MAX}
                list="{uid}-results"
                bind:value={c.result}
              />
            </label>
            <button type="button" class="btn ghost" onclick={() => removeCheck(i)}>Remove</button>
          </div>
        {/each}
        <datalist id="{uid}-results">
          {#each SOURCE_RESULT_SUGGESTIONS as r (r)}<option value={r}></option>{/each}
        </datalist>
        {#if draftChecks.length < MAX_SOURCES_CHECKED}
          <button type="button" class="btn ghost" onclick={addCheck}>Add a supplier check</button>
        {/if}
      </fieldset>

      <label for="{uid}-note">Why organic seed was not used (optional)</label>
      <textarea id="{uid}-note" rows="3" maxlength={UNAVAILABILITY_NOTE_MAX} bind:value={draftNote}
      ></textarea>

      <div class="actions">
        <button type="button" class="btn ghost" onclick={() => (editing = false)}>Cancel</button>
        <button type="submit" class="btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save seed sourcing'}
        </button>
      </div>
    </form>
  {/if}
</article>

<style>
  .seed-sourcing {
    border-top: 1px solid var(--color-divider-soft, #e6e0cf);
    padding-top: 10px;
    margin-top: 10px;
    overflow-wrap: anywhere;
  }
  .seed-sourcing:first-child {
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
  }
  h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--color-forest-deep, #1f3522);
  }
  h4 {
    margin: 10px 0 4px;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-muted, #6a6f63);
  }
  dl {
    margin: 6px 0 0;
  }
  dt {
    font-size: 0.8rem;
    color: var(--color-ink-muted, #6a6f63);
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
  .flag {
    display: inline-block;
    margin: 6px 0 0;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--color-wheat-soft, #fbf3dc);
    border: 1px solid var(--color-wheat, #d9b45a);
    font-size: 0.8rem;
    font-weight: 600;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .docs li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .doc-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest, #1f5e3a);
    font-weight: 600;
  }
  .note {
    margin: 0;
    white-space: pre-wrap;
  }
  .btn {
    min-height: 48px;
    min-width: 48px;
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid var(--color-forest, #1f5e3a);
    background: var(--color-paper, #fff);
    color: var(--color-forest, #1f5e3a);
    font-weight: 600;
    cursor: pointer;
    margin-top: 8px;
  }
  .btn.primary {
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
  }
  .btn.ghost {
    border-color: var(--color-divider, #d6cfbd);
  }
  .edit {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }
  select,
  input,
  textarea {
    min-height: 48px;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    font: inherit;
    padding: 6px 8px;
  }
  textarea {
    min-height: 72px;
  }
  fieldset {
    border: 1px solid var(--color-divider-soft, #e6e0cf);
    border-radius: 6px;
    padding: 8px;
    margin: 4px 0;
    min-width: 0;
  }
  .check-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 6px;
    align-items: end;
    padding-bottom: 8px;
    border-bottom: 1px dashed var(--color-divider-soft, #e6e0cf);
    margin-bottom: 8px;
  }
  .check-row label {
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
    min-width: 0;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .muted {
    color: var(--color-ink-muted, #6a6f63);
  }
  .small {
    font-size: 0.8rem;
  }
  .saved {
    color: var(--color-forest-deep, #1f3522);
    margin: 6px 0 0;
  }
  .error {
    color: var(--color-rust, #a23a3a);
    margin: 6px 0 0;
  }
</style>
