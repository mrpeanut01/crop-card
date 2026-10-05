<script lang="ts">
  import { equipmentTypeDescription, equipmentTypeLabel } from '$lib/equipment/typeLabel';
  import { untrack } from 'svelte';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { invalidateAll } from '$app/navigation';
  import { createT } from '$lib/i18n';

  let { data } = $props();
  const tr = $derived(createT(data.locale));

  type EquipmentType =
    | 'sprayer'
    | 'planter'
    | 'drill'
    | 'rake'
    | 'baler'
    | 'tractor'
    | 'mower'
    | 'irrigation'
    | 'other';

  const allTypes: EquipmentType[] = [
    'sprayer',
    'planter',
    'drill',
    'rake',
    'baler',
    'tractor',
    'mower',
    'irrigation',
    'other'
  ];

  let typeFilter = $state<'all' | string>('all');
  const filtered = $derived(
    typeFilter === 'all' ? data.equipment : data.equipment.filter((e) => e.typeName === typeFilter)
  );

  // #474: /equipment?add=sprayer (the old Inventory sprayer add link)
  // opens the form with the Sprayer type filled in.
  let newTypeName = $state(untrack(() => data.addType ?? ''));
  let newLabel = $state('');
  let newNotes = $state('');
  let newTankGal = $state<number | null>(null);
  let newNozzle = $state('');
  const addingSprayer = $derived(newTypeName.trim().toLowerCase().includes('sprayer'));
  let labelInput = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (data.addType && labelInput) untrack(() => labelInput?.focus());
  });
  let creating = $state(false);
  let createError = $state<string | null>(null);

  /** Resolve newTypeName → typeId, prompting to add a new term if it doesn't
   *  match an existing equipment type. Returns { ok: false } when the user
   *  cancels the prompt or the create fails. */
  async function resolveTypeId(): Promise<{
    ok: boolean;
    typeId: string | null;
    legacyType: EquipmentType;
  }> {
    const name = newTypeName.trim();
    if (!name) {
      createError = tr('equip.err.typeRequired');
      return { ok: false, typeId: null, legacyType: 'other' };
    }
    const existing = data.types.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      return { ok: true, typeId: existing.id, legacyType: nameToLegacyEnum(existing.name) };
    }
    const confirmed = confirm(tr('equip.confirmNewType', { name }));
    if (!confirmed) return { ok: false, typeId: null, legacyType: 'other' };
    const res = await fetch('/api/types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'equipment', name })
    });
    const out = await res.json();
    if (!res.ok) {
      createError = tr('equip.err.addType', { error: out.error ?? res.status });
      return { ok: false, typeId: null, legacyType: 'other' };
    }
    return { ok: true, typeId: out.type.id as string, legacyType: nameToLegacyEnum(name) };
  }

  /** Map a Type name to the closest legacy enum value so the existing
   *  equipment.type column stays valid. User-added Types fall back to 'other'. */
  function nameToLegacyEnum(name: string): EquipmentType {
    const lower = name.toLowerCase();
    for (const t of allTypes) if (lower.includes(t)) return t;
    return 'other';
  }

  async function createEquipment() {
    if (!newLabel.trim()) return;
    creating = true;
    createError = null;
    try {
      const typeRes = await resolveTypeId();
      if (!typeRes.ok) {
        creating = false;
        return;
      }
      const spec: Record<string, unknown> = {};
      if (typeRes.legacyType === 'sprayer') {
        if (newTankGal != null && newTankGal > 0) spec.tankGal = newTankGal;
        if (newNozzle.trim()) spec.nozzle = newNozzle.trim();
      }
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: typeRes.legacyType,
          typeId: typeRes.typeId,
          label: newLabel.trim(),
          notes: newNotes.trim() || undefined,
          spec: Object.keys(spec).length > 0 ? spec : undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        createError = out.error ?? tr('stockui.httpStatus', { status: res.status });
        return;
      }
      newLabel = '';
      newNotes = '';
      newTypeName = '';
      newTankGal = null;
      newNozzle = '';
      await invalidateAll();
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  function fmtTs(ts?: number | null) {
    return ts ? fmt.instant(ts, 'date') : '—';
  }

  function metricGpa(gpa: number): string {
    return currentPrefs().units === 'metric' ? ` (${fmt.qty(gpa, 'volumePerArea')})` : '';
  }

  async function deleteEquipment(id: string, label: string) {
    if (!confirm(tr('equip.confirmDelete', { label }))) {
      return;
    }
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        alert(tr('equip.err.delete', { error: out.error ?? res.status }));
        return;
      }
      await invalidateAll();
    } catch (e) {
      alert(tr('equip.err.delete', { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const e of data.equipment) m.set(e.typeName, (m.get(e.typeName) ?? 0) + 1);
    return m;
  });
</script>

<svelte:head><title>{tr('equip.pageTitle')}</title></svelte:head>

<h1>{tr('equip.title')}</h1>
<p class="lede">
  {tr('equip.lede')}
  <a href="/inventory">{tr('equip.ledeLink')}</a>.
</p>

<section class="card">
  <h2>{tr('equip.filterByType')}</h2>
  <div class="filters">
    <button class="chip" class:active={typeFilter === 'all'} onclick={() => (typeFilter = 'all')}>
      {tr('equip.all', { count: data.equipment.length })}
    </button>
    {#each [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])) as [name, c] (name)}
      <button class="chip" class:active={typeFilter === name} onclick={() => (typeFilter = name)}>
        {equipmentTypeLabel(name, data.locale)} ({c})
      </button>
    {/each}
  </div>
</section>

{#if !data.canEdit}
  <section class="card role-notice">
    <h2>{tr('equip.viewOnly')}</h2>
    <p>{tr('equip.viewOnlyNote')}</p>
  </section>
{/if}

{#if data.canEdit}
  <section class="card" id="add">
    <h2>{tr('equip.add.title')}</h2>
    <datalist id="equipment-type-suggestions">
      {#each data.types as t (t.id)}<option value={t.name}
          >{equipmentTypeDescription(t.name, t.description, data.locale)}</option
        >{/each}
    </datalist>
    <div class="add-grid">
      <label class="field">
        <span>{tr('equip.add.type')}</span>
        <input
          type="text"
          list="equipment-type-suggestions"
          placeholder={tr('equip.add.typePh')}
          bind:value={newTypeName}
        />
      </label>
      <label class="field">
        <span>{tr('equip.add.name')}</span>
        <input
          type="text"
          placeholder={addingSprayer ? tr('equip.add.namePhSprayer') : tr('equip.add.namePh')}
          bind:value={newLabel}
          bind:this={labelInput}
        />
      </label>
      {#if addingSprayer}
        <label class="field">
          <span>{tr('equip.add.tank')}</span>
          <input
            type="number"
            min="0"
            step="0.5"
            inputmode="decimal"
            placeholder="4"
            bind:value={newTankGal}
          />
        </label>
        <label class="field">
          <span>{tr('equip.add.nozzle')}</span>
          <input
            type="text"
            placeholder={tr('equip.add.nozzlePlaceholder')}
            maxlength="60"
            bind:value={newNozzle}
          />
        </label>
      {/if}
      <label class="field">
        <span>{tr('equip.add.notes')}</span>
        <input type="text" bind:value={newNotes} />
      </label>
    </div>
    {#if addingSprayer}
      <p class="hint-new-type">
        {tr('equip.add.uncalibrated')}
      </p>
    {/if}
    <button
      class="primary add-btn"
      onclick={createEquipment}
      disabled={creating || !newLabel.trim() || !newTypeName.trim()}
    >
      {creating ? '…' : tr('equip.add.button')}
    </button>
    {#if newTypeName.trim() && !data.types.find((t) => t.name.toLowerCase() === newTypeName
            .trim()
            .toLowerCase())}
      <p class="hint-new-type">
        {tr('equip.add.newType', { name: newTypeName.trim() })}
      </p>
    {/if}
    {#if createError}<p class="error">{createError}</p>{/if}
  </section>
{/if}

{#if filtered.length === 0}
  <section class="card empty">
    <p>{tr('equip.noMatch')}</p>
  </section>
{:else}
  <ul class="equipment-list">
    {#each filtered as e (e.id)}
      <li class="card item type-{e.type}">
        <header>
          <a href="/equipment/{e.id}"><strong>{e.label}</strong></a>
          <span class="type-badge">{equipmentTypeLabel(e.typeName, data.locale)}</span>
          {#if e.retiredAt}<span class="retired"
              >{tr('equip.retired', { date: fmtTs(e.retiredAt) })}</span
            >{/if}
          {#if data.canEdit}
            <button
              class="delete-btn"
              onclick={() => deleteEquipment(e.id, e.label)}
              title={tr('equip.delete')}
              aria-label={tr('equip.deleteAria', { label: e.label })}
            >
              🗑
            </button>
          {/if}
        </header>
        <dl>
          {#if e.type === 'sprayer'}
            <dt>GPA</dt>
            <dd>
              {e.state.calibratedGpa != null
                ? `${e.state.calibratedGpa}${metricGpa(e.state.calibratedGpa)}`
                : '—'}
            </dd>
            <dt>{tr('equip.lastLoad')}</dt>
            <dd>
              {#if e.state.lastChemistryClass}
                <span class="warn">{e.state.lastChemistryClass}</span>
                <a class="link" href="/spray/decon?sprayer={encodeURIComponent(e.id)}"
                  >{tr('equip.deconLink')}</a
                >
              {:else}
                <span class="ok">{tr('equip.clean')}</span>
              {/if}
            </dd>
            <dt>{tr('equip.lastDecon')}</dt>
            <dd>{fmtTs(e.state.lastDeconAt)}</dd>
          {:else}
            <dt>{tr('equip.hourMeter')}</dt>
            <dd>{e.state.hourMeter ?? '—'}</dd>
            <dt>{tr('equip.lastUsed')}</dt>
            <dd>{fmtTs(e.state.lastUsedAt)}</dd>
          {/if}
        </dl>
        {#if e.notes}<p class="notes">{e.notes}</p>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: var(--color-ink-muted);
    margin: 0 0 1.5rem;
  }
  .lede a {
    color: var(--color-forest-deep);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    min-width: 48px;
  }
  .card {
    background: var(--color-paper);
    border-radius: var(--radius-card, 8px);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest-deep);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .filters {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .chip {
    background: var(--color-paper);
    border: 2px solid var(--color-divider);
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-input, 6px);
    cursor: pointer;
    text-transform: capitalize;
    font: inherit;
    min-height: 48px;
    color: var(--color-ink);
  }
  .chip.active {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border-color: var(--color-forest-deep);
  }
  .role-notice {
    border-left: 4px solid var(--color-wheat, #d4a75c);
    background: rgba(212, 167, 92, 0.12);
  }
  .role-notice h2 {
    color: var(--color-wheat, #d4a75c);
  }
  .hint-new-type {
    font-size: 0.82rem;
    color: var(--color-ink-soft);
    margin: 0.4rem 0 0;
    font-style: italic;
  }
  .add-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 0.75rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--color-ink);
  }
  .add-btn {
    margin-top: 0.75rem;
  }
  .field input {
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
    font-weight: 400;
    padding: 0.6rem;
    border: 2px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    font-size: 1rem;
    min-height: 48px;
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: none;
    border-radius: var(--radius-input, 6px);
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: var(--color-ink-muted);
    cursor: not-allowed;
  }
  .error {
    color: var(--color-rust, #ba4b38);
  }
  .empty {
    text-align: center;
    padding: 2rem;
    color: var(--color-ink-muted);
  }
  .equipment-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .item header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .item header a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    min-width: 48px;
    color: var(--color-forest-deep);
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
  }
  .item header a:hover {
    text-decoration: underline;
  }
  .type-badge {
    background: rgba(44, 82, 55, 0.1);
    color: var(--color-forest-deep);
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .retired {
    color: var(--color-ink-muted);
    font-style: italic;
    font-size: 0.85rem;
  }
  .delete-btn {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--color-divider);
    color: var(--color-rust, #ba4b38);
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-input, 6px);
    cursor: pointer;
    font-size: 0.9rem;
    min-height: 48px;
    min-width: 48px;
  }
  .delete-btn:hover {
    background: rgba(186, 75, 56, 0.08);
    border-color: var(--color-rust, #ba4b38);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;
    font-size: 0.9rem;
  }
  dt {
    color: var(--color-ink-muted);
  }
  dd {
    margin: 0;
    color: var(--color-ink);
  }
  .warn {
    background: rgba(212, 167, 92, 0.18);
    color: var(--color-ink);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .ok {
    background: rgba(44, 82, 55, 0.1);
    color: var(--color-forest-deep);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 0.5rem;
    color: var(--color-rust, #ba4b38);
    text-decoration: none;
    font-weight: 600;
    margin-left: 0.25rem;
  }
  .notes {
    color: var(--color-ink-muted);
    font-size: 0.9rem;
    margin: 0.5rem 0 0;
  }
</style>
